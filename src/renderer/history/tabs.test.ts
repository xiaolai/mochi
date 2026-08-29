import { describe, expect, it } from 'vitest'
import { PLACES, VIEWS, alongRail, alongViews, isHers } from './tabs'

/**
 * Arrowing around the window.
 *
 * ## What changed, and what did not
 *
 * This file used to test one strip of three sibling tabs. The delivered design
 * has two navigations — three numbered views under her name, and a rail listing
 * the characters with the machine beneath them — so the assertions below name a
 * structure that did not exist before.
 *
 * The RULES are the same ones and they are contract T1/T2: one tab stop, arrows
 * move within it, the ends wrap, Home and End reach the ends. Those did not
 * change because the layout did; only what they are asserted against changed.
 * The one genuinely new rule is the last block: arrowing must not cross from her
 * page to the machine's.
 *
 * The MOVEMENT is what a test can hold. The suite runs in node with no DOM
 * emulator, deliberately, and wrapping is the half people get wrong.
 */
describe('which view an arrow key moves to', () => {
  const order = VIEWS.map((one) => one.id)

  it('has a set of views to move along', () => {
    // Counted first: a two-view set would make the wrapping assertions below
    // pass for a function that simply toggles.
    expect(order.length).toBeGreaterThan(2)
  })

  it('goes right and left', () => {
    expect(alongViews('ArrowRight', order[0]!)).toBe(order[1])
    expect(alongViews('ArrowLeft', order[1]!)).toBe(order[0])
  })

  it('WRAPS at both ends, rather than dying there', () => {
    expect(alongViews('ArrowRight', order[order.length - 1]!)).toBe(order[0])
    expect(alongViews('ArrowLeft', order[0]!)).toBe(order[order.length - 1])
  })

  it('takes Home and End to the ends', () => {
    expect(alongViews('Home', order[1]!)).toBe(order[0])
    expect(alongViews('End', order[0]!)).toBe(order[order.length - 1])
  })

  it('answers null for a key that is not part of the pattern', () => {
    // The caller only calls `preventDefault` on a real move, so a null here is
    // what leaves `Tab`, `Enter` and typing alone. Up and down belong to the
    // rail, which is a column, and must do nothing here.
    for (const key of ['Tab', 'Enter', ' ', 'a', 'ArrowUp', 'ArrowDown']) {
      expect(alongViews(key, order[0]!), key).toBeNull()
    }
  })
})

describe('her views never reach the machine', () => {
  /*
    The new rule, and the reason the two navigations are separate functions.

    Wrapping off the end of her sub-navigation into "This machine" would make
    the two pages read as one strip of four — which is the arrangement this
    design replaced, and it would put the keyboard at odds with what the window
    says: her page is one document about somebody, and the machine is not about
    her. It is reached from the rail, deliberately, by a different gesture.
  */
  it('is not among the views', () => {
    expect(VIEWS.some((one) => one.id === 'machine')).toBe(false)
    expect(isHers('machine')).toBe(false)
    for (const view of VIEWS) expect(isHers(view.id)).toBe(true)
  })

  it('is not reachable by any key from any view', () => {
    for (const view of VIEWS) {
      for (const key of ['ArrowRight', 'ArrowLeft', 'Home', 'End']) {
        expect(alongViews(key, view.id), `${key} from ${view.id}`).not.toBe('machine')
      }
    }
  })

  it('answers null when asked to move from it', () => {
    // It is not a member of this navigation, so it has no neighbours in it.
    for (const key of ['ArrowRight', 'ArrowLeft', 'Home', 'End']) {
      expect(alongViews(key, 'machine'), key).toBeNull()
    }
  })

  it('is still a place, and still the last one', () => {
    expect(PLACES.map((one) => one.id)).toContain('machine')
    expect(PLACES[PLACES.length - 1]?.id).toBe('machine')
  })
})

describe('which rail item an arrow key moves to', () => {
  /*
    A COLUMN, so up and down — and one list, so the last character arrows into
    the machine. The two navigations differ because one is a table of contents
    for the window and the other is a set of sections within one document.
  */
  it('goes down and up through the characters', () => {
    expect(alongRail('ArrowDown', 0, 3)).toBe(1)
    expect(alongRail('ArrowUp', 2, 3)).toBe(1)
  })

  it('carries on into the machine, which is the last item', () => {
    // Three characters means indexes 0..2, and the machine is 3.
    expect(alongRail('ArrowDown', 2, 3)).toBe(3)
    expect(alongRail('ArrowUp', 3, 3)).toBe(2)
  })

  it('wraps at both ends', () => {
    expect(alongRail('ArrowDown', 3, 3)).toBe(0)
    expect(alongRail('ArrowUp', 0, 3)).toBe(3)
  })

  it('takes Home and End to the ends', () => {
    expect(alongRail('Home', 2, 3)).toBe(0)
    expect(alongRail('End', 0, 3)).toBe(3)
  })

  it('works with the one character a new installation has', () => {
    // Most people's first hour: one character and the machine, so two items and
    // the wrap has to be a real move rather than standing still.
    expect(alongRail('ArrowDown', 0, 1)).toBe(1)
    expect(alongRail('ArrowDown', 1, 1)).toBe(0)
    expect(alongRail('End', 0, 1)).toBe(1)
  })

  it('answers null for left and right, which belong to her views', () => {
    for (const key of ['ArrowLeft', 'ArrowRight', 'Tab', 'Enter', ' ']) {
      expect(alongRail(key, 0, 3), key).toBeNull()
    }
  })

  it('answers null for an index that is not in the list', () => {
    expect(alongRail('ArrowDown', 9, 3)).toBeNull()
    expect(alongRail('ArrowDown', -1, 3)).toBeNull()
  })
})
