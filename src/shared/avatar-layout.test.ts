import { describe, expect, it } from 'vitest'
import { MOCHI, type FaceSpec } from './avatar-spec'
import {
  BASE_UNIT_SCALE,
  BREATHING_UNITS,
  FEET_FROM_TOP,
  LEAN_LIMIT,
  SIZE_PERCENT,
  SQUASH_LIMIT,
  STATUS_ROOM,
  STATUS_UNDER,
  WINDOW_H,
  WINDOW_W,
  clampSizePercent,
  fitToCanvas,
  fullPad,
  herPositionFrom,
  layoutFor,
  originHolding,
  windowFitting,
  worstCaseUnits,
} from './avatar-layout'
import { LOOKS } from '../renderer/companion/rig/looks'
import { ASLEEP_BREATH_GAIN } from '../renderer/companion/rig/mochi'

/**
 * Which side is allowed to say where she is, and when.
 *
 * ## The bug, with its numbers
 *
 * Dropped at 2400,1325 and stored correctly. Restored correctly: `fullPad` gives
 * 443,267, so `originHolding` puts the window at 1957,1058 and her body lands
 * back at 2400,1325. Then the first `companion:fit` moved her to 443,267 — which
 * is `fullPad`'s own offsets from an origin of ZERO.
 *
 * `setPosition` works on a window that has not been shown; `window.screenX` does
 * not. Chromium answers `0` because the widget has no screen position yet, and
 * it is not lying — it has nothing to report. Main believed it, and the position
 * was not lost so much as overwritten a second later by a window describing
 * somewhere it had never been.
 *
 * ## Why the condition is `visible` and not a tolerance
 *
 * "Is this reading plausible" needs a threshold, and any threshold is wrong at
 * some window size or during a drag, where the renderer legitimately lags main
 * by a frame. Whether the window has been shown is not a matter of degree, and
 * main is the thing that shows it.
 */
describe('where her body is, when two answers exist', () => {
  const BOUNDS = { x: 1957, y: 1058 }
  const BODY = { left: 443, top: 267 }

  it('is the window’s own origin plus the offset it was sent', () => {
    // Each side gives the half it holds. Main reads `getBounds()` in the handler
    // that receives the offset, so there is no pair of facts from two moments.
    expect(herPositionFrom(BOUNDS, BODY)).toEqual({ x: 2400, y: 1325 })
  })

  it('does not depend on anything the renderer had to infer', () => {
    /*
      The regression this replaces. The renderer used to send her SCREEN
      position, `window.screenX + offset` — and `screenX` is a cached rect
      Chromium does not reliably refresh for a frameless transparent window
      moved by `setPosition`. It answered 0 for a window at 1957,1058, shown and
      on screen, so main planted her at the pad's own offsets from an origin
      nobody had ever seen.

      Nothing in this signature can carry that mistake: there is no screen
      coordinate coming from the renderer to be wrong.
    */
    const asIfScreenXWereZero = herPositionFrom({ x: 0, y: 0 }, BODY)
    expect(asIfScreenXWereZero).toEqual({ x: 443, y: 267 })
    // And with the real origin, the same offset gives the real answer — which is
    // the point: the offset was never the broken half.
    expect(herPositionFrom(BOUNDS, BODY)).toEqual({ x: 2400, y: 1325 })
  })

  it('round-trips: restore, then the first fit, leaves her where she was left', () => {
    /*
      The whole failure in four lines, which is the only way to see it — every
      step is right on its own and the fault is in what they agree to believe.
    */
    const left = { x: 2400, y: 1325 }
    const pad = fullPad({ width: 94, height: 73 })
    const origin = originHolding(left, pad)
    expect(origin).toEqual({ x: 1957, y: 1058 })

    // The first fit: the renderer sends the offset it is drawing, main pairs it
    // with the origin it just set. No screen coordinate crosses at all.
    const her = herPositionFrom(origin, pad)
    expect(her).toEqual(left)

    // And the fit that follows holds her there rather than moving her.
    const small = { left: 26, top: 26, right: 26, bottom: 26 }
    const after = originHolding(her, small)
    expect({ x: after.x + small.left, y: after.y + small.top }).toEqual(left)
  })
})

