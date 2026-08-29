import { describe, expect, it } from 'vitest'
import { readEverything } from './boot'

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((yes) => {
    resolve = yes
  })
  return { promise, resolve }
}

/**
 * L1 — characters first, THEN conversations. Sequenced, not raced.
 * L2 — everything re-read on a character switch, not only at startup.
 */
describe('L1 · the order the two halves are read in', () => {
  it('does not begin the conversation read before the character read resolves', async () => {
    const characters = deferred()
    const order: string[] = []

    const done = readEverything({
      characters: async () => {
        order.push('characters started')
        await characters.promise
        order.push('characters resolved')
      },
      conversations: async () => {
        order.push('conversations started')
      },
      characterTrouble: () => {
        order.push('trouble')
      },
    })

    // Every already-scheduled microtask gets a chance. If the two were raced,
    // `conversations started` would be here.
    await Promise.resolve()
    await Promise.resolve()
    expect(order).toEqual(['characters started'])

    characters.resolve()
    await done
    expect(order).toEqual(['characters started', 'characters resolved', 'conversations started'])
  })

  it('still loads the conversations when the character half could not be read', async () => {
    // `finally` rather than `then`. The two are independent everywhere except
    // in the order they run, so a failure in one must not take the other down.
    const order: string[] = []
    await readEverything({
      characters: () => Promise.reject(new Error('store is gone')),
      conversations: async () => {
        order.push('conversations')
      },
      characterTrouble: (error) => {
        order.push(`trouble: ${String(error)}`)
      },
    })
    expect(order).toEqual(['trouble: Error: store is gone', 'conversations'])
  })

  it('reports the character trouble rather than throwing it at the caller', async () => {
    // Nothing awaits this at startup — it is a bare `void`. A rejection would
    // reach `unhandledrejection` and be reported as "Something went wrong".
    await expect(
      readEverything({
        characters: () => Promise.reject(new Error('store is gone')),
        conversations: async () => undefined,
        characterTrouble: () => undefined,
      }),
    ).resolves.toBeUndefined()
  })

  it('does not swallow trouble in the conversation half', async () => {
    // Nothing downstream of it can report, so this one has to surface. Rules
    // out a blanket catch that makes a dead archive look like an empty one.
    await expect(
      readEverything({
        characters: async () => undefined,
        conversations: () => Promise.reject(new Error('archive is gone')),
        characterTrouble: () => undefined,
      }),
    ).rejects.toThrow('archive is gone')
  })
})

describe('L2 · what a character switch re-reads', () => {
  it('re-reads BOTH halves, not only the characters', async () => {
    // The archive is scoped per character, so wearing somebody changes whose
    // conversations these are. A switch that re-read only the character half
    // would leave the previous character's archive under the new name.
    const counted = { characters: 0, conversations: 0 }
    const reads = {
      characters: async () => {
        counted.characters += 1
      },
      conversations: async () => {
        counted.conversations += 1
      },
      characterTrouble: () => undefined,
    }

    await readEverything(reads)
    await readEverything(reads)

    expect(counted).toEqual({ characters: 2, conversations: 2 })
  })

  it('keeps the order on the switch, not only on the first read', async () => {
    const order: string[] = []
    const reads = {
      characters: async () => {
        order.push('characters')
      },
      conversations: async () => {
        order.push('conversations')
      },
      characterTrouble: () => undefined,
    }
    await readEverything(reads)
    await readEverything(reads)
    expect(order).toEqual(['characters', 'conversations', 'characters', 'conversations'])
  })
})
