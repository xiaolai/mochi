import { describe, expect, it } from 'vitest'
import { FACE_BOUNDS, MOCHI, parseFaceSpec, type FaceSpec } from '@shared/avatar-spec'
import { THEME_IDS, paletteFor } from '@shared/theme'
import {
  AA_BODY,
  AA_MARK,
  accentVariables,
  contrast,
  contrastFailures,
  luminance,
  parseHex,
  readableAgainst,
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
    /*
      FOUR, down from eight — but two of them are pairs again, and the reason is
      not the window's hue coming back. `--her` and `--her-veil` are the halo,
      which is drawn over somebody's DESKTOP: her colour has to be dark enough
      to read on a white one and light enough on a black one, and no single
      value is both. The two that were dropped were read against the page, which
      no longer takes her colour at all.
    */
    for (const name of ['--her-deep', '--her-deep-ink']) {
      expect(vars[name], name).toMatch(/^#[0-9a-f]{6}$/)
    }
    expect(vars['--her'], '--her').toMatch(/^light-dark\(#[0-9a-f]{6}, #[0-9a-f]{6}\)$/)
    // Her colour as a film, at the two alphas the boards give the open ring.
    expect(vars['--her-veil'], '--her-veil').toMatch(
      /^light-dark\(rgb\(\d+ \d+ \d+ \/ 14%\), rgb\(\d+ \d+ \d+ \/ 22%\)\)$/,
    )
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
    /*
      A PAIR now, not a bare hex: the ring is her only sign that the microphone
      is open, so each half is taken to a floor against the surface it can land
      on. Her hue still has to survive the trip, which is what the second
      assertion is for — a floor that returned grey would satisfy the first.
    */
    expect(accentVariables(pink)['--her']).toMatch(/^light-dark\(#[0-9a-f]{6}, #[0-9a-f]{6}\)$/)
    expect(accentVariables(pink)['--her']).not.toBe(accentVariables(MOCHI)['--her'])
  })

  it('falls back instead of throwing on a colour it cannot read', () => {
    // `parseFaceSpec` guarantees hex today, so this is defence against a future
    // caller. An unstyled window is a worse outcome than a slightly wrong one.
    const broken = { ...MOCHI, colBody: 'not-a-colour' } as FaceSpec
    expect(accentVariables(broken)['--her']).toMatch(/^light-dark\(#[0-9a-f]{6}, #[0-9a-f]{6}\)$/)
  })

  it('falls back to HER green, not to a copy of it', () => {
    // The fallback was written out as literal channels, which is her palette
    // stated twice. Retuning `MOCHI.colBody` would have left the stale copy
    // behind with no test comparing the two -- this is that test.
    const broken = { ...MOCHI, colBody: 'not-a-colour' } as FaceSpec
    // HER green, taken to each floor — the fallback is her, not a grey that
    // happens to read.
    expect(accentVariables(broken)['--her']).toBe(accentVariables(MOCHI)['--her'])
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

describe('her colour, taken far enough to be a mark', () => {
  const WHITE = { r: 255, g: 255, b: 255 }
  const NEAR_BLACK = { r: 20, g: 26, b: 23 }

  it('rescues the built-in, which fails badly as drawn', () => {
    /*
      `#a5d8bd` is 1.60:1 on white. The halo is her only indicator that the
      microphone is open, and `halo.ts` opens by calling that the failure this
      repository most cannot get wrong — so this is a safety floor, not a
      preference. The delivery's own audit made it item A.
    */
    const base = { r: 165, g: 216, b: 189 }
    expect(contrast(base, WHITE)).toBeLessThan(3)
    expect(contrast(readableAgainst(base, WHITE, AA_BODY), WHITE)).toBeGreaterThanOrEqual(AA_BODY)
  })

  it('rescues a hue a fixed shade would not', () => {
    // `deep()` is one step of -0.42. A pale yellow is still pale after it, and
    // this is a colour somebody else chose — no table can have anticipated it.
    const pale = { r: 245, g: 230, b: 168 }
    expect(contrast(readableAgainst(pale, WHITE, AA_BODY), WHITE)).toBeGreaterThanOrEqual(AA_BODY)
  })

  it('leaves a colour that already reads alone', () => {
    // Darkening one that passes would spend her hue for nothing.
    const dark = { r: 47, g: 79, b: 62 }
    expect(readableAgainst(dark, WHITE, AA_BODY)).toEqual(dark)
  })

  it('goes the other way against a dark surface', () => {
    // The same colour has to be a mark on somebody's black wallpaper too, and
    // there the answer is lighter rather than darker.
    const murky = { r: 40, g: 52, b: 45 }
    const lifted = readableAgainst(murky, NEAR_BLACK, AA_MARK)
    expect(contrast(lifted, NEAR_BLACK)).toBeGreaterThanOrEqual(AA_MARK)
    expect(lifted.r).toBeGreaterThan(murky.r)
  })
})
