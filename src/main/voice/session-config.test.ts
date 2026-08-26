import { describe, expect, it } from 'vitest'

import { sessionConfig } from './session-config'
import type { SessionConfigDeps } from './session-config'

/**
 * The two decisions in this read, tested for the first time.
 *
 * It lived in `index.ts`, which cannot be imported outside Electron, so
 * "whether she may speak first" — a rule with three independent conditions and
 * an argued reason for each — was asserted by nothing.
 *
 * The reads it does (persona, avatar, note, grants) all belong to modules with
 * their own tests. What was never covered is how the ANSWERS combine.
 */

const userData = '/tmp/mochi-session-config'

function deps(over: Partial<SessionConfigDeps> = {}): SessionConfigDeps {
  const worn: string[] = []
  return {
    userData: () => userData,
    catalogue: () => ({ personas: new Map(), problems: [], sources: new Map() }) as never,
    conversation: () => ({ wear: (id: string) => worn.push(id) }) as never,
    nowWearing: () => undefined,
    replacingASession: () => false,
    resting: () => ({ asleep: false }),
    registry: { tools: [] } as never,
    transcripts: () => null,
    problemCount: () => 0,
    note: () => undefined,
    log: () => undefined,
    warn: () => undefined,
    ...over,
  }
}

/** Every condition on the greeting satisfied, so a test can flip exactly one. */
function speaking(over: Partial<SessionConfigDeps> = {}): SessionConfigDeps {
  return deps({ resting: () => ({ asleep: false }), replacingASession: () => false, ...over })
}

describe('whether she speaks first', () => {
  it('is null while she is resting', () => {
    /*
      TWO reasons for that null, and they are not the same reason.

      The grant is a permission somebody withheld; rest is a state she is in.
      Only the first was consulted once, so a session opened while she was
      resting greeted the room out loud — with her eyes shut, because `blink: 1`
      is held for the whole of `asleep`.
    */
    expect(sessionConfig(speaking({ resting: () => ({ asleep: true }) })).greeting).toBeNull()
  })

  it('is null when this open is replacing a session', () => {
    /*
      A greeting is for a WAKE, and a reconnect is not one.

      The renderer's `greeted` flag is per session and the hourly reconnect
      opens a new one, so she greeted again every hour somebody she had been
      mid-conversation with all along. The renderer cannot tell the two apart:
      from inside a session an open is an open.
    */
    expect(sessionConfig(speaking({ replacingASession: () => true })).greeting).toBeNull()
  })

  it('consumes the replacing flag exactly once', () => {
    // Left set, it would also silence the greeting of a character somebody
    // wore AFTER a reconnect — a new character saying nothing because an
    // unrelated session was replaced an hour earlier.
    let asked = 0
    sessionConfig(
      speaking({
        replacingASession: () => {
          asked += 1
          return true
        },
      }),
    )
    expect(asked).toBe(1)
  })
})

describe('which character the session belongs to', () => {
  it('tells the caller, so dispatch and the panel can agree', () => {
    // `grant-outcome.ts` describes what happens when they disagree: a revoke
    // that reports success and changes nothing.
    const said: string[] = []
    sessionConfig(deps({ nowWearing: (id) => said.push(id) }))
    expect(said).toHaveLength(1)
  })

  it('wears her in the conversation as well', () => {
    // A new session is a new conversation, and doing it here covers the
    // reconnect path too — which is the common case, hourly.
    const worn: string[] = []
    sessionConfig(deps({ conversation: () => ({ wear: (id: string) => worn.push(id) }) as never }))
    expect(worn).toHaveLength(1)
  })

  it('names the same character to both', () => {
    // Two answers to "who is this session" is the divergence C1 was about.
    const toCaller: string[] = []
    const toConversation: string[] = []
    sessionConfig(
      deps({
        nowWearing: (id) => toCaller.push(id),
        conversation: () => ({ wear: (id: string) => toConversation.push(id) }) as never,
      }),
    )
    expect(toCaller).toEqual(toConversation)
  })
})

describe('what it always answers with', () => {
  it('carries a face even with no avatars folder', () => {
    // She must be drawn. `resolveFaceFor` falls back to the built-in, which is
    // right here and wrong in the shelf — see `face-tile.ts`.
    expect(sessionConfig(deps()).face).toBeDefined()
  })

  it('reports how many problems there are, for the indicator', () => {
    expect(sessionConfig(deps({ problemCount: () => 7 })).problems).toBe(7)
  })

  it('sends the transcription model and whatever languages were set', () => {
    const config = sessionConfig(deps())
    expect(config.transcription.model).not.toBe('')
    expect(Array.isArray(config.transcription.languages)).toBe(true)
  })

  it('reports rest, so the renderer draws her shut', () => {
    expect(sessionConfig(deps({ resting: () => ({ asleep: true }) })).asleep).toBe(true)
  })
})

describe('a persona that could not be read', () => {
  it('says so rather than starting a session in silence', () => {
    const noted: string[] = []
    sessionConfig(
      deps({
        catalogue: () =>
          ({
            personas: new Map(),
            problems: [{ kind: 'that folder is not a persona' }],
            sources: new Map(),
          }) as never,
        note: (_what, _id, detail) => noted.push(detail),
      }),
    )
    expect(noted.join(' ')).toContain('not a persona')
  })
})
