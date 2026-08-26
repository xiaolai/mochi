import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { descendants, structuralDocument, type FakeNode } from '../../../test/structural-dom'

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

const { faceTile, wornMark } = await import('./face-tile')

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

  it('does not size a canvas it never drew into', () => {
    // A sized-but-blank canvas reserves the space and shows nothing, which
    // reads as a picture that failed to load rather than as a missing face.
    const tile = asNode(faceTile(undefined, 40)) as unknown as { width?: number; height?: number }
    expect(tile.width).toBeUndefined()
    expect(tile.height).toBeUndefined()
  })

  it('still carries the class the row styles against', () => {
    // The gap has to occupy the same slot, or the row reflows around it.
    expect(asNode(faceTile(undefined, 40)).className).toBe('tile')
  })
})

describe('the mark on the character she is wearing', () => {
  it('is announced as an image with a name', () => {
    // "A tick is read without being read" — which only holds if the tick has a
    // name for the readers that cannot see it.
    const mark = asNode(wornMark())
    expect(mark.attributes.get('role')).toBe('img')
    expect(mark.attributes.get('aria-label')).toBe('worn')
  })

  it('hides the graphic, so it is not announced twice', () => {
    const svg = descendants(asNode(wornMark())).find((one) => one.tag === 'svg')
    expect(svg?.attributes.get('aria-hidden')).toBe('true')
  })

  it('names nothing below the wrapper', () => {
    for (const one of descendants(asNode(wornMark()))) {
      expect(one.attributes.has('aria-label'), `${one.tag} is named too`).toBe(false)
    }
  })

  it('draws the tick with no fill, or it reads as a blob', () => {
    const tick = descendants(asNode(wornMark())).find((one) => one.tag === 'path')
    expect(tick?.attributes.get('fill')).toBe('none')
    expect(tick?.attributes.get('stroke-width')).toBe('2')
  })

  it('takes its colour from the rule rather than the markup', () => {
    // `currentColor` is what lets her theme reach the mark without a second
    // copy of the colour living here.
    const tick = descendants(asNode(wornMark())).find((one) => one.tag === 'path')
    expect(tick?.attributes.get('stroke')).toBe('currentColor')
  })

  it('builds the graphic in the SVG namespace', () => {
    // `createElement('svg')` produces an HTML element the browser draws as
    // nothing, and nothing about the markup looks wrong.
    expect(descendants(asNode(wornMark())).some((one) => one.tag === 'svg')).toBe(true)
  })
})
