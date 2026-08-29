import { describe, expect, it } from 'vitest'
import { picking } from './picking'

/**
 * A4 — in picking mode a click SELECTS and does not open.
 * T3 — leaving the archive cancels picking.
 */
describe('A4 · what a click on a conversation means', () => {
  it('selects, and does not open, while picking', () => {
    const mode = picking()
    mode.start()
    expect(mode.click('c1')).toEqual({ kind: 'selected', chosen: ['c1'] })
  })

  it('opens when the mode is off', () => {
    expect(picking().click('c1')).toEqual({ kind: 'open', token: 'c1' })
  })

  it('unselects on a second click on the same row', () => {
    const mode = picking()
    mode.start()
    mode.click('c1')
    expect(mode.click('c1')).toEqual({ kind: 'selected', chosen: [] })
  })

  it('gathers several, in the order they were chosen', () => {
    const mode = picking()
    mode.start()
    mode.click('c1')
    expect(mode.click('c2')).toEqual({ kind: 'selected', chosen: ['c1', 'c2'] })
  })

  it('never opens anything while the mode is on, however many rows are clicked', () => {
    // The whole of A4 in one line: no click in this mode is a navigation.
    const mode = picking()
    mode.start()
    const kinds = ['c1', 'c2', 'c1', 'c3'].map((token) => mode.click(token).kind)
    expect(new Set(kinds)).toEqual(new Set(['selected']))
  })
})

describe('T3 · leaving the archive', () => {
  it('cancels picking', () => {
    const mode = picking()
    mode.start()
    mode.wentTo('cast')
    expect(mode.on()).toBe(false)
  })

  it('forgets what was chosen', () => {
    // Not merely hidden. A selection somebody can no longer see is one they
    // have stopped agreeing to, and coming back to a primed delete control with
    // a count on it is the failure this rules out.
    const mode = picking()
    mode.start()
    mode.click('c1')
    mode.wentTo('machine')
    mode.start()
    expect(mode.chosen()).toEqual([])
  })

  it('leaves the mode alone when the archive is where we already are', () => {
    const mode = picking()
    mode.start()
    mode.click('c1')
    mode.wentTo('archive')
    expect(mode.on()).toBe(true)
    expect(mode.chosen()).toEqual(['c1'])
  })

  it('makes a click after leaving open a conversation again', () => {
    // The observable half of the cancel: the archive is readable again.
    const mode = picking()
    mode.start()
    mode.wentTo('cast')
    mode.wentTo('archive')
    expect(mode.click('c1')).toEqual({ kind: 'open', token: 'c1' })
  })

  it('clears the selection when the mode is turned off by hand too', () => {
    const mode = picking()
    mode.start()
    mode.click('c1')
    mode.stop()
    expect(mode.on()).toBe(false)
    expect(mode.chosen()).toEqual([])
  })
})
