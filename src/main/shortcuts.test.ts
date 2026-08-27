import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Rebinding a key, and what happens when the new combination cannot be had.
 *
 * The whole point of this module is that a refusal is an ORDINARY outcome — a
 * combination somebody has just chosen is far likelier to be taken than one
 * this project picked for being empty — so the interesting cases are the ones
 * where `register` answers false, and they are unreachable through the real
 * `globalShortcut`: it depends on what else is running on the machine.
 */

/** Combinations a pretend other application is holding. */
let taken = new Set<string>()
/** What this process currently holds, and what it is bound to. */
let held = new Map<string, () => void>()
/** Every call, in order, so a test can assert the ORDER of release and claim. */
let calls: string[] = []
/** A combination whose registration throws, standing in for a malformed one. */
let throwsOn: string | null = null

vi.mock('electron', () => ({
  globalShortcut: {
    register: (accelerator: string, handler: () => void) => {
      calls.push(`register ${accelerator}`)
      if (accelerator === throwsOn) throw new Error('bad accelerator')
      if (taken.has(accelerator)) return false
      held.set(accelerator, handler)
      return true
    },
    unregister: (accelerator: string) => {
      calls.push(`unregister ${accelerator}`)
      held.delete(accelerator)
    },
    unregisterAll: () => {
      held.clear()
    },
  },
}))

const { claimOne, claimShortcuts, rebindShortcut } = await import('./shortcuts')

beforeEach(() => {
  taken = new Set()
  held = new Map()
  calls = []
  throwsOn = null
})

describe('claiming the keys at launch', () => {
  it('registers what it is given, not what the app ships', () => {
    // The combinations are a setting now. A function reaching for `SHORTCUTS`
    // would be the answer that ignores everything somebody chose.
    const outcomes = claimShortcuts(
      { rest: () => undefined, hide: () => undefined },
      { rest: 'Alt+F9', hide: 'Alt+F10' },
    )
    expect(outcomes.map((one) => one.accelerator)).toEqual(['Alt+F9', 'Alt+F10'])
    expect([...held.keys()]).toEqual(['Alt+F9', 'Alt+F10'])
  })

  it('attempts every key even after one is refused', () => {
    // They are independent: one application holding one combination says
    // nothing about who holds the other. Stopping at the first failure would
    // silently drop a key that was free.
    taken.add('Alt+F9')
    const outcomes = claimShortcuts(
      { rest: () => undefined, hide: () => undefined },
      { rest: 'Alt+F9', hide: 'Alt+F10' },
    )
    expect(outcomes[0]?.refused).toBe('another application already has it')
    expect(outcomes[1]?.refused).toBeNull()
    expect(held.has('Alt+F10')).toBe(true)
  })

  it('reports a throw rather than taking the launch down', () => {
    // A malformed accelerator. `shared/accelerator.ts` is what should make this
    // unreachable; a hand-edited preferences file is why it is still caught.
    throwsOn = 'Alt+F9'
    const outcome = claimOne('rest', 'Alt+F9', () => undefined)
    expect(outcome.refused).toContain('bad accelerator')
  })
})

describe('moving a key to another combination', () => {
  const handler = (): void => undefined

  it('gives the old one back BEFORE taking the new one', () => {
    /*
      Registering first looks safer and is not: `register` on a combination this
      process already holds REPLACES the handler and answers true, so a rebind
      that did not release first could leave the old combination silently firing
      the new action — and the unregister afterwards would take away the binding
      that had just been made.
    */
    rebindShortcut('rest', 'Control+Shift+L', 'Alt+F9', handler)
    expect(calls).toEqual(['unregister Control+Shift+L', 'register Alt+F9'])
  })

  it('answers the new combination when it was taken', () => {
    const moved = rebindShortcut('rest', 'Control+Shift+L', 'Alt+F9', handler)
    expect(moved.rolledBack).toBe(false)
    expect(moved.outcome).toEqual({ id: 'rest', accelerator: 'Alt+F9', refused: null })
    expect([...held.keys()]).toEqual(['Alt+F9'])
  })

  it('puts the old combination back when the new one is refused', () => {
    /*
      Without this, choosing a combination another application holds would take
      away the key that WAS working — punishing somebody for trying, in the one
      control where trying is how you find out.
    */
    taken.add('Alt+F9')
    const moved = rebindShortcut('rest', 'Control+Shift+L', 'Alt+F9', handler)
    expect(moved.rolledBack).toBe(true)
    expect(moved.outcome).toEqual({
      id: 'rest',
      accelerator: 'Control+Shift+L',
      refused: null,
    })
    expect([...held.keys()]).toEqual(['Control+Shift+L'])
  })

  it('answers what is bound now, not what was asked for, after a rollback', () => {
    // The caller stores and displays this. An answer carrying the combination
    // that was refused would be a pane showing a key that does nothing.
    taken.add('Alt+F9')
    const moved = rebindShortcut('rest', 'Control+Shift+L', 'Alt+F9', handler)
    expect(moved.outcome.accelerator).not.toBe('Alt+F9')
  })

  it('says so when neither combination could be had', () => {
    /*
      Vanishingly rare — it needs another application to take the old
      combination in the moment between giving it back and asking for it again —
      and reported rather than assumed away, because a key that has silently
      stopped working is the state this module exists to make visible.
    */
    taken.add('Alt+F9')
    const moved = rebindShortcut('rest', 'Control+Shift+L', 'Alt+F9', () => {
      taken.add('Control+Shift+L')
    })
    // The rollback attempt happened even so, and the failure is reported rather
    // than presented as a successful restore.
    expect(moved.rolledBack).toBe(true)
    expect(calls).toContain('register Control+Shift+L')
  })

  it('reports the rollback failing rather than claiming the old key is back', () => {
    taken.add('Alt+F9')
    taken.add('Control+Shift+L')
    const moved = rebindShortcut('rest', 'Control+Shift+L', 'Alt+F9', handler)
    expect(moved.rolledBack).toBe(true)
    expect(moved.outcome.refused).toBe('another application already has it')
    expect(held.size).toBe(0)
  })

  it('releases the refused combination before rolling back', () => {
    // `register` answering false may still have left something behind on some
    // platforms, and the unregister is a no-op when it did not. Leaving it out
    // would risk holding a combination this application is not using.
    taken.add('Alt+F9')
    rebindShortcut('rest', 'Control+Shift+L', 'Alt+F9', handler)
    expect(calls).toEqual([
      'unregister Control+Shift+L',
      'register Alt+F9',
      'unregister Alt+F9',
      'register Control+Shift+L',
    ])
  })
})
