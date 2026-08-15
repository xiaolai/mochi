/**
 * The conversation being written down, and what happens when the disk refuses.
 *
 * Almost every test here is about a THROW. The six call sites this replaced
 * each reached into SQLite and let it throw into whatever was calling them --
 * the voice-event listener, the state machine, the quit handler. The rules are
 * that nothing here escapes and the handle is always released, and both are
 * only worth stating if they are checked.
 */

import { describe, expect, it, vi } from 'vitest'
import { createLiveTranscript } from './live-transcript'
import type { Transcripts } from '../store/transcripts'

/** The calls a live transcript can make, as spies the test can read. */
function spies() {
  return {
    begin: vi.fn((_personaId: string): string | null => 'token-1'),
    say: vi.fn(),
    end: vi.fn(),
    sessions: vi.fn(() => []),
  }
}

/**
 * A store built from those spies.
 *
 * Only the five methods a live transcript touches are real; the rest are
 * absent, which is deliberate — if this file ever needs one of them, the
 * module has grown a reach it is not supposed to have.
 */
function storeOf(calls: ReturnType<typeof spies>): Transcripts {
  return calls as unknown as Transcripts
}

const angry = (): never => {
  throw new Error('SQLITE_BUSY')
}

describe('writing a conversation down', () => {
  it('writes turns while it is open, and none once it is closed', () => {
    const calls = spies()
    const live = createLiveTranscript(() => storeOf(calls))

    live.begin('ada')
    live.say('you', 'hello')
    live.end()
    live.say('you', 'after the end')

    expect(calls.say).toHaveBeenCalledTimes(1)
    expect(live.writing()).toBe(false)
  })

  it('does not open a second conversation over an open one', () => {
    // The wake and the retention switch can both ask. Two rows for one
    // conversation is worse than one, and the second would take the turns.
    const calls = spies()
    const live = createLiveTranscript(() => storeOf(calls))

    live.begin('ada')
    live.begin('ada')

    expect(calls.begin).toHaveBeenCalledTimes(1)
  })

  it('is not writing when the store refuses the instant', () => {
    // `begin` answers null when that millisecond already has one of hers --
    // a refusal, not a failure. Nothing is being recorded either way, and
    // `writing()` has to say so or the tray claims a conversation that has
    // no row.
    const calls = { ...spies(), begin: vi.fn((): string | null => null) }
    const live = createLiveTranscript(() => storeOf(calls))
    live.begin('ada')
    expect(live.writing()).toBe(false)
  })

  it('is not writing when there is no store at all', () => {
    const live = createLiveTranscript(() => null)
    live.begin('ada')
    expect(live.writing()).toBe(false)
    expect(() => {
      live.say('you', 'hello')
      live.end()
    }).not.toThrow()
  })
})

describe('when the disk refuses', () => {
  it('never lets a failed write reach the caller', () => {
    // This runs inside the voice-event listener. A SQLite error escaping it
    // could take down the path that receives speech -- so the conversation
    // stops being recorded, rather than the conversation stopping.
    const live = createLiveTranscript(() => storeOf({ ...spies(), say: vi.fn(angry) }))
    live.begin('ada')
    expect(() => live.say('you', 'hello')).not.toThrow()
  })

  it('never lets a failed open reach the caller', () => {
    // This runs after the lifecycle has advanced and the microphone has been
    // decided. A throw here leaves her awake with the state machine past the
    // point that could undo it.
    const live = createLiveTranscript(() => storeOf({ ...spies(), begin: vi.fn(angry) }))
    expect(() => live.begin('ada')).not.toThrow()
    expect(live.writing()).toBe(false)
  })

  it('releases the handle even when finishing fails', () => {
    // The expensive one. A handle that survives its row makes the next wake
    // believe it is already recording, so it opens no new conversation and
    // the next one is appended to this one -- two conversations in a row that
    // the reader has no way to separate.
    const calls = { ...spies(), end: vi.fn(angry) }
    const live = createLiveTranscript(() => storeOf(calls))

    live.begin('ada')
    expect(() => live.end()).not.toThrow()

    expect(live.writing()).toBe(false)
    live.begin('ada')
    expect(calls.begin).toHaveBeenCalledTimes(2)
  })
})

describe('naming the open conversation', () => {
  it('is the token the store handed back, not a guess at the row with no end', () => {
    // The guess it replaced -- "the session whose `endedAt` is null" -- is
    // wrong in a case that exists: an imported archive can carry one. Acting
    // on it would release the handle because somebody deleted a DIFFERENT
    // conversation, and recording would stop with nothing saying so.
    const calls = { ...spies(), begin: vi.fn((): string | null => 'the-open-one') }
    const live = createLiveTranscript(() => storeOf(calls))

    live.begin('ada')

    expect(live.which()).toBe('the-open-one')
    expect(calls.sessions).not.toHaveBeenCalled()
  })

  it('names nothing when nothing is open', () => {
    const live = createLiveTranscript(() => storeOf(spies()))
    expect(live.which()).toBeNull()
  })

  it('lets go without ending a row that has already been deleted', () => {
    // `release` exists because ending a deleted row is not a no-op -- it is a
    // write against an id that is gone.
    const calls = spies()
    const live = createLiveTranscript(() => storeOf(calls))

    live.begin('ada')
    live.release()

    expect(calls.end).not.toHaveBeenCalled()
    expect(live.writing()).toBe(false)
  })
})
