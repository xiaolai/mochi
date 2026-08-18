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

import { wrapByWord } from './wrap'

/** Seconds of silence before it goes. The design's number. */
export const FADE_AFTER_QUIET_S = 1.2

/** And how long the fade itself takes, once it starts. */
const FADE_S = 0.35

/**
 * Lines the bubble may grow to.
 *
 * Eight rather than four because most of what she says fits in eight, and text
 * that fits never moves at all — which is the whole point of the change. Her
 * window is 320 tall and she stands 97 of it, so this is what is actually
 * available above her head.
 */
const LINES = 8

export interface BubbleColours {
  /** The opaque surface. See rule 2. */
  readonly paper: string
  readonly ink: string
}

export interface Bubble {
  /**
   * Advance the fade.
   *
   * `quietFor` is the analyser's own measurement, and it **cannot say whose
   * sound it is** — three call sites got some form of that wrong before it was
   * treated as one rule:
   *
   * - Before the analyser exists, `quietFor` is `Infinity` — correct for
   *   "nothing has ever been heard" — and it retired the bubble one frame after
   *   it appeared.
   * - Between an utterance's first delta and its first audio, the number is real
   *   but describes the silence BEFORE her. The bubble reached the desktop at
   *   alpha 0.24: `#f4f2ea` over `(30,30,45)` read `(81,81,90)`, which is
   *   `1 − 0.27/0.35` of a 0.35s fade.
   * - Sound from the PREVIOUS utterance counted as this one's, so the gap
   *   between two responses satisfied "she has gone quiet" and the bubble faded
   *   and emptied itself.
   *
   * Hence `begun`, which comes from the utterance rather than from a clock. It
   * gates the fade on THIS response having started, and outlives `speaking` on
   * purpose — the end of an utterance is exactly when a fade should run.
   */
  step(quietFor: number, dtSeconds: number, begun: boolean): void
  /** Turned off: forget the fade so a re-enable does not flash the last state. */
  clear(): void
  /**
   * Draw, if there is anything to draw. Returns whether it painted.
   *
   * `text` and `at` come from the utterance, which owns them because the
   * archive needs them too and does not care what the persona looks like.
   */
  draw(
    ctx: CanvasRenderingContext2D,
    width: number,
    colours: BubbleColours,
    text: string,
    at: number,
  ): boolean
}

/** One run of text on a line, and how it should look. */
interface Run {
  readonly text: string
  readonly style: 'said' | 'ahead'
}

/**
 * Cut a line into up to three runs at the current word.
 *
 * `start` is where the line begins in the same string the two boundaries are
 * measured in — passing an offset from a different string is the mistake this
 * signature exists to make hard to write.
 */
export function runsFor(line: string, start: number, at: number): readonly Run[] {
  const end = start + line.length
  const cut = (a: number, b: number): string =>
    line.slice(Math.max(0, a - start), Math.max(0, Math.min(line.length, b - start)))

  const runs: Run[] = [
    { text: cut(start, Math.min(at, end)), style: 'said' },
    { text: cut(Math.max(start, at), end), style: 'ahead' },
  ]
  return runs.filter((run) => run.text !== '')
}

export function createBubble(): Bubble {
  let opacity = 0
  /**
   * The wrap, cached against the text it was made from.
   *
   * The whole text is wrapped, not a sliding window around the cursor. A window
   * that slides with the cursor makes every page a slightly different page, so
   * paging on top of it still moves the words — which is the thing being fixed.
   *
   * Caching is what makes that affordable: the text changes a few times a
   * second as deltas arrive, and this draws sixty. Keyed on the text and the
   * width, because either one changing invalidates it.
   */
  let wrapped: { text: string; width: number; lines: string[] } | null = null

  function linesFor(
    ctx: CanvasRenderingContext2D,
    text: string,
    maxWidth: number,
  ): readonly string[] {
    if (wrapped !== null && wrapped.text === text && wrapped.width === maxWidth) {
      return wrapped.lines
    }
    const lines = wrapByWord(text, maxWidth, (one) => ctx.measureText(one).width)
    wrapped = { text, width: maxWidth, lines }
    return lines
  }

  return {
    step(_quietFor: number, dtSeconds: number, begun: boolean) {
      // Fades IN only. It stays until the next utterance replaces it or the
      // bubble is turned off.
      //
      // This retires v1's rule 1 — *fade 1.2s after the analyser reports her
      // audio ended* — deliberately rather than by forgetting it. That rule
      // existed to stop the bubble being retired EARLY, because the data
      // channel says "done" seconds before she stops speaking (§19, and §57
      // measured minutes on a long answer). A bubble that is not retired at all
      // cannot be retired early, so the hazard the rule guarded against is
      // gone with it. `quietFor` is kept in the signature because the caller
      // still has it and a future state — "she cannot reach a voice" — will
      // want it.
      if (!begun) return
      opacity = Math.min(1, opacity + dtSeconds / FADE_S)
    },
    clear() {
      opacity = 0
      wrapped = null
    },
    draw(ctx, width, colours, text, at) {
      if (text === '' || opacity <= 0) return false

      const pad = 10
      const radius = 12
      const lineHeight = 18
      const maxWidth = width - pad * 4

      ctx.save()
      ctx.font = '13px -apple-system, system-ui, sans-serif'
      ctx.textBaseline = 'top'

      // The WHOLE text, wrapped once and cached — see `linesFor`. There is no
      // window sliding along with the cursor: a window that slides makes every
      // page a slightly different page, so paging on top of one still moves the
      // words, which is the thing being fixed.
      //
      // Wrapped by MEASUREMENT, not by character count: she is routinely
      // speaking Chinese, where a glyph is about twice the width of a Latin
      // one. Where it may break is `wrap.ts` — a separate question with a
      // separate answer per script.
      const cursor = at
      const lines = linesFor(ctx, text, maxWidth)

      // Where she has got to. No word span: the underline is gone, because it
      // claimed WORD-level precision that §60 measured this cursor does not
      // have (−3% to −22%). The ink boundary claims only "about here", which is
      // what is known.
      const spoken = cursor

      // Which LINE she is on, and which PAGE that is.
      //
      // Paged, not scrolled. Following the cursor line by line makes the text a
      // teleprompter: it moves continuously and the reader's eye chases it. A
      // page holds still until she leaves it, so the text moves once every
      // eight lines instead of on every one.
      let cursorLine = 0
      let scanned = 0
      for (const [index, line] of lines.entries()) {
        cursorLine = index
        if (spoken < scanned + line.length) break
        scanned += line.length
      }
      const page = Math.floor(cursorLine / LINES)
      const start = page * LINES
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

      let lineStart = offset
      shown.forEach((line, row) => {
        const top = y + pad + row * lineHeight
        let left = x + pad
        for (const run of runsFor(line, lineStart, spoken)) {
          // Dimmed rather than hidden — the point of showing it at all.
          ctx.globalAlpha = opacity * (run.style === 'ahead' ? 0.38 : 1)
          ctx.fillStyle = colours.ink
          ctx.fillText(run.text, left, top)
          left += ctx.measureText(run.text).width
        }
        lineStart += line.length
      })
      ctx.restore()
      return true
    },
  }
}
