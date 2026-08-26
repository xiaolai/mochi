import { describe, expect, it } from 'vitest'

import { DRIFT_PX, createHerPlace } from './her-place'

/**
 * Three decisions that lived inside a `listenTo` body and could not be reached.
 *
 * The one that matters is `movedBy`. Resizing her window is only acceptable
 * because she stays put — a version that silently moved her shipped, and the
 * symptom reads as a layout opinion rather than as a defect.
 */

const NOMINAL = { left: 267, top: 26, width: 146, height: 73.32 }
const place = () => createHerPlace({ nominalBody: NOMINAL, feetFromTop: 340 })

describe('where she is before anything has fitted', () => {
  it('starts at the body the window was first placed against', () => {
    // The fallback is wrong for a resized avatar and wrong in the direction
    // that keeps her reachable, which is the point.
    expect(place().body()).toEqual(NOMINAL)
  })

  it('starts at her shipped stance', () => {
    expect(place().feet()).toBe(340)
  })
})

describe('a fit that keeps its promise', () => {
  it('reports no movement when she lands where she was', () => {
    const her = place()
    const body = { left: 267, top: 26, width: 146, height: 73.32 }
    const herOnScreen = { x: 1000, y: 500 }
    // `originHolding` derives the origin so she lands exactly here.
    const origin = { x: herOnScreen.x - body.left, y: herOnScreen.y - body.top }
    expect(
      her.fitTo({ body, origin, size: { width: 680, height: 200 }, herOnScreen }).movedBy,
    ).toBe(0)
  })

  it('measures how far a fit moved her when it does', () => {
    /*
      THE DEFECT THIS EXISTS FOR.

      An origin computed against the wrong body puts her somewhere else, and
      every other signal in the app looks fine: the window is the right size,
      she is drawn correctly inside it, and she is simply not where she was.
    */
    const her = place()
    const body = { left: 267, top: 26, width: 146, height: 73.32 }
    const herOnScreen = { x: 1000, y: 500 }
    const wrong = { x: herOnScreen.x - body.left, y: herOnScreen.y - body.top - 241 }
    expect(
      her.fitTo({ body, origin: wrong, size: { width: 680, height: 200 }, herOnScreen }).movedBy,
    ).toBe(241)
  })

  it('takes the LARGER of the two axes, not their sum', () => {
    // A diagonal move of 5 and 5 is "she moved 5", not 10 — the number is read
    // as a distance somebody can compare against a threshold.
    const her = place()
    const body = { left: 0, top: 0, width: 10, height: 10 }
    const moved = her.fitTo({
      body,
      origin: { x: 5, y: 5 },
      size: { width: 100, height: 100 },
      herOnScreen: { x: 0, y: 0 },
    })
    expect(moved.movedBy).toBe(5)
  })

  it('tolerates sub-pixel drift', () => {
    // Bounds are integers and her body is not, so half a pixel is rounding.
    const her = place()
    const body = { left: 267.4, top: 26.6, width: 146, height: 73.32 }
    const moved = her.fitTo({
      body,
      origin: { x: 733, y: 473 },
      size: { width: 680, height: 200 },
      herOnScreen: { x: 1000, y: 500 },
    })
    expect(moved.movedBy).toBeLessThanOrEqual(DRIFT_PX)
  })
})

describe('which fits are worth a line', () => {
  const fit = (her: ReturnType<typeof place>, size: { width: number; height: number }) =>
    her.fitTo({
      body: NOMINAL,
      origin: { x: 0, y: 0 },
      size,
      herOnScreen: { x: NOMINAL.left, y: NOMINAL.top },
    }).isNewSize

  it('reports the first one', () => {
    expect(fit(place(), { width: 680, height: 200 })).toBe(true)
  })

  it('does not report the same size twice', () => {
    // The renderer asks on any frame the answer changes, and a line per frame
    // buries everything else in the log.
    const her = place()
    expect(fit(her, { width: 680, height: 200 })).toBe(true)
    expect(fit(her, { width: 680, height: 200 })).toBe(false)
    expect(fit(her, { width: 680, height: 200 })).toBe(false)
  })

  it('reports it again once it actually changes', () => {
    const her = place()
    fit(her, { width: 680, height: 200 })
    expect(fit(her, { width: 146, height: 100 })).toBe(true)
  })

  it('notices a change in either dimension alone', () => {
    const her = place()
    fit(her, { width: 680, height: 200 })
    expect(fit(her, { width: 680, height: 201 })).toBe(true)
    expect(fit(her, { width: 681, height: 201 })).toBe(true)
  })
})

