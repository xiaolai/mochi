/**
 * How she holds herself in each phase of the lifecycle.
 *
 * A TABLE, in `shared/`, because two processes' worth of code has to agree on
 * it and one of them is a build script. It lived inside a `switch` in
 * `companion/main.ts` — a module that touches `window` and the bridge at load,
 * so nothing outside the running renderer could read it.
 *
 * ## Why that mattered
 *
 * `scripts/make-site-art.ts` draws the website's pictures with the real rig,
 * so her SHAPE cannot drift from the product. It then picked expressions out of
 * `LOOKS` by hand, and two of the four were faces the app never wears: it
 * showed her mid-sentence with `happy` eyes and an eye glint, when she is
 * `neutral` for the whole of `awake`; and it showed a `thinking` face, which
 * nothing in the app has ever set. The geometry could not drift and the
 * expression drifted immediately, because only one of the two had a single
 * source.
 *
 * With the table here, an expression the lifecycle never assigns is not
 * something the website can render — the generator walks `PHASES` rather than
 * choosing.
 *
 * ## What is deliberately NOT here
 *
 * The waking `poke`. An impulse is motion, not posture: it decays to nothing
 * within about a second, so it belongs to the moment of the transition rather
 * than to the phase, and a still frame of `waking` should show the expression
 * it settles into. It stays at the call site in `companion/main.ts`.
 *
 * The MOUTH, likewise, and more firmly. Nothing here moves it. `EnvelopeMouth`
 * is its single writer, and the reason is stated where `wear` used to live: an
 * avatar that mouths during the dial is lying about whether anything is being
 * said. "Talking" is `awake` plus a mouth the audio opened, never a posture of
 * its own.
 */

import type { Phase } from './companion'
import type { EmotionSignal } from './avatar'

/**
 * The four, in the order she moves through them.
 *
 * Exported so a caller can WALK them rather than list them. The website's four
 * pictures come from this array, which is what makes "the site shows a face the
 * app never wears" unrepresentable rather than merely fixed once.
 */
export const PHASES = ['asleep', 'waking', 'awake', 'farewell'] as const satisfies readonly Phase[]

export const POSTURE: Readonly<Record<Phase, EmotionSignal>> = {
  // Visibly dozing rather than hidden. `sleepy` already carries a settled
  // squash, so she looks like she is resting on the desk, not switched off.
  asleep: { emotion: 'sleepy', intensity: 1 },

  // The instant reaction, and the whole reason the lifecycle is worth feeling
  // before the voice layer exists. She is LOCAL and runs at 60fps; the session
  // is ~900ms away. A reaction inside 100ms makes the wait that follows read as
  // her thinking rather than as the app hanging — same total latency,
  // completely different experience, and none of it touches the network.
  //
  // `surprised` is the perk: wide eyes and a negative squash, so she stretches
  // up, and it decays back to neutral on its own while the dial is still in
  // flight — the shape of "oh!" followed by attention.
  waking: { emotion: 'surprised', intensity: 0.6, holdMs: 700 },

  // Neutral for the ENTIRE conversation, which is the fact the website got
  // wrong. Whatever she is doing while awake is carried by the mouth and the
  // gaze; the face underneath does not editorialise.
  awake: { emotion: 'neutral', intensity: 0 },

  // A warm sign-off that fades of its own accord, so `asleep` arriving
  // afterwards is a settle rather than a second instruction fighting it.
  farewell: { emotion: 'happy', intensity: 0.5, holdMs: 1400 },
}

/**
 * The impulse that goes with waking, as a number rather than a call.
 *
 * -0.16, down from -0.4. It ADDS to the squash the emotion already carries, and
 * the two were once chosen independently: together they drove the target past
 * -0.34, so waking her launched her rather than perking her up.
 */
export const WAKE_IMPULSE = -0.16
