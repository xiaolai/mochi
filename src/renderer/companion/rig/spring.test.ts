import { describe, expect, it } from 'vitest'
import { DEFAULT_SPRING, MAX_STEP_SECONDS, Spring } from './spring'

/** Run a spring to a target for a while and report where it got to. */
function settle(spring: Spring, target: number, seconds: number, dt = 1 / 60): number[] {
  const trace: number[] = []
  for (let t = 0; t < seconds; t += dt) trace.push(spring.step(dt, target, DEFAULT_SPRING))
  return trace
}

describe('Spring', () => {
  it('converges on its target', () => {
    const spring = new Spring(0)
    const trace = settle(spring, 1, 3)
    expect(trace.at(-1)).toBeCloseTo(1, 3)
  })

  it('overshoots — the property a one-pole filter cannot have', () => {
    // This is the entire reason the class exists. A first-order filter
    // approaches its target monotonically; mass overshoots and comes back, and
    // that is what makes a squash read as dough rather than as a scaled image.
    const spring = new Spring(0)
    const trace = settle(spring, 1, 3)
    expect(Math.max(...trace)).toBeGreaterThan(1)
  })

  it('settles rather than oscillating forever', () => {
    const spring = new Spring(0)
    settle(spring, 1, 5)
    expect(spring.isAtRest(1)).toBe(true)
  })

  it('does not diverge when a frame takes seconds', () => {
    // A backgrounded window, a breakpoint, or a laptop waking from sleep all
    // hand the integrator a dt of seconds. Semi-implicit Euler is only
    // conditionally stable, so without the clamp this runs away to Infinity in
    // a handful of frames and every later frame paints NaN.
    const spring = new Spring(0)
    for (let i = 0; i < 20; i++) spring.step(30, 1, DEFAULT_SPRING)
    expect(Number.isFinite(spring.value)).toBe(true)
    expect(Math.abs(spring.value)).toBeLessThan(10)
  })

  it('clamps the step rather than refusing it', () => {
    const clamped = new Spring(0)
    clamped.step(5, 1, DEFAULT_SPRING)
    const exact = new Spring(0)
    exact.step(MAX_STEP_SECONDS, 1, DEFAULT_SPRING)
    // Under-integrated, not ignored: she resumes slightly behind rather than
    // freezing, which is invisible where divergence is catastrophic.
    expect(clamped.value).toBeCloseTo(exact.value, 10)
  })

  it('ignores a non-finite target instead of poisoning itself', () => {
    const spring = new Spring(0.5)
    spring.step(1 / 60, Number.NaN, DEFAULT_SPRING)
    expect(spring.value).toBe(0.5)
    // And still works afterwards — one bad sample must not be permanent.
    settle(spring, 1, 3)
    expect(spring.value).toBeCloseTo(1, 3)
  })

  it('ignores non-positive and non-finite time steps', () => {
    const spring = new Spring(0.25)
    expect(spring.step(0, 1, DEFAULT_SPRING)).toBe(0.25)
    expect(spring.step(-1, 1, DEFAULT_SPRING)).toBe(0.25)
    expect(spring.step(Number.NaN, 1, DEFAULT_SPRING)).toBe(0.25)
  })

  it('snap kills velocity, so a teleport does not spring back', () => {
    const spring = new Spring(0)
    settle(spring, 1, 0.1)
    spring.snap(0)
    expect(spring.value).toBe(0)
    expect(spring.isAtRest(0)).toBe(true)
  })

  it('bounces once visibly at the tuned values, then settles', () => {
    // 190/20 is underdamped on purpose (damping ratio ~0.73), so mathematically
    // it crosses its target several times. Counting raw crossings measures the
    // wrong thing: amplitude falls by ~99.9% per period, so every crossing
    // after the first is far below a pixel and nobody will ever see it.
    //
    // What the eye judges is how many crossings are BIG enough to notice, and
    // that is the number worth pinning — one overshoot reads as weight, three
    // reads as jelly.
    const VISIBLE = 0.01
    const spring = new Spring(0)
    const trace = settle(spring, 1, 2)

    let visible = 0
    let peak = 0
    let side = Math.sign((trace[0] ?? 0) - 1)
    for (const value of trace) {
      const error = value - 1
      const nextSide = Math.sign(error)
      if (nextSide !== 0 && nextSide !== side) {
        if (peak > VISIBLE) visible++
        peak = 0
        side = nextSide
      }
      peak = Math.max(peak, Math.abs(error))
    }
    expect(visible).toBeGreaterThanOrEqual(1)
    expect(visible).toBeLessThanOrEqual(2)
  })
})
