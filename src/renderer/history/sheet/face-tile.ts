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
  if (face === undefined) {
    /*
      SIZED, and nothing drawn into it.

      A `<canvas>` with no width or height has an intrinsic 300×150, so a bare
      one here is eleven times wider than the tile beside it. That never showed
      while the cast column carried a `.faceless .tile { width: 44px }` rule
      that happened to compensate; the moment that column was replaced, one
      character's row pushed the rail 115px wider than the rail itself.

      The earlier rule here was that a sized-but-blank canvas "reads as a
      picture that failed to load rather than as a missing face". That was true
      of a blank square and it is not true of what the design draws now: the
      delivered treatment is a DASHED, hatched box, which reads as a marked
      absence rather than as a failure — see `.faceless .tile`. So the size is
      the element's own, and the stylesheet says what the absence looks like.

      Attributes rather than `style`, because that is what makes the intrinsic
      size go away — and because the size is then a fact about the element that
      survives whatever sheet is in force.
    */
    canvas.width = px
    canvas.height = px
    return canvas
  }
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

/*
  `wornMark` stood here: a tick with `role="img"` and `aria-label="worn"`, drawn
  in the corner of a character card.

  The rail says "worn now" in words under her name instead, which is the
  delivered design's own answer and a better one — the rule that a mark's
  meaning must also exist as words is satisfied most simply by not needing a
  mark. It went with the cards; nothing calls it, and a tested function nobody
  calls is the shape this repository has been bitten by before.
*/

/** SHE / HER, HE / HIM, IT / ITS — the caps line under her name. */
export const PRONOUN_CAPS: ByPronoun = { she: 'she / her', he: 'he / him', it: 'it / its' }
