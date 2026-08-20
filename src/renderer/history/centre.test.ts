import { describe, expect, it } from 'vitest'
import { centreOffset, paintedBounds } from './centre'

/** A grid where `1` is painted, so a case reads as the picture it describes. */
function grid(rows: readonly string[]): (x: number, y: number) => number {
  return (x, y) => (rows[y]?.[x] === '1' ? 255 : 0)
}

describe('where the painted pixels actually are', () => {
  it('finds the box, not the canvas', () => {
    const rows = ['0000', '0110', '0110', '0000']
    expect(paintedBounds(grid(rows), 4, 4)).toEqual({ top: 1, bottom: 2, left: 1, right: 2 })
  })

  it('is null when nothing was painted', () => {
    expect(paintedBounds(grid(['000', '000']), 3, 2)).toBeNull()
  })

  it('counts the antialiased fringe as painted', () => {
    /*
      The threshold is 8 of 255. Antialiasing puts a very faint edge around
      everything she has, and calling that empty crops a pixel off each side —
      invisible at 108px and a twentieth of her at 40px.
    */
    const faint = (x: number, y: number): number => (x === 1 && y === 1 ? 9 : 0)
    expect(paintedBounds(faint, 3, 3)).toEqual({ top: 1, bottom: 1, left: 1, right: 1 })
    const fainter = (x: number, y: number): number => (x === 1 && y === 1 ? 7 : 0)
    expect(paintedBounds(fainter, 3, 3)).toBeNull()
  })
})

describe('how far to move it', () => {
  it('is nothing when it is already centred', () => {
    expect(centreOffset({ top: 1, bottom: 2, left: 1, right: 2 }, 4, 4)).toEqual({ dx: 0, dy: 0 })
  })

  it('lifts a creature that sits low, by half the difference', () => {
    /*
      The measured swatch: 40px canvas, 16.5px of air above her and 2.0px below.
      In backing pixels at ratio 2 that is rows 33..75 of 80 — 43 painted rows,
      37 spare, so she moves up 14.5 and the tie rounds toward zero. Half a
      backing pixel is a quarter of a CSS one; which way it falls does not
      matter, that it is a WHOLE pixel does.

      Horizontally she was already centred — 13 and 13 — which is why the fix is
      vertical and the test says so rather than asserting a bare `dy`.
    */
    expect(centreOffset({ top: 33, bottom: 75, left: 13, right: 66 }, 80, 80)).toEqual({
      dx: 0,
      dy: -14,
    })
  })

  it('rounds to whole pixels', () => {
    /*
      The result is a `drawImage` offset. A fractional one resamples every edge
      she has, which at 40px is the difference between a drawn line and a grey
      smear.
    */
    const at = centreOffset({ top: 0, bottom: 2, left: 0, right: 2 }, 4, 4)
    expect(Number.isInteger(at.dx)).toBe(true)
    expect(Number.isInteger(at.dy)).toBe(true)
  })

  it('has nothing to move when nothing was painted', () => {
    expect(centreOffset(null, 40, 40)).toEqual({ dx: 0, dy: 0 })
  })

  it('centres what it is given, whatever the canvas shape', () => {
    // A wide canvas with her in the top-left corner: both axes move.
    expect(centreOffset({ top: 0, bottom: 9, left: 0, right: 9 }, 100, 20)).toEqual({
      dx: 45,
      dy: 5,
    })
  })
})
