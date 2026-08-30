import { describe, expect, it } from 'vitest'
import { FACE_BOUNDS, MOCHI, parseFaceSpec, type FaceSpec } from '@shared/avatar-spec'
import { THEME_IDS, paletteFor } from '@shared/theme'
import {
  accentVariables,
  contrast,
  contrastFailures,
  luminance,
  parseHex,
  shade,
  toHex,
} from './accent'

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

describe('accentVariables', () => {
  it('derives every property the token sheet declares', () => {
    const vars = accentVariables(MOCHI)
    // FOUR, down from eight. She is one colour whatever the OS is set to, so
    // none of them is a `light-dark()` pair any more: the two that were read
    // against the page went with the window's hue.
    for (const name of ['--her', '--her-deep', '--her-deep-ink']) {
      expect(vars[name], name).toMatch(/^#[0-9a-f]{6}$/)
    }
    // Her colour as a film, for the halo's interior. Alpha, so neither shape.
    expect(vars['--her-veil'], '--her-veil').toMatch(/^rgb\(\d+ \d+ \d+ \/ \d+%\)$/)
    // And nothing else: a property written onto the document that no sheet
    // declares and nothing reads is a producer with no consumer.
    expect(Object.keys(vars).sort()).toEqual([
      '--her',
      '--her-deep',
      '--her-deep-ink',
      '--her-veil',
    ])
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
  it('is defined for the extremes of the colour bounds', () => {
    expect(FACE_BOUNDS.eyeGlint.min).toBe(0)
    for (const colour of ['#000000', '#ffffff']) {
      const vars = accentVariables({ ...MOCHI, colBody: colour })
      expect(vars['--her-deep']).toMatch(/^#[0-9a-f]{6}$/)
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

describe('white on her colour, which is the pairing the palette added', () => {
  /**
   * The fourth check, and the only one where she is the SURFACE.
   *
   * The three before it ask whether her colour is readable AS TEXT. The palette
   * now puts white text ON her — the open tab, the button that commits, a
   * checked box — which is the reversal `accent.ts` documents in one place. A
   * persona could satisfy every other pairing and still ship an open tab nobody
   * can read, and nothing would have said so.
   */
  it('passes the built-in, whose moss is the worst of the eight at 5.64:1', () => {
    expect(contrastFailures(MOCHI)).toEqual([])
  })

  it('refuses a face whose own features vanish into its body', () => {
    // The pairing that survives v2. Her ink draws her eyes and her mouth, so a
    // face that fails this is a character with no expression at all — which is
    // worse than an unreadable label, and the only thing left for this check to
    // be about now that her colour has been taken out of the chrome.
    const faceless = { ...MOCHI, colBody: '#f7f3a0', colInk: '#efe89a', colShade: '#e2dd8a' }
    expect(contrastFailures(faceless).join(' ')).toContain('her features on her body')
  })

  it('is what the eight-theme sweep now covers too', () => {
    // The sweep above runs `contrastFailures` per theme, so adding a pairing
    // there adds it everywhere. This asserts the coupling rather than assuming
    // it — a fifth pairing added to the function and not to the sweep would be
    // a check that only ever ran on strangers.
    for (const theme of THEME_IDS) {
      expect(contrastFailures({ ...MOCHI, ...paletteFor(theme) })).toEqual([])
    }
  })
})
