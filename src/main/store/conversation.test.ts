import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createConversation } from './conversation'
import { createTranscripts, type Transcripts } from './transcripts'

/**
 * A REAL archive on a real filesystem, not a fake one.
 *
 * A fake is always consistent with itself. `begin` refusing a duplicate instant,
 * and a session's turns coming back in the order they were said, are properties
 * of SQLite and of this schema — a stand-in would only confirm the stand-in.
 */
let userData = ''
let transcripts: Transcripts

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'mochi-conv-'))
  transcripts = createTranscripts(userData)
})
afterEach(() => {
  rmSync(userData, { recursive: true, force: true })
})

const said: string[] = []
/** A clock the test owns, so nothing here depends on how fast the machine is. */
let tick = 1_700_000_000_000
function conversation(keeps: (id: string) => boolean = () => true) {
  said.length = 0
  tick = 1_700_000_000_000
  return createConversation({
    transcripts,
    keeps,
    now: () => (tick += 1),
    log: (text) => said.push(text),
  })
}

describe('starting a conversation', () => {
  it('writes nothing until somebody actually says something', () => {
    // A wake nobody spoke into must leave no row. An empty conversation says
    // somebody was there and said nothing, which is untrue and would be the
    // most common row in the file.
    const talk = conversation()
    talk.wear('mochi')

    expect(talk.isLive()).toBe(false)
    expect(transcripts.sessions('mochi')).toEqual([])
  })

  it('begins on the first turn and files it', () => {
    const talk = conversation()
    talk.wear('mochi')
    talk.file('you', 'hello')

    expect(talk.isLive()).toBe(true)
    const sessions = transcripts.sessions('mochi')
    expect(sessions).toHaveLength(1)
    expect(transcripts.turns('mochi', sessions[0]!.token).map((turn) => turn.text)).toEqual([
      'hello',
    ])
  })

  it('keeps both sides in the order they were said', () => {
    const talk = conversation()
    talk.wear('mochi')
    talk.file('you', 'what is your name')
    talk.file('her', 'Mochi')
    talk.file('you', 'thanks')

    const token = transcripts.sessions('mochi')[0]!.token
    expect(transcripts.turns('mochi', token).map((turn) => [turn.who, turn.text])).toEqual([
      ['you', 'what is your name'],
      ['her', 'Mochi'],
      ['you', 'thanks'],
    ])
  })

  it('ignores silence, which is not a turn', () => {
    const talk = conversation()
    talk.wear('mochi')
    talk.file('you', '   ')
    expect(talk.isLive()).toBe(false)
    expect(transcripts.sessions('mochi')).toEqual([])
  })

  it('files nothing before a persona is worn', () => {
    const talk = conversation()
    talk.file('you', 'into the void')
    expect(talk.isLive()).toBe(false)
  })
})

describe('the retention setting', () => {
  it('stops anything reaching disk when it is off', () => {
    const talk = conversation(() => false)
    talk.wear('mochi')
    talk.file('you', 'this must not be stored')
    talk.file('her', 'nor this')

    expect(talk.isLive()).toBe(false)
    expect(transcripts.sessions('mochi')).toEqual([])
  })

  it('is read PER TURN, so turning it off takes effect on the next thing said', () => {
    // The failure this prevents: somebody turns saving off, keeps talking, and
    // the rest of the conversation is stored anyway because the answer was
    // cached at the start. A privacy switch that looks like it worked and had
    // not yet is worse than one that plainly does nothing.
    let keeping = true
    const talk = conversation(() => keeping)
    talk.wear('mochi')
    talk.file('you', 'before')
    keeping = false
    talk.file('you', 'after')

    const token = transcripts.sessions('mochi')[0]!.token
    expect(transcripts.turns('mochi', token).map((turn) => turn.text)).toEqual(['before'])
  })

  it('is read per persona, not once for the app', () => {
    const talk = conversation((id) => id === 'mochi')
    talk.wear('mochi')
    talk.file('you', 'kept')
    talk.wear('loki')
    talk.file('you', 'not kept')

    expect(transcripts.sessions('mochi')).toHaveLength(1)
    expect(transcripts.sessions('loki')).toEqual([])
  })
})

describe('the instant a conversation begins on', () => {
  it('stores nothing rather than shifting the clock when the instant is taken', () => {
    // `begin` answers null on `UNIQUE (persona_id, started_at)`. Not storing one
    // conversation is the cheapest of the three options — throwing fails a wake
    // for a reason nobody in the room can act on, and advancing the stored time
    // produces a session that began after the things said in it.
    //
    // This is also the flake that made this file's own test fail in a full run
    // and pass alone: two `begin` calls inside one millisecond.
    const frozen = createConversation({
      transcripts,
      keeps: () => true,
      now: () => 1_700_000_000_000,
      log: (text) => said.push(text),
    })
    frozen.wear('mochi')
    frozen.file('you', 'first')
    frozen.wear('mochi')
    frozen.file('you', 'second')

    expect(transcripts.sessions('mochi')).toHaveLength(1)
    expect(said).toContain('could not begin a conversation for this instant — nothing stored')
  })
})

describe('ending it', () => {
  it('closes the conversation so retention can ever prune it', () => {
    // Retention only considers sessions that ENDED. One left open is kept
    // forever by a persona set to keep a week, while every surface reports it
    // dropped.
    const talk = conversation()
    talk.wear('mochi')
    talk.file('you', 'hello')
    talk.end()

    expect(talk.isLive()).toBe(false)
    expect(transcripts.sessions('mochi')[0]?.endedAt).not.toBeNull()
  })

  it('is idempotent, and harmless with nothing open', () => {
    const talk = conversation()
    talk.end()
    talk.wear('mochi')
    talk.end()
    talk.file('you', 'hello')
    talk.end()
    expect(() => talk.end()).not.toThrow()
    expect(transcripts.sessions('mochi')).toHaveLength(1)
  })

  it('closes the previous conversation when a persona is put on', () => {
    // The reconnect path, which happens hourly (§53) — and the persona switch,
    // which cannot leave the last one hanging open under somebody else's name.
    const talk = conversation()
    talk.wear('mochi')
    talk.file('you', 'first')
    talk.wear('mochi')

    expect(talk.isLive()).toBe(false)
    expect(transcripts.sessions('mochi')[0]?.endedAt).not.toBeNull()

    talk.file('you', 'second')
    expect(transcripts.sessions('mochi')).toHaveLength(2)
  })
})
