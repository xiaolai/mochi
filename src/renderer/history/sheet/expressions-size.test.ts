import { describe, expect, it } from 'vitest'
import { MOCHI } from '@shared/avatar-spec'
import { layoutFor } from '@shared/avatar-layout'
import { drawnHeight } from './expressions'

/**
 * A2c's only claim is that each expression is drawn at the size she appears on
 * the desktop, so the number handed to `faceTile` has to be a PIXEL HEIGHT.
 *
 * `Persona.size` is a percentage — the A1 slider writes `clampSizePercent` — and
 * it was passed straight through, so 100 meant "100% of her base size" to one
 * side of the call and "100 pixels" to the other.
 */
describe('the size a face tile is drawn at', () => {
  const her = (size: number | null) => ({ face: MOCHI, size })

  it('is a pixel height, not the percentage that was passed in', () => {
    // The defect in one line: if these were equal the units would be conflated.
    expect(drawnHeight(her(100))).not.toBe(100)
    expect(drawnHeight(her(100))).toBe(layoutFor(MOCHI, 100).height)
  })

  it('tracks the setting the way her window does', () => {
    // Half the size is half the height, so the tiles stay honest at either end
    // of the slider — 60% was 60px against a real 71 before this.
    const full = drawnHeight(her(100))
    expect(drawnHeight(her(50))).toBeCloseTo(full / 2, 0)
    expect(drawnHeight(her(200))).toBeCloseTo(full * 2, 0)
  })

  it('falls back to a real height when she has no face of her own', () => {
    // The tile is a dashed placeholder then and nothing is drawn in it, but the
    // box still has to be the size the others are or the grid steps.
    expect(drawnHeight({ face: undefined, size: null })).toBe(drawnHeight(her(100)))
  })
})
