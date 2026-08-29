import { describe, expect, it } from 'vitest'
import { acknowledged } from './acknowledged'

const sameList = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((one, at) => one === b[at])

/**
 * C1 — a control tracks what it has ASKED FOR, not what it was drawn with.
 *
 * Named with the contract id, so a deletion of the rule is traceable to it.
 */
describe('C1 · what a control has asked for', () => {
  it('dispatches two different writes for two clicks on different options', () => {
    // The pane has NOT been redrawn between them. That is the whole case: both
    // clicks land while the control still shows what it was built with.
    const row = acknowledged('she')
    expect(row.ask('he')).not.toBeNull()
    expect(row.ask('it')).not.toBeNull()
  })

  it('dispatches once for two clicks on the same option', () => {
    const row = acknowledged('she')
    expect(row.ask('he')).not.toBeNull()
    expect(row.ask('he')).toBeNull()
  })

  it('refuses the value it was drawn with, before anything is clicked', () => {
    expect(acknowledged('she').ask('she')).toBeNull()
  })

  it('can be asked back for the value it started on', () => {
    // Clicking away and back is two changes, not none. Comparing against the
    // DRAWN value rather than the asked-for one would swallow the second.
    const row = acknowledged('she')
    expect(row.ask('he')).not.toBeNull()
    expect(row.ask('she')).not.toBeNull()
    expect(row.showing()).toBe('she')
  })

  it('shows what it asked for while the write is in flight', () => {
    const row = acknowledged('she')
    row.ask('he')
    expect(row.showing()).toBe('he')
    expect(row.waiting()).toBe(true)
  })
})

describe('an OLDER value arriving while a newer write is out', () => {
  it('is ignored, so the control does not revert', () => {
    // Click `he`, click `it`, and the acknowledgement of `he` lands first.
    // Adopting it puts the control back on `he` while the write for `it` is
    // still on its way — the user watching their second choice undo itself.
    const row = acknowledged('she')
    row.ask('he')
    row.ask('it')
    expect(row.arrived('he')).toBe('it')
    expect(row.waiting()).toBe(true)
  })

  it('and the control settles when the LATER one lands', () => {
    const row = acknowledged('she')
    row.ask('he')
    row.ask('it')
    row.arrived('he')
    expect(row.arrived('it')).toBe('it')
    expect(row.waiting()).toBe(false)
  })
})

describe('a change from somewhere else', () => {
  it('is adopted when nothing of ours is out', () => {
    // The tray switching character, or another window saving.
    expect(acknowledged('she').arrived('it')).toBe('it')
  })

  it('does not re-arm the wait', () => {
    const row = acknowledged('she')
    row.arrived('it')
    expect(row.waiting()).toBe(false)
  })
})

describe('a REFUSED write, which is the case a value cannot answer', () => {
  it('releases the control, even though nothing agreed', () => {
    // A refusal hands back the value that was already stored, so "did what I
    // asked for come back" is answered no — for ever.
    const row = acknowledged('she')
    const mine = row.ask('he')
    expect(row.settled(mine ?? 0, 'she')).toBe('she')
    expect(row.waiting()).toBe(false)
  })

  it('puts back what is actually stored, so the control stops lying', () => {
    const row = acknowledged('she')
    const mine = row.ask('he')
    row.settled(mine ?? 0, 'she')
    expect(row.showing()).toBe('she')
  })

  it('lets the same choice be asked for again afterwards', () => {
    // It was refused, not decided.
    const row = acknowledged('she')
    const mine = row.ask('he')
    row.settled(mine ?? 0, 'she')
    expect(row.ask('he')).not.toBeNull()
  })

  it('accepts a value that DID land, on the same call', () => {
    const row = acknowledged('she')
    const mine = row.ask('he')
    expect(row.settled(mine ?? 0, 'he')).toBe('he')
    expect(row.waiting()).toBe(false)
  })
})

describe('an OLDER request settling while a newer one is out', () => {
  it('does not speak for the newer one', () => {
    // The case `arrived` alone cannot cover: both clicks produce a WRITE, and
    // the first can finish while the second is still out. Settling it un-waited
    // the control and put the pre-write value back, wiping the second choice.
    const row = acknowledged('she')
    const first = row.ask('he')
    const second = row.ask('it')
    expect(row.settled(first ?? 0, 'he')).toBe('it')
    expect(row.waiting()).toBe(true)
    expect(row.settled(second ?? 0, 'it')).toBe('it')
    expect(row.waiting()).toBe(false)
  })

  it('and a refusal of the older one does not undo the newer one either', () => {
    const row = acknowledged('she')
    const first = row.ask('he')
    row.ask('it')
    expect(row.settled(first ?? 0, 'she')).toBe('it')
    expect(row.waiting()).toBe(true)
  })
})

describe('a value that is a list rather than a scalar', () => {
  it('compares by contents, because identity is the wrong question', () => {
    // A set that crosses a process boundary is a new array every read, so
    // identity would report every reload as somebody else's change.
    const set = acknowledged<readonly string[]>(['neutral'], sameList)
    set.ask(['neutral', 'happy'])
    expect(set.arrived(['neutral', 'happy'])).toEqual(['neutral', 'happy'])
    expect(set.waiting()).toBe(false)
  })

  it('still ignores an older list while a newer one is out', () => {
    const set = acknowledged<readonly string[]>(['neutral'], sameList)
    set.ask(['neutral', 'happy'])
    set.ask(['neutral', 'happy', 'sad'])
    expect(set.arrived(['neutral', 'happy'])).toEqual(['neutral', 'happy', 'sad'])
  })
})
