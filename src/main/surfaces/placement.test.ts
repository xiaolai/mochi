import { describe, expect, it, vi } from 'vitest'

// `screen` is Electron's, and there is no Electron here. Faked at the module
// boundary rather than by injecting a parameter: the display layout is ambient
// to every caller, and threading it through would change three signatures to
// suit a test.
const workArea = { x: 0, y: 0, width: 1440, height: 900 }
vi.mock('electron', () => ({
  screen: { getDisplayNearestPoint: (): { workArea: typeof workArea } => ({ workArea }) },
}))

const { clamp, containToWorkArea } = await import('./placement')

describe('containToWorkArea', () => {
  it('leaves a window that is already inside where it is', () => {
    expect(containToWorkArea(400, 300, { width: 200, height: 160 })).toEqual({ x: 400, y: 300 })
  })

  it('pulls a window back from past the right and bottom edges', () => {
    // The failure it exists to prevent: she is dragged off the edge, the tray
    // only toggles visibility, and she is gone for the rest of the run in a way
    // that looks exactly like a crash.
    expect(containToWorkArea(1400, 880, { width: 200, height: 160 })).toEqual({
      x: 1240,
      y: 740,
    })
  })

  it('pulls a window back from past the left and top edges', () => {
    expect(containToWorkArea(-50, -50, { width: 200, height: 160 })).toEqual({ x: 0, y: 0 })
  })

  it('pins a window LARGER than the work area to the top-left', () => {
    // The case the old clamp got backwards. With an oversized window the
    // maximum origin lands LEFT of the minimum, and `Math.min(max, Math.max(min,
    // v))` then returns the maximum -- a negative origin, further off screen
    // than the value it was asked to correct. The function did the opposite of
    // its name on the one input where it mattered most.
    const at = containToWorkArea(0, 0, { width: 2000, height: 1200 })
    expect(at).toEqual({ x: workArea.x, y: workArea.y })

    // ...from any starting point, including one already off-screen.
    expect(containToWorkArea(-500, -400, { width: 2000, height: 1200 })).toEqual({ x: 0, y: 0 })
    expect(containToWorkArea(3000, 3000, { width: 2000, height: 1200 })).toEqual({ x: 0, y: 0 })
  })

  it('handles a window exactly the size of the work area', () => {
    expect(containToWorkArea(37, 37, { width: 1440, height: 900 })).toEqual({ x: 0, y: 0 })
  })
})

describe('clamp', () => {
  it('is the plain three-argument clamp the rest of the module builds on', () => {
    expect(clamp(5, 0, 10)).toBe(5)
    expect(clamp(-5, 0, 10)).toBe(0)
    expect(clamp(50, 0, 10)).toBe(10)
  })
})
