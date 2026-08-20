/**
 * The pause before she answers — held locally, because the wait is the point.
 *
 * ## The measurement this exists for
 *
 * §64 swept five turn-detection settings on one harness, sixteen turns each,
 * and found no configuration that reaches a one-second goal. The best measured
 * is **1470ms P90** (`server_vad` at 400ms, bought with cutting the speaker off
 * once in sixteen); the shipped `semantic_vad` gives **1989ms P90**. The cost is
 * arithmetic rather than tuning: an energy detector has to outwait the longest
 * pause inside a sentence, which for the measured speaker is ~540ms, and
 * `semantic_vad` beats that bound by reading the words and takes 1004ms to do
 * it. There is no setting between them.
 *
 * So the second and a half cannot be removed. It can only be made legible, and
 * `attending.ts` already argues that those are different problems with
 * different fixes. This is the second one, one state further along: `attending`
 * knows they stopped talking, and this is what she does about it until her own
 * voice arrives.
 *
 * ## Why it is not driven by a frame from the service
 *
 * A beat entered on a server event inherits the very latency it exists to
 * cover — it would appear at the moment it was no longer needed. Everything
 * here is local: turn end comes from the microphone's own envelope through
 * `attending`, and leaving comes from the analyser that already drives her
 * mouth. Nothing in this file, and nothing that calls it, needs a message from
 * main.
 *
 * ## And the case where the answer never comes
 *
 * §64 also measured, in every arm and on the same two utterances every pass,
 * `output_audio_buffer.started` arriving followed by **no audio at all**
 * (analyser peak exactly 0.0000) — 6 of 24 sentences with the detector never
 * settling. That is roughly one turn in four, which is a common case rather
 * than an edge, and in the app it presents as silence rather than as slowness.
 * Open-ended silence from a companion is indistinguishable from one that has
 * crashed, so the beat has to end in something rather than in nothing.
 *
 * ## What it draws: nothing
 *
 * It used to draw a pill under her — three dots, then the words "say that
 * again?". That pill was removed, and the argument against it is in this file's
 * own code: *"Her own body rather than a spinner: a companion that shows a
 * progress indicator has stopped being a companion."* The pill was a spinner
 * with better manners.
 *
 * Four things were wrong with it. It was written in the first person, so it read
 * as HER asking — while the fault it reported is that her audio never arrived,
 * which is the app's, not hers. It prescribed an action that does not fix that:
 * repeating yourself rolls the same one-in-four dice again. It sat below her
 * while her real speech sits above her, so the surface written in her voice was
 * the one that was not her. And it taught anybody using it that she is hard of
 * hearing, when she never got to speak.
 *
 * What remains is what this file always did better: she looks away and sways
 * while she waits, then comes back to you and nods. No words, no blame, and no
 * claim about whose fault the silence was.
 *
 * Leaving is the ANALYSER's answer rather than `output_audio_buffer.started`
 * for exactly that reason. The started frame is a promise of audio; the
 * analyser is audio. §64 measured them disagreeing.
 */

export type Beat =
  /** Nothing is pending — she is talking, or nobody has said anything. */
  | 'none'
  /** Their turn ended and her voice has not arrived. THE beat. */
  | 'held'
  /** Long past anything §64 measured. The detector is not going to settle. */
  | 'overdue'

/**
 * How long the beat is held before it is called overdue, in seconds.
 *
 * §64's P90 for the shipped `semantic_vad` is 1989ms measured **from the end of
 * the clip**, and this beat opens ~350ms after that — `attending`'s own
 * `QUIET_S`, the local silence that says the turn ended. So the P90 lands about
 * 1.64s into the beat, and three seconds is ~3.35s from clip end: comfortably
 * past every arm in the sweep, including the 900ms one at 2220ms.
 *
 * Chosen to fail in the quieter direction. Too short and an ordinary slow turn
 * is told to repeat itself, which is worse than waiting; too long and the
 * one-in-four case sits in silence for longer than it has to.
 */
export const OVERDUE_S = 3

/** Long enough to read as arriving, short enough not to feel like a delay. */
const FADE_S = 0.12

export interface HeldBeat {
  /**
   * Their turn ended — the microphone went quiet. Opens the beat.
   *
   * Takes effect on the next `step`, not here, so a turn that ends while she is
   * already making sound never opens a beat that would close on the same frame.
   */
  turnEnded(): void
  /** They are talking again, she is asleep, or the session went away. */
  reset(): void
  /** One frame. `sounding` is the analyser's answer about HER voice. */
  step(dtSeconds: number, sounding: boolean): Beat
  state(): Beat
  /** How long it has been held, in seconds. Zero when there is no beat. */
  heldFor(): number
  /** How far it has faded in, 0..1. Zero when there is no beat. */
  opacity(): number
}

export function createBeat(overdueSeconds: number = OVERDUE_S): HeldBeat {
  let state: Beat = 'none'
  let held = 0
  /** A turn ended and `step` has not seen it yet. See `turnEnded`. */
  let opening = false

  return {
    turnEnded() {
      // Only from rest. A second turn end inside a live beat is the same wait
      // continuing, and restarting the clock would push `overdue` out of reach
      // for anybody who clears their throat.
      if (state !== 'none') return
      opening = true
    },
    reset() {
      state = 'none'
      held = 0
      opening = false
    },
    step(dtSeconds: number, sounding: boolean) {
      const dt = Number.isFinite(dtSeconds) ? Math.min(Math.max(dtSeconds, 0), 0.25) : 0
      if (sounding) {
        // Her voice. Whatever was being waited for has arrived, and this is the
        // only thing that closes the beat — see the header on why it is the
        // analyser rather than the frame that promises audio.
        state = 'none'
        held = 0
        opening = false
        return state
      }
      if (opening) {
        opening = false
        state = 'held'
        held = 0
      }
      if (state === 'none') return state
      held += dt
      if (state === 'held' && held >= overdueSeconds) state = 'overdue'
      return state
    },
    state: () => state,
    heldFor: () => (state === 'none' ? 0 : held),
    opacity: () => (state === 'none' ? 0 : Math.min(1, held / FADE_S)),
  }
}
