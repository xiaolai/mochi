import { describe, expect, it } from 'vitest'
import { chipRect, drawChip, hits, visible } from './chip'

const WIDTH = 320

describe('where it is', () => {
  it('sits in the top right, inside the window', () => {
    const rect = chipRect(WIDTH)
    expect(rect.x + rect.w).toBeLessThan(WIDTH)
    expect(rect.x).toBeGreaterThan(WIDTH / 2)
    expect(rect.y).toBeGreaterThan(0)
  })

  it('answers for points on it and not for points beside it', () => {
    const { x, y, w, h } = chipRect(WIDTH)
    expect(hits(x + w / 2, y + h / 2, WIDTH)).toBe(true)
    expect(hits(x - 4, y + h / 2, WIDTH)).toBe(false)
    expect(hits(x + w / 2, y + h + 4, WIDTH)).toBe(false)
    // The middle of the window is her, not it.
    expect(hits(WIDTH / 2, WIDTH / 2, WIDTH)).toBe(false)
  })
})

describe('when it shows', () => {
  it('is hidden when the pointer is nowhere near the window', () => {
    expect(visible(null, false, WIDTH)).toBe(false)
  })

  it('shows while the pointer is on her', () => {
    expect(visible({ x: 160, y: 200 }, true, WIDTH)).toBe(true)
  })

  it('stays up while the pointer is on IT, though that is not on her', () => {
    // The rule that makes it clickable at all. The chip sits outside her
    // silhouette — that is what a corner is — so any path from her to it leaves
    // her. "Show while on her" alone hides it exactly as the cursor arrives,
    // which also un-solids the rectangle under the cursor.
    const { x, y, w, h } = chipRect(WIDTH)
    expect(visible({ x: x + w / 2, y: y + h / 2 }, false, WIDTH)).toBe(true)
  })

  it('hides when the pointer is on neither', () => {
    expect(visible({ x: 4, y: 300 }, false, WIDTH)).toBe(false)
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
    drawChip(ctx, WIDTH, COLOURS, 1)
    expect(calls).toContain(`fill:${COLOURS.paper}`)
    expect(calls).toContain(`fill:${COLOURS.ink}`)
    expect(raw.globalAlpha).toBe(1)
  })

  it('draws nothing at all when it has faded out', () => {
    // Not "draws it invisibly": a zero-alpha fill still costs a path per frame,
    // sixty times a second, for every frame she is not hovered — which is
    // almost all of them.
    const { ctx, calls } = recorder()
    drawChip(ctx, WIDTH, COLOURS, 0)
    expect(calls).toEqual([])
  })

  it('restores the context it was handed', () => {
    // It shares a canvas with her. A leaked `globalAlpha` or fillStyle would
    // tint whatever is painted next, which is her face.
    const { ctx, calls } = recorder()
    drawChip(ctx, WIDTH, COLOURS, 0.5)
    expect(calls[0]).toBe('save')
    expect(calls[calls.length - 1]).toBe('restore')
  })
})
