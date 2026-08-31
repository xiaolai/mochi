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
import { haloClearance } from './halo'
import {
  placeBubble,
  sidesThatFit,
  type Body,
  type Reach,
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
 * **Five, down from eight, and this is a judgement rather than a measurement.**
 *
 * Eight was measured: it is what fits above her head in a 320-tall window, and
 * "text that fits never moves" is the property the number was chosen to give.
 * Five keeps the property and lowers the threshold — more of what she says will
 * now move, and HOW MUCH MORE has never been counted, because nothing has ever
 * bucketed her turns by rendered line count.
 *
 * The argument for it is that fitting and belonging are different questions: at
 * eight lines the box is 184px, which is 57% of her whole window and larger than
 * she is. A bubble is something you glance at; a paragraph you have to settle
 * into belongs in her record, which is what the third control opens.
 *
 * To put the number back on evidence, count the stored turns in
 * `transcripts.db` by wrapped line count at `TEXT_W`. Until somebody does, this
 * is taste — informed taste, and still taste.
 */
const LINES = 5

export interface BubbleColours {
  /** The opaque surface. See rule 2. */
  readonly paper: string
  readonly ink: string
  /**
   * What she has not said yet, as a COLOUR rather than as an alpha.
   *
   * It was `globalAlpha * 0.38` of the ink, which has no stated contrast at all
   * — it depends on the surface underneath, and the whole argument for an
   * opaque bubble is that nothing should. `--bubble-ahead` is measured against
   * the bubble's own paper: 4.57:1 light, 5.66:1 dark. Dim means "she has not
   * got here yet", not "you are not meant to read this".
   */
  readonly ahead: string
  /**
   * Its own edge.
   *
   * A white bubble on a bright photograph has no boundary at all, and a shadow
   * alone is not enough. This is the hairline that makes it a surface.
   */
  readonly edge: string
  /**
   * The disc behind one of the three controls: at rest, and under the pointer.
   *
   * `静止时浅灰,悬停加深` — the boards fill these at rest and deepen them on
   * hover. They were STROKED at rest and filled only when hovered, which is a
   * different shape arriving rather than the same one darkening.
   */
  readonly chip: string
  readonly chipOn: string
  /**
   * The bubble's two shadow layers.
   *
   * The delivery's own note on the surface reads "白气泡在亮壁纸上没有边界,只靠
   * 影子不够" — the 1px stroke was ADDED because a shadow alone is not enough.
   * Only the stroke was built, so the bubble had a hairline and nothing else and
   * read as a sticker rather than as something above the desktop.
   */
  readonly liftFar: string
  readonly liftNear: string
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
  /**
   * Where the bubble on screen actually went, and what else it could have.
   *
   * NOT what the tray menu is built from any more — see `sidesForTheMenu` in
   * `face.ts`. That question is about her NEXT words and has to be answerable
   * while she is silent; this one describes the drawing that exists.
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
  readonly style: 'said' | 'saying' | 'ahead'
}

/**
 * Word boundaries, by the platform's own segmenter rather than by splitting on
 * spaces.
 *
 * She speaks Chinese routinely, and Chinese has no spaces — so a "word" found
 * by looking for gaps is the entire line, and the underline below would run
 * under all of it. `Intl.Segmenter` knows better, and `wrap.ts` beside this
 * already leans on it for the same reason.
 */
const WORDS = new Intl.Segmenter(undefined, { granularity: 'word' })

/** Where the word containing `at` starts and ends, or null if `at` is outside. */
function wordAround(line: string, at: number): { start: number; end: number } | null {
  if (at < 0 || at >= line.length) return null
  for (const part of WORDS.segment(line)) {
    const end = part.index + part.segment.length
    if (at < end) return part.isWordLike === true ? { start: part.index, end } : null
  }
  return null
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

  /*
    THREE runs, and the middle one reverses a measured decision.

    The word span was removed here once, and the reason is in the file's own
    history: §60 measured this cursor's precision at −3% to −22%, so an
    underline claiming to sit under the word she is saying is claiming an
    accuracy the estimate does not have. Two runs claimed only "about here",
    which is what is known.

    The v2 design puts it back, with its eyes open: "位置是估的,永远会差半秒;
    差的是下划线的位置,不是能不能读到" — the position is estimated and will
    always be off by about half a second, and what is wrong is where the
    underline sits, not whether the passage can be read. The whole passage is on
    screen either way, so the error costs a misplaced mark rather than missing
    words. It also buys a real thing: the same 2px underline marks a search hit
    in the window, and both mean "this part, here".

    That is a defensible trade and it is a REVERSAL. If the underline reads as
    lying about where she is, this is the decision to revisit, and §60 is the
    measurement to revisit it with.
  */
  const word = wordAround(line, at - start)
  const runs: Run[] =
    word === null
      ? [
          { text: cut(start, Math.min(at, end)), style: 'said' },
          { text: cut(Math.max(start, at), end), style: 'ahead' },
        ]
      : [
          { text: line.slice(0, word.start), style: 'said' },
          { text: line.slice(word.start, word.end), style: 'saying' },
          { text: line.slice(word.end), style: 'ahead' },
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
 * The tip is rounded, not sharp.
 *
 * A point reads as a spike stuck into her; a 2.2px cap reads as a tail. Small
 * enough that the direction is unaffected — the tail's whole job is to point.
 */
const TAIL_TIP = 2.2

/**
 * The box's own measurements, and they are MODULE constants rather than locals.
 *
 * They were declared inside `draw`, and `WIDEST_BUBBLE` restated two of them as
 * literals — `TEXT_W + 10 * 2` and `LINES * 18`. That is the second copy of the
 * arithmetic this file's own comment says it exists to avoid, and it survives
 * only while nobody changes the padding. This design changes the padding.
 */
const PAD = 12
/** The panel rung, same as the window's. 22, up from 12. */
const RADIUS = 22
/**
 * 14/20, up from 13/18.
 *
 * Not a preference: Outfit's x-height is smaller than the face this was set in,
 * so 13px here would render smaller than the smallest body text in the window
 * while carrying her actual words. Five lines at 20 plus 24 of padding is a
 * 124px box — against 223px of usable room above her head once the halo has
 * taken its 27.
 */
const FONT_PX = 14
const LINE_H = 20
/**
 * The cursor: 2px, three under the baseline.
 *
 * With `textBaseline = 'top'` the baseline sits about 0.79em below the top of
 * the line, so "3px under the baseline" lands at very close to `FONT_PX` from
 * the top. That constant is used rather than an ascent read off the context,
 * because `actualBoundingBoxAscent` is not populated by every canvas this runs
 * on, and a silently-undefined ascent would strike the line through the middle
 * of the word instead of under it.
 */
const UNDERLINE_W = 2
const UNDERLINE_TOP = FONT_PX
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
const BUTTON = 18
/** Between stacked buttons. Enough to separate two 24-grid glyphs, no more. */
const BUTTON_GAP = 5
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
/**
 * Room for the whole column, so a one-line bubble is not shorter than it.
 *
 * 72 — three 18s, two 5s and 4px of inset top and bottom. It is worth naming
 * what this number decides: one line of text needs 44, so this is the FLOOR on
 * the commonest bubble in the product, and the previous version left it out of
 * the design entirely.
 */
const CONTROLS_H = BUTTON * 3 + BUTTON_GAP * 2 + 8

/**
 * The biggest box a bubble can ever be, and why the MENU needs it.
 *
 * The tray's list of sides is a question about where her NEXT words can go, not
 * where the last ones went. Measured from the box she happened to say, a short
 * reply and a long one give different answers at the same spot — and until now
 * the list was computed only on a frame that actually drew a bubble, so it
 * froze at her last utterance and stopped tracking her when she moved.
 *
 * So the menu asks about the widest and tallest bubble that can exist. A side
 * offered on that basis can hold anything she goes on to say, which is what an
 * answer to "put her words on the left" has to mean.
 *
 * Derived from the same three numbers the drawing uses — `TEXT_W`, the padding
 * and the control column — rather than restated, because a second copy of this
 * arithmetic is a menu that offers a side the drawing then refuses.
 */
export const WIDEST_BUBBLE = { w: TEXT_W + PAD * 2 + CONTROLS_W, h: LINES * LINE_H + PAD * 2 }

/**
 * The gap the bubble keeps from her, tail included — and it differs above.
 *
 * `placeBubble` knew her body and nothing else, so `GAP` was measured from her
 * scalp and the tail landed INSIDE the halo. That is a collision in the shipped
 * build, not one this design introduces; the design is what noticed it.
 *
 * Above her, the tip clears the top of the ring and then keeps 8 more.
 * Everywhere else nothing is drawn over her and `GAP` stands.
 */
export const BUBBLE_REACH: Reach = {
  above: haloClearance() + 8 + TAIL,
  rest: GAP + TAIL,
}

/**
 * There is more, said by a fade rather than by a scrollbar.
 *
 * The rail that was here — a 3px track with a thumb — is furniture for reading
 * a passage to its end, and that is not what a bubble is for. It also implied
 * something draggable that never was.
 *
 * 24px of the surface's own colour over the last line says the same thing
 * honestly: there is more, and it is not here that you read it. The way to the
 * rest is the third control, which opens her record.
 */
const FADE_H = 24

/**
 * The same colour at zero alpha, for the top of the fade.
 *
 * NOT the keyword `transparent`, which is `rgba(0, 0, 0, 0)` — black at zero
 * alpha. A canvas that interpolates a gradient without premultiplying takes the
 * fade through grey on its way out, so a white bubble grows a dirty band across
 * its last line. Emitting the surface's own channels makes the ramp correct
 * whichever way the implementation interpolates.
 *
 * The colours arrive from `getComputedStyle`, so `rgb()` is what actually shows
 * up here; the hex branch is for a caller assembling one in code, and the
 * keyword is the honest last resort rather than a throw — a slightly wrong fade
 * is not worth taking her window down for.
 */
function transparent(colour: string): string {
  const text = colour.trim()
  const rgb = /^rgba?\(([^)]+)\)$/.exec(text)
  if (rgb !== null) {
    const parts = (rgb[1] ?? '').split(/[\s,/]+/).filter((one) => one !== '')
    const [r, g, b] = parts
    if (r !== undefined && g !== undefined && b !== undefined) return `rgba(${r}, ${g}, ${b}, 0)`
  }
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text)
  if (hex !== null) {
    const body = hex[1] ?? ''
    // Indexed rather than spread, for the reason `accent.ts` gives beside the
    // same expansion: the regex has already restricted this to ASCII hex, so
    // code-point iteration buys nothing, and spreading a string is the wrong
    // default habit to build.
    const twice = (at: number): string => body.charAt(at).repeat(2)
    const wide = body.length === 3 ? twice(0) + twice(1) + twice(2) : body
    const value = Number.parseInt(wide, 16)
    const channel = (shift: number): string => String((value >> shift) & 255)
    return `rgba(${channel(16)}, ${channel(8)}, ${channel(0)}, 0)`
  }
  return 'transparent'
}

/** The problem badge on the history control. A dot: a digit at this size is mush. */

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
  let offered: ReturnType<Bubble['offered']> = null
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
    draw(ctx, width, colours, text, at, her, room, prefer, hovered) {
      // A different utterance is a different thing to read, so the reader's
      // position goes back to following her. Without this, her next sentence
      // opens parked in the middle of the last one.
      if (text !== shownText) scrolledTo = null
      shownText = text
      if (text === '' || opacity <= 0 || text === hidden) {
        laidOut = null
        return false
      }

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
      const maxWidth = Math.min(TEXT_W, width - PAD * 4 - CONTROLS_W)

      ctx.save()
      // Outfit, the face the window is set in — the bubble is her words, and
      // her words are read in the same face wherever they are read.
      ctx.font = `${String(FONT_PX)}px Outfit, system-ui, sans-serif`
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
        maxWidth + PAD * 2 + CONTROLS_W,
        Math.max(
          CONTROLS_W + PAD * 2,
          Math.max(...shown.map((one) => ctx.measureText(one).width)) + PAD * 2 + CONTROLS_W,
        ),
      )
      // Tall enough for the text OR for the control column, whichever needs
      // more. Without the floor, "Yes." makes a box shorter than the three
      // stacked buttons and the last one hangs off the bottom edge.
      const boxHeight = Math.max(shown.length * LINE_H + PAD * 2, CONTROLS_H)

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
      const placed = placeBubble(her, { w: boxWidth, h: boxHeight }, room, BUBBLE_REACH, prefer)
      /*
        Where this bubble went, and what else THIS box could have done.

        No longer what the tray menu is built from. That question is about her
        next words and has to be answerable while she is silent, so it moved to
        `sidesForTheMenu` in `face.ts` — this froze at her last utterance,
        because `draw` returns early when there is nothing to say and never
        reached the assignment.
      */
      offered = {
        available: sidesThatFit(her, { w: boxWidth, h: boxHeight }, room, BUBBLE_REACH),
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
      /*
        FOUR CORNERS, ONE RADIUS. The two either side of the tail were drawn at
        10 against the other two at 22.

        The reason given was that at 22 the curve runs so far along the edge
        that the tail grows out of the curve and reads as stuck on, so 10 left
        it a flat shoulder to sit on. The geometry does not support that, and
        the clamp below is why: the tail's base spans `tip ± TAIL`, and `tip` is
        held at least `RADIUS + TAIL` from either corner, so the base begins
        exactly where the curve ends. That holds at 10 and it holds at 22 — the
        shoulder is the CLAMP's doing, and the radius never affected it.

        What the tightening did do was flatten both corners on the tail's edge
        whatever the tail was near. The tail tracks HER, so on a 400px box with
        her off to one side it sits nowhere near either one, and the bubble was
        visibly rounder along the top than along the bottom for no reason
        anybody could see. Somebody noticed unprompted, which is the test.

        The cost is 12px off each end of the tail's travel, and it only bites
        when she is at the very edge of the screen — where the tail is clamped
        and therefore already approximate.
      */
      ctx.roundRect(x, y, boxWidth, boxHeight, [RADIUS, RADIUS, RADIUS, RADIUS])
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
      /*
        `arcTo` for the tip, so the point is capped rather than sharp. A spike
        reads as stuck into her; the tail only has to point at her.
      */
      if (placed.side === 'above' || placed.side === 'below') {
        const tip = Math.max(x + RADIUS + TAIL, Math.min(x + boxWidth - RADIUS - TAIL, centreX))
        // The edge that FACES her, and the direction that reaches for her.
        const edge = placed.side === 'above' ? y + boxHeight - 1 : y + 1
        const reach = placed.side === 'above' ? TAIL : -TAIL
        ctx.moveTo(tip - TAIL, edge)
        ctx.arcTo(tip, edge + reach, tip + TAIL, edge, TAIL_TIP)
        ctx.lineTo(tip + TAIL, edge)
      } else {
        const tip = Math.max(y + RADIUS + TAIL, Math.min(y + boxHeight - RADIUS - TAIL, centreY))
        const edge = placed.side === 'left' ? x + boxWidth - 1 : x + 1
        const reach = placed.side === 'left' ? TAIL : -TAIL
        ctx.moveTo(edge, tip - TAIL)
        ctx.arcTo(edge + reach, tip, edge, tip + TAIL, TAIL_TIP)
        ctx.lineTo(edge, tip + TAIL)
      }
      ctx.closePath()
      /*
        FILLED TWICE, once per shadow layer.

        A canvas carries one shadow at a time and the boards specify two —
        `0 10px 30px` at 16% with `0 1px 3px` at 10% beneath it. Painting the
        same opaque path under each gives the pair; the order is far first so
        the tight one lands on top of it.

        Reset before the stroke, or the outline casts a shadow of its own and
        the edge doubles.
      */
      for (const layer of [
        { colour: colours.liftFar, blur: 30, drop: 10 },
        { colour: colours.liftNear, blur: 3, drop: 1 },
      ]) {
        ctx.shadowColor = layer.colour
        ctx.shadowBlur = layer.blur
        ctx.shadowOffsetY = layer.drop
        ctx.fill()
      }
      ctx.shadowColor = 'transparent'
      ctx.shadowBlur = 0
      ctx.shadowOffsetY = 0

      /*
        Its own edge, drawn over both fills so the seam between box and tail is
        not stroked twice.

        Rule 2 says the surface is opaque; this says it has a BOUNDARY. On a
        bright photograph a white bubble has neither an outline nor a usable
        shadow, and "anything carrying words gets its own opaque surface" is
        only half the promise if you cannot tell where the surface ends.
      */
      ctx.strokeStyle = colours.edge
      ctx.lineWidth = 1
      ctx.stroke()

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
      const column = x + boxWidth - PAD - BUTTON + 2
      const close = { x: column, y: y + 4, w: BUTTON, h: BUTTON }
      const copy = { x: column, y: close.y + BUTTON + BUTTON_GAP, w: BUTTON, h: BUTTON }
      const history = { x: column, y: copy.y + BUTTON + BUTTON_GAP, w: BUTTON, h: BUTTON }
      laidOut = { copy, close, history, box: { x, y, w: boxWidth, h: boxHeight } }

      let lineStart = offset
      // One alpha for the whole passage. What she has not said yet is a
      // COLOUR now, not a fraction of this one — see `BubbleColours.ahead`.
      ctx.globalAlpha = opacity
      shown.forEach((line, row) => {
        const top = y + PAD + row * LINE_H
        let left = x + PAD
        for (const run of runsFor(line, lineStart, spoken)) {
          const runWidth = ctx.measureText(run.text).width
          // Dimmed rather than hidden — the point of showing it at all.
          ctx.fillStyle = run.style === 'ahead' ? colours.ahead : colours.ink
          ctx.fillText(run.text, left, top)
          if (run.style === 'saying') {
            ctx.fillRect(left, top + UNDERLINE_TOP, runWidth, UNDERLINE_W)
          }
          left += runWidth
        }
        lineStart += line.length
      })
      /**
       * Controls, ALWAYS — and this reverses the hover-only rule that was here.
       *
       * The old argument was sound as far as it went: permanent chrome on
       * something meant to be glanced at is chrome you stop seeing. What it did
       * not weigh is that the room for these three is reserved on every frame
       * anyway, so hiding them bought no space at all — it only made three
       * controls undiscoverable to anybody who never happened to hover.
       *
       * v2 keeps them present and spends the visibility budget on WEIGHT
       * instead: a light grey glyph in a stroked circle at rest, ink in a filled
       * one under the pointer. Nothing moves and nothing reflows, which is the
       * property the reserved column existed to give.
       */
      const fresh = confirmedAt !== null && frames - confirmedAt < 90
      ctx.globalAlpha = opacity
      for (const [rect, icon] of [
        [close, CLOSE],
        [copy, fresh ? CHECK : COPY],
        [history, HISTORY],
      ] as const) {
        // Round, because round is what "you can press this" looks like in this
        // vocabulary. Stroked at rest, filled once the pointer is on the bubble.
        ctx.beginPath()
        ctx.arc(rect.x + rect.w / 2, rect.y + rect.h / 2, rect.w / 2, 0, Math.PI * 2)
        /*
          FILLED AT REST, deeper under the pointer — `静止时浅灰,悬停加深`.

          It was a stroked ring at rest and a filled disc on hover, so arriving
          with the pointer changed the SHAPE rather than its depth, and at 18px
          an outline on a white bubble is most of nothing. The boards fill all
          three with `#f4f4f5` before anything is hovered.
        */
        ctx.fillStyle = hovered ? colours.chipOn : colours.chip
        ctx.fill()
        // Inset, so Lucide's 24-grid artwork has the margin it is drawn for.
        strokeIcon(
          ctx,
          icon,
          { x: rect.x + 3, y: rect.y + 3, size: rect.w - 6 },
          hovered ? colours.ink : colours.ahead,
        )
      }

      /*
        THE UNREAD-PROBLEMS DOT STOOD HERE, on the history icon.

        It marked "main could not do something" — a rejected persona file, a
        face that would not load — so somebody who edited a file and saw nothing
        change had a thread to pull. Removed on request, and it costs nothing
        the app cannot say elsewhere: `face.troubled()` still carries the count
        to her shoulder chip, and the shell's troubles drawer is where the
        problems are actually readable. This surface only ever said "there is
        something", never what.

        Her bubble is what she is SAYING. A badge on it is the application
        talking about itself over the top of her, which is a different voice in
        the same box.
      */

      /**
       * There is more, and this is not where you read it.
       *
       * Four attempts now, and the first three are worth keeping because each
       * failed differently. A `⋯` at half alpha beside a rounded corner **read
       * as a second bubble peeking out from behind this one** and was reported
       * as exactly that. A fade at both edges sat inside the padding and said
       * nothing. A rail said the most — how much more, and whereabouts — and it
       * was the wrong thing to say: a scrollbar is furniture for reading a
       * passage to its end, it implied a thumb somebody could drag, and dragging
       * it never did anything.
       *
       * A bubble is glanced at. The honest signal is "there is more", full
       * stop — and the way to the rest is the third control, which opens her
       * record. So: 24px of the surface's own colour over the last line.
       *
       * Drawn INSIDE the padding's lower edge rather than over it, so the fade
       * covers text rather than blank paper.
       */
      if (lines.length > LINES) {
        const foot = y + boxHeight - PAD
        const fade = ctx.createLinearGradient(0, foot - FADE_H, 0, foot)
        fade.addColorStop(0, transparent(colours.paper))
        fade.addColorStop(1, colours.paper)
        ctx.globalAlpha = opacity
        ctx.fillStyle = fade
        ctx.fillRect(x + PAD, foot - FADE_H, boxWidth - PAD * 2 - CONTROLS_W, FADE_H)
      }

      ctx.restore()
      return true
    },
  }
}
