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
import { CHECK, CLOSE, COPY, HISTORY, strokeIcon } from './icons'
import {
  placeBubble,
  sidesThatFit,
  type Body,
  type Room,
  type Side,
  type SidePreference,
} from './place'

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
  /**
   * The unread-problems dot. Not themed, unlike everything else here.
   *
   * The rest of the colour is handed in so she can sit on a light desktop or a
   * dark one. This one is not decoration -- it means "read me" -- and a red that
   * politely adapts to its surroundings can lose that argument. It is `--alarm`
   * rather than a literal now, and `tokens.css` carries the four measurements
   * that let one value serve both schemes.
   */
  readonly alarm: string
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
   * How visible it is, 0 to 1.
   *
   * Exposed for the window fit: her window has to stay large enough for the
   * bubble while it FADES, and shrinking on the frame the text is cleared would
   * clip the last 0.35s of it. The beat already publishes the same thing for the
   * same kind of reason.
   */
  opacity(): number
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
    her: Anchor,
    /** Where the bubble may go, in canvas pixels. See `place.ts`. */
    room: Room,
    /** Which side somebody asked for, or `auto`. */
    prefer: SidePreference,
    hovered: boolean,
    /** How many things main could not do, for the badge on the history control. */
    problems?: number,
  ): boolean
  /**
   * Move the reader's position, in lines. Positive is further into the text.
   *
   * Until this is called the page follows her; after it, it holds where the
   * reader left it until the next utterance.
   */
  scrollBy(lines: number): void
  /**
   * Which sides the bubble could go on, from the last frame it drew.
   *
   * Read rather than pushed, so nothing is computed for a menu that is not
   * open. Null until it has drawn once.
   */
  offered(): { readonly available: readonly Side[]; readonly using: Side } | null
  /** Where its controls are, so the caller can route the mouse to them. */
  controls(): { readonly copy: Rect; readonly close: Rect; readonly history: Rect } | null
  /** Whether a point is anywhere on it — for hover, not for clicks. */
  covers(x: number, y: number): boolean
  /** Dismiss what is showing. The NEXT utterance still appears. */
  dismiss(): void
  /** Say that a copy just happened, so the button can confirm it. */
  copied(): void
}

/**
 * Her whole body in CSS pixels, which is what the bubble is placed AROUND.
 *
 * It used to be her centre and the top of her head, which is everything a
 * bubble above her needs and not enough for one anywhere else: below her needs
 * her feet, and beside her needs both her sides.
 */
export type Anchor = Body

