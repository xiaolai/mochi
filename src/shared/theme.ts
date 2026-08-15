/**
 * Her colour, as a small set of choices rather than sixty hex values.
 *
 * ## Derived, not hand-picked
 *
 * A theme is ONE base colour. Everything else follows from it, because her
 * palette is not five independent decisions — it is a body colour, the same
 * colour slightly darker for the shading band, and the same hue much darker for
 * the ink. Measured off her:
 *
 *   body    H147  S35%  L67%
 *   shadow  H146  S33%  L62%   — same hue, five points darker
 *   ink     H159  S32%  L21%   — hue nudged warm, and far darker
 *
 * So the rule is: shadow is L−5, ink is hue+12 at L21. Applied back to her own
 * base it reproduces `#7dc09b` and `#23483b` against her actual `#7dbd99` and
 * `#24463a` — a contrast ratio of 1.03 between derived and real, which is
 * invisible. `theme.test.ts` asserts that, because a derivation that has
 * drifted from the thing it was derived from is worth catching.
 *
 * Darkening happens in HSL, NOT by lerping toward black. `shade()` toward black
 * desaturates: it turns her shadow into `#83b89b`, a greyer green than the one
 * she has. Every theme built that way would look muddier than she does, which
 * is precisely the "looks arbitrary" failure a palette set exists to avoid.
 *
 * ## What is not derived
 *
 * The cheek is a fixed warm coral on every theme, and the catchlight is white.
 * A blush is warm regardless of what it sits on — that is what makes it read as
 * a blush — and at `cheekAlpha` it is a tint rather than a mark, measuring 1.23
 * against her body. It is deliberately near-invisible; deriving it from the
 * body hue would make it invisible in a different way.
 *
 * ## Her own theme is exact, not derived
 *
 * `moss` carries her real palette rather than the derivation of it. Her values
 * were measured against `rig/__fixtures__/mochi-icon.png` and the silhouette test checks
 * the shading against that artwork; shifting her shadow by three units to make
 * the code tidier would change the shipped avatar to no one's benefit.
 */

import type { FaceSpec } from './avatar-spec'

export const THEME_IDS = [
  'moss',
  'sky',
  'mint',
  'sand',
  'clay',
  'blossom',
  'lilac',
  'slate',
] as const
export type ThemeId = (typeof THEME_IDS)[number]

export const DEFAULT_THEME: ThemeId = 'moss'

/**
 * Her colour in words, for the system prompt.
 *
 * The default persona's style used to open with "a small green mochi", which
 * stopped being true the moment somebody picked sky or lilac -- and nothing
 * could fix it without rewriting text the user owns. Derived here instead, so
 * the prompt and the pixels come from the same value.
 *
 * Plain adjectives rather than the theme ids: `moss` and `blossom` are names
 * this project chose, and the model has no reason to know them.
 */
export const THEME_WORDS: Readonly<Record<ThemeId, string>> = {
  moss: 'soft green',
  sky: 'pale blue',
  mint: 'light mint green',
  sand: 'warm sand',
  clay: 'terracotta',
  blossom: 'blossom pink',
  lilac: 'soft lilac',
  slate: 'cool grey',
}

/** The five colour fields a theme decides. */
export type Palette = Pick<FaceSpec, 'colBody' | 'colShadow' | 'colInk' | 'colCheek' | 'colGlint'>

/** A blush is warm whatever it sits on. Not derived — see the header. */
const CHEEK = '#ef8f86'
const GLINT = '#ffffff'

interface Hsl {
  readonly h: number
  readonly s: number
  readonly l: number
}

const SOURCE: Readonly<Record<ThemeId, Hsl>> = {
  moss: { h: 147, s: 0.35, l: 0.67 },
  sky: { h: 203, s: 0.38, l: 0.67 },
  mint: { h: 171, s: 0.34, l: 0.67 },
  sand: { h: 44, s: 0.42, l: 0.67 },
  clay: { h: 21, s: 0.45, l: 0.67 },
  blossom: { h: 332, s: 0.42, l: 0.67 },
  lilac: { h: 268, s: 0.32, l: 0.67 },
  slate: { h: 215, s: 0.16, l: 0.67 },
}

/**
 * Her measured palette, kept verbatim.
 *
 * The one theme that is not computed, for the reason in the header: these
 * numbers came off the icon artwork.
 */
const MEASURED: Palette = {
  colBody: '#8ec8a8',
  colShadow: '#7dbd99',
  colInk: '#24463a',
  colCheek: CHEEK,
  colGlint: GLINT,
}

