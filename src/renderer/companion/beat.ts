import type { Body, Room } from './place'

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
 * Open-ended silence from a companion is indistinguishable from a companion
 * that has crashed, so the beat expires into something that says so and gives
 * the person the one action that helps: say it again.
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

/**
 * Its own opaque surface, and a fixed size.
 *
 * Opaque because the handoff settles it as a rule — anything carrying words
 * gets its own surface with an elevation, never the wallpaper — and she may be
 * sitting on a photograph. Fixed because both strings this ever draws are
 * constants in this file: measuring text to size a box whose contents cannot
 * change would be a per-frame measurement for an answer that is known here.
 */
const WIDTH = 116
const HEIGHT = 22
/** Clear of her body, so the two do not read as one shape. */
const GAP = 10

/** What the overdue beat says. The one action that helps, in her own words. */
export const OVERDUE_TEXT = 'say that again?'

export interface BeatColours {
  readonly paper: string
  readonly ink: string
}

export interface Rect {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

/**
 * Where it sits: centred under her, or over her head when there is no room.
 *
 * BELOW by preference, which is the opposite of the bubble's — `place.ts` tries
 * `above` first — so the two do not compete for the same strip when a persona
 * has the bubble turned on. The room is the same `Room` everything else in this
 * window is placed against: her window deliberately hangs off the display, so
 * "inside the canvas" is not the same question as "on screen".
 */
export function beatRect(her: Body, room?: Room): Rect {
  const below = her.top + her.height + GAP
  const above = her.top - GAP - HEIGHT
  const centred = her.left + her.width / 2 - WIDTH / 2

  // No room means the whole canvas, which is what a caller drawing her in
  // isolation — the tests, the tuner — should get.
  const y = room === undefined || below + HEIGHT <= room.bottom ? below : Math.max(room.top, above)
  const x =
    room === undefined
      ? centred
      : Math.min(Math.max(centred, room.left), Math.max(room.left, room.right - WIDTH))
  return { x, y, w: WIDTH, h: HEIGHT }
}

/**
 * Draw the beat. Nothing at all when there is none.
 *
 * An early return rather than a zero-alpha paint: this is called every frame,
 * and she is not in a beat for almost all of them.
 *
 * It does NOT take the mouse, and that is the difference between this and the
 * chip. `chip.ts` widens "only painted pixels of hers take the mouse" because a
 * control nobody can click is not a control; this is not a control, so the
 * exception does not apply and her hit region is unchanged.
 */
export function drawBeat(
  ctx: CanvasRenderingContext2D,
  her: Body,
  colours: BeatColours,
  state: Beat,
  opacity: number,
  room?: Room,
): void {
  if (state === 'none' || opacity <= 0) return
  const { x, y, w, h } = beatRect(her, room)

  ctx.save()
  ctx.globalAlpha = Math.min(1, opacity)

  ctx.fillStyle = colours.paper
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, 8)
  ctx.fill()

  ctx.fillStyle = colours.ink
  if (state === 'held') {
    // Three dots, and nothing that claims to be progress. Nothing here knows
    // how long the wait will be — §64 is the measurement that says nothing
    // does — so a bar filling towards an end would be an invention.
    for (let i = 0; i < 3; i += 1) {
      ctx.beginPath()
      ctx.arc(x + w / 2 + (i - 1) * 8, y + h / 2, 2, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
    return
  }

  ctx.font = '11px -apple-system, system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(OVERDUE_TEXT, x + w / 2, y + h / 2)
  ctx.restore()
}
