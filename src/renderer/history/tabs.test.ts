import { describe, expect, it } from 'vitest'
import { PLACES, alongTabs } from './tabs'

/**
 * Arrowing along the tab strip.
 *
 * The strip declared `role="tablist"` and its buttons `role="tab"`, and then
 * marked the live one with `aria-current` alone — so assistive technology asked
 * for `aria-selected` and got nothing, and the keyboard could not move between
 * tabs at all. A container promising state whose members never report it is
 * worse than one that promises nothing, because the promise is what a reader
 * navigates by.
 *
 * The MOVEMENT is what a test can hold. The suite runs in node with no DOM
 * emulator, deliberately, and wrapping is the half people get wrong.
 */
describe('which tab an arrow key moves to', () => {
  const order = PLACES.map((one) => one.id)

  it('has a strip to move along', () => {
    // Counted first: a two-tab strip would make the wrapping assertions below
    // pass for a function that simply toggles.
    expect(order.length).toBeGreaterThan(2)
  })

  it('goes right and left', () => {
    expect(alongTabs('ArrowRight', order[0]!)).toBe(order[1])
    expect(alongTabs('ArrowLeft', order[1]!)).toBe(order[0])
  })

  it('WRAPS at both ends, rather than dying there', () => {
    // What the pattern specifies, and what somebody arrowing off the end
    // expects instead of a key that does nothing.
    expect(alongTabs('ArrowRight', order[order.length - 1]!)).toBe(order[0])
    expect(alongTabs('ArrowLeft', order[0]!)).toBe(order[order.length - 1])
  })

  it('takes Home and End to the ends', () => {
    expect(alongTabs('Home', order[1]!)).toBe(order[0])
    expect(alongTabs('End', order[0]!)).toBe(order[order.length - 1])
  })

  it('answers null for a key that is not part of the pattern', () => {
    // The caller only calls `preventDefault` on a real move, so a null here is
    // what leaves `Tab`, `Enter` and typing alone.
    for (const key of ['Tab', 'Enter', ' ', 'a', 'ArrowUp', 'ArrowDown']) {
      expect(alongTabs(key, order[0]!), key).toBeNull()
    }
  })
})
