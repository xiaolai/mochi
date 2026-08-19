import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTranscripts, type Transcripts } from '../../main/store/transcripts'
import { stubDeps, TEST_NOW } from '../../test/capability-deps'
import { capability } from './capability'

/**
 * These assertions came from `main/capability/handlers.test.ts` and moved here
 * with the capability they are about. What did NOT come with them is the block
 * about a capability that is declared and not implemented: that state is no
 * longer representable, so there is nothing left to answer for it. The property
 * it protected — a manifest with no handler must not reach the wire — is now
 * `collect`'s, and `../index.test.ts` states it as a build failure.
 */

let userData = ''
let transcripts: Transcripts

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'mochi-recall-'))
  transcripts = createTranscripts(userData)
})
afterEach(() => {
  // CLOSED before the directory goes. `createTranscripts` holds an open SQLite
  // handle and registers the path; deleting the folder underneath it leaks the
  // handle, and on a platform that refuses to unlink an open database it fails
  // outright.
  transcripts.close()
  rmSync(userData, { recursive: true, force: true })
})

const NOW = TEST_NOW

function call(
  args: Readonly<Record<string, string>>,
  input: { store?: Transcripts | null; wearing?: string | null } = {},
): unknown {
  if (capability.kind !== 'immediate') throw new Error('this one answers on the spot')
  return capability.handler(
    args,
    stubDeps({
      transcripts: () => (input.store === undefined ? transcripts : input.store),
      wearing: () => (input.wearing === undefined ? 'loki' : input.wearing),
    }),
  )
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
  it('declares itself as the one that answers on the spot', () => {
    // The kind is not decoration: it decides whether the dispatch settles the
    // call or acknowledges and delivers later. This one reads an index that is
    // already on this machine, so there is nothing to defer.
    expect(capability.kind).toBe('immediate')
    expect(capability.manifest.name).toBe('recall_conversations')
  })

  it('finds what was actually said and quotes it', () => {
    archive()
    const payload = call({ query: 'Kyoto' }) as {
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
    const payload = call({ query: 'submarines' }) as { status: string }
    expect(payload.status).toBe('nothing')
  })

  it('says UNAVAILABLE when it could not search, which is a different sentence', () => {
    // "I looked and there is nothing" and "I could not look" are different
    // things to say, and a model handed an empty object picks one at random.
    // Only one of them is true.
    const noStore = call({ query: 'x' }, { store: null })
    expect((noStore as { status: string }).status).toBe('unavailable')

    const noPersona = call({ query: 'x' }, { wearing: null })
    expect((noPersona as { status: string }).status).toBe('unavailable')
  })

  it('searches only the persona being worn', () => {
    // The archive is scoped per persona, and that is a privacy property rather
    // than a convenience: wearing one must not read another's conversations.
    archive()
    const asSomeoneElse = call({ query: 'Kyoto' }, { wearing: 'someone_else' })
    expect((asSomeoneElse as { status: string }).status).toBe('nothing')
  })

  it('survives a missing argument rather than throwing on the voice path', () => {
    // A throw here would take down the listener that receives speech, and leave
    // her waiting on a call nothing will ever answer.
    archive()
    expect(() => call({})).not.toThrow()
  })

  it('says UNAVAILABLE for a query with nothing in it, rather than claiming it searched', () => {
    // The store returns `[]` without running a query when the words reduce to
    // an empty FTS expression — so `nothing` would have her say "I searched and
    // found nothing" about a search that never happened, and the person would
    // believe their conversation was not in the archive.
    archive()
    // Punctuation is the one that a `trim()` check let through: `!!!` is not
    // blank and still reduces to no searchable term.
    for (const query of ['', '   ', '\n\t', '!!!', '...', '?!', '\u200b']) {
      expect((call({ query }) as { status: string }).status, JSON.stringify(query)).toBe(
        'unavailable',
      )
    }
    expect((call({}) as { status: string }).status).toBe('unavailable')
  })
})
