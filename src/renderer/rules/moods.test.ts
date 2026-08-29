import { describe, expect, it } from 'vitest'
import { EMOTIONS, type Emotion } from '@shared/avatar'
import { moods } from './moods'

/**
 * C2 — the mood set is MUTATED, not copied.
 *
 * Each toggle sent the whole list, rebuilt from the set as it was at RENDER
 * time. Two toggles before the reload lands both start from the same snapshot,
 * so turning `happy` on and then `sad` on wrote a list with `sad` and without
 * `happy` — silently undoing a change the control still showed as made.
 */
describe('C2 · the mood set two toggles share', () => {
  it('carries both, when the second lands before any reload', () => {
    const set = moods(['neutral'])
    set.allow('happy', true)
    const second = set.allow('sad', true)
    expect(second).toContain('happy')
    expect(second).toContain('sad')
  })

  it('sends the whole list every time, not the change', () => {
    // The store keeps what it is given. A payload of just the toggle would read
    // as "these are the only ones".
    const set = moods(['neutral'])
    expect(set.allow('happy', true)).toEqual(['neutral', 'happy'])
  })

  it('puts the list in EMOTIONS order, whatever order they were clicked', () => {
    // So what is stored does not depend on the order somebody happened to
    // click, which would make two identical sets compare unequal.
    const set = moods([])
    set.allow('sleepy', true)
    const payload = set.allow('happy', true)
    expect([...payload]).toEqual(EMOTIONS.filter((one) => payload.includes(one)))
  })

  it('keeps the others when one is turned off', () => {
    const set = moods(['neutral', 'happy', 'sad'])
    expect(set.allow('happy', false)).toEqual(['neutral', 'sad'])
  })

  it('lets the set go empty, which is a real answer and not "all of them"', () => {
    // A manifest that does not mention faces is given every one; an empty list
    // is somebody saying none. Collapsing the two would make the choice
    // impossible to express.
    const set = moods(['happy'])
    expect(set.allow('happy', false)).toEqual([])
  })

  it('does not write back to the list it was given', () => {
    // The view it came from is re-read from the store, not patched here.
    const from: Emotion[] = ['neutral']
    const set = moods(from)
    set.allow('happy', true)
    expect(from).toEqual(['neutral'])
  })
})
