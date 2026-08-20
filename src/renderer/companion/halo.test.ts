import { describe, expect, it } from 'vitest'
import { beadAngle, drawHalo, haloFor, haloRect, haloReach } from './halo'

/** Where she stands at size 100, as the rig lays her out. */
const HER = { left: 0, top: 26, width: 94, height: 73.32 }
const COLOURS = { her: '#8ec8a8', veil: 'rgb(142 200 168 / 22%)', quiet: 'rgb(250 251 252 / 62%)' }

/** Enough of a 2D context to record what was asked for. */
function recorder(): {
  ctx: CanvasRenderingContext2D
  calls: string[]
  strokes: string[]
  fills: string[]
} {
  const calls: string[] = []
  const strokes: string[] = []
  const fills: string[] = []
  const ctx = {
    save: () => calls.push('save'),
    restore: () => calls.push('restore'),
    translate: (x: number, y: number) => calls.push(`translate:${x.toFixed(1)},${y.toFixed(1)}`),
    rotate: (a: number) => calls.push(`rotate:${a.toFixed(3)}`),
    beginPath: () => calls.push('beginPath'),
    ellipse: (...a: number[]) => calls.push(`ellipse:${a.slice(0, 4).join(',')}`),
    arc: (x: number, y: number, r: number) =>
      calls.push(`arc:${x.toFixed(1)},${y.toFixed(1)},${r}`),
    fill: () => fills.push(String((ctx as { fillStyle?: unknown }).fillStyle)),
    stroke: () => strokes.push(String((ctx as { strokeStyle?: unknown }).strokeStyle)),
    globalAlpha: 1,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
  } as unknown as CanvasRenderingContext2D
  return { ctx, calls, strokes, fills }
}

describe('where the halo sits', () => {
  it('is centred on her and clear of her head', () => {
    const ring = haloRect(HER)
    expect(ring.x).toBe(HER.left + HER.width / 2)
    // Its lowest point is above her scalp, not on it.
    expect(ring.y + haloReach()).toBeLessThan(HER.top)
  })

  it('is narrower than she is, so it never widens her window', () => {
    // Her window fits what is drawn. A halo wider than her body would add
    // padding on both sides for a readout, which is the wrong thing to grow for.
    expect(haloRect(HER).rx * 2).toBeLessThan(HER.width)
  })

  it('stays above her wherever she is, unlike the chip', () => {
    // The chip flips sides near an edge because an unreachable control is
    // broken. This is a readout: a halo that jumped under her chin would say
    // something different every time she moved.
    const high = haloRect({ ...HER, top: 0 })
    const low = haloRect({ ...HER, top: 900 })
    expect(high.y).toBeLessThan(0)
    expect(low.y).toBeLessThan(900)
  })

  it('computes its reach from the tilt rather than from a measured drawing', () => {
    // sqrt((a·sinθ)² + (b·cosθ)²) at a=33, b=8, θ=12°.
    expect(haloReach()).toBeCloseTo(10.4, 1)
  })
})

describe('the bead is a clock', () => {
  it('laps once a second', () => {
    expect(beadAngle(0)).toBe(0)
    expect(beadAngle(0.5)).toBeCloseTo(Math.PI, 5)
    // Two seconds in is the same place as one second in — elapsed time, not
    // progress toward an end nothing in this app knows.
    expect(beadAngle(2)).toBeCloseTo(beadAngle(1), 5)
    expect(beadAngle(2.25)).toBeCloseTo(beadAngle(0.25), 5)
  })

  it('refuses a number that is not one', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1]) expect(beadAngle(bad)).toBe(0)
  })
})

describe('what each state draws', () => {
  it('draws NOTHING when the grant is withheld', () => {
    // An outline promising a microphone that cannot open is worse than none.
    const { ctx, calls } = recorder()
    drawHalo(ctx, HER, COLOURS, 'off', 1, null)
    expect(calls).toEqual([])
  })

  it('fills with her colour when the microphone is open', () => {
    const { ctx, strokes, fills } = recorder()
    drawHalo(ctx, HER, COLOURS, 'open', 1, null)
    expect(strokes).toContain(COLOURS.her)
    expect(fills).toContain(COLOURS.veil)
  })

  it('is a hairline when she is resting, and not her colour', () => {
    // Resting and withheld must not look alike: one is a state that ends, the
    // other a decision somebody made.
    const { ctx, strokes, fills } = recorder()
    drawHalo(ctx, HER, COLOURS, 'closed', 1, null)
    expect(strokes).toContain(COLOURS.quiet)
    expect(strokes).not.toContain(COLOURS.her)
    expect(fills).toEqual([])
  })

  it('draws the bead only while something is being waited for', () => {
    const without = recorder()
    drawHalo(without.ctx, HER, COLOURS, 'open', 1, null)
    expect(without.calls.some((one) => one.startsWith('arc:'))).toBe(false)

    const withBead = recorder()
    drawHalo(withBead.ctx, HER, COLOURS, 'open', 1, 0.4)
    expect(withBead.calls.some((one) => one.startsWith('arc:'))).toBe(true)
  })

  it('draws nothing at zero opacity, rather than painting transparently', () => {
    // The same early return the chip and the beat use: this runs every frame and
    // she is not waiting for almost all of them.
    const { ctx, calls } = recorder()
    drawHalo(ctx, HER, COLOURS, 'open', 0, null)
    expect(calls).toEqual([])
  })

  it('leaves the context as it found it', () => {
    const { ctx, calls } = recorder()
    drawHalo(ctx, HER, COLOURS, 'open', 1, 0.5)
    expect(calls.filter((one) => one === 'save')).toHaveLength(1)
    expect(calls.filter((one) => one === 'restore')).toHaveLength(1)
    expect(calls[calls.length - 1]).toBe('restore')
  })
})

describe('which state the two booleans mean', () => {
  /**
   * The whole semantic content of the halo, and the reason it is a function.
   *
   * `hearing` alone cannot answer this: main computes it as `!asleep && mayHear`,
   * so a closed microphone means either she is resting or somebody withheld the
   * grant. Those must not look alike — one is a state that ends when she wakes,
   * the other a decision somebody made.
   */
  it('is open only when the microphone is actually live', () => {
    expect(haloFor(true, false)).toBe('open')
    // Hearing while resting should not happen; if it does, live wins, because
    // the halo's job is reporting the microphone and not tidying the state.
    expect(haloFor(true, true)).toBe('open')
  })

  it('is a hairline while she rests, and nothing when the grant is withheld', () => {
    expect(haloFor(false, true)).toBe('closed')
    expect(haloFor(false, false)).toBe('off')
  })

  it('never reports the same state for resting and withheld', () => {
    expect(haloFor(false, true)).not.toBe(haloFor(false, false))
  })
})
