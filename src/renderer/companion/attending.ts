import { rms } from './rig/envelope'

/**
 * Whether the user is talking — known LOCALLY, about a second before the
 * service admits it.
 *
 * §62 measured the whole reason this exists. From the user actually stopping to
 * `input_audio_buffer.speech_stopped` arriving is **1026ms at the median**, and
 * `eagerness` does not move it: across every setting the spread was 68ms
 * against the second that would have to go. End to end, "I stop talking → she
 * is audible" is **1819ms** against a 1000ms goal.
 *
 * That second cannot be removed. But it is only invisible because the app was
 * waiting for the server to tell it something the microphone already knew: the
 * user's voice went quiet. The same envelope that drives her mouth, pointed at
 * the INPUT instead of the output, answers in about a tenth of that.
 *
 * So the dead window stops being dead. She can react to the silence while the
 * service is still deciding what it means — which does not make her faster and
 * does make the wait legible, and those are different problems with different
 * fixes. This is the second one.
 */

export type Attention =
  /** Nothing is happening. */
  | 'idle'
  /** They are talking right now. */
  | 'hearing'
  /** They have stopped and nothing has come back yet. THE window §62 measured. */
  | 'considering'

/**
 * How long the voice must be gone before it counts as a pause in the user.
 *
 * Deliberately short — this is the whole point, and the budget being competed
 * with is a second. Long enough not to fire between two words, which at
 * ordinary speaking rates is comfortably under 200ms.
 */
const QUIET_S = 0.35

/** And how loud counts as talking at all, above room noise. */
const SPEAKING_RMS = 0.02

export interface Attending {
  /** One frame of microphone. Returns the state, which may have just changed. */
  step(level: number, dtSeconds: number): Attention
  /** Her voice started, so whatever they said has been answered. */
  answered(): void
  /** No microphone any more. */
  reset(): void
  state(): Attention
}

export function createAttending(): Attending {
  /**
   * Its own quiet timer, not the mouth envelope's `quietFor`.
   *
   * That number is measured against the envelope's OWN silence threshold, which
   * is tuned for driving a mouth from her output and is not the same question
   * as "is this person talking into a microphone". Borrowing it made a 150ms
   * gap between two words read as a full second of silence.
   */
  let quiet = 0
  let state: Attention = 'idle'
  /** Set when she answers, cleared when they speak again — see `step`. */
  let spent = false

  return {
    step(level: number, dtSeconds: number) {
      const talking = level > SPEAKING_RMS
      quiet = talking ? 0 : quiet + dtSeconds

      if (talking) {
        state = 'hearing'
        spent = false
        return state
      }
      // Quiet. Whether that is a pause or the end of a turn is exactly what the
      // service takes a second to decide — but "they were talking and now they
      // are not" is knowable here and now, and it is enough to react to.
      if (state === 'hearing' && quiet >= QUIET_S) {
        state = spent ? 'idle' : 'considering'
      }
      return state
    },
    answered() {
      // Not `idle`: they may still be quiet, and going straight to idle would
      // let the next silence re-trigger considering with nothing to consider.
      spent = true
      if (state === 'considering') state = 'idle'
    },
    reset() {
      quiet = 0
      state = 'idle'
      spent = false
    },
    state: () => state,
  }
}

/** The level of one frame of microphone, in the same unit the mouth uses. */
export function levelOf(samples: Float32Array): number {
  return rms(samples)
}
