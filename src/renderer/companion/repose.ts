/**
 * What she does when nothing is happening.
 *
 * ## Why this exists at all, and what it is answering
 *
 * `usage.json` on the real installation: over 275 sessions and 914 of her
 * turns, `set_expression` was called **zero times**. Eight expressions were
 * drawn, painted and reachable, and she never once reached for one.
 *
 * The lesson is not that the faces were wrong. It is that **anything requiring
 * her to choose stays unchosen**, so a motion added without a trigger is
 * another eight-faces. Every clip this module names is driven by the passage of
 * time, which needs no decision from anybody.
 *
 * ## A ladder, not a switch
 *
 * Somebody who has stopped talking to her has not necessarily left, and the
 * three rungs are three different lengths of absence:
 *
 * - **she looks around** — a single turn, at the point where a person would
 *   glance up from what they were doing;
 * - **she swings** — gentle, going nowhere, the posture of waiting;
 * - **she wanders** — she has been alone long enough to get comfortable.
 *
 * Each is more visible than the last, and the last is the only one that moves
 * her, so the thing most likely to be noticed is the thing that takes longest
 * to arrive. That ordering is the whole design: a companion who starts pacing
 * thirty seconds after you look away is a companion you turn off.
 *
 * ## `busy` collapses every reason to stop into one
 *
 * She is speaking, they are speaking, the beat is waiting on a slow answer, the
 * pointer is on her, she is asleep. All of those mean the same thing here —
 * something is happening, so nothing ambient should be — and enumerating them
 * in this module would put a second copy of "is anything going on" beside the
 * one `face.ts` already assembles.
 *
 * ## It cannot outrank the beat
 *
 * There is ONE motion slot. `beat.ts` plays `sway` while a real answer is
 * outstanding, and that is legible information — she is waiting on something.
 * An ambient motion overwriting it would replace a signal with decoration, so
 * `busy` is asserted by the caller for the whole of a beat and this returns
 * `none` throughout.
 */

/** The looping motion that should be playing, or none. */
export type Ambient = 'none' | 'swing' | 'wander'

export interface Repose {
  /**
   * Advance by `seconds`, and say what she should be doing.
   *
   * `look` is true on EXACTLY ONE step, which is what separates a one-shot from
   * a loop: `playMotion` has a single slot, so a caller that treated `turn` as
   * a state would stop it again on the next frame. A loop is a state and a
   * glance is an event, and this returns each as what it is.
   */
  step(seconds: number, busy: boolean): { readonly loop: Ambient; readonly look: boolean }
  /** Forget the quiet. The next rung starts counting from here. */
  reset(): void
}

/**
 * When she glances up.
 *
 * Twenty seconds is about the length of a pause somebody would not call a
 * silence. Short enough that it happens in an ordinary conversation, and it is
 * the cheapest of the three: one turn of her features, no travel.
 */
export const LOOK_AFTER_S = 20

/** When she settles into swinging. Long enough to mean they have stopped. */
export const SWING_AFTER_S = 38

/**
 * When she starts wandering.
 *
 * Nearly two minutes, and deliberately far from the rung below it. This is the
 * only ambient motion that takes her anywhere, and the argument recorded in
 * `plan-v2.md` is that a companion who moves unbidden is one that cannot be
 * ignored. Two minutes of nobody saying anything is the point at which being
 * noticed is a feature rather than an interruption.
 */
export const WANDER_AFTER_S = 110

export function createRepose(): Repose {
  let quiet = 0
  /** Whether the glance has already been spent for this stretch of quiet. */
  let looked = false

  return {
    step(seconds, busy) {
      if (busy) {
        // Reset on the FRAME something happens, not after a decay. Ambient
        // motion continuing for even a moment into her being spoken to reads
        // as her not having noticed.
        quiet = 0
        looked = false
        return { loop: 'none', look: false }
      }
      // Guarded rather than trusted: `seconds` comes from a frame delta, and a
      // tab that was throttled hands back a number large enough to skip every
      // rung at once. Non-finite would poison the accumulator permanently.
      if (Number.isFinite(seconds) && seconds > 0) quiet += seconds

      const loop: Ambient =
        quiet >= WANDER_AFTER_S ? 'wander' : quiet >= SWING_AFTER_S ? 'swing' : 'none'

      const look = !looked && quiet >= LOOK_AFTER_S
      if (look) looked = true
      return { loop, look }
    },
    reset() {
      quiet = 0
      looked = false
    },
  }
}
