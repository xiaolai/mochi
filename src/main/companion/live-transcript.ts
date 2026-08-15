/**
 * The conversation being written down right now.
 *
 * ## Why this is a module and not a variable
 *
 * It was `let liveSession: number | null`, opened, closed and nulled by hand at
 * six call sites: the wake, the sleep, the quit, the retention switch, a
 * single-conversation delete and a whole-persona delete. Every one of those
 * sites did the same three things in a slightly different order, and every one
 * of them called into SQLite, which throws.
 *
 * That produced a defect at each site rather than one:
 *
 * - A throw from `say` escaped the voice-event listener, so a storage error
 *   during a conversation could take down the path that receives speech.
 * - A throw from `end` left the handle non-null, so the next wake saw "already
 *   recording", skipped opening a row, and appended the new conversation to
 *   the old one.
 * - A throw from `begin` escaped after the lifecycle had already advanced and
 *   the microphone had been decided, leaving her awake and the state machine
 *   past the point that could undo it.
 * - Deciding which conversation was live by looking for the row with no end
 *   is a guess: an imported archive may legitimately hold one. The handle is
 *   now the conversation's own token, which cannot be reissued -- so a stale
 *   one names nothing rather than naming whatever took its place.
 *
 * One owner fixes the class. The invariants are stated once here and hold for
 * every caller:
 *
 * 1. **Nothing here throws.** Losing a transcript is bad; taking down the
 *    voice path or the state machine to report it is worse. Failures are
 *    loud in the log and invisible to the conversation.
 * 2. **The handle is released whatever happens.** A handle that survives its
 *    row is how one conversation ends up appended to another.
 * 3. **`writing()` is the single answer** to "is anything being recorded", so
 *    the tray readout and the session cannot disagree.
 */

import type { Speaker, Transcripts, LiveSession, SessionToken } from '../store/transcripts'

export interface LiveTranscript {
  /**
   * Start writing a conversation for her.
   *
   * A no-op when one is already open: the retention switch and the wake can
   * both ask, and two rows for one conversation is worse than one.
   */
  begin(personaId: string): void
  /** Record one turn. Silently does nothing when not writing. */
  say(who: Speaker, text: string): void
  /** Finish the conversation. Safe when there is none. */
  end(): void
  /**
   * Let go WITHOUT finishing: the row this named has been deleted.
   *
   * Distinct from `end` because ending a row that no longer exists is not a
   * no-op, it is a write against a deleted id -- and the caller that just
   * deleted it is the only one who knows.
   */
  release(): void
  /** Whether anything is being written down at this moment. */
  writing(): boolean
  /** What the open conversation answers to, or null. Never a guess. */
  which(): SessionToken | null
}

export function createLiveTranscript(store: () => Transcripts | null): LiveTranscript {
  let session: LiveSession | null = null

  /** Run a store call, and never let its failure reach the caller. */
  function attempt(what: string, run: (history: Transcripts) => void): void {
    const history = store()
    if (history === null) return
    try {
      run(history)
    } catch (error: unknown) {
      // Loud, because the alternative is a conversation that silently stops
      // being recorded while the tray still says it is.
      console.error(`[transcripts] could not ${what}:`, error)
    }
  }

  return {
    begin(personaId) {
      if (session !== null) return
      const history = store()
      if (history === null) return
      try {
        // `begin` answers null when the instant is already taken, which is a
        // refusal rather than a failure -- see the store. Either way nothing
        // is being written, and that is what `writing()` will say.
        session = history.begin(personaId)
      } catch (error: unknown) {
        console.error('[transcripts] could not start writing this conversation down:', error)
        session = null
      }
    },
    say(who, text) {
      const open = session
      if (open === null) return
      attempt('write down what was said', (history) => {
        history.say(open, who, text)
      })
    },
    end() {
      const open = session
      // Released FIRST, so a throw inside cannot leave the handle behind. The
      // failure this ordering prevents is the expensive one: a stale handle
      // makes the next wake think it is already recording, and the next
      // conversation is appended to this one.
      session = null
      if (open === null) return
      attempt('finish writing this conversation down', (history) => {
        history.end(open)
      })
    },
    release() {
      session = null
    },
    writing() {
      return session !== null
    },
    which() {
      // The handle IS the name now, so there is nothing to look up and nothing
      // that can fail. It used to be a rowid, which meant asking the store --
      // and before that, guessing at the row with no end.
      return session
    },
  }
}