export interface Rect {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
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

/**
 * The tail, and how far its tip stops short of her head.
 *
 * `GAP` is measured from the TIP, not from the bubble's underside, so it is
 * the distance somebody actually sees. Six read as crowding her; the tail only
 * has to point, not touch.
 */
const TAIL = 8
const GAP = 18
/**
 * The text column, in CSS pixels — a reading measure rather than the canvas.
 *
 * About 60 Latin characters or 26 Chinese ones at 13px, which is inside the
 * range prose is comfortable at. Her window is 700 wide so the bubble has room
 * to slide clear of a screen edge; wrapping text to that width would make every
 * line a paragraph.
 */
const TEXT_W = 340
/**
 * The control buttons, and the room kept clear for them.
 *
 * RESERVED ALWAYS, not only while they are showing. The alternatives are both
 * worse: laying text under them and masking it leaves a line that reads as
 * truncated mid-word, and widening the box on hover reflows the paragraph
 * under the pointer at the exact moment somebody is trying to read it.
 *
 * The cost is a permanently narrower first line, which is the cheapest of the
 * three and the only one that never surprises anybody.
 */
const BUTTON = 16
/** Between stacked buttons. Enough to separate two 24-grid glyphs, no more. */
const BUTTON_GAP = 4
/**
 * ONE column, at the right edge, not a row across the top.
 *
 * A row put three buttons into the first line's width, which is where the
 * sentence starts — so the opening words of every utterance were squeezed into
 * whatever was left. A column costs the same room on every line instead of a
 * lot on one, and it gives each control a fixed place: the close button is
 * always the top right corner, wherever the text ends.
 */
const CONTROLS_W = BUTTON + 8
/** Room for the whole column, so a one-line bubble is not shorter than it. */
const CONTROLS_H = BUTTON * 3 + BUTTON_GAP * 2 + 8

/**
 * The reading rail: how much more there is, and where in it the reader is.
 *
 * Three pixels wide and inset five from the right edge, which puts it clear of
 * the control column by three — the buttons end at `boxWidth - pad + 2`.
 */
const RAIL_W = 3
const RAIL_INSET = 5
/** So a very long passage still has a thumb somebody can see. */
const RAIL_MIN = 14

/** The problem badge on the history control. A dot: a digit at this size is mush. */
const DOT = 3.5

export function createBubble(): Bubble {
  let opacity = 0
  /** What is on screen right now, so `dismiss` can name it. */
  let shownText = ''
  /** A frame counter, only for timing the copy confirmation. */
  let frames = 0
  /** Dismissed by hand. Reset by the next utterance, not by the next frame. */
  let hidden = ''
  /**
   * Which line the reader scrolled to, or null while the page follows her.
   *
   * Two sources for one number would be two sources of truth, so this is an
   * OVERRIDE rather than a second input: while it is null the page is chosen by
   * where she has got to, and the moment somebody scrolls it stops following
   * and holds. A new utterance clears it — the alternative is arriving at her
   * next sentence still parked in the middle of the last one.
   */
  let scrolledTo: number | null = null
  /** What the last frame worked out about where the bubble may go. */
  let offered: { available: readonly Side[]; using: Side } | null = null
  /** Where the page would be if nobody had scrolled. `scrollBy` starts here. */
  let followingLine = 0
  /**
   * When a copy was confirmed, so the button can say so and then stop.
   *
   * `null`, not `0`. Zero is a real frame number — the one the bubble opens on
   * — so a zero here read as "just copied" and the button showed a tick for the
   * first second and a half of EVERY utterance, confirming something nobody
   * had done.
   */
  let confirmedAt: number | null = null
  let laidOut: { copy: Rect; close: Rect; history: Rect; box: Rect } | null = null
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
      frames += 1
      opacity = Math.min(1, opacity + dtSeconds / FADE_S)
    },
    opacity: () => opacity,
    clear() {
      opacity = 0
      wrapped = null
      hidden = ''
      laidOut = null
      scrolledTo = null
    },
    dismiss() {
      // The TEXT is remembered, not a flag: the next utterance is different
      // text, so it shows without anything having to reset this. A boolean
      // would have to be cleared by somebody, and whoever forgot would leave
      // the bubble permanently off with no way to tell why.
      hidden = shownText
    },
    copied() {
      confirmedAt = frames
    },
    offered: () => offered,
    scrollBy(lines: number) {
      // Recorded, not clamped: how far it CAN go depends on the wrap, which is
      // known only inside `draw` where the width is. Draw clamps and writes the
      // clamped value back, so a long scroll past the end does not accumulate a
      // debt that has to be scrolled back through.
      scrolledTo = (scrolledTo ?? followingLine) + lines
    },
    controls: () =>
      laidOut === null
        ? null
        : { copy: laidOut.copy, close: laidOut.close, history: laidOut.history },
    covers(x: number, y: number) {
      if (laidOut === null) return false
      const { box } = laidOut
      return x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h
    },
    draw(ctx, width, colours, text, at, her, room, prefer, hovered, problems = 0) {
      // A different utterance is a different thing to read, so the reader's
      // position goes back to following her. Without this, her next sentence
      // opens parked in the middle of the last one.
      if (text !== shownText) scrolledTo = null
      shownText = text
      if (text === '' || opacity <= 0 || text === hidden) {
        laidOut = null
        return false
      }

      const pad = 10
      const radius = 12
      const lineHeight = 18
      /**
       * How wide the text column may be — a fixed measure, not a fraction of
       * the canvas.
       *
       * The canvas is 700 wide now, so wrapping to it would give a line of
       * about ninety Latin characters: technically legible, and nothing anybody
       * reads comfortably. `TEXT_W` is a reading measure, and it also fixes the
       * bubble's widest possible box, which is what `place.ts` needs in order
       * to know whether it fits beside her.
       */
      const maxWidth = Math.min(TEXT_W, width - pad * 4 - CONTROLS_W)

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
      /**
       * Where the reader is, which is where SHE is until somebody says otherwise.
       *
       * Clamped here rather than in `scrollBy`, because how far it can go
       * depends on the wrap and the wrap depends on the width — neither of
       * which that method knows. The clamped value is written back so a long
       * flick past the end does not bank a debt that has to be scrolled off
       * before the text moves again.
       */
      const lastStart = Math.max(0, lines.length - LINES)
      followingLine = Math.min(page * LINES, lastStart)
      const start =
        scrolledTo === null ? followingLine : Math.max(0, Math.min(scrolledTo, lastStart))
      if (scrolledTo !== null) scrolledTo = start
      const shown = lines.slice(start, start + LINES)
      let offset = 0
      for (const line of lines.slice(0, start)) offset += line.length

      // Wide enough for the text OR for the controls, whichever needs more —
      // a one-word utterance must not produce a box the buttons hang out of.
      const boxWidth = Math.min(
        maxWidth + pad * 2 + CONTROLS_W,
        Math.max(
          CONTROLS_W + pad * 2,
          Math.max(...shown.map((one) => ctx.measureText(one).width)) + pad * 2 + CONTROLS_W,
        ),
      )
      // Tall enough for the text OR for the control column, whichever needs
      // more. Without the floor, "Yes." makes a box shorter than the three
      // stacked buttons and the last one hangs off the bottom edge.
      const boxHeight = Math.max(shown.length * lineHeight + pad * 2, CONTROLS_H)

      /**
       * Just above her head, not at the top of the window.
       *
       * The window is far taller than she is, so a bubble pinned to its top
       * edge floated two hundred pixels away from the thing saying the words.
       * Proximity is half of what makes it read as HERS; the tail is the other
       * half.
       *
       * Clamped to the window rather than allowed to run off it: the window is
       * what sits in the screen corner, so anything above its edge is simply
       * clipped away, and a clipped first line is worse than a lower bubble.
       */
      /**
       * Which side of her, decided against the SCREEN rather than the window.
       *
       * Her window is far larger than she is and deliberately hangs off the
       * edge of the display when she is parked in a corner, so "inside the
       * window" and "on screen" are different questions. `room` answers the
       * second; see `place.ts`.
       */
      const placed = placeBubble(her, { w: boxWidth, h: boxHeight }, room, GAP + TAIL, prefer)
      // What the menu may offer. Reported by the caller, from the same call
      // that did the placing, so the menu cannot list a side that would not be
      // honoured if it were picked.
      offered = {
        available: sidesThatFit(her, { w: boxWidth, h: boxHeight }, room, GAP + TAIL),
        using: placed.side,
      }
      const { x, y } = placed
      const centreX = her.left + her.width / 2
      const centreY = her.top + her.height / 2

      ctx.globalAlpha = opacity
      // Opaque, per rule 2 — the alpha above fades the WHOLE bubble in and out,
      // which is a different thing from a translucent surface with the desktop
      // showing through the words.
      ctx.fillStyle = colours.paper
      ctx.beginPath()
      ctx.roundRect(x, y, boxWidth, boxHeight, radius)
      ctx.fill()

      /**
       * The tail: a small triangle from the underside, pointing at her head.
       *
       * This is what makes the box read as SPEECH rather than as a notification
       * that happens to be nearby. It points at HER centre, not at the box's,
       * because those come apart the moment the box is clamped to the window
       * edge — and a tail pointing at nothing is worse than no tail.
       */
      ctx.beginPath()
      if (placed.side === 'above' || placed.side === 'below') {
        const tip = Math.max(x + radius + TAIL, Math.min(x + boxWidth - radius - TAIL, centreX))
        // The edge that FACES her, and the direction that reaches for her.
        const edge = placed.side === 'above' ? y + boxHeight - 1 : y + 1
        const reach = placed.side === 'above' ? TAIL : -TAIL
        ctx.moveTo(tip - TAIL, edge)
        ctx.lineTo(tip, edge + reach)
        ctx.lineTo(tip + TAIL, edge)
      } else {
        const tip = Math.max(y + radius + TAIL, Math.min(y + boxHeight - radius - TAIL, centreY))
        const edge = placed.side === 'left' ? x + boxWidth - 1 : x + 1
        const reach = placed.side === 'left' ? TAIL : -TAIL
        ctx.moveTo(edge, tip - TAIL)
        ctx.lineTo(edge + reach, tip)
        ctx.lineTo(edge, tip + TAIL)
      }
      ctx.closePath()
      ctx.fill()

      /**
       * The controls, INSIDE the bubble's top right corner.
       *
       * They straddled the edge before, which put half of each button over
       * whatever happened to be behind her — so they were unreadable against a
       * dark desktop and looked detached from the thing they belong to. Inside
       * means they are always on her paper.
       */
      /**
       * Down the right edge, in the order somebody reaches for them: close at
       * the top corner where a close button belongs, copy under it, and the way
       * into her conversations at the bottom.
       *
       * That last one used to float at her shoulder as a chip of its own, which
       * put a second speech-bubble glyph beside an actual speech bubble and left
       * two controls on screen for one utterance.
       */
      const column = x + boxWidth - pad - BUTTON + 2
      const close = { x: column, y: y + 4, w: BUTTON, h: BUTTON }
      const copy = { x: column, y: close.y + BUTTON + BUTTON_GAP, w: BUTTON, h: BUTTON }
      const history = { x: column, y: copy.y + BUTTON + BUTTON_GAP, w: BUTTON, h: BUTTON }
      laidOut = { copy, close, history, box: { x, y, w: boxWidth, h: boxHeight } }

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
      /**
       * Controls, on hover only.
       *
       * Always-visible buttons put permanent chrome on something meant to be
       * glanced at. Hover is detectable without taking the mouse — the window
       * forwards `mousemove` while clicks pass through — so the text stays
       * click-through and only these two rectangles ever become solid.
       */
      if (hovered) {
        const fresh = confirmedAt !== null && frames - confirmedAt < 90
        ctx.globalAlpha = opacity
        for (const [rect, icon] of [
          [close, CLOSE],
          [copy, fresh ? CHECK : COPY],
          [history, HISTORY],
        ] as const) {
          // Inset, so Lucide's 24-grid artwork has the margin it is drawn for.
          strokeIcon(ctx, icon, { x: rect.x + 2, y: rect.y + 2, size: rect.w - 4 }, colours.ink)
        }
      }

      /**
       * Something main could not do — said WITHOUT waiting to be hovered.
       *
       * Every other control here is hover-only, because permanent chrome on
       * something meant to be glanced at is chrome you stop seeing. This one is
       * the exception on purpose: the case it exists for is somebody editing a
       * persona file, reloading, and seeing nothing change — because the file
       * was rejected and a default took over. They have no reason to hover.
       */
      if (problems > 0) {
        ctx.globalAlpha = opacity
        if (!hovered) {
          strokeIcon(
            ctx,
            HISTORY,
            { x: history.x + 2, y: history.y + 2, size: history.w - 4 },
            colours.ink,
          )
        }
        ctx.fillStyle = colours.paper
        ctx.beginPath()
        ctx.arc(history.x + history.w - 2, history.y + 2, DOT + 1.5, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = colours.alarm
        ctx.beginPath()
        ctx.arc(history.x + history.w - 2, history.y + 2, DOT, 0, Math.PI * 2)
        ctx.fill()
      }

      /**
       * How much more there is, and where in it the reader is.
       *
       * Two earlier attempts, both rejected against the running app. A `⋯` at
       * half alpha in the top-left padding, beside a rounded corner, **read as
       * a second bubble peeking out from behind this one** and was reported as
       * exactly that. A fade at the top and bottom edges then sat almost
       * entirely in the ten pixels of padding, where it said nothing at all —
       * and making it tall enough to read meant eating the line somebody was
       * trying to read.
       *
       * A rail touches no text, cannot be mistaken for another surface, and
       * says more than either: not just THAT there is more, but how much and
       * whereabouts. It is drawn in the right margin, clear of the control
       * column by a few pixels, and only when the passage does not fit.
       */
      if (lines.length > LINES) {
        const trackTop = y + pad
        const trackHeight = boxHeight - pad * 2
        const thumbHeight = Math.max(RAIL_MIN, (trackHeight * LINES) / lines.length)
        // Positioned over the range it can actually travel, so the thumb is
        // flush with the bottom on the last line rather than short of it.
        const travel = trackHeight - thumbHeight
        const progress = lastStart === 0 ? 0 : start / lastStart
        const railX = x + boxWidth - RAIL_INSET

        ctx.globalAlpha = opacity * 0.12
        ctx.fillStyle = colours.ink
        ctx.beginPath()
        ctx.roundRect(railX, trackTop, RAIL_W, trackHeight, RAIL_W / 2)
        ctx.fill()

        ctx.globalAlpha = opacity * 0.42
        ctx.beginPath()
        ctx.roundRect(railX, trackTop + travel * progress, RAIL_W, thumbHeight, RAIL_W / 2)
        ctx.fill()
      }

      ctx.restore()
      return true
    },
  }
}
