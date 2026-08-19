import { describe, expect, it } from 'vitest'
import { chipRect, drawChip, hits, visible } from './chip'

/** Where she stands on her 980x560 canvas at size 100. */
const HER = { left: 443, top: 267, width: 94, height: 73 }

/** The whole canvas on screen, which is the ordinary case. */
const OPEN = { left: 0, top: 0, right: 980, bottom: 560 }

describe('where it is', () => {
  it('sits beside her shoulder, not in the window’s corner', () => {
    // The window is far larger than she is, so anchoring to the window put the
    // control a long way from the thing it belongs to.
    const rect = chipRect(HER)
    // Outside her box, and touching it. Both extremes were tried by eye and
    // rejected: centred on the corner overlapped her, and nine pixels clear
    // read as unrelated to her.
    expect(rect.x).toBe(HER.left + HER.width)
    expect(rect.y + rect.h).toBe(HER.top)
  })

  it('does not overlap her, which is the whole complaint about where it was', () => {
    // It used to be centred ON her corner, so a quarter of the button sat
    // inside her outline and the two ran into each other.
    const rect = chipRect(HER)
    expect(rect.x).toBeGreaterThanOrEqual(HER.left + HER.width)
    expect(rect.y + rect.h).toBeLessThanOrEqual(HER.top)
  })

  it('follows her when she moves', () => {
    const a = chipRect(HER)
    const b = chipRect({ ...HER, left: HER.left + 53, top: HER.top - 139 })
    expect(b.x - a.x).toBe(53)
    expect(b.y - a.y).toBe(-139)
  })

  it('answers for points on it and not for points beside it', () => {
    // `hits` is the CLICK region and stays exactly the button. The margin that
    // keeps it from vanishing mid-approach lives in `visible`, not here.
    const { x, y, w, h } = chipRect(HER)
    expect(hits(x + w / 2, y + h / 2, HER)).toBe(true)
    expect(hits(x - 4, y + h / 2, HER)).toBe(false)
    expect(hits(x + w / 2, y + h + 4, HER)).toBe(false)
    // The middle of her body is her, not it.
    expect(hits(HER.left + HER.width / 2, HER.top + HER.height / 2, HER)).toBe(false)
  })
})

describe('when it shows', () => {
  it('is hidden when the pointer is nowhere near the window', () => {
    expect(visible(null, false, HER)).toBe(false)
  })

  it('shows while the pointer is on her', () => {
    expect(visible({ x: HER.left + 40, y: HER.top + 40 }, true, HER)).toBe(true)
  })

  it('stays up while the pointer is on IT, though that is not on her', () => {
    // The rule that makes it clickable at all. The chip sits outside her
    // silhouette — that is what a corner is — so any path from her to it leaves
    // her. "Show while on her" alone hides it exactly as the cursor arrives,
    // which also un-solids the rectangle under the cursor.
    const { x, y, w, h } = chipRect(HER)
    expect(visible({ x: x + w / 2, y: y + h / 2 }, false, HER)).toBe(true)
  })

  it('survives the gap between her and it', () => {
    // Moving it clear of her opened a strip of empty desktop in between, and
    // "on her or on it" hides it exactly halfway across — which un-solids the
    // rectangle the cursor is travelling towards.
    const { x, y, h } = chipRect(HER)
    expect(visible({ x: x - 6, y: y + h + 6 }, false, HER)).toBe(true)
  })

  it('hides when the pointer is on neither', () => {
    expect(visible({ x: 4, y: 20 }, false, HER)).toBe(false)
  })

  it('shows on the corner it actually chose, not the one it prefers', () => {
    // The rule that makes it clickable at all, now that the corner moves.
    const cramped = { left: 0, top: 0, right: HER.left + HER.width + 4, bottom: 560 }
    const rect = chipRect(HER, cramped)
    expect(visible({ x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 }, false, HER, cramped)).toBe(
      true,
    )
  })
})

/** A context that records what was asked of it, shared by both blocks below. */
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

describe('what it draws', () => {
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

describe('when something needs reading', () => {
  it('still waits to be hovered, however many problems there are', () => {
    // It used to show itself unbidden while a problem was outstanding. That was
    // overruled: a control that appears on the desktop by itself is a control
    // that appears on the desktop by itself, whatever its reason. The mark on
    // it is kept, so the hover that finds it still says something is waiting —
    // and the bubble's own copy of this control keeps its unprompted badge,
    // which is the common case.
    expect(visible(null, false, HER)).toBe(false)
    expect(visible({ x: 4, y: 20 }, false, HER)).toBe(false)
  })

  it('paints the dot, and does not when the count is zero', () => {
    const withOne = recorder()
    drawChip(withOne.ctx, HER, COLOURS, 1, 1)
    expect(withOne.calls).toContain('fill:#d1495b')

    const withNone = recorder()
    drawChip(withNone.ctx, HER, COLOURS, 1, 0)
    expect(withNone.calls).not.toContain('fill:#d1495b')
  })

  it('draws nothing at all when faded out, badge included', () => {
    // The early return is what keeps sixty paths a second off the canvas while
    // she is not hovered. A badge drawn past it would reinstate them.
    const { ctx, calls } = recorder()
    drawChip(ctx, HER, COLOURS, 0, 3)
    expect(calls).toEqual([])
  })
})

describe('which corner of her it takes', () => {
  it('her top right, when the screen allows', () => {
    // The corner a badge belongs on, and the one furthest from where the
    // bubble's tail comes down.
    const rect = chipRect(HER, OPEN)
    expect(rect.x).toBe(HER.left + HER.width)
    expect(rect.y + rect.h).toBe(HER.top)
  })

  it('her top LEFT when she is against the right edge of the display', () => {
    // A 26-pixel button pinned outside her top right is half off the screen the
    // moment she is against that edge — which the drag lets her be, by design.
    const atRight = { left: 0, top: 0, right: HER.left + HER.width + 10, bottom: 560 }
    const rect = chipRect(HER, atRight)
    expect(rect.x + rect.w).toBeLessThanOrEqual(HER.left)
  })

  it('BELOW her when she is against the top of the display', () => {
    const atTop = { left: 0, top: HER.top, right: 980, bottom: 560 }
    const rect = chipRect(HER, atTop)
    expect(rect.y).toBeGreaterThanOrEqual(HER.top + HER.height)
  })

  it('takes the far corner when she is in a corner of the display', () => {
    // Top right of the screen: no room to her right, none above her. It goes
    // to her bottom left, which is the only corner left.
    const corner = { left: 0, top: HER.top, right: HER.left + HER.width + 10, bottom: 560 }
    const rect = chipRect(HER, corner)
    expect(rect.x + rect.w).toBeLessThanOrEqual(HER.left)
    expect(rect.y).toBeGreaterThanOrEqual(HER.top + HER.height)
  })

  it('stays on screen even when neither side has room', () => {
    const none = {
      left: HER.left,
      top: HER.top,
      right: HER.left + HER.width,
      bottom: HER.top + HER.height,
    }
    const rect = chipRect(HER, none)
    expect(rect.x).toBeGreaterThanOrEqual(none.left)
    expect(rect.y + rect.h).toBeLessThanOrEqual(none.bottom)
  })
})
