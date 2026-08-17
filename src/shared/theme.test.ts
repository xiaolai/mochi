import { describe, expect, it } from 'vitest'
import { MOCHI, parseFaceSpec } from './avatar-spec'
import {
  DEFAULT_THEME,
  MOSS_BASE,
  THEME_IDS,
  applyTheme,
  derivePalette,
  isCustomTheme,
  isTheme,
  isThemeId,
  paletteFor,
} from './theme'
import {
  AA_BODY,
  contrast,
  contrastFailures,
  parseHex,
  readableInk,
  shade,
} from '../renderer/design/accent'

const rgb = (hex: string) => {
  const parsed = parseHex(hex)
  expect(parsed, `${hex} is not a colour`).not.toBeNull()
  return parsed!
}

describe('the derivation', () => {
  it('reproduces her own palette from her own base colour', () => {
    // The claim the whole module rests on: a theme is one colour and the rest
    // follows. If the rule no longer produces her shadow and ink from her body,
    // then it is not the rule her palette was built with, and every other theme
    // is guessing.
    //
    // This assertion USED to be a body-to-shadow contrast on `mint` under 1.3,
    // which is a different claim entirely: any two colours five lightness
    // points apart satisfy it, her measured values were never read, and the
    // comment above it promised a comparison that no line performed. What the
    // header claims is a ratio of about 1.03 between derived and measured, so
    // that is what is asserted -- on both derived fields, against her artwork.
    const derived = derivePalette(MOSS_BASE)
    expect(contrast(rgb(derived.colBody), rgb(MOCHI.colBody)), 'body').toBeLessThan(1.05)
    expect(contrast(rgb(derived.colShadow), rgb(MOCHI.colShadow)), 'shadow').toBeLessThan(1.05)
    expect(contrast(rgb(derived.colInk), rgb(MOCHI.colInk)), 'ink').toBeLessThan(1.05)

    // Her shipped values are untouched by any of this.
    expect(paletteFor('moss').colBody).toBe(MOCHI.colBody)
    expect(paletteFor('moss').colShadow).toBe(MOCHI.colShadow)
    expect(paletteFor('moss').colInk).toBe(MOCHI.colInk)
  })

  it('keeps every theme in the same family as she is', () => {
    // Her ink sits at 5.46 on her body. A theme whose ink is far from that
    // reads as a different drawing rather than the same mochi in another
    // colour, which is the entire point of deriving instead of hand-picking.
    const hers = contrast(rgb(MOCHI.colInk), rgb(MOCHI.colBody))
    for (const id of THEME_IDS) {
      const palette = paletteFor(id)
      const ratio = contrast(rgb(palette.colInk), rgb(palette.colBody))
      expect(Math.abs(ratio - hers), `${id} ink-on-body ${ratio.toFixed(2)}`).toBeLessThan(1)
    }
  })

  it('makes a face that the format accepts', () => {
    // A theme reaches the renderer as a `FaceSpec`, so every palette has to
    // survive the same validation a user's avatar file does — hex only, and
    // every colour field present.
    for (const id of THEME_IDS) {
      const result = parseFaceSpec(applyTheme(MOCHI, id))
      expect(result.ok, `${id}: ${result.ok ? '' : result.problems.join('; ')}`).toBe(true)
    }
  })

  it('changes colour and nothing else', () => {
    // Shape is what a running app must not have swapped underneath it, and it
    // is why a theme can be applied live while the avatars folder is still read
    // once at startup. If `applyTheme` ever touched geometry, that argument
    // would quietly stop being true.
    const themed = applyTheme(MOCHI, 'lilac')
    for (const key of Object.keys(MOCHI) as (keyof typeof MOCHI)[]) {
      if (key.startsWith('col')) continue
      expect(themed[key], key).toBe(MOCHI[key])
    }
  })
})

describe('every theme gives the interface a legible accent', () => {
  /**
   * The design asks for each palette "with the interface accent it derives and
   * the measured contrast ratio". This is that, enforced rather than
   * documented: the accent, the wash and her-colour-as-text are all computed
   * from `colBody` at runtime, so shipping a theme is shipping an interface,
   * and a pretty colour that makes a link unreadable is a defect the picker
   * would otherwise hand to the user.
   */
  const PAPER = { light: '#f4f1ea', dark: '#1a1b14' } as const

  it('clears AA on every surface it lands on, in both schemes', () => {
    const failures: string[] = []
    for (const id of THEME_IDS) {
      const palette = paletteFor(id)
      const body = rgb(palette.colBody)
      const ink = rgb(palette.colInk)

      // Exactly what `accentVariables` derives. Restated here rather than
      // imported so this fails if the derivation changes shape without anyone
      // re-checking the themes against it.
      const checks: readonly [string, number][] = [
        ['label on her fill', contrast(readableInk(body), body)],
        ['her ink on light paper', contrast(ink, rgb(PAPER.light))],
        ['her ink on her light wash', contrast(ink, shade(body, 0.82))],
        ['light ink on dark paper', contrast(shade(body, 0.25), rgb(PAPER.dark))],
        ['light ink on her dark wash', contrast(shade(body, 0.25), shade(body, -0.68))],
      ]
      for (const [what, ratio] of checks) {
        if (ratio < AA_BODY) failures.push(`${id}: ${what} = ${ratio.toFixed(2)}`)
      }
    }
    expect(failures, failures.join('\n')).toEqual([])
  })
})

