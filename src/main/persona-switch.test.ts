/**
 * The failure matrix for the switch.
 *
 * Every one of these cases corresponds to a defect that shipped and that no
 * existing test could see, because the transaction lived in a file a test
 * cannot import. That is the whole reason this module exists: the thing under
 * test has to be the code that INTERPRETS a failure, not a description of what
 * it was meant to do.
 */

import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_PERSONA, type Persona } from '@shared/persona'
import { switchPersona, type SwitchDeps } from './persona-switch'

const tutor: Persona = { ...DEFAULT_PERSONA, id: 'tutor', name: 'Ada', theme: 'sky' }

function harness(overrides: Partial<SwitchDeps> = {}): {
  deps: SwitchDeps
  calls: Record<string, ReturnType<typeof vi.fn>>
  adopted: Persona[]
} {
  const adopted: Persona[] = []
  const calls = {
    remember: vi.fn(() => true),
    adopt: vi.fn((p: Persona) => adopted.push(p)),
    endSession: vi.fn(),
    showCompanion: vi.fn(),
    tellSettings: vi.fn(),
    refreshTray: vi.fn(),
    warn: vi.fn(),
  }
  const deps: SwitchDeps = {
    find: (id) => (id === 'tutor' ? tutor : null),
    current: () => DEFAULT_PERSONA,
    ...calls,
    ...overrides,
  }
  return { deps, calls, adopted }
}

describe('nothing happens when there is nothing to do', () => {
  it('refuses an id the catalog does not have, touching nothing', () => {
    const { deps, calls } = harness()
    expect(switchPersona(deps, 'ghost')).toEqual({ kind: 'unknown' })
    for (const [name, fn] of Object.entries(calls)) {
      expect(fn, name).not.toHaveBeenCalled()
    }
  })

  it('does nothing when she is already the active persona', () => {
    const { deps, calls } = harness({ current: () => tutor })
    expect(switchPersona(deps, 'tutor')).toEqual({ kind: 'already' })
    // Not an error, and not a no-op that still churns every surface: a tray
    // click on the persona already worn should cost nothing at all.
    expect(calls.remember).not.toHaveBeenCalled()
    expect(calls.adopt).not.toHaveBeenCalled()
  })
})

describe('the durable commit comes first', () => {
  it('changes nothing at all when the remembered id cannot be written', () => {
    const { deps, calls } = harness({ remember: vi.fn(() => false) })

    expect(switchPersona(deps, 'tutor')).toEqual({ kind: 'not-remembered' })

    // The defect this pins: adopting first and writing second left persona B
    // on screen while the disk still said A, so the switch silently undid
    // itself at the next launch and reported success in the meantime.
    expect(calls.adopt).not.toHaveBeenCalled()
    expect(calls.endSession).not.toHaveBeenCalled()
    expect(calls.showCompanion).not.toHaveBeenCalled()
    expect(calls.tellSettings).not.toHaveBeenCalled()
    expect(calls.refreshTray).not.toHaveBeenCalled()
  })

  it('adopts only after the write succeeded', () => {
    const order: string[] = []
    const { deps } = harness({
      remember: vi.fn(() => {
        order.push('remember')
        return true
      }),
      adopt: vi.fn(() => order.push('adopt')),
      endSession: vi.fn(() => order.push('endSession')),
      showCompanion: vi.fn(() => order.push('showCompanion')),
      tellSettings: vi.fn(() => order.push('tellSettings')),
      refreshTray: vi.fn(() => order.push('refreshTray')),
    })

    expect(switchPersona(deps, 'tutor')).toEqual({ kind: 'switched', persona: tutor })
    // The session ends BEFORE the new face and name appear, so the transition
    // reads as one character leaving and another arriving.
    expect(order).toEqual([
      'remember',
      'adopt',
      'endSession',
      'showCompanion',
      'tellSettings',
      'refreshTray',
    ])
  })
})

describe('one surface failing does not deprive the others', () => {
  // Each of these is a real shape: a companion window that has gone, a
  // settings window torn down mid-send, a tray destroyed during quit.
  for (const failing of ['endSession', 'showCompanion', 'tellSettings', 'refreshTray'] as const) {
    it(`carries on when ${failing} throws`, () => {
      const { deps, calls } = harness({
        [failing]: vi.fn(() => {
          throw new Error('gone')
        }),
      })

      // Still a switch. The durable state already says so, so the surfaces
      // have to be brought along as far as they can be -- the alternative is
      // a tray still showing somebody she is no longer.
      expect(switchPersona(deps, 'tutor')).toEqual({ kind: 'switched', persona: tutor })
      expect(calls.warn).toHaveBeenCalledTimes(1)

      for (const other of ['endSession', 'showCompanion', 'tellSettings', 'refreshTray'] as const) {
        if (other !== failing) expect(calls[other], other).toHaveBeenCalledTimes(1)
      }
    })
  }

  it('never throws at its caller, whatever every surface does', () => {
    const boom = (): never => {
      throw new Error('gone')
    }
    const { deps, calls } = harness({
      endSession: vi.fn(boom),
      showCompanion: vi.fn(boom),
      tellSettings: vi.fn(boom),
      refreshTray: vi.fn(boom),
    })

    expect(() => switchPersona(deps, 'tutor')).not.toThrow()
    expect(calls.warn).toHaveBeenCalledTimes(4)
  })
})

describe('what the caller is told', () => {
  it('hands back the persona that was adopted, so nobody re-derives it', () => {
    const { deps, adopted } = harness()
    const outcome = switchPersona(deps, 'tutor')
    expect(outcome).toEqual({ kind: 'switched', persona: tutor })
    expect(adopted).toEqual([tutor])
  })
})

describe('when this process cannot take her on', () => {
  it('names the outcome rather than reporting a switch', () => {
    const { deps, calls } = harness({
      adopt: vi.fn(() => {
        throw new Error('the face would not load')
      }),
    })

    // The durable write already happened, so this is NOT `not-remembered`.
    // Reporting it as a switch would tell the tray to draw somebody this
    // process is not wearing.
    expect(switchPersona(deps, 'tutor')).toEqual({ kind: 'not-adopted', persona: tutor })
    expect(calls.warn).toHaveBeenCalledTimes(1)
    // Nothing downstream runs: the surfaces have not been told anything, which
    // is the only state a restart can resolve cleanly.
    expect(calls.endSession).not.toHaveBeenCalled()
    expect(calls.showCompanion).not.toHaveBeenCalled()
    expect(calls.tellSettings).not.toHaveBeenCalled()
    expect(calls.refreshTray).not.toHaveBeenCalled()
  })
})
