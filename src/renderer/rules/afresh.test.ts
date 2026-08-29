import { describe, expect, it, vi } from 'vitest'
import { afresh, type Returns } from './afresh'

/** A window that can be focused, without a DOM. */
function fakeWindow(): Returns & { focus: () => void; listeners: () => number } {
  const on = new Set<() => void>()
  return {
    addEventListener: (_type, run) => {
      on.add(run)
    },
    removeEventListener: (_type, run) => {
      on.delete(run)
    },
    focus: () => {
      for (const run of on) run()
    },
    listeners: () => on.size,
  }
}

/** M4 — outside answers are re-read when the window comes back. */
describe('M4 · answers that come from outside the window', () => {
  it('reads at once', () => {
    const read = vi.fn()
    const where = fakeWindow()
    afresh(where, read)
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('reads again when the window comes back', () => {
    // Failures happen DURING use. Read once at launch, the count was taken at
    // the one moment it is guaranteed to be zero.
    const read = vi.fn()
    const where = fakeWindow()
    afresh(where, read)
    where.focus()
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('reads again every time, not only the first', () => {
    const read = vi.fn()
    const where = fakeWindow()
    afresh(where, read)
    where.focus()
    where.focus()
    where.focus()
    expect(read).toHaveBeenCalledTimes(4)
  })

  it('reads every one that was registered', () => {
    // The defect this shape prevents: a read added to the focus listener but
    // not run at launch, or run at launch and never registered.
    const one = vi.fn()
    const two = vi.fn()
    const where = fakeWindow()
    afresh(where, one, two)
    expect(one).toHaveBeenCalledTimes(1)
    expect(two).toHaveBeenCalledTimes(1)
    where.focus()
    expect(one).toHaveBeenCalledTimes(2)
    expect(two).toHaveBeenCalledTimes(2)
  })

  it('reads them in the order given', () => {
    const order: string[] = []
    const where = fakeWindow()
    afresh(
      where,
      () => order.push('first'),
      () => order.push('second'),
    )
    expect(order).toEqual(['first', 'second'])
  })

  it('stops when asked, leaving no listener behind', () => {
    const read = vi.fn()
    const where = fakeWindow()
    const stop = afresh(where, read)
    stop()
    where.focus()
    expect(read).toHaveBeenCalledTimes(1)
    expect(where.listeners()).toBe(0)
  })

  it('registers exactly one listener however many reads there are', () => {
    const where = fakeWindow()
    afresh(where, vi.fn(), vi.fn(), vi.fn())
    expect(where.listeners()).toBe(1)
  })

  it('fixes the list at registration', () => {
    // Held by the rest parameter, which copies. Pinned because changing the
    // signature to take one array argument would lose it silently: a caller
    // that kept a reference could then change what a later focus reads.
    const read = vi.fn()
    const reads = [read]
    const where = fakeWindow()
    afresh(where, ...reads)
    reads.push(vi.fn())
    where.focus()
    expect(read).toHaveBeenCalledTimes(2)
  })
})
