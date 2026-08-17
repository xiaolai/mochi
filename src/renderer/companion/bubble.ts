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

/**
 * How fast she actually speaks, measured (§57), in cost units per second.
 *
 * A subtitle cannot be paced by when the text ARRIVES. §56 established that
 * generation runs ahead of the audio; §57 measured how far, and the answer is
 * not "a little": a 1101-character story was in hand within seconds and took
 * **72.7 seconds** to read aloud. Paced by arrival, the bubble shows the last
 * paragraph of a story for the whole two minutes she spends reading its first.
 *
 * 15.1 chars/s held across 37, 289 and 1101 characters — three orders of length
 * with the same number, which is why it is usable as a constant at all.
 */
const SPEECH_RATE = 15.1

/**
 * What one Chinese glyph costs against one Latin one, at the same speaking rate.
 *
 * §57 measured 4.1 chars/s for Chinese against 15.1 for English — the same
 * mouth, a third of the characters, because a Chinese glyph carries far more.
 * The same shape as the width metric in `wrap.ts`, and for the same reason: a
 * per-character constant that ignores the script is wrong in one direction or
 * the other, and here it would be wrong by a factor of nearly four.
 */
const CJK_COST = SPEECH_RATE / 4.1

/** Held so a long story is not truncated before she has read it. */
const MAX_HELD = 20_000

const CJK = /[⺀-〿぀-ヿ㐀-䶿一-鿿豈-﫿가-힯＀-￯]/u

const costOf = (glyph: string): number => (CJK.test(glyph) ? CJK_COST : 1)

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
   * Her audio for this response has begun — from `output_audio_buffer.started`,
   * which carries the id.
   *
   * This is the anchor the whole thing hangs on, and it is the ONLY correct use
   * of that event here. An earlier version used it as the boundary between one
   * utterance's text and the next, which is wrong for the reason `add` gives.
   * As "her voice for THIS response starts now" it is exact, and it is the only
   * signal that is: the analyser hears sound but cannot say whose.
   */
  speaks(responseId: string): void
  /**
   * Advance the fade and the reveal. `quietFor` is the mouth's own measurement.
   *
   * **`quietFor` answers "how long since sound", which means nothing until
   * there has been sound — and it cannot say whose sound.** Three call sites
   * got some form of this wrong before it was treated as one rule:
   *
   * - Before the analyser exists, `quietFor` is `Infinity` — correct for
   *   "nothing has ever been heard" — and it retired the bubble one frame after
   *   it appeared.
   * - Between an utterance's first delta and its first audio, the number is real
   *   but describes the silence BEFORE her. The bubble reached the desktop at
   *   alpha 0.24: `#f4f2ea` over `(30,30,45)` read `(81,81,90)`, which is
   *   `1 − 0.27/0.35` of a 0.35s fade.
   * - Sound from the PREVIOUS utterance counted as this one's. When she answered
   *   in two responses, the second's text arrived while the first was still
   *   playing; the gap between the two then satisfied "she has gone quiet", and
   *   the bubble faded and **emptied itself** — so it flashed while she was
   *   silent and was gone for the whole minute she then spent speaking.
   *
   * Hence `speaks()`: the fade and the reveal both wait for THIS response's
   * audio. And the fade no longer destroys the text, so a pause is a pause
   * rather than the end of the utterance.
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
  /** Everything generated for the current response — the future included. */
  let text = ''
  /** The prefix of it she is estimated to have actually said. What is drawn. */
  let said = ''
  /** Where `said` ends in `text`, and its cost, so the reveal is O(1) a frame. */
  let at = 0
  let spent = 0
  /** Seconds of her audio, times the rate. Advances only while she sounds. */
  let budget = 0
  let opacity = 0
  let saying: string | null = null
  /** Whether THIS response's audio has begun. Not "whether there was sound". */
  let speaking = false

  /** A new response replaces everything; none of the old state survives it. */
  function beginUtterance(responseId: string): void {
    saying = responseId
    text = ''
    said = ''
    at = 0
    spent = 0
    budget = 0
    speaking = false
  }

  return {
    add(delta: string, responseId: string) {
      if (responseId !== saying) beginUtterance(responseId)
      // Held whole, not trimmed to what fits: `MAX_CHARS` bounds what is SHOWN,
      // and trimming here would throw away the end of a story before she has
      // read it. Bounded well above any real utterance so it cannot grow without
      // limit on a session that never ends.
      if (text.length < MAX_HELD) text += delta
      // Deliberately NOT `opacity = 1`. Text arriving is not her speaking — that
      // is the whole of §56 — and a bubble that appears on arrival appears
      // during the silence before her.
    },
    speaks(responseId: string) {
      if (responseId !== saying) beginUtterance(responseId)
      speaking = true
    },
    step(quietFor: number, dtSeconds: number) {
      if (text === '' || !speaking) return

      if (quietFor >= FADE_AFTER_QUIET_S) {
        // She has stopped. Fade — but keep the text, because a pause between two
        // sentences is not the end of the utterance, and emptying here is what
        // made the bubble unable to come back.
        opacity = Math.max(0, opacity - dtSeconds / FADE_S)
        return
      }

      opacity = Math.min(1, opacity + dtSeconds / FADE_S)
      // Reveal at the rate she actually speaks (§57), not the rate the text
      // arrives at. The remainder carries between frames: at 60fps one frame
      // buys 0.25 of a character, so a loop that discarded it would never
      // advance at all.
      budget += dtSeconds * SPEECH_RATE
      while (at < text.length) {
        const glyph = text[at] ?? ''
        const cost = spent + costOf(glyph)
        if (cost > budget) break
        spent = cost
        said += glyph
        at += 1
      }
    },
    clear() {
      text = ''
      said = ''
      at = 0
      spent = 0
      budget = 0
      opacity = 0
      saying = null
      speaking = false
    },
    draw(ctx, width, colours) {
      if (said === '' || opacity <= 0) return false

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
      //
      // Only the tail of what she has SAID, which is what bounds the work: a
      // 1101-character story wrapped whole on every frame would be re-measured
      // sixty times a second for four lines of output.
      const lines = wrapByWord(
        said.slice(-MAX_CHARS),
        maxWidth,
        (one) => ctx.measureText(one).width,
      )
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
