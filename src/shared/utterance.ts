/**
 * One thing she was asked to say, and what became of it.
 *
 * ## Why an utterance needs a name
 *
 * `speak()` used to return nothing. That made three different questions
 * unanswerable: which request a cancellation refers to, whether a request was
 * heard or thrown away, and whether the thing that just ended is the thing you
 * asked for. Everything downstream of "she finished" was guessing.
 *
 * The drill paid for that directly. It marked a word covered when it SENT the
 * request, because there was no later moment it could trust -- so a request
 * that never played still advanced the list, and the word was skipped in
 * silence.
 */

/**
 * A request to speak, as issued.
 *
 * Monotonic ACROSS THE PROCESS, not within one attempt. The distinction is the
 * whole point: an id that restarted per session could collide after a
 * reconnect, and a late outcome from the previous attempt would then commit
 * work for an utterance of the new one. `lifecycle.ts` mints these and says
 * the same thing.
 */
export type UtteranceId = number

/**
 * How an utterance ended.
 *
 * `played` is the only one that means she was heard, and it is the only one a
 * caller should treat as done. Kept distinct rather than collapsed to a
 * boolean because the three want different handling: `cancelled` is somebody
 * interrupting and is normal, `failed` is worth a log line, and a caller that
 * cannot tell them apart will treat an interruption as a completed turn.
 */
export type UtteranceOutcome = 'played' | 'cancelled' | 'failed'

export interface UtteranceEnded {
  readonly id: UtteranceId
  readonly outcome: UtteranceOutcome
}

/**
 * How a request relates to the conversation. TWO dimensions, not one.
 *
 * A single `alone` flag collapsed questions the Realtime API keeps separate,
 * and the two real cases prove they are separate: the drill needs a response
 * that neither reads the conversation nor is added to it, while OpenAI's own
 * out-of-band classification example READS the conversation and is not added
 * to it. One boolean cannot express both.
 *
 * ## There was a third, and it was a trap
 *
 * `audible` was here on the argument that an internal classification would
 * want text back and no sound. Nothing ever constructed it, and it could not
 * have worked: an utterance completes when `output_audio_buffer.stopped`
 * arrives, and a text-only response never emits one. The first caller to pass
 * `audible: false` would have got a request that never ended, holding the
 * session's single sounding slot for the life of the attempt.
 *
 * The same rule as on `AvatarKind`: a member the implementation
 * cannot honour is a promise the type system makes on its behalf. It comes
 * back the day a text-only path exists, with the completion signal that makes
 * it real.
 */
export interface Isolation {
  /** Whether the model may see what has been said so far. */
  readonly reads: boolean
  /** Whether her answer joins the conversation the model sees next time. */
  readonly writes: boolean
}

/**
 * Nothing before it, nothing after it.
 *
 * What a drill needs. It was observed being needed: asked for a sentence using
 * a new word while an unanswered question sat in the conversation, she answered
 * the question with the word instead and the word was burned.
 */
export const ALONE: Isolation = { reads: false, writes: false }

/**
 * The APP asked for this, not the person. It is remembered; it continues nothing.
 *
 * The comment on `ALONE` above turned out to describe a class rather than one
 * feature, and this is its second member. Asked for a goodbye while an
 * unanswered question sat in the conversation -- "Want to start by practicing
 * the question, or jump right into a full dialogue?" -- she answered the
 * question and set a pronunciation exercise. The goodbye was burned exactly as
 * the drill's word had been, by the same mechanism, in a feature written
 * afterwards.
 *
 * So the rule, rather than a third patch: an utterance the app initiates is
 * never a reply, and must not be able to read the turn it would otherwise
 * continue. `writes` stays true because a goodbye is something she said and
 * belongs in the conversation -- the transcript arrives on
 * `response.output_audio_transcript.done` and does not depend on this either
 * way, but the record should still be true.
 */
export const UNPROMPTED: Isolation = { reads: false, writes: true }
