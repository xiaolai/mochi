import { describe, expect, it } from 'vitest'

import { fullPad, layoutFor } from '@shared/avatar-layout'
import { MOCHI, type FaceSpec } from '@shared/avatar-spec'
import { bodyOf, boxFor, padFor } from './her-geometry'

/**
 * AUDIT FINDING: this module had no test at all.
 *
 * `.claude/loc-guardian.local.md` says of the `face.ts` split that *"everything
 * that was a DECISION has been taken out and given a test"*, naming
 * `her-geometry.ts`, `screen-room.ts` and `pad-change.ts`. Only the third had
 * one. The other two were extracted **for** testability, from a closure that
 * resolves a palette off `document` at load and therefore cannot be imported —
 * so the extraction paid its whole cost and collected none of its benefit.
 *
 * This file's own header says where the expensive mistakes have been: *"the
 * horizontal symmetry rule below was wrong by 12px once and took three other
 * rectangles with it, because everything in that file believed what it said."*
 * That is precisely the failure a test catches and a reader does not.
 */

/**
 * The shipped face, at a given size.
 *
 * `size` is a PERCENT, not a multiplier — `layoutFor(MOCHI, 100)` is her
 * default. A first draft of this file passed `1` and got `NaN` all the way
 * through, which is its own small argument for the module having had a test.
 */
function face(size = 100): FaceSpec {
  return { ...MOCHI, size }
}

describe('her body out of a layout', () => {
  it('takes the BODY dimensions, not the window ones', () => {
    /*
      The trap this function exists for, stated by its own comment:
      `fullPad(layout)` typechecks, because the shapes are structurally
      identical, and silently passes the WINDOW's 980x560 as her body — which
      yields a negative `top` that main's validator refuses, so the window
      never resizes and nothing says why.
    */
    const layout = layoutFor(face(), 1)
    expect(bodyOf(layout)).toEqual({ width: layout.bodyWidth, height: layout.bodyHeight })
    // And it is NOT the window's own width/height, which sit on the same object.
    expect(bodyOf(layout).width).not.toBe(layout.width)
  })
})

describe('how much room she needs', () => {
  it('reserves the full pad while words are showing', () => {
    const worn = face()
    const body = bodyOf(layoutFor(worn, worn.size))
    expect(padFor(worn, true, 1)).toEqual(fullPad(body))
  })

  it('keeps the full pad while the bubble is still FADING', () => {
    // Shrinking on the frame the text is cleared would clip the last 0.35s of
    // the bubble going away — which is why the condition is opacity, not text.
    const worn = face()
    const body = bodyOf(layoutFor(worn, worn.size))
    expect(padFor(worn, true, 0.01)).toEqual(fullPad(body))
  })

  it('releases it once the bubble has finished fading', () => {
    const worn = face()
    const full = fullPad(bodyOf(layoutFor(worn, worn.size)))
    const quiet = padFor(worn, true, 0)
    expect(quiet).not.toEqual(full)
  })

  it('reserves room above her for the halo and the chip even when silent', () => {
    // The halo is narrower than she is so it never widens her window, but it
    // sits ABOVE her head and that room is reserved here rather than assumed
    // to fit inside what the chip already needs.
    const worn = face()
    expect(padFor(worn, false, 0).top).toBeGreaterThan(0)
  })

  it('is symmetric left and right', () => {
    /*
      THE RULE THAT WAS WRONG BY 12px.

      Her window is centred on her, so the room reserved on each side has to
      match — and when it did not, three other rectangles inherited the error
      because everything in the file believed what it said.
    */
    for (const size of [50, 100, 150, 200]) {
      const pad = padFor(face(size), false, 0)
      expect(pad.left, `asymmetric at size ${String(size)}`).toBe(pad.right)
    }
  })

  it('reserves the same room BESIDE her whatever size she is', () => {
    /*
      Measured, not assumed. A first draft of this test asserted the pad grows
      with her, which is wrong and is the more intuitive guess: the room beside
      her is for the CHIP and the HALO, and both are fixed-size controls. Only
      what is under her feet scales.
    */
    expect(padFor(face(50), false, 0).left).toBe(padFor(face(200), false, 0).left)
    expect(padFor(face(50), false, 0).top).toBe(padFor(face(200), false, 0).top)
  })

  it('gives her more room UNDER her as she grows', () => {
    expect(padFor(face(200), false, 0).bottom).toBeGreaterThan(padFor(face(50), false, 0).bottom)
  })

  it('leaves the bubble LESS room as she grows, not more', () => {
    /*
      The direction that surprises, and the one worth pinning.

      Her window is a fixed size, so the bigger she is the less of it is left
      for words beside her. A change that made this grow would be someone
      "fixing" it toward the intuitive answer and quietly pushing the bubble
      off her own window.
    */
    expect(padFor(face(200), true, 1).left).toBeLessThan(padFor(face(50), true, 1).left)
  })

  it('stops growing at the largest size the layout allows', () => {
    // 200 and 400 give identical answers: `layoutFor` clamps. Asserted so the
    // clamp cannot quietly disappear and let an absurd size size the window.
    expect(padFor(face(400), false, 0)).toEqual(padFor(face(200), false, 0))
  })

  it('never reserves a negative amount', () => {
    // A negative pad is what main's validator refuses, and the symptom is a
    // window that silently never resizes.
    for (const size of [50, 100, 300]) {
      for (const showing of [true, false]) {
        const pad = padFor(face(size), showing, showing ? 1 : 0)
        for (const [edge, value] of Object.entries(pad)) {
          expect(value, `${edge} at size ${String(size)}`).toBeGreaterThanOrEqual(0)
        }
      }
    }
  })
})

describe('where she stands inside that room', () => {
  it('puts her at the pad`s own offsets', () => {
    // Her offset inside her own window IS the room reserved to her left and
    // above her, because that is what the pad means.
    const worn = face()
    const pad = padFor(worn, false, 0)
    const box = boxFor(worn, pad, 0, false)
    expect(box.left).toBe(pad.left)
    expect(box.top).toBe(pad.top)
  })

  it('gives her a body the size of her body', () => {
    const worn = face()
    const layout = layoutFor(worn, worn.size)
    const box = boxFor(worn, padFor(worn, false, 0), 0, false)
    expect(box.width).toBe(layout.bodyWidth)
    expect(box.height).toBe(layout.bodyHeight)
  })

  it('never places her outside her own window', () => {
    for (const size of [50, 100, 200]) {
      const worn = face(size)
      const pad = padFor(worn, true, 1)
      const box = boxFor(worn, pad, 0, true)
      expect(box.left).toBeGreaterThanOrEqual(0)
      expect(box.top).toBeGreaterThanOrEqual(0)
    }
  })
})
