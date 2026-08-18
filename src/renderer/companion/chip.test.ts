import { describe, expect, it } from 'vitest'
import { chipRect, drawChip, hits, visible } from './chip'

/** Where she stands on a 320 canvas at size 100 — her right edge and her top. */
const HER = { right: 207, top: 239 }

describe('where it is', () => {
  it('sits on her shoulder, not in the window’s corner', () => {
    // The window is far larger than she is, so anchoring to the window put the
    // control a long way from the thing it belongs to.
    const rect = chipRect(HER)
    expect(Math.abs(rect.x + rect.w / 2 - HER.right)).toBeLessThan(2)
    expect(Math.abs(rect.y + rect.h / 2 - HER.top)).toBeLessThan(2)
  })

  it('follows her when she moves', () => {
    const a = chipRect({ right: 207, top: 239 })
    const b = chipRect({ right: 260, top: 100 })
    expect(b.x - a.x).toBe(53)
    expect(b.y - a.y).toBe(-139)
  })

  it('answers for points on it and not for points beside it', () => {
    const { x, y, w, h } = chipRect(HER)
    expect(hits(x + w / 2, y + h / 2, HER)).toBe(true)
    expect(hits(x - 4, y + h / 2, HER)).toBe(false)
    expect(hits(x + w / 2, y + h + 4, HER)).toBe(false)
    // The middle of her body is her, not it.
    expect(hits(160, 290, HER)).toBe(false)
  })
})

describe('when it shows', () => {
  it('is hidden when the pointer is nowhere near the window', () => {
    expect(visible(null, false, HER)).toBe(false)
  })

  it('shows while the pointer is on her', () => {
    expect(visible({ x: 160, y: 280 }, true, HER)).toBe(true)
  })

  it('stays up while the pointer is on IT, though that is not on her', () => {
    // The rule that makes it clickable at all. The chip sits outside her
    // silhouette — that is what a corner is — so any path from her to it leaves
    // her. "Show while on her" alone hides it exactly as the cursor arrives,
    // which also un-solids the rectangle under the cursor.
    const { x, y, w, h } = chipRect(HER)
    expect(visible({ x: x + w / 2, y: y + h / 2 }, false, HER)).toBe(true)
  })

  it('hides when the pointer is on neither', () => {
    expect(visible({ x: 4, y: 20 }, false, HER)).toBe(false)
  })
})

describe('what it draws', () => {
  function recorder() {
    const calls: string[] = []
    const ctx = {
      save: () => calls.push('save'),
      restore: () => calls.push('restore'),
      beginPath() {},
      roundRect() {},
      moveTo() {},
      lineTo() {},
      closePath() {},
      arc() {},
      fill() {
        calls.push(`fill:${String(ctx.fillStyle)}`)
      },
      fillStyle: '' as string,
      globalAlpha: 1,
    }
    return { ctx: ctx as unknown as CanvasRenderingContext2D, calls, raw: ctx }
  }

  const COLOURS = { paper: '#f4f2ea', ink: '#2b2c25' }

  it('paints its own opaque surface, like anything else she sits in front of', () => {
    const { ctx, calls, raw } = recorder()
    drawChip(ctx, HER, COLOURS, 1)
    expect(calls).toContain(`fill:${COLOURS.paper}`)
    expect(calls).toContain(`fill:${COLOURS.ink}`)
    expect(raw.globalAlpha).toBe(1)
  })

  it('draws nothing at all when it has faded out', () => {
    // Not "draws it invisibly": a zero-alpha fill still costs a path per frame,
    // sixty times a second, for every frame she is not hovered — which is
    // almost all of them.
    const { ctx, calls } = recorder()
    drawChip(ctx, HER, COLOURS, 0)
    expect(calls).toEqual([])
  })

  it('restores the context it was handed', () => {
    // It shares a canvas with her. A leaked `globalAlpha` or fillStyle would
    // tint whatever is painted next, which is her face.
    const { ctx, calls } = recorder()
    drawChip(ctx, HER, COLOURS, 0.5)
    expect(calls[0]).toBe('save')
    expect(calls[calls.length - 1]).toBe('restore')
  })
})
