/**
 * When a late answer may be spoken, given that she might be mid-sentence.
 *
 * ## The gap this closes
 *
 * §1 measured five ways of delivering a result that arrives a turn late and
 * chose one: answer the call immediately with `started`, then send a **second**
 * `function_call_output` on the same `call_id` when the work finishes, with
 * **no** `response.create`. That is what ships, and `ledger.ts` asserts it —
 * asking for a turn while she is speaking is refused with
 * `conversation_already_has_active_response`, intermittently, which is the
 * hardest kind of failure to reproduce.
 *
 * §1's own words for what happens next are *"it comes out naturally the next
 * time she speaks"*. Observed on 2026-08-24, that turned out to assume a
 * conversation that keeps going:
 *
 * ```
 * 00:00:23  ask_workspace(…)                    she says she will look
 * 00:00:42  "Just a tiny moment more, 笑来."
 * 00:01:07  ask_workspace delivered {"status":"ok","answer":"…27 to 30 degrees…"}
 *           — and then nothing, because nobody spoke to her again
 * ```
 *
 * The answer was correct, complete, and sat in her context unsaid. A lookup
 * that answers only if you happen to speak again is not an answer.
 *
 * ## Why the decision is split across the two processes
 *
 * Main decides **that** she should volunteer it — that is a decision about what
 * this machine does on somebody's behalf, and those are main's. Only the
 * renderer can decide **when**, because "is she making sound right now" is a
 * fact about the audio it is holding.
 *
 * ## And why it is safe to ask at all
 *
 * §1's refusal was measured specifically *while she is speaking*. So the rule
 * is to ask only when she is not, and `output_audio_buffer.started` /
 * `.stopped` / `.cleared` are exactly that signal — all three captured, all
 * three carrying `response_id` (§47).
 *
 * **If the ask is refused anyway, nothing is lost.** The `function_call_output`
 * has already gone out by then, so a refused turn degrades precisely to the
 * behaviour above: she says it the next time she speaks. That is what makes
 * this worth attempting rather than engineering around — the failure mode is
 * the status quo.
 */
export interface Nudge {
  /**
   * A late answer has landed and she should say it.
   *
   * Returns whether to ask for a turn NOW. `false` means she is speaking, and
   * the request is remembered until she stops.
   */
  wanted(): boolean
  /** The ask did not go out; want it again. See the implementation. */
  again(): void
  /**
   * Her audio started or ended.
   *
   * Returns whether this is the moment to ask — true only when a request was
   * waiting and she has just gone quiet.
   */
  sounding(on: boolean): boolean
  /** Whether an ask is still waiting. For the log and for assertions. */
  waiting(): boolean
}

export function createNudge(): Nudge {
  let speaking = false
  let pending = false

  return {
    wanted() {
      if (!speaking) return true
      // She is mid-sentence: remember rather than ask and be refused.
      pending = true
      return false
    },
    sounding(on: boolean) {
      const stopped = speaking && !on
      speaking = on
      if (!stopped || !pending) return false
      // ONE ask, however many answers arrived while she was talking: the turn
      // she takes can carry all of them, and a second `response.create` behind
      // the first is the refusal this module exists to avoid.
      pending = false
      return true
    },
    /**
     * The ask did not go out after all; want it again.
     *
     * `wanted()` and `sounding()` both clear the flag on the way to returning
     * true — they say "ask now", and the caller was assumed to have done it.
     * `put` can drop the frame on a channel that is not open, and then the
     * nudge is spent for an ask that never happened: her answer sits in the
     * conversation, unspoken, and nothing will ever request the turn that
     * would say it. That is the exact silence this module exists to prevent,
     * arrived at from the other side.
     */
    again() {
      pending = true
    },
    waiting: () => pending,
  }
}