function hex({ h, s, l }: Hsl): string {
  const hue = ((h % 360) + 360) % 360
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1))
  const m = l - c / 2
  // A table, not a six-deep ternary. The wheel has six sectors and each one
  // permutes (c, x, 0) differently; written as nested conditionals the pattern
  // is invisible and a transposed pair reads as plausible. The index is the
  // sector, and the rows are the permutation.
  const SECTORS: readonly (readonly [number, number, number])[] = [
    [c, x, 0], // 0-60    red -> yellow
    [x, c, 0], // 60-120  yellow -> green
    [0, c, x], // 120-180 green -> cyan
    [0, x, c], // 180-240 cyan -> blue
    [x, 0, c], // 240-300 blue -> magenta
    [c, 0, x], // 300-360 magenta -> red
  ]
  const [r, g, b] = SECTORS[Math.min(5, Math.floor(hue / 60))] ?? [0, 0, 0]
  const byte = (value: number): string =>
    Math.round((value + m) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${byte(r)}${byte(g)}${byte(b)}`
}

/** The five colours of a theme, named or chosen. */
export function paletteFor(theme: Theme): Palette {
  if (isCustomTheme(theme)) return fromHsl({ h: theme.hue, ...CUSTOM_SL })
  const id = theme
  // A COPY. Returning the module's own object handed every caller the same
  // mutable reference, so one caller writing to the palette it was given would
  // have changed her colours everywhere, permanently, for the rest of the
  // session -- and the other four themes return fresh objects, so the bug would
  // have existed for exactly one theme.
  if (id === 'moss') return { ...MEASURED }
  return fromHsl(SOURCE[id])
}

/**
 * The derivation, in one place.
 *
 * The rule: shadow is the same hue five points darker, ink is the hue
 * plus twelve at lightness 0.21. Applied identically to the eight named themes
 * and to a hue a package chose, so a custom colour cannot look like it came
 * from a different app.
 *
 * Darkened in HSL, never toward black. Interpolating to black loses
 * saturation, which makes every derived theme muddier than she is -- and
 * "looks like it was thrown together" is the one thing a palette must not.
 */
function fromHsl(base: Hsl): Palette {
  return {
    colBody: hex(base),
    colShadow: hex({ ...base, l: base.l - 0.05 }),
    colInk: hex({ h: base.h + 12, s: base.s, l: 0.21 }),
    colCheek: CHEEK,
    colGlint: GLINT,
  }
}

/**
 * A colour a package chose for itself, rather than one of the eight.
 *
 * A HUE only. Saturation and lightness are the SAME for every named theme
 * (0.67 lightness throughout, saturation within a narrow band), because they
 * are what make her look like herself rather than like a swatch -- letting a
 * package set them would let it ship a mochi that is fluorescent, or one so
 * pale her shadow disappears. The hue is the part that is genuinely a choice.
 */
export interface CustomTheme {
  /** Degrees on the wheel, 0-359. */
  readonly hue: number
}

export type Theme = ThemeId | CustomTheme

/**
 * The saturation and lightness every persona shares. See `CustomTheme`.
 *
 * These two numbers are what make a package's colour SAFE BY CONSTRUCTION
 * rather than safe by inspection. A load-time contrast check was written for
 * this and then deleted: with S and L fixed, every one of the 360 hues clears
 * AA on every pairing, so the check could not reject anything it was given.
 * A guard that cannot fire is ceremony, and ceremony is what people trust
 * instead of the thing that actually holds.
 *
 * The guarantee is a TEST that sweeps the whole wheel -- the same treatment
 * The eight named themes come from this band. Widen it and it goes red,
 * which is the moment a runtime check would become worth having.
 */
const CUSTOM_SL = { s: 0.36, l: 0.67 } as const

export function isCustomTheme(value: unknown): value is CustomTheme {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const hue = (value as Record<string, unknown>)['hue']
  // A WHOLE number in range. 359.5 is not a hue somebody chose, it is a hue
  // something computed, and accepting it means two packages can differ by an
  // amount no eye can see while comparing unequal.
  return typeof hue === 'number' && Number.isInteger(hue) && hue >= 0 && hue <= 359
}

export function isTheme(value: unknown): value is Theme {
  return isThemeId(value) || isCustomTheme(value)
}

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && (THEME_IDS as readonly string[]).includes(value)
}

/**
 * Recolour a face without touching its geometry.
 *
 * A theme changes what she is coloured, never what she is shaped like — so an
 * avatar somebody designed in the tuner keeps its proportions and takes the
 * chosen colours. That separation is why a theme can be applied live while the
 * avatars FOLDER is still read once at startup: the shape is what a running app
 * must not have swapped underneath it.
 */
export function applyTheme(face: FaceSpec, theme: Theme): FaceSpec {
  return { ...face, ...paletteFor(theme) }
}

/**
 * Her colour in words, for a theme a package chose.
 *
 * The eight named ones have adjectives somebody wrote. A hue does not, so it
 * is named by the sector it falls in -- coarse on purpose: the prompt needs
 * her to know roughly what colour she is, and "hue two hundred and three"
 * would be a number read aloud by a companion.
 */
export function themeWords(theme: Theme): string {
  if (!isCustomTheme(theme)) return THEME_WORDS[theme]
  const SECTORS: readonly (readonly [number, string])[] = [
    [15, 'red'],
    [45, 'orange'],
    [70, 'yellow'],
    [160, 'green'],
    [200, 'teal'],
    [260, 'blue'],
    [290, 'violet'],
    [335, 'pink'],
    [360, 'red'],
  ]
  const found = SECTORS.find(([upTo]) => theme.hue < upTo)
  return `soft ${found?.[1] ?? 'green'}`
}
