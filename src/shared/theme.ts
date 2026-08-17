/**
 * Her colour, as a small set of choices rather than sixty hex values.
 *
 * ## Derived, not hand-picked
 *
 * A theme is ONE base colour. Everything else follows from it, because her
 * palette is not five independent decisions — it is a body colour, the same
 * colour slightly darker for the shading band, and the same hue much darker for
 * the ink. The rule itself, and the measurements behind it, live beside
 * `derivePalette`; this header does not restate them, because four copies of that
 * rationale had already drifted into contradicting each other.
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

/** The five colour fields a theme decides. */
export type Palette = Pick<FaceSpec, 'colBody' | 'colShadow' | 'colInk' | 'colCheek' | 'colGlint'>

/** A blush is warm whatever it sits on. Not derived — see the header. */
const CHEEK = '#ef8f86'
const GLINT = '#ffffff'

export interface Hsl {
  readonly h: number
  readonly s: number
  readonly l: number
}

/**
 * The base colour of every theme that is derived — which is all of them but hers.
 *
 * `moss` is deliberately absent: `paletteFor` returns her measured palette
 * verbatim, so an entry here would have been unreachable and would have implied
 * that editing it changed her colours. The base she was measured AT is
 * `MOSS_BASE`, which is a different claim and kept for a different reason.
 */
const SOURCE: Readonly<Record<Exclude<ThemeId, 'moss'>, Hsl>> = {
  sky: { h: 203, s: 0.38, l: 0.67 },
  mint: { h: 171, s: 0.34, l: 0.67 },
  sand: { h: 44, s: 0.42, l: 0.67 },
  clay: { h: 21, s: 0.45, l: 0.67 },
  blossom: { h: 332, s: 0.42, l: 0.67 },
  lilac: { h: 268, s: 0.32, l: 0.67 },
  slate: { h: 215, s: 0.16, l: 0.67 },
}

/**
 * The base her measured palette sits at. NOT used to draw her.
 *
 * `paletteFor('moss')` returns `MEASURED` verbatim, so nothing in the app reads
 * this. It exists so `theme.test.ts` can put her own base through the ordinary
 * derivation and check that the result still lands on the artwork — which is
 * the one claim the whole module rests on. If that check goes red, either the
 * derivation changed or the artwork did, and both are worth knowing.
 */
export const MOSS_BASE: Hsl = { h: 147, s: 0.35, l: 0.67 }

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
  if (isCustomTheme(theme)) return derivePalette({ ...CUSTOM_SL, h: theme.hue })
  // VALIDATED, not assumed. `Theme` is a union that TypeScript cannot enforce
  // at a boundary: `{ hue: 360 }` is assignable to `CustomTheme` and rejected
  // by `isCustomTheme`, so it fell through to the named branch, missed the
  // table, and crashed inside `derivePalette(undefined)` with nothing naming
  // the cause.
  if (!isThemeId(theme)) {
    throw new Error(`not a theme: ${JSON.stringify(theme)}`)
  }
  // A COPY. Returning the module's own object handed every caller the same
  // mutable reference, so one caller writing to the palette it was given would
  // have changed her colours everywhere, permanently, for the rest of the
  // session -- and the derived themes return fresh objects, so the bug would
  // have existed for exactly one theme.
  if (theme === 'moss') return { ...MEASURED }
  return derivePalette(SOURCE[theme])
}

/**
 * The derivation, in one place.
 *
 * ## Where the rule came from
 *
 * Measured off her:
 *
 *   body    H147  S35%  L67%
 *   shadow  H146  S33%  L62%   — same hue, five points darker
 *   ink     H159  S32%  L21%   — hue nudged warm, and far darker
 *
 * So the rule is: shadow is L−5, ink is hue+12 at L21. Applied back to her own
 * base it lands within a contrast ratio of about 1.03 of her actual `#7dbd99`
 * and `#24463a`, which is invisible. `theme.test.ts` asserts that ratio against
 * `MOSS_BASE`, because a derivation that has drifted from the thing it was
 * derived from is worth catching. Exported for exactly that check — nothing in
 * the app calls it except `paletteFor`, immediately above.
 *
 * ## Applied to what
 *
 * The seven derived themes and any hue a package chose. `moss` does NOT come
 * through here — she is returned verbatim from `MEASURED`, which is the whole
 * of the difference between her and everything else.
 *
 * ## Darkened in HSL, never toward black
 *
 * `shade()` toward black desaturates: it turns her shadow into `#83b89b`, a
 * greyer green than the one she has. Every theme built that way would look
 * muddier than she does, which is precisely the "looks arbitrary" failure a
 * palette set exists to avoid.
 */
export function derivePalette(base: Hsl): Palette {
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
 * A HUE only, and nothing else: saturation and lightness come from `CUSTOM_SL`,
 * for the reason recorded there. The hue is the part that is genuinely a
 * choice; the other two are what make her look like herself rather than like a
 * swatch.
 */
export interface CustomTheme {
  /** Degrees on the wheel, 0-359. */
  readonly hue: number
}

export type Theme = ThemeId | CustomTheme

/**
 * The saturation and lightness a package's chosen hue is drawn at.
 *
 * FIXED, which is what makes a package's colour safe by construction rather
 * than safe by inspection. A load-time contrast check was written for this and
 * then deleted: with S and L pinned here, every one of the 360 hues clears AA
 * on every pairing, so the check could not reject anything it was given. A
 * guard that cannot fire is ceremony, and ceremony is what people trust instead
 * of the thing that actually holds. The guarantee is instead a TEST that sweeps
 * the whole wheel; widen these two numbers and it goes red, which is the moment
 * a runtime check would become worth having.
 *
 * These are NOT the named themes' values. Every named theme shares the
 * lightness — 0.67 throughout — but their saturations run from `slate` at 0.16
 * to `clay` at 0.45, and 0.36 is simply a middle of that range rather than a
 * value any of them uses. A package's colour is therefore in the same family as
 * the named themes, not identical to any of them.
 */
const CUSTOM_SL = { s: 0.36, l: 0.67 } as const

/**
 * Whether a value is a hue a package chose.
 *
 * `{ hue }` and NOTHING else. The first version read the property off anything
 * object-shaped, so `{ hue: 20, saturation: 1 }` was accepted, the saturation
 * silently ignored, and a package author had no way to discover that the field
 * they wrote does not exist. An inherited `hue` passed the same way. Rejecting
 * the whole object is the loud version: `parsePersona` reports it rather than
 * shipping a theme that is not the one the manifest asked for.
 */
export function isCustomTheme(value: unknown): value is CustomTheme {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  // Own and enumerable, exactly one of them, named `hue`.
  const keys = Object.keys(value)
  if (keys.length !== 1 || keys[0] !== 'hue') return false
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