describe('layoutFor', () => {
  it('makes her body the fixed thing and the window the derived one', () => {
    // The whole point of the inversion. Her size must be exactly the design
    // units times the scale, with nothing else able to influence it.
    const layout = layoutFor(MOCHI, 100)
    expect(layout.scale).toBeCloseTo(BASE_UNIT_SCALE, 10)
    expect(layout.bodyWidth).toBeCloseTo(MOCHI.bodyW * BASE_UNIT_SCALE, 10)
    expect(layout.bodyHeight).toBeCloseTo(MOCHI.bodyH * BASE_UNIT_SCALE, 10)
  })

  it('scales linearly with the percentage', () => {
    const half = layoutFor(MOCHI, 50)
    const full = layoutFor(MOCHI, 100)
    const double = layoutFor(MOCHI, 200)
    expect(half.bodyWidth * 2).toBeCloseTo(full.bodyWidth, 6)
    expect(double.bodyWidth).toBeCloseTo(full.bodyWidth * 2, 6)
  })

  it('leaves room for the most deformed frame that can be drawn', () => {
    // The window exists to contain her worst case, not her resting pose. This
    // is the arithmetic behind the crop that shipped: sleepy posture at the top
    // of a breath ran past a window sized for the resting body.
    for (const percent of [SIZE_PERCENT.min, 100, SIZE_PERCENT.max]) {
      const layout = layoutFor(MOCHI, percent)
      const worst = worstCaseUnits(MOCHI)
      expect(worst.width * layout.scale, `${percent}% width`).toBeLessThanOrEqual(layout.width)
      // Everything above the ground line has to hold her tallest frame.
      const aboveGround = layout.height * layout.ground
      expect(worst.height * layout.scale, `${percent}% height`).toBeLessThanOrEqual(aboveGround)
    }
  })

  it('keeps the clearance proportional, not fixed in pixels', () => {
    // In her own units so the gap around her looks the same at every size. A
    // pixel margin would swallow her at 50% and look lost at 200%.
    const small = layoutFor(MOCHI, 50)
    const large = layoutFor(MOCHI, 200)
    const gap = (l: ReturnType<typeof layoutFor>): number => (l.width - l.bodyWidth) / l.bodyWidth
    expect(gap(small)).toBeCloseTo(gap(large), 2)
  })

  it('rests her base one clearance above the bottom edge', () => {
    const layout = layoutFor(MOCHI, 100)
    const fromBottom = layout.height * (1 - layout.ground)
    expect(fromBottom).toBeCloseTo(BREATHING_UNITS * layout.scale, 6)
  })

  it('gives whole pixels, because a window cannot be 293.7 wide', () => {
    for (const percent of [50, 73, 100, 137, 200]) {
      const layout = layoutFor(MOCHI, percent)
      expect(Number.isInteger(layout.width), `${percent}% width`).toBe(true)
      expect(Number.isInteger(layout.height), `${percent}% height`).toBe(true)
    }
  })

  it('follows a face with different proportions', () => {
    // Every avatar declares its own body, so the window must come from THAT
    // face rather than from the built-in's numbers.
    const tall: FaceSpec = { ...MOCHI, bodyW: 60, bodyH: 140 }
    const layout = layoutFor(tall, 100)
    expect(layout.height).toBeGreaterThan(layout.width)
    expect(layout.bodyWidth / layout.bodyHeight).toBeCloseTo(60 / 140, 6)
  })
})

describe('clampSizePercent', () => {
  it('clamps rather than rejects', () => {
    expect(clampSizePercent(10)).toBe(SIZE_PERCENT.min)
    expect(clampSizePercent(9000)).toBe(SIZE_PERCENT.max)
    expect(clampSizePercent(100)).toBe(100)
  })

  it('falls back on anything that is not a usable number', () => {
    // This value arrives from a hand-editable JSON file and from an IPC
    // payload, so it is a boundary, not an internal.
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, null, undefined, '120', {}]) {
      expect(clampSizePercent(bad), JSON.stringify(bad)).toBe(SIZE_PERCENT.fallback)
    }
  })
})

describe('the deformation limits the window is sized against', () => {
  it('no look leans further than the window allows for', () => {
    // `LEAN_LIMIT` is a promise the window sizing relies on. Nothing stops a
    // future look exceeding it except this test, and the symptom would be her
    // apex clipped on one side in one expression.
    for (const [emotion, look] of Object.entries(LOOKS)) {
      expect(Math.abs(look.lean), emotion).toBeLessThanOrEqual(LEAN_LIMIT)
    }
  })

  it('no look squashes further than the window allows for', () => {
    // The rig clamps the SPRING to this, so a look beyond it would simply be
    // truncated rather than clipped — but a table that asks for something the
    // renderer refuses to draw is a table lying about what it does.
    for (const [emotion, look] of Object.entries(LOOKS)) {
      expect(Math.abs(look.squash), emotion).toBeLessThanOrEqual(SQUASH_LIMIT)
    }
  })

  it('no look plus a full breath does either', () => {
    /*
      The check above reads the table one look at a time, and the rig does not:
      `mochi.ts` SUMS the look, the breath, any clip and any poke into one
      squash target. So a look inside the limit on its own can still be outside
      it while she is breathing, and nothing here noticed.

      That is not hypothetical. `looks.ts` records `sleepy` being cut from 0.19
      because "at 0.19 plus a breath she spread to 1.24 times her width" — found
      by looking at her, because no test was watching this sum. This is the test
      that was missing.

      The breath is one-sided and positive, so it can only worsen a look that
      already spreads her; against a negative look it pulls back toward rest,
      which is why the two directions are checked differently rather than with
      an absolute value.

      Scoped to the built-in face's `breathAmp`. A downloaded avatar picks its
      own within `FACE_BOUNDS`, and the render-time clamp is what holds there —
      a data file cannot be constrained by a test in this repository.
    */
    for (const [emotion, look] of Object.entries(LOOKS)) {
      /*
        `sleepy` is measured against the DEEPER breath, because that is the only
        amplitude it is ever drawn with. Sleep doubles the breath — the eyes are
        shut and the drift is at a fifth, so at the waking amplitude she moved
        2px and read as switched off — and a check that quietly used the waking
        number for the one look that never sees it would be reporting on a frame
        the rig cannot draw.
      */
      const amp = emotion === 'sleepy' ? MOCHI.breathAmp * ASLEEP_BREATH_GAIN : MOCHI.breathAmp
      expect(look.squash + amp, `${emotion} + inhale`).toBeLessThanOrEqual(SQUASH_LIMIT)
      expect(-look.squash, `${emotion} stretched`).toBeLessThanOrEqual(SQUASH_LIMIT)
    }
  })
})

