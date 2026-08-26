/**
 * Where she is inside her own window, and what follows from it.
 *
 * ## Why this is a module and the rest of `index.ts` is not
 *
 * The grill report measured it: handler-splitting the composition root does
 * not pay, because 9 of 19 bindings span essentially the whole file and moving
 * them only relocates the state. These three are the opposite — `herFeet` has
 * a reference span of **one line** — so they leave without dragging anything
 * behind them.
 *
 * What comes with them is worth more than the lines. Three decisions were
 * embedded in a `listenTo` body and therefore unreachable by any test:
 *
 *   - **Did a fit move her?** Resizing her window is only acceptable because
 *     she stays put. A version that silently moved her shipped, and the
 *     symptom — she is not near the corner any more — reads as a layout
 *     opinion rather than as a defect.
 *   - **Is this size worth a line?** The renderer asks on any frame the answer
 *     changes, so logging per request buries everything else.
 *   - **Where are her feet?** Derived from her body rather than from a
 *     constant, which is what makes it right in both the big window and the
 *     small one without a branch.
 *
 * ## What it deliberately does not do
 *
 * It never touches a `BrowserWindow`. `setBounds` stays in `index.ts`, because
 * moving her is the composition root's business and a module that both decides
 * and acts is one a test has to mock a window to reach.
 */

export interface Rect {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

export interface Size {
  readonly width: number
  readonly height: number
}

export interface Point {
  readonly x: number
  readonly y: number
}

/** What a fit did, so the caller can log it and say if it went wrong. */
export interface Fitted {
  /**
   * How far the fit moved her, in pixels.
   *
   * Zero is the contract. Anything above `DRIFT_PX` is a defect and the caller
   * says so out loud — one subtraction, once per fit, naming the thing that
   * went wrong rather than leaving it to look like a layout choice.
   */
  readonly movedBy: number
  /** True when this is a size that has not been reported before. */
  readonly isNewSize: boolean
}

/**
 * Sub-pixel drift is rounding, not movement.
 *
 * Bounds are integers and her body is not, so a fit that lands half a pixel
 * out is arithmetic rather than a bug. One pixel is the smallest threshold
 * that does not cry wolf on every fit.
 */
export const DRIFT_PX = 1

export interface HerPlace {
  /** Where she is inside her window. */
  body(): Rect
  /** How far into her window she is standing. */
  feet(): number
  /**
   * The renderer reported a new body without a fit.
   *
   * `companion:body` and `companion:fit` are separate channels: the first
   * arrives whenever her drawn size changes, the second only when the WINDOW
   * has to change with it. Both update where she is, and a body recorded by
   * only one of them leaves the drag clamp measuring a shape she no longer has.
   */
  reportedBody(body: Rect): void
  /**
   * She was dragged to a new stance.
   *
   * Returns whether it CHANGED, because the caller sends a frame on the change
   * and sending one per drag event would be a message per mouse move.
   */
  standAt(feet: number): boolean
  /**
   * Record a fit, and say what it did.
   *
   * `herOnScreen` is where she was before; `origin` and `size` are what the
   * window is becoming.
   */
  fitTo(input: {
    readonly body: Rect
    readonly origin: Point
    readonly size: Size
    readonly herOnScreen: Point
  }): Fitted
  /**
   * Where she is on the desktop, for remembering across launches.
   *
   * Her BODY's position, not the window's: the window is padding around her
   * and its corner moves whenever the padding changes, so storing that would
   * put her somewhere else on the next launch with the bubble in a different
   * state.
   */
  placeFrom(windowAt: Point): Rect
}

export function createHerPlace(input: {
  /** The body the window was first placed against, and the fallback. */
  readonly nominalBody: Rect
  /** Her stance in the window as shipped. */
  readonly feetFromTop: number
}): HerPlace {
  let body: Rect = input.nominalBody
  let feet: number = input.feetFromTop
  /** The last size reported, so a line is one per change rather than per frame. */
  let lastSize: Size = { width: 0, height: 0 }

  return {
    body: () => body,
    feet: () => feet,

    reportedBody(next) {
      body = next
    },

    standAt(next) {
      if (next === feet) return false
      feet = next
      return true
    },

    fitTo({ body: next, origin, size, herOnScreen }) {
      body = next
      /*
        A fit must never MOVE her, and this measures it rather than trusting it.

        `origin + body.left/top` is where she lands; `herOnScreen` is where she
        was. The two are equal by construction — `originHolding` is derived to
        make them so — which is exactly why an error here is silent without a
        check.
      */
      const landed = { x: origin.x + next.left, y: origin.y + next.top }
      const movedBy = Math.max(
        Math.abs(landed.x - herOnScreen.x),
        Math.abs(landed.y - herOnScreen.y),
      )
      const isNewSize = size.width !== lastSize.width || size.height !== lastSize.height
      if (isNewSize) lastSize = size
      return { movedBy, isNewSize }
    },

    placeFrom(windowAt) {
      return {
        left: Math.round(windowAt.x + body.left),
        top: Math.round(windowAt.y + body.top),
        width: Math.round(body.width),
        height: Math.round(body.height),
      }
    },
  }
}