describe('choosing one', () => {
  it('recognises the ids it ships and refuses anything else', () => {
    for (const id of THEME_IDS) expect(isThemeId(id), id).toBe(true)
    for (const bad of ['', 'MOSS', 'green', null, 7, {}]) {
      expect(isThemeId(bad), JSON.stringify(bad)).toBe(false)
    }
  })

  it('defaults to hers', () => {
    expect(DEFAULT_THEME).toBe('moss')
    expect(paletteFor(DEFAULT_THEME).colBody).toBe(MOCHI.colBody)
  })

  it('has a distinct colour for every id', () => {
    // Two themes that look the same are one theme and a mistake.
    const bodies = THEME_IDS.map((id) => paletteFor(id).colBody)
    expect(new Set(bodies).size).toBe(THEME_IDS.length)
  })
})

describe('a hue a package chose', () => {
  it('derives its palette exactly as the named themes do', () => {
    // The point: a custom colour must not look like it came from a different
    // app. Same rule -- shadow five points darker, ink at hue+12 -- applied to
    // both, so nothing about a package's colour is special-cased.
    const custom = paletteFor({ hue: 203 })
    const named = paletteFor('sky')
    // `sky` is hue 203 at s .38; the custom band is .36, so these are close
    // rather than equal -- what matters is that both went through one path.
    expect(custom.colCheek).toBe(named.colCheek)
    expect(custom.colGlint).toBe(named.colGlint)
    for (const key of ['colBody', 'colShadow', 'colInk'] as const) {
      expect(custom[key], key).toMatch(/^#[0-9a-f]{6}$/)
    }
  })

  it('refuses anything that is not a whole hue in range', () => {
    for (const value of [{ hue: -1 }, { hue: 360 }, { hue: 203.5 }, { hue: '203' }, {}, null, []]) {
      expect(isTheme(value), JSON.stringify(value)).toBe(false)
    }
  })

  it('refuses a hue carrying settings the format does not have', () => {
    // Accepted before, and silently ignored: a package author who wrote
    // `saturation` got a theme that was not the one their manifest asked for,
    // with nothing anywhere saying so. Rejecting the object is what makes the
    // mistake visible -- `parsePersona` reports it.
    expect(isCustomTheme({ hue: 20, saturation: 1 })).toBe(false)
    expect(isTheme({ hue: 20, saturation: 1 })).toBe(false)
  })

  it('refuses a hue it only inherited', () => {
    // `'hue' in value` was true for this and the value came back from the
    // prototype, so an object with no colour of its own carried one.
    expect(isCustomTheme(Object.create({ hue: 20 }) as unknown)).toBe(false)
  })

  it('names an unusable theme instead of crashing inside the derivation', () => {
    // `{ hue: 360 }` is assignable to `CustomTheme` -- TypeScript cannot stop a
    // manifest producing it -- and `isCustomTheme` rejects it, so it used to
    // fall through to the named-theme branch, miss the table, and throw
    // `Cannot destructure property 'h' of 'undefined'` with nothing naming the
    // cause.
    expect(() => paletteFor({ hue: 360 })).toThrow(/not a theme/)
    expect(() => paletteFor('emerald' as never)).toThrow(/not a theme/)
  })

  it('accepts both ends of the wheel', () => {
    for (const hue of [0, 359, 180]) {
      expect(isTheme({ hue })).toBe(true)
    }
  })

  it('is readable at every hue on the wheel, which is why nothing checks at load', () => {
    // This assertion replaced a runtime scan. The scan was written first, and
    // an assertion guarding it -- "some hue must fail, or the check proves
    // nothing" -- showed that none does: with S and L fixed, all 360 clear AA.
    //
    // So the readability is a property of the FORMAT, not something to verify
    // per package. Widen `CUSTOM_SL` and this goes red, which is the moment a
    // load-time check would start being worth its weight.
    for (let hue = 0; hue < 360; hue += 1) {
      expect(contrastFailures(applyTheme(MOCHI, { hue })), String(hue)).toEqual([])
    }
  })
})
