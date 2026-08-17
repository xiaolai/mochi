import { describe, expect, it } from 'vitest'
import { FACE_BOUNDS, MOCHI, parseFaceSpec, type FaceSpec } from '@shared/avatar-spec'
import { accentVariables, contrast, luminance, parseHex, readableInk, shade, toHex } from './accent'

const white = { r: 255, g: 255, b: 255 }
const black = { r: 0, g: 0, b: 0 }

describe('parseHex', () => {
  it('reads every form the avatar format allows', () => {
    // The same four shapes `parseFaceSpec` accepts. A colour that validates on
    // load and then fails to parse here would leave the window unstyled with
    // nothing in the log.
    expect(parseHex('#8ec8a8')).toEqual({ r: 142, g: 200, b: 168 })
    expect(parseHex('#fff')).toEqual(white)
    expect(parseHex('#ffff')).toEqual(white)
    expect(parseHex('#8ec8a8ff')).toEqual({ r: 142, g: 200, b: 168 })
  })

  it('returns null rather than a wrong colour', () => {
    for (const bad of ['', '#', 'red', '#gg0000', '#12345']) {
      expect(parseHex(bad), bad).toBeNull()
    }
  })

  it('requires the `#`, exactly as the avatar format does', () => {
    // This parser used to strip an optional `#` and accept the rest, making it
    // more permissive than `parseFaceSpec`. A face built in code could then
    // carry a colour the on-disk validator would reject, and it would paint
    // rather than fall back -- two definitions of "a colour" in one app.
    for (const bare of ['8ec8a8', 'fff', '8ec8a8ff']) {
      expect(parseFaceSpec({ ...MOCHI, colBody: bare }).ok, bare).toBe(false)
      expect(parseHex(bare), bare).toBeNull()
    }
  })
})

describe('luminance and contrast', () => {
  it('matches the WCAG reference points', () => {
    expect(luminance(white)).toBeCloseTo(1, 5)
    expect(luminance(black)).toBeCloseTo(0, 5)
    expect(contrast(white, black)).toBeCloseTo(21, 2)
  })

  it('applies gamma expansion rather than averaging channels', () => {
    // The whole reason the expansion is there. A plain channel average puts
    // pure green at 0.33; perceptually it is more than twice that, and her
    // entire body is green -- so an averaging implementation would pick the
    // wrong ink for exactly this app.
    expect(luminance({ r: 0, g: 255, b: 0 })).toBeGreaterThan(0.6)
  })
})

describe('readableInk', () => {
  it('gives her own green a legible ink', () => {
    // The defect this function exists to prevent: the first settings sheet used
    // AccentColorText, which is white, on a button filled with her colour --
    // about 1.8:1, which is unreadable.
    const her = parseHex(MOCHI.colBody)
    expect(her).not.toBeNull()
    if (her === null) return
    expect(contrast(her, white)).toBeLessThan(3)
    expect(contrast(her, readableInk(her))).toBeGreaterThan(4.5)
  })

  it('clears WCAG AA on any colour the avatar format permits', () => {
    // Swept rather than spot-checked. A user designs this colour in the tuner,
    // and the bounds allow any hex at all -- so "the accent is readable" has to
    // hold across the whole space, not just for the shipped green.
    let worst = { ratio: Number.POSITIVE_INFINITY, colour: '' }
    for (let r = 0; r <= 255; r += 15) {
      for (let g = 0; g <= 255; g += 15) {
        for (let b = 0; b <= 255; b += 15) {
          const colour = { r, g, b }
          const ratio = contrast(colour, readableInk(colour))
          if (ratio < worst.ratio) worst = { ratio, colour: toHex(colour) }
        }
      }
    }
    // 4.5:1 is AA for body text. The worst case is a mid-grey, where neither
    // near-black nor near-white is comfortable; if this ever fails the answer
    // is a darker/lighter ink pair, not a lower threshold.
    expect(worst.ratio, `worst background ${worst.colour}`).toBeGreaterThan(4.5)
  })
})

describe('accentVariables', () => {
  it('derives every property the token sheet declares', () => {
    const vars = accentVariables(MOCHI)
    // Her fill and its label are one colour in both schemes; the two that are
    // read against the PAGE are `light-dark()` pairs. See accentVariables.
    for (const name of ['--her', '--her-hover', '--her-ink']) {
      expect(vars[name], name).toMatch(/^#[0-9a-f]{6}$/)
    }
    for (const name of ['--her-wash', '--ink-brand']) {
      expect(vars[name], name).toMatch(/^light-dark\(#[0-9a-f]{6}, #[0-9a-f]{6}\)$/)
    }
  })

  it('follows her when her palette is retuned', () => {
    // One graphical source. If somebody makes her pink, the buttons go pink --
    // the same guarantee the tray icon has, for the same reason.
    const pink: FaceSpec = { ...MOCHI, colBody: '#e79ab8' }
    expect(accentVariables(pink)['--her']).toBe('#e79ab8')
    expect(accentVariables(pink)['--her']).not.toBe(accentVariables(MOCHI)['--her'])
  })

  it('falls back instead of throwing on a colour it cannot read', () => {
    // `parseFaceSpec` guarantees hex today, so this is defence against a future
    // caller. An unstyled window is a worse outcome than a slightly wrong one.
    const broken = { ...MOCHI, colBody: 'not-a-colour' } as FaceSpec
    expect(accentVariables(broken)['--her']).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('falls back to HER green, not to a copy of it', () => {
    // The fallback was written out as literal channels, which is her palette
    // stated twice. Retuning `MOCHI.colBody` would have left the stale copy
    // behind with no test comparing the two -- this is that test.
    const broken = { ...MOCHI, colBody: 'not-a-colour' } as FaceSpec
    expect(accentVariables(broken)['--her']).toBe(MOCHI.colBody.toLowerCase())
  })
  it('keeps the hover shade distinct from the base', () => {
    // A hover state identical to the resting state is a hover state that does
    // not exist, and nothing else would notice.
    const vars = accentVariables(MOCHI)
    expect(vars['--her-hover']).not.toBe(vars['--her'])
  })

  it('is defined for the extremes of the colour bounds', () => {
    expect(FACE_BOUNDS.eyeGlint.min).toBe(0)
    for (const colour of ['#000000', '#ffffff']) {
      const vars = accentVariables({ ...MOCHI, colBody: colour })
      expect(vars['--her-ink']).toMatch(/^#[0-9a-f]{6}$/)
    }
  })
})

describe('shade', () => {
  const mid = { r: 128, g: 128, b: 128 }

  it('darkens on a negative amount and lightens on a positive one', () => {
    // The documented range said `0..1` while every darkening caller passed a
    // negative. The contract was wrong, not the callers.
    expect(shade(mid, -0.5).r).toBeLessThan(mid.r)
    expect(shade(mid, 0.5).r).toBeGreaterThan(mid.r)
    expect(shade(mid, 0)).toEqual(mid)
  })

  it('clamps beyond the ends rather than overshooting the channel range', () => {
    expect(toHex(shade(mid, -5))).toBe('#000000')
    expect(toHex(shade(mid, 5))).toBe('#ffffff')
  })
})