describe('her stance while she is dragged', () => {
  it('says when it changed', () => {
    const her = place()
    expect(her.standAt(99)).toBe(true)
    expect(her.feet()).toBe(99)
  })

  it('says when it did not', () => {
    // The caller sends a frame on the change; one per drag event would be a
    // message per mouse move, and she is being dragged at sixty a second.
    const her = place()
    her.standAt(99)
    expect(her.standAt(99)).toBe(false)
  })

  it('changes back when she is dragged away from the edge again', () => {
    const her = place()
    her.standAt(99)
    expect(her.standAt(340)).toBe(true)
  })
})

describe('remembering where she was left', () => {
  it('records HER position, not the window`s', () => {
    /*
      The window is padding around her, and its corner moves whenever the
      padding does — with a bubble up, without one, at a different size.
      Storing the window would put her somewhere else on the next launch
      depending on what she happened to be doing when it closed.
    */
    const her = place()
    const saved = her.placeFrom({ x: 100, y: 200 })
    expect(saved.left).toBe(100 + NOMINAL.left)
    expect(saved.top).toBe(200 + NOMINAL.top)
  })

  it('rounds, because a stored place is written as integers', () => {
    const her = place()
    const saved = her.placeFrom({ x: 100.4, y: 200.6 })
    expect(Number.isInteger(saved.left)).toBe(true)
    expect(Number.isInteger(saved.top)).toBe(true)
    expect(Number.isInteger(saved.width)).toBe(true)
    expect(Number.isInteger(saved.height)).toBe(true)
  })

  it('follows the body a fit gave her, not the one she started with', () => {
    // Her body changes with the bubble, and a place saved against the nominal
    // one would drift by the difference every time the window resized.
    const her = place()
    const grown = { left: 20, top: 30, width: 200, height: 90 }
    her.fitTo({
      body: grown,
      origin: { x: 0, y: 0 },
      size: { width: 400, height: 300 },
      herOnScreen: { x: 20, y: 30 },
    })
    expect(her.placeFrom({ x: 0, y: 0 })).toEqual({
      left: 20,
      top: 30,
      width: 200,
      height: 90,
    })
  })
})

describe('a body reported without a fit', () => {
  /**
   * `companion:body` and `companion:fit` are separate channels. The first
   * arrives whenever her drawn size changes; the second only when the WINDOW
   * has to change with it. A body recorded by only one of them leaves the drag
   * clamp measuring a shape she no longer has — and the drag clamp is what
   * keeps her from being dragged off the display.
   */
  it('updates where she is', () => {
    const her = place()
    const grown = { left: 10, top: 20, width: 300, height: 150 }
    her.reportedBody(grown)
    expect(her.body()).toEqual(grown)
  })

  it('is what a later saved place is measured from', () => {
    const her = place()
    her.reportedBody({ left: 10, top: 20, width: 300, height: 150 })
    expect(her.placeFrom({ x: 0, y: 0 }).left).toBe(10)
  })

  it('does not disturb her stance', () => {
    // Her body is her drawn size; her feet are where she stands in the window.
    // A resize while she is held against the top of the display must not undo
    // the stance the drag gave her.
    const her = place()
    her.standAt(99)
    her.reportedBody({ left: 10, top: 20, width: 300, height: 150 })
    expect(her.feet()).toBe(99)
  })
})
