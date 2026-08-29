import { describe, expect, it } from 'vitest'
import { writes } from './writes'

/** A promise this test resolves by hand, so ordering is decided and not raced. */
function deferred<T = void>(): {
  promise: Promise<T>
  resolve: (value: T) => void
} {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((yes) => {
    resolve = yes
  })
  return { promise, resolve }
}

/**
 * M3 — writes are queued and the QUEUE never rejects, or one failed write skips
 * every later one.
 */
describe('M3 · the write queue', () => {
  it('runs a later write after one that rejected', async () => {
    const queue = writes()
    const ran: string[] = []

    const failed = queue.add(async () => {
      ran.push('first')
      await Promise.resolve()
      throw new Error('main refused')
    })
    const after = queue.add(async () => {
      ran.push('second')
    })

    // The caller is told, because it is the one that knows what to say.
    await expect(failed).rejects.toThrow('main refused')
    await after
    expect(ran).toEqual(['first', 'second'])
  })

  it('survives a write that rejects with nothing at all', async () => {
    const queue = writes()
    await expect(queue.add(() => Promise.reject(undefined))).rejects.toBeUndefined()
    await expect(queue.add(async () => 'still here')).resolves.toBe('still here')
  })

  it('runs one at a time, in the order they were asked for', async () => {
    const queue = writes()
    const first = deferred()
    const ran: string[] = []

    const one = queue.add(async () => {
      ran.push('one started')
      await first.promise
      ran.push('one finished')
    })
    const two = queue.add(async () => {
      ran.push('two started')
    })

    // The second must not have started while the first is still in flight.
    await Promise.resolve()
    expect(ran).toEqual(['one started'])

    first.resolve()
    await one
    await two
    expect(ran).toEqual(['one started', 'one finished', 'two started'])
  })

  it('gives each write back its own answer', async () => {
    // The queue orders them; it does not merge them. A caller saying "Saved."
    // needs the result of ITS write, not of whatever finished last.
    const queue = writes()
    const one = queue.add(async () => 'first')
    const two = queue.add(async () => 'second')
    expect(await one).toBe('first')
    expect(await two).toBe('second')
  })

  it('keeps ordering writes queued while one is already in flight', async () => {
    // Rules out a queue that resets after an error, which would release
    // everything behind it at once — losing the order exactly when a failure
    // has made it matter most.
    const queue = writes()
    const ran: string[] = []
    const failed = queue.add(async () => {
      ran.push('a')
      throw new Error('no')
    })
    const b = queue.add(async () => {
      ran.push('b')
    })
    const c = queue.add(async () => {
      ran.push('c')
    })
    await expect(failed).rejects.toThrow('no')
    await b
    await c
    expect(ran).toEqual(['a', 'b', 'c'])
  })
})
