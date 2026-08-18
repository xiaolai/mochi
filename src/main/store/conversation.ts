import type { Speaker, Transcripts } from './transcripts'

/**
 * The conversation currently being written down.
 *
 * ## Why this is a module and not four lines in `index.ts`
 *
 * It was four lines in `index.ts`, and the only way to check them was to run
 * the app and hope somebody spoke into a thirty-second window. Everything here
 * is a decision — when a conversation starts, whether a turn is stored at all,
 * when it ends — and decisions belong somewhere they can be asserted without a
 * microphone.
 *
 * The archive and the retention setting are injected for the same reason.
 *
 * ## Started lazily, and that is the interesting part
 *
 * A conversation begins on the FIRST turn, not when the session opens. A wake
 * nobody spoke into leaves nothing behind — an empty conversation in the
 * archive is a row saying somebody was there and said nothing, which is untrue
 * and useless, and it would be the most common row in the file.
 *
 * ## Ended on purpose, because retention only prunes what ended
 *
 * A session left open is never pruned: retention considers sessions that have
 * ENDED, so a persona set to keep a week would keep that one forever while
 * every surface reports it dropped. `transcripts.ts` closes sessions left open
 * by an unclean quit the next time the file opens, which covers a crash; this
 * covers every ordinary exit, and the reconnect — which happens hourly (§53).
 */
export interface Conversation {
  /** Wear a persona. Ends whatever was being written for the last one. */
  wear(personaId: string): void
  /**
   * Write one turn. Starts the conversation if this is the first.
   *
   * `cut` marks a turn she was interrupted in, and `at` is when it HAPPENED
   * rather than when the frame describing it arrived. Both matter and both were
   * absent:
   *
   * - Empty text is normally silence and is dropped. An empty turn with `cut`
   *   is not silence — it is a turn she began and was cut off in before a word
   *   of it survived, and losing that is worse than recording it.
   * - `response.output_audio_transcript.done` can arrive **16 seconds** after
   *   the barge-in that ended it (measured). Stamping at arrival puts her
   *   fragment after the user turn that interrupted her and reverses the
   *   archive's order.
   */
  file(who: Speaker, text: string, spoken?: { readonly cut: boolean; readonly at: number }): void
  /** Close the conversation, if one is open. Idempotent. */
  end(): void
  /** Whether anything is currently being written. For assertions and the log. */
  isLive(): boolean
}

export function createConversation(input: {
  readonly transcripts: Transcripts
  /**
   * Whether this persona's conversations are stored at all.
   *
   * A FUNCTION rather than a boolean, so it is read per turn. Somebody turning
   * saving off should have it take effect on the next thing said, not on the
   * next wake — and a cached answer here is exactly the shape that makes a
   * privacy switch look like it worked while it had not yet.
   */
  readonly keeps: (personaId: string) => boolean
  /**
   * The clock, injected.
   *
   * Not a convenience. `begin` answers NULL when the instant it is handed
   * already holds one of hers — `UNIQUE (persona_id, started_at)` — so two
   * conversations inside one millisecond means the second is silently not
   * stored. That is correct behaviour and it made the first version of this
   * module's own test flaky: it passed alone and failed in the full suite,
   * depending only on how fast the machine got between two calls.
   *
   * A test that owns the clock cannot be flaky about it, and the production
   * caller passes `Date.now` and behaves exactly as before.
   */
  readonly now?: () => number
  readonly log?: (text: string) => void
}): Conversation {
  const { transcripts, keeps } = input
  const say = input.log ?? ((): void => {})
  const now = input.now ?? Date.now

  let wearing: string | null = null
  let live: string | null = null

  function end(): void {
    if (live === null) return
    transcripts.end(live, now())
    say('conversation closed')
    live = null
  }

  return {
    wear(personaId: string) {
      // Ended BEFORE the switch, not after: `end` needs the token, and the token
      // belongs to the persona being left.
      end()
      wearing = personaId
    },

    file(who: Speaker, text: string, spoken?: { cut: boolean; at: number }) {
      const cut = spoken?.cut ?? false
      // Silence is not a turn — EXCEPT a cut marker, which is empty on purpose.
      if (wearing === null || (text.trim() === '' && !cut)) return
      if (!keeps(wearing)) return
      if (live === null) {
        live = transcripts.begin(wearing, now())
        if (live === null) {
          // `begin` answers null when this instant already holds one of hers — a
          // clock correction, or two wakes inside a millisecond. Nothing is
          // stored, which is the cheapest of the three bad options and the one
          // the rest of the store already takes. Said out loud, not swallowed.
          say('could not begin a conversation for this instant — nothing stored')
          return
        }
        say(`conversation begun for ${wearing}`)
      }
      // `spoken.at` is when she was interrupted, not when this frame arrived.
      transcripts.say(live, who, text, spoken?.at ?? now(), cut)
    },

    end,
    isLive: () => live !== null,
  }
}
