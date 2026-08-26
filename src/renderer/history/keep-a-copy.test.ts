import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Saving a copy from inside the "delete for good?" dialog.
 *
 * This one is not assembly — it is a small state machine around an async call,
 * and every branch of it is a thing somebody is told. Its own header names the
 * stake: *"an export somebody believes happened and did not is worse than no
 * export offered at all."*
 *
 * The disable/re-enable is the part worth holding. Both buttons go down while
 * the write runs so the destructive one cannot be reached mid-export, and both
 * must come back on **every** outcome — a dialog left dead has the
 * conversations still there and no way to confirm or dismiss.
 *
 * ## Which line actually guarantees that, established by mutation
 *
 * It is the `.catch()`, not the `.finally()`. The chain is
 * `then → catch → finally`, so by the time the cleanup runs the promise is
 * resolved whatever happened — swapping `.finally` for `.then` changes
 * nothing, and a mutation test proved it by not failing.
 *
 * Removing the `.catch()` **does** fail these. So the `finally` expresses
 * intent and the `catch` carries the guarantee, and a reader who assumed the
 * opposite would "simplify" the wrong one. This note exists because the first
 * draft of this file asserted the opposite in as many words.
 */

interface Button {
  disabled: boolean
  textContent: string
  click: () => void
}

function button(): Button {
  let listener: () => void = () => undefined
  const self: Button = {
    disabled: false,
    textContent: '',
    click: () => {
      listener()
    },
  }
  Object.assign(self, {
    addEventListener: (_type: string, handler: () => void) => {
      listener = handler
    },
  })
  return self
}

const sureExportEl = button()
const sureYesEl = button()
const said: { text: string; bad: boolean }[] = []

vi.mock('./elements', () => ({
  get sureExportEl() {
    return sureExportEl
  },
  get sureYesEl() {
    return sureYesEl
  },
}))

vi.mock('./status', () => ({
  say: (text: string, bad = false) => said.push({ text, bad }),
}))

const { offerACopyFirst } = await import('./keep-a-copy')

type ExportResult =
  | { ok: true; path: string; conversations: number }
  | { ok: false; cancelled: boolean; why?: string }

/** Arm the bridge with one answer, and run the click to completion. */
async function clickWith(answer: Promise<ExportResult>): Promise<void> {
  vi.stubGlobal('window', { mochiHistory: { exportAll: () => answer } })
  sureExportEl.click()
  // The handler is `void`ed, so the assertions have to wait for its chain.
  await answer.catch(() => undefined)
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

beforeEach(() => {
  said.length = 0
  sureExportEl.disabled = false
  sureYesEl.disabled = false
  sureExportEl.textContent = ''
  offerACopyFirst()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('saving a copy before deciding', () => {
  it('says where it went, and how much', async () => {
    await clickWith(Promise.resolve({ ok: true, path: '/tmp/out.json', conversations: 12 }))
    expect(said[0]?.text).toContain('12')
    expect(said[0]?.text).toContain('/tmp/out.json')
    expect(said[0]?.bad).toBe(false)
  })

  it('marks the button with what was saved', async () => {
    // The dialog stays open, so the button itself is where the outcome lives —
    // somebody is about to make an irreversible choice next to it.
    await clickWith(Promise.resolve({ ok: true, path: '/tmp/out.json', conversations: 12 }))
    expect(sureExportEl.textContent).toContain('12')
  })

  it('says nothing when the save panel was simply dismissed', async () => {
    // Cancelling is not a failure and must not be reported as one.
    await clickWith(Promise.resolve({ ok: false, cancelled: true }))
    expect(said).toHaveLength(0)
  })

  it('reports a refusal that was not a cancellation', async () => {
    await clickWith(Promise.resolve({ ok: false, cancelled: false, why: 'the disk is full' }))
    expect(said[0]?.bad).toBe(true)
    expect(said[0]?.text).toContain('the disk is full')
  })

  it('reports a rejection rather than losing it', async () => {
    /*
      The channel can die. Without the `catch`, this is an unhandled rejection
      in a window whose devtools nobody has open — and the button stays down,
      because `finally` would still run but nothing would say why the export
      did not happen.
    */
    await clickWith(Promise.reject(new Error('the channel is gone')))
    expect(said[0]?.bad).toBe(true)
    expect(said[0]?.text).toContain('the channel is gone')
  })
})

describe('what the destructive button is doing meanwhile', () => {
  it('is unreachable while the write runs', async () => {
    /*
      The whole reason both are disabled.

      Deleting while an export is mid-write races the read it is doing, and the
      file that lands is a copy of a thing that no longer exists.
    */
    let settle: (value: ExportResult) => void = () => undefined
    const pending = new Promise<ExportResult>((resolve) => {
      settle = resolve
    })
    vi.stubGlobal('window', { mochiHistory: { exportAll: () => pending } })
    sureExportEl.click()
    expect(sureYesEl.disabled, 'delete was reachable during an export').toBe(true)
    expect(sureExportEl.disabled, 'export could be started twice').toBe(true)
    settle({ ok: true, path: '/tmp/out.json', conversations: 1 })
    await pending
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(sureYesEl.disabled).toBe(false)
  })

  it('comes back after a refusal', async () => {
    await clickWith(Promise.resolve({ ok: false, cancelled: false, why: 'no' }))
    expect(sureYesEl.disabled).toBe(false)
    expect(sureExportEl.disabled).toBe(false)
  })

  it('comes back after a cancellation', async () => {
    await clickWith(Promise.resolve({ ok: false, cancelled: true }))
    expect(sureYesEl.disabled).toBe(false)
  })

  it('comes back after a rejection', async () => {
    /*
      THE ONE THAT MATTERS, and the `.catch()` is what keeps it.

      Without that catch the rejection propagates past the cleanup, the buttons
      stay down, and the dialog is permanently dead after one dropped channel —
      conversations still there, and neither button able to confirm or dismiss.
      Verified by removing it: these fail.
    */
    await clickWith(Promise.reject(new Error('gone')))
    expect(sureYesEl.disabled, 'the dialog was left dead').toBe(false)
    expect(sureExportEl.disabled).toBe(false)
  })
})
