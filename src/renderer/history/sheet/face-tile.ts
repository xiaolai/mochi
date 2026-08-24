/**
 * What every section of her sheet is built from: a heading, and a row of
 * choices where exactly one is current.
 *
 * Below the sections rather than beside them. `shelf.ts` holds the ORDER the
 * sections appear in and imports each one; each one needs this vocabulary, so
 * leaving it in `shelf.ts` would have made every section import the file that
 * imports it.
 */
import { MochiAvatar } from '../../companion/rig/mochi'
import { element } from '../../element'
import { drawCentred } from '../centre'
import { type Emotion } from '@shared/avatar'
import { type FaceSpec } from '@shared/avatar-spec'
import { type ByPronoun } from '@shared/pronoun'
/**
 * Her face, drawn by the rig that draws her on the desktop.
 *
 * The artifact anchors every row and every swatch with a small coloured mochi;
 * this build shipped four lines of text where that face should be, on the one
 * screen whose whole job is telling characters apart. A picture of her is also
 * the only thing here that a persona's THEME changes, so without it two
 * characters with different colours looked identical.
 *
 * The rig rather than a stored thumbnail, for the reason `shipped-icons.test.ts`
 * had to be written: a second drawing of her is a second thing to keep in step.
 *
 * STILL, not a loop — a grid of blinking faces is motion competing with the one
 * thing on screen that is actually alive. An emotion is settled by stepping the
 * clock rather than by one frame at zero: the expression itself lands
 * immediately, but the body squash it asks for runs through a spring, so a
 * single frame draws `surprised` at its resting size.
 */
export function faceTile(
  face: FaceSpec | undefined,
  px: number,
  emotion?: Emotion,
): HTMLCanvasElement {
  const canvas = element('canvas', 'tile')
  /*
    A missing face is REFUSED, not quietly replaced.

    `MochiAvatar` falls back to the built-in when `face` is undefined, which is
    right for the companion — she must be drawn — and wrong here: every row
    then shows the same green mochi and the shelf silently stops doing the one
    job it has. That is exactly what a stale main process looked like, and it
    looked like a design decision. Empty is honest; the caller reports it.
  */
  if (face === undefined) return canvas
  const ratio = Math.min(window.devicePixelRatio || 1, 3)
  canvas.width = Math.round(px * ratio)
  canvas.height = Math.round(px * ratio)
  canvas.style.width = `${String(px)}px`
  canvas.style.height = `${String(px)}px`
  /*
    Drawn OFFSCREEN, then blitted into place centred on her own pixels.

    `fitToCanvas` scales her so the worst-case pose fits and stands her one
    breathing unit off the bottom, which leaves the unused headroom above her:
    measured at 16.5px above and 2.0px below in a 40px swatch. Right on her own
    window, where she stands on a floor and breathes into the room above it, and
    wrong in a tile that has neither. See `centre.ts` for why this is measured
    rather than computed and why the canvas itself cannot simply be moved.
  */
  drawCentred(canvas, (offCtx) => {
    const avatar = new MochiAvatar(offCtx, { face, size: 'fit-canvas', random: () => 0.5 })
    avatar.resize(px, px, ratio)
    avatar.setIdle(false)
    if (emotion === undefined) {
      // ONE frame. There is nothing to settle: the squash spring starts at rest
      // and only an expression moves it, so seventeen renders of a neutral tile
      // was seventeen times the cost of the same picture — multiplied by every
      // character in a list of unbounded length.
      avatar.render(0)
      return
    }
    avatar.setEmotion({ emotion, intensity: 1 })
    // A quarter of a second of clock, at sixty a second. Long enough for the
    // squash spring to arrive at rest with `stiffness`/`damping` as shipped.
    for (let at = 0; at <= 256; at += 16) avatar.render(at)
  })
  return canvas
}

/**
 * Which one she IS, as a check rather than as the word.
 *
 * The row already carries her name, her pronoun and her voice; a fourth caps
 * word in a pill was the loudest thing on it and said the least. A tick is read
 * without being read.
 *
 * It keeps the WORD for anybody not looking at it. `role="img"` plus an
 * `aria-label` is what makes a graphic announce as "worn" — dropping to a bare
 * icon otherwise deletes the fact from a screen reader entirely, which is a
 * regression that no screenshot shows.
 *
 * The span exists so the class is on an element `element()` made. `stylesheets.
 * test.ts` finds classes by reading `element('span', 'x')` out of the source,
 * and an SVG's class is set through `setAttribute` — invisible to that check,
 * which is how a rule quietly stops governing anything here.
 */
export function wornMark(): HTMLElement {
  const NS = 'http://www.w3.org/2000/svg'
  const mark = element('span', 'wearing')
  mark.setAttribute('role', 'img')
  mark.setAttribute('aria-label', 'worn')

  const svg = document.createElementNS(NS, 'svg')
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('width', '15')
  svg.setAttribute('height', '15')
  // The graphic is announced by the span above it, so the shape itself is
  // hidden rather than announced twice.
  svg.setAttribute('aria-hidden', 'true')

  const tick = document.createElementNS(NS, 'path')
  tick.setAttribute('d', 'M3.5 8.6 6.4 11.5 12.5 4.8')
  tick.setAttribute('fill', 'none')
  // `currentColor`, so the mark takes her colour from the rule rather than
  // carrying a second copy of it in the markup.
  tick.setAttribute('stroke', 'currentColor')
  tick.setAttribute('stroke-width', '2')
  tick.setAttribute('stroke-linecap', 'round')
  tick.setAttribute('stroke-linejoin', 'round')

  svg.append(tick)
  mark.append(svg)
  return mark
}

/** SHE / HER, HE / HIM, IT / ITS — the caps line under her name. */
export const PRONOUN_CAPS: ByPronoun = { she: 'she / her', he: 'he / him', it: 'it / its' }
