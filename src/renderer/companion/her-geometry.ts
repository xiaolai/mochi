/**
 * How much room she needs, and where inside it she stands.
 *
 * ## Why these are not in `face.ts`
 *
 * They were, inside the `showFace` closure -- and that closure resolves a
 * palette off `document` at load, so nothing in here could be reached by a
 * test. These are where the expensive mistakes have been: the horizontal
 * symmetry rule below was wrong by 12px once and took three other rectangles
 * with it, because everything in that file believed what it said.
 *
 * Each takes what it reads and nothing more. `padFor` is a function of the
 * worn face, whether words are showing, and how opaque the bubble is. `boxFor`
 * adds the pad, where her feet are, and whether the window is the roomy one.
 * `face.ts` keeps a one-line adapter for each, so its fourteen call sites stay
 * as short as they were.
 */
import { chipRect } from './chip'
import { haloReach, haloRect } from './halo'
import { builtInReach } from './rig/motion'
import { type Pad, STATUS_ROOM, STATUS_UNDER, fullPad, layoutFor } from '@shared/avatar-layout'
import { type FaceSpec } from '@shared/avatar-spec'
/**
 * Where she actually is on the canvas, from the module that decides it.
 *
 * She is horizontally centred and rests one clearance above the bottom, so
 * her corner follows from the layout rather than from a guess. Recomputed on
 * resize rather than cached at construction, because `fit()` changes the
 * canvas and a stale corner would leave the chip behind.
 */
/**
 * Her whole body in the canvas, which is what the bubble is placed AROUND.
 *
 * This used to be `herHead` — her centre and the top of her head — which is
 * everything a bubble above her needs and not enough for one anywhere else.
 */
/**
 * Her BODY out of a layout, named because the layout also has `width` and
 * `height` and they are the WINDOW's.
 *
 * `fullPad(layout)` typechecks — the shapes are structurally identical — and
 * silently passes 980x560 as her body, which yields a negative `top` that
 * main's validator then refuses, so the window never resizes and nothing says
 * why. Two pairs of numbers with the same names and different meanings is the
 * kind of thing a type cannot catch, so it gets a function instead.
 */
export function bodyOf(layout: { bodyWidth: number; bodyHeight: number }): {
  width: number
  height: number
} {
  return { width: layout.bodyWidth, height: layout.bodyHeight }
}

export function boxFor(
  worn: FaceSpec,
  pad: Pad,
  feet: number,
  roomy: boolean,
): { left: number; top: number; width: number; height: number } {
  const layout = layoutFor(worn, worn.size)
  /*
    Where the PAD puts her, not where a fixed window used to.

    This was `centred, feetY(canvasHeight, ...)`, which is the right answer for
    a window sized once for the worst case and the wrong one for a window that
    fits what is drawn: her offset inside her own window is exactly the room
    reserved on her left and above her, because that is what the pad means.

    `feet` still has the last word when the drag pushes her against the top of
    the display — that is `standingRoom`, and it is about the screen rather
    than about this window, so it survives.
  */
  /*
    `feet` has the last word only while the window is the BIG one.

    `standingRoom` exists because macOS will not put a window's top edge above
    the work area, so a 560-tall window could not carry her close to the menu
    bar and she had to stand higher inside it instead. A window that fits her
    is ~140 tall and can be placed anywhere she needs to be, so the stance has
    nothing to correct for — and honouring it here would jump her by hundreds
    of pixels inside a window with no room to hold her.
  */
  const top = roomy ? Math.max(0, feet - layout.bodyHeight) : pad.top
  return {
    left: pad.left,
    top,
    width: layout.bodyWidth,
    height: layout.bodyHeight,
  }
}

/**
 * The room everything drawn AROUND her needs, on each side of her body.
 *
 * Measured from the rectangles that will actually be drawn rather than from a
 * table of constants, which is the difference between "the window fits what is
 * drawn" and "the window fits what somebody once wrote down". While a bubble
 * is up it is `fullPad`, because the bubble's rectangle is computed inside
 * `bubble.ts` at draw time and reaching for it here would put that geometry in
 * two places.
 */
export function padFor(worn: FaceSpec, showingWords: boolean, bubbleOpacity: number): Pad {
  const layout = layoutFor(worn, worn.size)
  const body = bodyOf(layout)
  // While it FADES, not merely while it has text: shrinking on the frame the
  // text is cleared would clip the last 0.35s of the bubble going away.
  if (showingWords && bubbleOpacity > 0) return fullPad(body)

  // Her box as it would be with no padding, so the rects below place
  // themselves relative to her rather than to whatever window she is in now.
  const her = { left: 0, top: 0, width: body.width, height: body.height }
  /*
    The chip, and the halo's bounding box.

    The halo is narrower than she is, so it never widens her window — but it
    sits ABOVE her head, and the room for that is reserved here rather than
    assumed to fit inside what the chip already needs. It is close: the chip
    wants 26px above her and the halo wants about 27.
  */
  const ring = haloRect(her)
  /*
    Room for her to MOVE, reserved whether or not she is moving.

    `lift` and `shift` translate her inside this window, and a window fitted
    to her standing still clips her the moment she uses either — she walks
    into the edge of a transparent rectangle and is cut in half by it.

    Reserved as a CONSTANT, from the worst case across every built-in clip,
    rather than tracked per motion. Growing the window when a clip starts and
    shrinking it when it ends means resizing a window during an animation,
    sixty times a second, against a shrink that is deliberately delayed —
    three moving parts to save about forty transparent pixels. The pixels are
    free; the state machine is not.

    `up` only for the vertical half. She hops rather than sinking, and
    reserving room below would push her down inside her own window to hold a
    clearance nothing ever uses.
  */
  const reach = builtInReach()
  const travel = {
    x: -reach.x * body.width,
    y: -reach.up * body.height,
    w: body.width * (1 + reach.x * 2),
    h: body.height * (1 + reach.up),
  }
  const around = [
    chipRect(her),
    {
      x: ring.x - ring.rx,
      y: ring.y - haloReach(),
      w: ring.rx * 2,
      h: haloReach() * 2,
    },
    travel,
  ]
  const pad = {
    left: Math.max(0, ...around.map((one) => -one.x)),
    top: Math.max(0, ...around.map((one) => -one.y)),
    right: Math.max(0, ...around.map((one) => one.x + one.w - her.width)),
    bottom: Math.max(0, ...around.map((one) => one.y + one.h - her.height)),
  }
  // The status line is DOM and main places it; one constant, read by both, so
  // it cannot be positioned outside the window that was sized for it.
  /*
    SYMMETRIC horizontally, and that is not tidiness — it is what makes the pad
    true.

    `MochiAvatar` centres her in the canvas; it is not told a left offset. So
    `herBox()` saying she is at `pad.left` is only correct when the padding is
    equal on both sides. It was not — the chip needs 26px on her right and
    nothing on her left — and she was painted 12px right of where every other
    thing in this file believed she was. The chip, the bubble's placement and
    the click-through rectangle were all measured against a box she was not in.
    Measured: painted left 12.0, `herBox()` left 0.

    The cost is 26px of transparent pixels on her left. The alternative is
    teaching the rig a horizontal offset, which is a second place her position
    is decided.
  */
  const side = Math.max(pad.left, pad.right)
  return {
    ...pad,
    left: side,
    right: side,
    bottom: Math.max(pad.bottom, body.height * STATUS_UNDER + STATUS_ROOM),
  }
}