describe('fitToCanvas', () => {
  it('finds a scale whose WORST case fits, not whose resting pose fits', () => {
    const scale = fitToCanvas(MOCHI, 400, 300)
    const worst = worstCaseUnits(MOCHI)
    expect((worst.width + BREATHING_UNITS * 2) * scale).toBeLessThanOrEqual(400 + 1e-9)
    expect((worst.height + BREATHING_UNITS * 2) * scale).toBeLessThanOrEqual(300 + 1e-9)
  })

  it('is bound by whichever axis is tighter', () => {
    expect(fitToCanvas(MOCHI, 100, 10_000)).toBeLessThan(fitToCanvas(MOCHI, 10_000, 10_000))
    expect(fitToCanvas(MOCHI, 10_000, 100)).toBeLessThan(fitToCanvas(MOCHI, 10_000, 10_000))
  })
})

describe('fitToCanvas on a canvas that is not a canvas yet', () => {
  it('refuses a zero, negative or non-finite size instead of scaling by it', () => {
    // Every one of these produced an answer that flowed downstream in a shape
    // nothing tested for: zero gave scale 0 and a `0 / 0` ground, so she was
    // positioned at NaN and vanished silently; a negative width gave a negative
    // scale, which mirrors her. A zero-sized canvas is ordinary -- an element
    // that is display:none, or measured a frame before layout, reports exactly
    // that.
    for (const [w, h] of [
      [0, 200],
      [200, 0],
      [-200, 200],
      [200, -200],
      [Number.NaN, 200],
      [200, Number.POSITIVE_INFINITY],
    ] as const) {
      expect(fitToCanvas(MOCHI, w, h), `${w}x${h}`).toBe(0)
    }
  })

  it('still fits a real canvas', () => {
    expect(fitToCanvas(MOCHI, 240, 220)).toBeGreaterThan(0)
  })
})

describe('a window that fits what is drawn', () => {
  const BODY = { width: 94, height: 73 }

  it('is her body plus the padding, and nothing more', () => {
    const pad = { left: 26, top: 32, right: 26, bottom: 40 }
    expect(windowFitting(BODY, pad)).toEqual({ width: 146, height: 145 })
  })

  it('never collapses to nothing, whatever it is handed', () => {
    // A zero-size window is not a smaller window, it is an invisible one — and
    // she would be gone with no error anywhere.
    const nothing = { left: 0, top: 0, right: 0, bottom: 0 }
    const window = windowFitting({ width: 0, height: 0 }, nothing)
    expect(window.width).toBeGreaterThan(0)
    expect(window.height).toBeGreaterThan(0)
  })

  it('holds her on the screen when the window changes size', () => {
    // The property the whole thing rests on: resize her window and she does not
    // move. A window grows from its origin, so without this she slides across
    // the desktop every time she starts speaking.
    const her = { x: 2000, y: 1200 }
    for (const pad of [
      { left: 26, top: 32, right: 26, bottom: 40 },
      { left: 443, top: 267, right: 443, bottom: 220 },
      { left: 0, top: 0, right: 0, bottom: 0 },
    ]) {
      const origin = originHolding(her, pad)
      expect(origin.x + pad.left).toBe(her.x)
      expect(origin.y + pad.top).toBe(her.y)
    }
  })

  it('reproduces the old fixed window exactly, for the bubble case', () => {
    // `fullPad` is the escape hatch while a bubble is up, and it has to be the
    // SAME window the build shipped or the bubble gains a new way to be clipped.
    const pad = fullPad(BODY)
    expect(windowFitting(BODY, pad)).toEqual({ width: WINDOW_W, height: WINDOW_H })
    // And she stands exactly where she always did inside it.
    expect(pad.top + BODY.height).toBe(FEET_FROM_TOP)
    expect(pad.left).toBe(Math.round(WINDOW_W / 2 - BODY.width / 2))
  })

  it('leaves room for the status line it also positions', () => {
    // One source for both, so the line cannot be placed outside the window that
    // was sized for it.
    const tallest = { width: 188, height: 147 }
    const needed = tallest.height * STATUS_UNDER + STATUS_ROOM
    expect(fullPad(tallest).bottom).toBeGreaterThan(needed)
  })
})
