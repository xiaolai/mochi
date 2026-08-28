import { describe, expect, it } from 'vitest'
import { FACE_BOUNDS } from '@shared/avatar-spec'
import { stepFor } from './size'

/**
 * A size the control cannot represent, presented as the setting.
 *
 * `FACE_BOUNDS.size.step` is documented as "Granularity a slider should offer.
 * Not enforced -- a spec may be finer", so a face is entitled to declare 52 and
 * one does not have to be hand-written for that to happen.
 *
 * Assigning 52 to a `step: 5` range input does not fail. The browser SANITISES
 * it to the nearest valid step and the control silently holds 50 — and the
 * reading was built from the stored number rather than from the control, so the
 * pane said "52%" over a slider sitting at 50. The first drag would then save a
 * number nobody chose.
 */
describe('the step a size control offers', () => {
  const BAND = FACE_BOUNDS.size

  it('is the grid for a value on it', () => {
    for (const on of [BAND.min, BAND.min + BAND.step, 100, BAND.max]) {
      expect(stepFor(on), String(on)).toBe(String(BAND.step))
    }
  })

  it('stands the grid down for a value that is not on it', () => {
    // 52 is in the band and is not a multiple of 5 from the minimum.
    expect(stepFor(52)).toBe('any')
    expect(stepFor(100.5)).toBe('any')
  })

  it('measures the grid from the MINIMUM, not from zero', () => {
    /*
      The off-by-one that a lazier check has. `min` is 50 and `step` is 5, so
      the grid happens to line up with multiples of 5 either way — but it does
      not have to, and a rule written as `value % step === 0` would be right by
      coincidence here and wrong the moment either number changes.
    */
    expect(stepFor(7, { min: 5, step: 2 })).toBe(String(2))
    expect(stepFor(8, { min: 5, step: 2 })).toBe('any')
  })
})
