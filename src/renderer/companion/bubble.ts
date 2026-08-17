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
 *
 * ## It shows what she has NOT said yet, dimmed
 *
 * The first working version revealed the text progressively and hid the rest,
 * which sounds right and reads badly. Where she is in her own sentence can only
 * be estimated (`pace.ts` explains why nothing on the wire says), and hiding the
 * future turns every half-second of estimate error into words that are simply
 * missing — the reader cannot catch up, because there is nothing to catch up to.
 *
 * So the whole passage is on screen: said in full ink, the word she is on
 * underlined, still-to-come dimmed. The same error becomes an underline that is
 * slightly off with every word still readable. **The cursor is a reading aid,
 * not a gate.**
 */

import { createPacer, wordAt } from './pace'
import { wrapByWord } from './wrap'

/** Seconds of silence before it goes. The design's number. */
export const FADE_AFTER_QUIET_S = 1.2

/** And how long the fade itself takes, once it starts. */
const FADE_S = 0.35

/**
 * How recently there must have been sound for the cursor to be moving.
 *
 * Much tighter than the fade's 1.2s, and they are different questions. "Is she
 * still in this utterance" tolerates a pause; "is she saying a word right now"
 * does not, and using the fade's threshold for both advanced the cursor through
 * every pause at full speed.
 */
const SOUNDING_S = 0.25

/** Never more than this on screen. A bubble is a glance, not a transcript. */
const MAX_CHARS = 220

/** How much of what is still to come to keep in view, dimmed. */
const AHEAD = 80

/** Held so a long story is not truncated before she has read it. */
const MAX_HELD = 20_000

/** Lines that fit. The rest scrolls past. */
const LINES = 4

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
   * going?"`.
   *
   * §56 measured the pair: text arrived first in 6 of 6 responses, by 0–320ms,
   * and for a one-word utterance that window carries all of it. §19 is *not*
   * evidence here and was briefly miscited as though it were: it measured the
   * pair of ENDINGS.
   */
  add(delta: string, responseId: string): void
  /**
   * Her audio for this response has begun — `output_audio_buffer.started`,
   * which carries the id.
   *
   * The anchor everything hangs on, and the ONLY correct use of that event
   * here. As a boundary between one utterance's text and the next it is wrong,
   * for the reason `add` gives; as "her voice for THIS response starts now" it
   * is exact, and it is the only signal that is — the analyser hears sound but
   * cannot say whose.
   */
  speaks(responseId: string): void
  /**
   * Her audio finished on its own, or she was cut off.
   *
   * The two are different frames (`.stopped` against `.cleared`) and the
   * difference is load-bearing: only the natural end means she said everything
   * that was generated, which is the one fact `pace.ts` can calibrate against.
   */
  finished(responseId: string, interrupted: boolean): void
  /**
   * Advance the fade and the cursor. `quietFor` is the mouth's own measurement.
   *
   * **`quietFor` answers "how long since sound", which means nothing until
   * there has been sound — and it cannot say whose.** Three call sites got some
   * form of this wrong before it was treated as one rule:
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
   *   playing; the gap between them then satisfied "she has gone quiet", and the
   *   bubble faded and **emptied itself** — so it flashed while she was silent
   *   and was gone for the whole minute she then spent speaking.
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

/** One run of text on a line, and how it should look. */
interface Run {
  readonly text: string
  readonly style: 'said' | 'saying' | 'ahead'
}

/**
 * Cut a line into up to three runs at the current word.
 *
 * `start` is where the line begins in the same string the two boundaries are
 * measured in — passing an offset from a different string is the mistake this
 * signature exists to make hard to write.
 */
export function runsFor(line: string, start: number, from: number, to: number): readonly Run[] {
  const end = start + line.length
  const cut = (a: number, b: number): string =>
    line.slice(Math.max(0, a - start), Math.max(0, Math.min(line.length, b - start)))

  const runs: Run[] = [
    { text: cut(start, Math.min(from, end)), style: 'said' },
    { text: cut(Math.max(start, from), Math.min(to, end)), style: 'saying' },
    { text: cut(Math.max(start, to), end), style: 'ahead' },
  ]
  return runs.filter((run) => run.text !== '')
}

