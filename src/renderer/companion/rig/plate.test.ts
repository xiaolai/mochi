import { describe, expect, it } from 'vitest'
import { MOCHI } from '@shared/avatar-spec'
import { ICON_SET } from './icons'
import { mochiSvg, type Treatment } from './svg'

/**
 * The plate she sits on, and whether it is where the docblock says it is.
 *
 * `plateRect` promises a CENTRED plate. Coordinates in the emitted SVG are
 * integers, and `at = round((px - size) / 2)` with an odd remainder puts it
 * half a pixel off centre — margins that differ by one. At `px = 16`, where a
 * tray icon lives, one pixel of the sixteen is a visible lean.
 *
 * None of the committed assets happens to land on an odd remainder, which is
 * why nothing caught it and why the whole icon set is byte-identical after the
 * fix. Latent is not the same as absent: the sizes are a design decision that
 * changes, and this is what makes the next one safe.
 */
describe('where the plate sits inside the tile', () => {
  function plateOf(px: number, size: number): { x: number; y: number; side: number } {
    const treatment: Treatment = {
      ...ICON_SET[0]!.treatment,
      background: { from: '#000', to: '#fff', size, radius: 0 },
    }
    const svg = mochiSvg(MOCHI, px, treatment)
    const rect = /<rect x="(-?[\d.]+)" y="(-?[\d.]+)" width="([\d.]+)"/.exec(svg)
    if (rect === null) throw new Error('no plate was drawn')
    return { x: Number(rect[1]), y: Number(rect[2]), side: Number(rect[3]) }
  }

  it('has a plate to measure', () => {
    // Counted first: a regex that stopped matching would throw rather than pass
    // silently, but a full-bleed plate would make every margin trivially equal.
    const plate = plateOf(64, 0.8)
    expect(plate.side).toBeGreaterThan(0)
    expect(plate.side).toBeLessThan(64)
  })

  it('leaves the SAME margin on both sides, at every size', () => {
    /*
      Swept, because the failure depends on the parity of `px - size` and one
      fraction can be centred while its neighbour is not. `16 × 0.8` is the
      case from the finding: 13 inside 16, margins 2 and 1.
    */
    for (const px of [16, 32, 48, 64, 128, 1024]) {
      for (const size of [0.5, 0.62, 0.8, 0.83, 0.95, 1]) {
        const plate = plateOf(px, size)
        expect(plate.x, `px=${String(px)} size=${String(size)}`).toBe(px - plate.side - plate.x)
        expect(plate.y).toBe(plate.x)
      }
    }
  })

  it('never draws a plate wider than the tile', () => {
    // The parity correction only ever takes a pixel off, so this cannot grow —
    // and a version that rounded UP to fix the parity would overflow.
    for (const px of [16, 33]) {
      expect(plateOf(px, 1).side).toBeLessThanOrEqual(px)
    }
  })
})
