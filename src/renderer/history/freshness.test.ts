import { describe, expect, it } from 'vitest'
import { freshness } from './freshness'

/**
 * Overlapping reads of one thing, and which answer is allowed to land.
 *
 * The window makes several IPC round trips at once — a character switch while a
 * save is settling, a rapid pair of writes, a tab entered twice — and nothing
 * ordered them. An older answer landing last repainted state that had already
 * been replaced, silently, because a stale shelf and a fresh one are the same
 * shape.
 */
describe('which read is still the one being waited for', () => {
  it('says yes to a read nothing has overtaken', () => {
    const reads = freshness()
    const newest = reads.begin()
    expect(newest()).toBe(true)
  })

  it('says no to one that a later read has overtaken', () => {
    const reads = freshness()
    const first = reads.begin()
    const second = reads.begin()
    expect(first()).toBe(false)
    expect(second()).toBe(true)
  })

  it('keeps answering no, however long the stale one takes to arrive', () => {
    // The order answers come back in is the whole problem, so a token that was
    // only correct if asked promptly would be no use.
    const reads = freshness()
    const first = reads.begin()
    reads.begin()
    reads.begin()
    expect(first()).toBe(false)
  })

  it('gives each family its own answer', () => {
    // A shelf read must not cancel a machine read. They replace themselves, not
    // each other, and a shared counter would invent a relationship.
    const shelf = freshness()
    const machine = freshness()
    const shelfRead = shelf.begin()
    machine.begin()
    machine.begin()
    expect(shelfRead()).toBe(true)
  })
})
