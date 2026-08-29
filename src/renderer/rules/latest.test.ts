import { describe, expect, it } from 'vitest'
import { latest } from './latest'

/**
 * A3 — a late answer for a conversation nobody is looking at must not paint.
 *
 * Six copies of `const mine = generation` were spread through the window, each
 * one a chance to capture the counter a line too late or to compare against the
 * wrong one. The arithmetic was never the risk; the copies were.
 */
describe('A3 · whether an answer is still the one being looked at', () => {
  it('discards A when A was asked, then B, and A resolves last', () => {
    const looking = latest()

    looking.moved()
    const stillA = looking.request()

    looking.moved()
    const stillB = looking.request()

    expect(stillA()).toBe(false)
    expect(stillB()).toBe(true)
  })

  it('keeps saying no however long the stale answer takes to arrive', () => {
    // The order answers come back in is the whole problem, so a token that was
    // only correct if asked promptly would be no use.
    const looking = latest()
    looking.moved()
    const stillA = looking.request()
    looking.moved()
    looking.moved()
    expect(stillA()).toBe(false)
  })

  it('lets an answer paint when nobody has moved on', () => {
    const looking = latest()
    looking.moved()
    expect(looking.request()()).toBe(true)
  })

  it('does not discard a request just because a second read started', () => {
    // THE DIFFERENCE FROM `freshness`. Two reads with no change of mind between
    // them are both still wanted — a background re-read that bumped this would
    // throw away the transcript somebody is waiting for.
    const looking = latest()
    looking.moved()
    const watched = looking.request()
    const background = looking.request()
    expect(watched()).toBe(true)
    expect(background()).toBe(true)
  })

  it('gives each family of intent its own answer', () => {
    // A search changes the list; a transcript is the column beside it. Sharing
    // one counter made typing discard a transcript that was still loading.
    const reading = latest()
    const searching = latest()
    reading.moved()
    const stillReading = reading.request()
    searching.moved()
    searching.moved()
    expect(stillReading()).toBe(true)
  })
})