export function createBubble(): Bubble {
  /** Everything generated for the current response — the future included. */
  let text = ''
  let opacity = 0
  let saying: string | null = null
  /**
   * Whether THIS response's audio has begun. Not "whether there was sound".
   *
   * Survives the end of the utterance, because it answers "has this ever been
   * on screen" and the fade needs that long after `speaking` is false.
   */
  let begun = false
  /** Whether it is still going. Gates the CURSOR only — see `step`. */
  let speaking = false
  const pacer = createPacer()

  function beginUtterance(responseId: string): void {
    saying = responseId
    text = ''
    begun = false
    speaking = false
    pacer.restart()
  }

  return {
    add(delta: string, responseId: string) {
      if (responseId !== saying) beginUtterance(responseId)
      // Held whole, not trimmed to what fits: `MAX_CHARS` bounds what is SHOWN,
      // and trimming here would throw away the end of a story before she has
      // read it. Bounded well above any real utterance so it cannot grow without
      // limit on a session that never ends.
      if (text.length < MAX_HELD) text += delta
      pacer.wrote(text)
      // Deliberately NOT `opacity = 1`. Text arriving is not her speaking — that
      // is the whole of §56 — and a bubble that appears on arrival appears
      // during the silence before her.
    },
    speaks(responseId: string) {
      if (responseId !== saying) beginUtterance(responseId)
      begun = true
      speaking = true
      pacer.began()
    },
    finished(responseId: string, interrupted: boolean) {
      // A frame for an utterance that is no longer on screen is not this one's
      // business, and acting on it would stop a live cursor.
      if (responseId !== saying) return
      speaking = false
      if (interrupted) pacer.cut()
      else pacer.ended()
    },
    step(quietFor: number, dtSeconds: number) {
      // `begun`, not `speaking`. Gating the FADE on the utterance still being
      // live froze the bubble wherever its opacity happened to be the moment
      // `.stopped` arrived — half-transparent, on screen, for ever. The end of
      // an utterance is precisely when a fade should be running.
      if (text === '' || !begun) return
      // The cursor, though, only moves while this response is actually going.
      if (speaking) pacer.step(dtSeconds, quietFor < SOUNDING_S)

      if (quietFor >= FADE_AFTER_QUIET_S) {
        // She has stopped. Fade — but keep the text, because a pause between two
        // sentences is not the end of the utterance, and emptying here is what
        // made the bubble unable to come back.
        opacity = Math.max(0, opacity - dtSeconds / FADE_S)
        return
      }
      opacity = Math.min(1, opacity + dtSeconds / FADE_S)
    },
    clear() {
      text = ''
      opacity = 0
      saying = null
      speaking = false
      pacer.restart()
    },
    draw(ctx, width, colours) {
      if (text === '' || opacity <= 0) return false

      const pad = 10
      const radius = 12
      const lineHeight = 18
      const maxWidth = width - pad * 4

      ctx.save()
      ctx.font = '13px -apple-system, system-ui, sans-serif'
      ctx.textBaseline = 'top'

      // A window around the cursor: what she has just said, plus a glimpse of
      // what is coming. Bounded so a 1101-character story is not re-measured
      // sixty times a second for four lines of output.
      const cursor = pacer.at()
      const to = Math.min(text.length, cursor + AHEAD)
      const from = Math.max(0, to - MAX_CHARS)
      const visible = text.slice(from, to)

      // Wrapped by MEASUREMENT, not by character count: she is routinely
      // speaking Chinese, where a glyph is about twice the width of a Latin one.
      // Where it is allowed to break is `wrap.ts` — a separate question with a
      // separate answer per script.
      const lines = wrapByWord(visible, maxWidth, (one) => ctx.measureText(one).width)

      const word = wordAt(text, cursor)
      const wordFrom = (word?.from ?? cursor) - from
      const wordTo = (word?.to ?? cursor) - from

      // Which LINE she is on, and a window of lines around it.
      //
      // Taking the last four instead was wrong in a way that only shows on real
      // text: a passage with a paragraph break wraps to more lines than fit, and
      // the last four are then entirely past the cursor — every word dimmed, no
      // underline anywhere, on screen for the whole paragraph. The character
      // window bounds the WORK; the line window is what has to follow her.
      let cursorLine = 0
      let scanned = 0
      for (const [index, line] of lines.entries()) {
        if (wordFrom < scanned + line.length) {
          cursorLine = index
          break
        }
        scanned += line.length
        cursorLine = index
      }
      // Her line sits second from the bottom, so one line of what is coming is
      // always visible — the whole point of showing the unsaid text at all.
      const last = Math.max(0, lines.length - LINES)
      const start = Math.min(last, Math.max(0, cursorLine - (LINES - 2)))
      const shown = lines.slice(start, start + LINES)
      let offset = 0
      for (const line of lines.slice(0, start)) offset += line.length

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

      let at = offset
      shown.forEach((line, row) => {
        const top = y + pad + row * lineHeight
        let left = x + pad
        for (const run of runsFor(line, at, wordFrom, wordTo)) {
          // Dimmed rather than hidden — the point of showing it at all.
          ctx.globalAlpha = opacity * (run.style === 'ahead' ? 0.38 : 1)
          ctx.fillStyle = colours.ink
          ctx.fillText(run.text, left, top)
          const runWidth = ctx.measureText(run.text).width
          if (run.style === 'saying') {
            ctx.fillRect(left, top + lineHeight - 4, runWidth, 1)
          }
          left += runWidth
        }
        at += line.length
      })
      ctx.restore()
      return true
    },
  }
}
