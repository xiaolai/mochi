/**
 * The three rules this module exists to hold together.
 *
 * Each was a bug once, and each was invisible while the state lived as three
 * separate flags in the composition root: only the newest probe may settle,
 * only one repair dialog at a time, and the remedy depends on which credential
 * the user chose.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CodexStatus } from '../codex/status'

const checkCodex = vi.fn<() => Promise<CodexStatus>>()
vi.mock('../codex/status', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../codex/status')>()),
  checkCodex: () => checkCodex(),
}))

const { createAvailability } = await import('./availability')

const READY: CodexStatus = { kind: 'ready', version: '1.0', mode: 'chatgpt' }
const LOGGED_OUT: CodexStatus = { kind: 'logged-out', version: '1.0' }

/** A promise plus the handle to settle it, so a test can order two probes. */
function deferred(): { promise: Promise<CodexStatus>; settle: (s: CodexStatus) => void } {
  let settle!: (s: CodexStatus) => void
  const promise = new Promise<CodexStatus>((resolve) => {
    settle = resolve
  })
  return { promise, settle }
}

function make(overrides: Partial<Parameters<typeof createAvailability>[0]> = {}) {
  const prompts: CodexStatus[] = []
  const deps = {
    source: () => 'codex' as const,
    keyStored: () => false,
    onChange: vi.fn(),
    promptRepair: async (status: CodexStatus) => {
      prompts.push(status)
      await Promise.resolve()
    },
    openKeySettings: vi.fn(),
    ...overrides,
  }
  return { availability: createAvailability(deps), deps, prompts }
}

afterEach(() => {
  checkCodex.mockReset()
})

describe('only the newest probe settles', () => {
  it('keeps the newer verdict when an older probe finishes last', async () => {
    // Three callers start a probe -- launch, the Check button, and each round
    // of the repair dialog -- and nothing sequenced them. A slow launch probe
    // finishing after a fast Check overwrote the newer verdict with its own,
    // and the tray then described a machine as it had been seconds earlier.
    const slow = deferred()
    const fast = deferred()
    checkCodex.mockReturnValueOnce(slow.promise).mockReturnValueOnce(fast.promise)

    const { availability } = make()
    const first = availability.probe()
    const second = availability.probe()

    fast.settle(READY)
    await second
    expect(availability.remedy()).toBeNull()

    // The older one lands last and must not win.
    slow.settle(LOGGED_OUT)
    await first
    expect(availability.remedy()).toBeNull()
  })

  it('still returns its own answer to the caller that asked', async () => {
    // Overtaken is not the same as wrong. The caller asked a question and gets
    // the answer to it; what changes is that it does not become global state.
    const slow = deferred()
    checkCodex.mockReturnValueOnce(slow.promise).mockResolvedValueOnce(READY)

    const { availability } = make()
    const first = availability.probe()
    await availability.probe()
    slow.settle(LOGGED_OUT)
    expect((await first).kind).toBe('logged-out')
  })
})

describe('one repair dialog at a time', () => {
  it('refuses a second while the first is open', async () => {
    checkCodex.mockResolvedValue(LOGGED_OUT)
    const { availability, prompts } = make()

    await Promise.all([availability.repair(), availability.repair()])
    expect(prompts.length).toBe(1)
  })

  it('reports that it is repairing, so the tray can grey its own item', async () => {
    checkCodex.mockResolvedValue(LOGGED_OUT)
    let sawRepairing = false
    const { availability } = make({
      promptRepair: async () => {
        sawRepairing = availability.repairing()
        await Promise.resolve()
      },
    })

    expect(availability.repairing()).toBe(false)
    await availability.repair()
    expect(sawRepairing, 'the guard must be held while the dialog is up').toBe(true)
    expect(availability.repairing()).toBe(false)
  })

  it('releases the guard even when the dialog throws', async () => {
    checkCodex.mockResolvedValue(LOGGED_OUT)
    const { availability } = make({
      promptRepair: () => Promise.reject(new Error('the dialog broke')),
    })
    await expect(availability.probeAndOffer()).rejects.toThrow('the dialog broke')
    // Stuck at true, every later repair silently does nothing and the tray item
    // stays greyed for the life of the process.
    expect(availability.repairing()).toBe(false)
  })
})

describe('the remedy depends on which credential was chosen', () => {
  it('asks for a key rather than a Codex login when the key is the source', async () => {
    // Every Codex remedy is the wrong instruction here -- `login` would send
    // somebody to a terminal to fix a text field.
    const { availability } = make({ source: () => 'apikey', keyStored: () => false })
    expect(availability.remedy()).toBe('store-key')
  })

  it('is satisfied by a stored key without asking Codex anything', async () => {
    const { availability } = make({ source: () => 'apikey', keyStored: () => true })
    expect(availability.remedy()).toBeNull()
    expect(checkCodex).not.toHaveBeenCalled()
  })

  it('opens settings for a missing key instead of a Codex dialog', async () => {
    const { availability, deps, prompts } = make({ source: () => 'apikey', keyStored: () => false })
    await availability.repair()
    expect(deps.openKeySettings).toHaveBeenCalledOnce()
    expect(prompts).toEqual([])
  })

  it('does not probe Codex at launch when the key is the source', async () => {
    // Three child processes to answer a question `remedy` short-circuits past.
    const { availability } = make({ source: () => 'apikey', keyStored: () => true })
    await availability.probeAndOffer()
    expect(checkCodex).not.toHaveBeenCalled()
  })
})

describe('what it believes before anything has been checked', () => {
  it('does not claim she is ready', async () => {
    // `null` means ready, and starting there meant Wake was offered for as long
    // as the credential probe took -- pressing it opened a session with no
    // bearer.
    const { availability } = make()
    expect(availability.remedy()).not.toBeNull()
  })

  it('offers the dialog at launch when there is something to fix', async () => {
    // The launch path used to set the guard and then call the guarded entry
    // point from its own `.then`, which begins by returning if the guard is
    // held -- so the startup prompt could never open, and a user with no Codex
    // installed was told nothing at all.
    checkCodex.mockResolvedValue(LOGGED_OUT)
    const { availability, prompts } = make()
    await availability.probeAndOffer()
    expect(prompts.map((p) => p.kind)).toEqual(['logged-out'])
  })

  it('says nothing at launch when she can already speak', async () => {
    checkCodex.mockResolvedValue(READY)
    const { availability, prompts } = make()
    await availability.probeAndOffer()
    expect(prompts).toEqual([])
    expect(availability.remedy()).toBeNull()
  })
})
