import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { structuralDocument, type FakeNode } from '../../../test/structural-dom'

/**
 * The two pieces of a shelf row that are not the row's text.
 *
 * ## What is asserted here, and what is left to the rasteriser
 *
 * `faceTile`'s DRAWING is a rendering question, and this project answers those
 * with `@napi-rs/canvas` rather than a stub — `mochi.test.ts` and
 * `shipped-icons.test.ts` do exactly that, for the reason `vitest.config.ts`
 * gives. Nothing here re-litigates it.
 *
 * What is asserted is the DECISION at the top of that function, which is not
 * about pixels at all: *"A missing face is REFUSED, not quietly replaced."*
 * `MochiAvatar` falls back to the built-in when a face is undefined — right
 * for the companion, who must be drawn, and wrong here, because then every row
 * shows the same green mochi and the shelf silently stops doing the one job it
 * has. The comment records that this is what a stale main process looked like,
 * *and that it looked like a design decision.*
 *
 * That is the failure worth a test: it is invisible, it is plausible, and the
 * fallback that causes it lives in another module.
 */

const dom = structuralDocument()

beforeEach(() => {
  vi.stubGlobal('document', dom.document)
  // Read by `faceTile` before it draws. Absent, the guard under test is never
  // reached and the test would pass for the wrong reason.
  vi.stubGlobal('window', { devicePixelRatio: 2 })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const { faceTile } = await import('./face-tile')

const asNode = (value: unknown): FakeNode => value as FakeNode

describe('a row with no face to draw', () => {
  it('gives back an empty tile rather than somebody else', () => {
    /*
      THE DECISION.

      Drawing the built-in here would put the same green mochi on every row,
      which is indistinguishable from a working shelf until you notice every
      character looks the same. Empty is honest; the caller reports it.
    */
    const tile = asNode(faceTile(undefined, 40))
    expect(tile.tag).toBe('canvas')
    expect(tile.children).toHaveLength(0)
  })

  it('is the size it was asked for, though nothing is drawn in it', () => {
    /*
      A canvas with no width or height has an INTRINSIC 300×150, so a refusal
      that returns a bare one is eleven times wider than the tile beside it.
      That went unseen for as long as the cast column carried a rule that
      happened to compensate, and it pushed the rail 115px wider than the rail
      the moment that column was replaced.

      This assertion used to be the opposite — that an unsized canvas was right,
      because a sized blank one "reads as a picture that failed to load rather
      than as a missing face". That held for a blank square. The delivered
      design draws a DASHED box instead, which reads as a marked absence, so the
      reason no longer applies and the element owns its own size.
    */
    const tile = asNode(faceTile(undefined, 40)) as unknown as { width?: number; height?: number }
    expect(tile.width).toBe(40)
    expect(tile.height).toBe(40)
  })

  it('pins its CSS size too, so its dashed edge falls inside the box', () => {
    /*
      THE ATTRIBUTE IS THE INTRINSIC SIZE, not a layout width.

      With the attributes alone this is a replaced element at `width: auto`,
      which lays out at its intrinsic size PLUS its borders — so the dashed tile
      came out 36px against a face's 34, and the name beside it started two
      pixels further right than the name in the row above. One list, two left
      edges, for a character whose only difference is a missing face file.

      `box-sizing: border-box` cannot fix that, because there is no CSS width
      for it to apply to. The style is what pins the box; the attribute stays
      because it is still the bitmap and still what kills the intrinsic 300×150.
    */
    const tile = asNode(faceTile(undefined, 40))
    expect(tile.style.width).toBe('40px')
    expect(tile.style.height).toBe('40px')
  })

  it('takes no drawing surface it would have to be given a context for', () => {
    // Sized, and still empty: the refusal is the point, and `MochiAvatar` is
    // never constructed. Every other tile blits a rendered face in here.
    expect(asNode(faceTile(undefined, 40)).children).toHaveLength(0)
  })

  it('still carries the class the row styles against', () => {
    // The gap has to occupy the same slot, or the row reflows around it.
    expect(asNode(faceTile(undefined, 40)).className).toBe('tile')
  })
})
