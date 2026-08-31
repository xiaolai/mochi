import { describe, expect, it } from 'vitest'
import { SHIPPED_PROMPTS } from '@shared/instructions'

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
    // `liveToken` as well as `wear`, because `sessionConfig` reads it before the
    // switch now. A stub missing a method the code calls is a stub that decides
    // which bugs the suite can see.
    conversation: () => ({ wear: (id: string) => worn.push(id), liveToken: () => null }) as never,
    nowWearing: () => undefined,
    briefedWith: () => undefined,
    replacingASession: () => false,
    resting: () => ({ asleep: false }),
    tools: () => [],
    unready: () => new Set(),
    prompts: () => SHIPPED_PROMPTS,
    transcripts: () => null,
    problemCount: () => 0,
    // Fixed, so a brief's "most recently…" is a value rather than a moving target.
    now: () => 1_700_000_000_000,
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

  /** A live conversation, which is what a reconnect and a reload both have. */
  const carryingOn = {
    conversation: () => ({ wear: () => undefined, liveToken: () => 'live' }) as never,
    transcripts: () => ({ turns: () => [], sessions: () => [] }) as never,
  }

  it('is null when there is a conversation to carry on from', () => {
    /*
      A greeting is for a WAKE, and a reconnect is not one.

      The renderer's `greeted` flag is per session and the hourly reconnect
      opens a new one, so she greeted again every hour somebody she had been
      mid-conversation with all along. The renderer cannot tell the two apart:
      from inside a session an open is an open.

      This asked `replacingASession` instead, which is a PROXY for the same
      question and disagrees with it in one case — see the test below.
    */
    expect(
      sessionConfig(speaking({ replacingASession: () => true, ...carryingOn })).greeting,
    ).toBeNull()
  })

  it('is null on a RENDERER RELOAD, where nothing sets the replacing flag', () => {
    /*
      The case the proxy got wrong, and it produced a contradiction rather than
      a wrong guess.

      `did-finish-load` fires again when the renderer reloads, and nothing sets
      `replacing` for that — `briefing` says so in as many words and uses the
      live conversation instead. So the brief was `resumeFor`, which ends "Do
      not greet them again, do not summarise it back to them, and do not mention
      any interruption", and this sent a greeting in the same breath. Two
      instructions that contradict each other, in one session, and whichever she
      followed one of them was wrong.
    */
    expect(
      sessionConfig(speaking({ replacingASession: () => false, ...carryingOn })).greeting,
    ).toBeNull()
  })

  it('CONTROL: she still greets a wake, where there is nothing to carry on from', () => {
    // Without this the two above pass for a build that never greets at all.
    expect(sessionConfig(speaking({ replacingASession: () => false })).greeting).not.toBeNull()
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
    sessionConfig(
      deps({
        conversation: () =>
          ({ wear: (id: string) => worn.push(id), liveToken: () => null }) as never,
      }),
    )
    expect(worn).toHaveLength(1)
  })

  it('names the same character to both', () => {
    // Two answers to "who is this session" is the divergence C1 was about.
    const toCaller: string[] = []
    const toConversation: string[] = []
    sessionConfig(
      deps({
        nowWearing: (id) => toCaller.push(id),
        conversation: () =>
          ({ wear: (id: string) => toConversation.push(id), liveToken: () => null }) as never,
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

describe('what she is told about the conversation she is joining', () => {
  /*
    Two kinds, and sending the wrong one is worse than sending neither.

    A WAKE gets a dated summary of a conversation that ENDED, framed as
    background and explicitly not to be resumed. A RECONNECT gets the opposite:
    nothing ended, a connection dropped, and she has to carry on. `replacing` is
    the only signal that tells them apart, and main is the only process holding
    it — from inside a session an open is an open.

    Both `briefFor` and `resumeFor` were written, tested, and reached from
    nothing until 2026-08-27. Without `resumeFor`, an hour into a conversation
    the session is replaced (§53) and a new Realtime session starts with an
    empty context: she kept talking and had forgotten the morning.
  */
  const TAIL = [
    { at: 1_699_999_000_000, who: 'you' as const, text: 'I am learning Rust.', cut: false },
    { at: 1_699_999_001_000, who: 'her' as const, text: 'How is it going?', cut: false },
  ]

  function withArchive(over: Partial<SessionConfigDeps> = {}): SessionConfigDeps {
    return deps({
      transcripts: () =>
        ({
          sessions: () => [
            { token: 't1', startedAt: 1_699_999_000_000, endedAt: 1_699_999_002_000, turns: 2 },
          ],
          turns: () => TAIL,
        }) as never,
      ...over,
    })
  }

  it('briefs her on the last conversation when she wakes', () => {
    const config = sessionConfig(withArchive({ replacingASession: () => false }))
    expect(config.instructions).toContain('The last time you spoke')
  })

  it('tells her NOT to pick that one back up', () => {
    // Resuming a conversation that ended hours ago is unsettling rather than
    // warm, which is why the brief says so in terms.
    const config = sessionConfig(withArchive({ replacingASession: () => false }))
    expect(config.instructions).toContain('It is background.')
  })

  /**
   * A conversation that ENDS when it is worn, which is what the real one does.
   *
   * The first version of these tests returned `'t1'` unconditionally, and it
   * passed over a `resumeFor` that could never run: `sessionConfig` calls
   * `wear()` — which calls `end()`, which nulls the live token — before the
   * briefing is built. A stub that cannot reach the broken state cannot fail
   * on it, and this one now can.
   */
  function liveConversation(token: string): () => never {
    let live: string | null = token
    /*
      ONE instance, handed back on every call.

      `conversation()` in main is `talk ??= createConversation(...)` — a
      singleton. A stub that BUILDS one per call is a different object each
      time, so `wear()` mutates one and `liveToken()` reads another that still
      holds the token. That version passed with the token read on the wrong
      side of `wear()`, which is the bug it exists to catch.
    */
    const one = {
      wear: () => {
        live = null
      },
      liveToken: () => live,
    }
    return () => one as never
  }

  it('tells her to carry on when the session is only being replaced', () => {
    const config = sessionConfig(
      withArchive({
        replacingASession: () => true,
        conversation: liveConversation('t1'),
      }),
    )
    expect(config.instructions).toContain('already under way')
    expect(config.instructions).toContain('Do not greet them again')
  })

  it('never sends both, because they contradict each other', () => {
    const resumed = sessionConfig(
      withArchive({
        replacingASession: () => true,
        conversation: liveConversation('t1'),
      }),
    ).instructions
    expect(resumed).not.toContain('The last time you spoke')
  })

  it('says nothing at all when there is no archive open', () => {
    // An empty brief is a section `instructionsFor` omits, rather than a
    // heading over nothing.
    const config = sessionConfig(deps({ transcripts: () => null }))
    expect(config.instructions).not.toContain('The last time you spoke')
  })

  it('opens the session anyway when the brief cannot be built', () => {
    // A brief that throws is a session without one, which is the state every
    // session was in before this was wired. It is never a reason to refuse her.
    const warned: string[] = []
    const config = sessionConfig(
      deps({
        transcripts: () =>
          ({
            sessions: () => {
              throw new Error('SQLITE_BUSY')
            },
          }) as never,
        warn: (line: string) => warned.push(line),
      }),
    )
    expect(config.instructions.length).toBeGreaterThan(0)
    expect(warned.join(' ')).toContain('brief')
  })
})
