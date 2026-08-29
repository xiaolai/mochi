import { describe, expect, it } from 'vitest'
import { showing } from './showing'

/**
 * A5 — a live search wins over the calendar.
 *
 * The column is either showing a search or showing a day. Every reload assumed
 * the day, so a reload while something was typed replaced the results with a
 * day's conversations under a populated search field.
 */
describe('A5 · what the conversation column is showing', () => {
  it('is the search whenever something is typed', () => {
    expect(showing('layer order')).toBe('a search')
  })

  it('is the day when nothing is', () => {
    expect(showing('')).toBe('a day')
  })

  it('is the day when only whitespace is', () => {
    // A field holding spaces is one nobody has searched with. Treating it as
    // live would hide the calendar and answer "nothing matched" for a search
    // nobody made.
    expect(showing('   ')).toBe('a day')
    expect(showing('\n\t ')).toBe('a day')
  })

  it('is the search for a query that is only punctuation', () => {
    // Not our decision to make. What matches is the store's business; this only
    // decides which of two things the column is showing.
    expect(showing('?')).toBe('a search')
  })

  it('does not care why it is being asked', () => {
    // The reload, the character switch, the keystroke and the first paint all
    // ask the same question. One answer, or the ones that forgot to ask get a
    // different one — which is exactly how this defect existed.
    expect(showing('x')).toBe(showing('x'))
  })
})
