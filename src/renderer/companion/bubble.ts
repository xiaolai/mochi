/**
 * Her words, beside her.
 *
 * v1 designed this and never built it. Three of its rules are load-bearing and
 * are kept verbatim, because each one is a decision somebody already made
 * carefully:
 *
 * ## 1 · It fades on the ANALYSER, not on the data channel
 *
 * The design says: *fades 1.2 s after the analyser reports her audio ended, not
 * after the data channel says `response.done` — the wire is ~2.1 s early.*
 *
 * `dev-docs/README.md` filed that as a rotted cross-reference, because §19 later
 * measured the gap and found it is **not a constant** — it grows with sentence
 * length. But the rule does not depend on the number. It names the hazard and
 * then picks the mechanism that is immune to it: the analyser knows when the
 * sound stopped, and no amount of drift in the wire changes that. §19 makes the
 * rule *more* necessary, not less.
 *
 * `EnvelopeState.quietFor` is exactly this measurement, and it already exists
 * because the mouth needs it.
 *
 * ## 2 · It is opaque, in both schemes
 *
 * The design settles it as a rule rather than a colour: *anything carrying
 * words gets its own opaque surface*, because she may sit on anything — a
 * photograph included. A translucent bubble has no contrast ratio at all, since
 * there is no telling what is behind it.
 *
 * ## 3 · It must not enlarge her hit region
 *
 * `hitTest` is the promise that only painted pixels take the mouse, and the
 * promise is about HER silhouette. The bubble is drawn here and asked nothing:
 * `face.ts` computes click-through from `avatar.hitTest` alone, so a bubble
 * cannot quietly turn a strip of the window solid.
 */

import { wrapByWord } from './wrap'

/** Seconds of silence before it goes. The design's number. */
export const FADE_AFTER_QUIET_S = 1.2

/** And how long the fade itself takes, once it starts. */
const FADE_S = 0.35

/** Never more than this on screen. A bubble is a glance, not a transcript. */
const MAX_CHARS = 220

export interface BubbleColours {
  /** The opaque surface. See rule 2. */
  readonly paper: string
  readonly ink: string
}

export interface Bubble {
  /**
   * One fragment of what she is generating, with the response it belongs to.
   *
   * **The id is what marks a new utterance, and a boundary for text has to come
   * from the text.** The first version cleared the bubble on
   * `output_audio_buffer.started` — the event that says her AUDIO has begun —
   * and the bubble then showed only a suffix of what she said, observed on
   * screen: `"how's everything going?"` of `"Hi, I'm back, how's everything
   * going?"`. Deltas that arrived before the audio started were thrown away.
   *
   * §56 measured the pair: text arrived first in 6 of 6 responses, by 0–320ms.
   * Milliseconds are the wrong unit and understate it — in that window the
   * generator emits a clause, and for a **one-word** utterance it emits all of
   * it, so the bubble was not truncated but permanently blank. §19 is *not*
   * evidence here and was briefly miscited as though it were: it measured the
   * pair of ENDINGS.
   *
   * The reason to use the id is not the size of that gap. It is that a boundary
   * for text taken from the audio stream depends on an interleaving nobody here
   * controls, so it is wrong by a varying amount and fails silently — presenting
   * as a model that sometimes drops its opening words.
   */
  add(delta: string, responseId: string): void
  /**
   * Advance the fade. `quietFor` comes from the same envelope as the mouth.
   *
   * **`quietFor` answers "how long since sound", which means nothing until
   * there has been sound.** Two different call sites got this wrong before it
   * was treated as a class:
   *
   * - Before the analyser exists at all, `quietFor` is `Infinity` — correct for
   *   "nothing has ever been heard", and it retired the bubble on the frame
   *   after it appeared.
   * - Between this utterance's first delta and its first audio, the number is
   *   real but describes the SILENCE BEFORE HER, not a pause in her. §56
   *   measured that window at 0–320ms, and the bubble reached the desktop at
   *   alpha 0.24 — measured off a screenshot, `#f4f2ea` over `(30,30,45)`
   *   reading `(81,81,90)`, which is `1 − 0.27/0.35` of a 0.35s fade.
   *
   * So the fade waits for sound rather than for a clock, here, once, instead of
   * at each caller.
   */
  step(quietFor: number, dtSeconds: number): void
  /**
   * Forget everything, because the bubble was turned off.
   *
   * Without it a persona with no bubble, worn after one that had it, would
   * bring the previous character's last sentence back the moment it was
   * switched on again.
   */
  clear(): void
  /** Draw, if there is anything to draw. Returns whether it painted. */
  draw(ctx: CanvasRenderingContext2D, width: number, colours: BubbleColours): boolean
}

export function createBubble(): Bubble {
  let text = ''
  let opacity = 0
  let saying: string | null = null
  /** Whether her audio has been heard at all, for the utterance now on screen. */
  let sounded = false

  return {
    add(delta: string, responseId: string) {
      if (responseId !== saying) {
        saying = responseId
        text = ''
        // A new utterance has its own audio, which has not started yet.
        sounded = false
      }
      text = (text + delta).slice(-MAX_CHARS)
      // She is talking again, so whatever fade was running is over.
      opacity = 1
    },
    step(quietFor: number, dtSeconds: number) {
      if (text === '') return
      if (quietFor < FADE_AFTER_QUIET_S) {
        // Sound, now or within the interval. From here on "how long since
        // sound" describes a pause in HER rather than the silence before her.
        sounded = true
        return
      }
      // Long silence, but she has not started — so there is nothing to be
      // finished with. See the note on `step` above.
      if (!sounded) return
      opacity = Math.max(0, opacity - dtSeconds / FADE_S)
      if (opacity === 0) text = ''
    },
    clear() {
      text = ''
      opacity = 0
      saying = null
      sounded = false
    },
    draw(ctx, width, colours) {
      if (text === '' || opacity <= 0) return false

      const pad = 10
      const radius = 12
      const font = '13px -apple-system, system-ui, sans-serif'
      const lineHeight = 18
      const maxWidth = width - pad * 4

      ctx.save()
      ctx.font = font
      ctx.textBaseline = 'top'

      // Wrapped by MEASUREMENT, not by character count: she is routinely
      // speaking Chinese, where a glyph is about twice the width of a Latin one
      // and any count-based wrap is wrong in one direction or the other. Where
      // it is allowed to break is `wrap.ts`, which is a separate question with
      // a separate answer per script.
      const lines = wrapByWord(text, maxWidth, (one) => ctx.measureText(one).width)
      // Only the tail fits on screen; a bubble is a glance.
      const shown = lines.slice(-4)

      const boxWidth = Math.min(
        maxWidth + pad * 2,
        Math.max(...shown.map((one) => ctx.measureText(one).width)) + pad * 2,
      )
      const boxHeight = shown.length * lineHeight + pad * 2
      const x = (width - boxWidth) / 2
      const y = pad

      ctx.globalAlpha = opacity
      // Opaque, per rule 2 — the alpha above fades the WHOLE bubble in and out,
      // which is a different thing from a translucent surface with the desktop
      // showing through the words.
      ctx.fillStyle = colours.paper
      ctx.beginPath()
      ctx.roundRect(x, y, boxWidth, boxHeight, radius)
      ctx.fill()

      ctx.fillStyle = colours.ink
      shown.forEach((one, index) => {
        ctx.fillText(one, x + pad, y + pad + index * lineHeight)
      })
      ctx.restore()
      return true
    },
  }
}
