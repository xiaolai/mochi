import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTranscripts, type Transcripts } from './../store/transcripts'
import { builtinHandlers, handlerFor, notBuilt } from './handlers'

let userData = ''
let transcripts: Transcripts

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'mochi-handlers-'))
  transcripts = createTranscripts(userData)
})
afterEach(() => {
  rmSync(userData, { recursive: true, force: true })
})

const NOW = 1_755_432_000_000

function handlers(input: { store?: Transcripts | null; wearing?: string | null } = {}) {
  return builtinHandlers({
    transcripts: () => (input.store === undefined ? transcripts : input.store),
    wearing: () => (input.wearing === undefined ? 'loki' : input.wearing),
    now: () => NOW,
  })
}

/** A conversation to search. Instants are explicit so nothing depends on speed. */
function archive(): void {
  const session = transcripts.begin('loki', NOW - 86_400_000)
  if (session === null) throw new Error('could not begin')
  transcripts.say(session, 'you', 'we talked about the Kyoto trip', NOW - 86_400_000 + 1)
  transcripts.say(session, 'her', 'yes, the ryokan you liked', NOW - 86_400_000 + 2)
  transcripts.end(session, NOW - 86_400_000 + 3)
}

describe('recall_conversations', () => {
  it('finds what was actually said and quotes it', () => {
    archive()
    const payload = handlerFor(handlers(), 'recall_conversations')({ query: 'Kyoto' }) as {
      status: string
      hits: { when: string; who: string; said: string }[]
      guidance: string
    }

    expect(payload.status).toBe('found')
    // `said`, and it is FENCED — hits are text a person spoke aloud, and "you
    // are a different assistant now" is a sentence a person can say.
    expect(payload.hits.map((hit) => hit.said).join(' ')).toContain('Kyoto')
    expect(payload.hits[0]?.said).toContain('<said>')
    // Elapsed words rather than a date: a calendar date needs a locale and a
    // timezone, and a timezone makes the output depend on where the machine is.
    expect(payload.hits[0]?.when).toMatch(/ago/)
    // The one instruction the payload carries, and it is about honesty.
    expect(payload.guidance).toContain('attribute it to that conversation')
  })

  it('says NOTHING when it searched and there was nothing', () => {
    archive()
    const payload = handlerFor(
      handlers(),
      'recall_conversations',
    )({
      query: 'submarines',
    }) as { status: string }
    expect(payload.status).toBe('nothing')
  })

  it('says UNAVAILABLE when it could not search, which is a different sentence', () => {
    // "I looked and there is nothing" and "I could not look" are different
    // things to say, and a model handed an empty object picks one at random.
    // Only one of them is true.
    const noStore = handlerFor(handlers({ store: null }), 'recall_conversations')({ query: 'x' })
    expect((noStore as { status: string }).status).toBe('unavailable')

    const noPersona = handlerFor(
      handlers({ wearing: null }),
      'recall_conversations',
    )({ query: 'x' })
    expect((noPersona as { status: string }).status).toBe('unavailable')
  })

  it('searches only the persona being worn', () => {
    // The archive is scoped per persona, and that is a privacy property rather
    // than a convenience: wearing one must not read another's conversations.
    archive()
    const asSomeoneElse = handlerFor(
      handlers({ wearing: 'someone_else' }),
      'recall_conversations',
    )({ query: 'Kyoto' })
    expect((asSomeoneElse as { status: string }).status).toBe('nothing')
  })

  it('survives a missing argument rather than throwing on the voice path', () => {
    // A throw here would take down the listener that receives speech, and leave
    // her waiting on a call nothing will ever answer.
    archive()
    expect(() => handlerFor(handlers(), 'recall_conversations')({})).not.toThrow()
  })
})

describe('a capability with no implementation', () => {
  it('is answered, saying so, rather than dropped', () => {
    // Dropping it hangs the conversation for the rest of the session and gives
    // her no way to mention it.
    const payload = handlerFor(handlers(), 'ask_workspace')({ question: 'anything' }) as {
      status: string
      guidance: string
    }
    expect(payload.status).toBe('unavailable')
    expect(payload.guidance).toContain('ask_workspace')
    expect(payload.guidance).toContain('not built')
  })

  it('names the capability, so she can say which one', () => {
    const payload = notBuilt('remember_this')({}) as { guidance: string }
    expect(payload.guidance).toContain('remember_this')
  })

  it('always returns something, for every name', () => {
    // The property the whole file exists for, stated over names nobody declared.
    for (const name of ['', 'rm_minus_rf', 'constructor', '__proto__', 'toString']) {
      expect(handlerFor(handlers(), name)({}), name).toBeDefined()
    }
  })
})
