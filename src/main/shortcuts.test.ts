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
const { SHORTCUTS } = await import('@shared/shortcuts')

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

/**
 * Two ids arriving on one combination, which `applyKey` cannot prevent.
 *
 * It refuses a collision on the way in from the window. `preferences.json` is
 * hand-editable, so this is the path where that check never runs — the argument
 * `readSleepAfterMinutes` makes about the same file, one module along.
 *
 * Electron does not refuse the second registration: it replaces the handler and
 * answers true. So the failure is silent by construction, and it is the exact
 * one `applyKey`'s check exists to stop.
 */
describe('two keys on one combination', () => {
  it('registers the first and refuses the second, rather than binding twice', () => {
    const outcomes = claimShortcuts(
      { rest: () => undefined, hide: () => undefined },
      { rest: 'Alt+F9', hide: 'Alt+F9' },
    )
    expect(outcomes[0]?.refused).toBeNull()
    expect(outcomes[1]?.refused).toContain('another of this application')
    // ONE registration, not two. Electron would have answered true both times.
    expect([...held.keys()]).toEqual(['Alt+F9'])
    expect(calls.filter((one) => one === 'register Alt+F9')).toHaveLength(1)
  })

  it('says so without leaking the internal id into what a person reads', () => {
    // `listKeys` exists because "rest" is our word for it and not the thing
    // anybody is looking for. A refusal naming it would put it on screen.
    const outcomes = claimShortcuts(
      { rest: () => undefined, hide: () => undefined },
      { rest: 'Alt+F9', hide: 'Alt+F9' },
    )
    expect(outcomes[1]?.refused).toBe("another of this application's keys already has it")
    expect(outcomes[1]?.refused).not.toContain('rest')
    // And the row still shows the combination it was ASKED for, so somebody can
    // see what is in the file rather than a value nothing wrote.
    expect(outcomes[1]?.accelerator).toBe('Alt+F9')
  })

  it('does not treat a combination another application owns as taken by us', () => {
    /*
      The subtle half. If the first id could not have it either, marking it
      taken would refuse the second id for a reason that is not true — and the
      pane would say one of our own keys holds it while nothing does.
    */
    taken.add('Alt+F9')
    const outcomes = claimShortcuts(
      { rest: () => undefined, hide: () => undefined },
      { rest: 'Alt+F9', hide: 'Alt+F9' },
    )
    expect(outcomes[0]?.refused).toBe('another application already has it')
    expect(outcomes[1]?.refused).toBe('another application already has it')
  })

  it('leaves distinct combinations alone', () => {
    const outcomes = claimShortcuts(
      { rest: () => undefined, hide: () => undefined },
      { rest: 'Alt+F9', hide: 'Alt+F10' },
    )
    expect(outcomes.every((one) => one.refused === null)).toBe(true)
    expect([...held.keys()]).toEqual(['Alt+F9', 'Alt+F10'])
  })
})

/**
 * The defaults must not collide with each other.
 *
 * The check above resolves a collision by refusing the second key. If the
 * SHIPPED combinations collided, that refusal would be the ordinary state on a
 * fresh install and one key would never work at all.
 */
describe('what the app ships', () => {
  it('gives every key its own combination', () => {
    const values = Object.values(SHORTCUTS)
    expect(new Set(values).size).toBe(values.length)
  })
})

describe('rebinding a key that is not holding its combination', () => {
  /*
    `release` works by COMBINATION, not by id. A key can be showing one it does
    not have — refused because another application owns it, or because the other
    id in this application got there first — so releasing it on the way past
    hands back whatever is registered under that string.

    That made the obvious repair the destructive one: two keys land on one
    combination in a hand-edited file, somebody moves the broken one off it, and
    the key that was working stops.
  */
  it('does not release the combination the OTHER key is holding', () => {
    const started = claimShortcuts(
      { rest: () => undefined, hide: () => undefined },
      { rest: 'Alt+F9', hide: 'Alt+F9' },
    )
    expect(started[1]?.refused).not.toBeNull()
    calls.length = 0
    // `null` is what the caller passes for a key that holds nothing.
    rebindShortcut('hide', null, 'Alt+F10', () => undefined)
    expect(calls).toEqual(['register Alt+F10'])
    expect([...held.keys()]).toEqual(['Alt+F9', 'Alt+F10'])
  })

  it('reports no rollback when there was nothing to roll back to', () => {
    // Saying it rolled back would tell the caller a working binding was
    // restored when none existed — and the handler stores on that distinction.
    taken.add('Alt+F10')
    const moved = rebindShortcut('hide', null, 'Alt+F10', () => undefined)
    expect(moved.rolledBack).toBe(false)
    expect(moved.outcome.refused).toBe('another application already has it')
  })

  it('still releases when the key genuinely holds its combination', () => {
    // The ordinary path must not be weakened by the guard above: registering a
    // replacement without releasing first would leave the old combination
    // silently firing the new action.
    claimShortcuts(
      { rest: () => undefined, hide: () => undefined },
      { rest: 'Alt+F9', hide: 'Alt+F10' },
    )
    calls.length = 0
    rebindShortcut('hide', 'Alt+F10', 'Alt+F11', () => undefined)
    expect(calls).toEqual(['unregister Alt+F10', 'register Alt+F11'])
    expect([...held.keys()]).toEqual(['Alt+F9', 'Alt+F11'])
  })
})
