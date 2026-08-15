/**
 * Slider metadata for the tuner.
 *
 * Labels and grouping only. Both the RANGES and the DEFAULTS are imported --
 * ranges from `FACE_BOUNDS`, defaults from `MOCHI` -- because a tuner with its
 * own copy of either would let you design a face the loader then rejects, which
 * reads to a designer as "the app ignored my file".
 */

/**
 * ## Why these labels are not translated
 *
 * The project rule is that any string a USER sees goes through i18n, and these
 * do not qualify. The tuner is a development instrument: it is not in the app's
 * bundle -- `electron.vite.config.ts` builds exactly two renderer entries,
 * `companion` and `settings` -- and it is reached only by `pnpm tuner`, which
 * starts a separate dev server. Its audience is whoever is editing the face,
 * and the labels are field names from `FaceSpec`: `upperShoulder`, `waist`,
 * `breathAmp`. Translating those would produce two names for one field and make
 * the tuner harder to match against the code it edits.
 *
 * There is a second cost. Routing them through `shared/i18n` would make a
 * development tool a consumer of the shipped message tables, so adding a locale
 * would mean supplying a translation for `lowerShoulder` before the app
 * compiles -- coupling in the wrong direction, paid on every locale.
 */

import { COLOUR_KEYS, FACE_BOUNDS, type ColourKey } from '@shared/avatar-spec'

/** Every numeric field, derived so a new one cannot be forgotten here. */
export type NumericKey = keyof typeof FACE_BOUNDS

export interface Slider {
  readonly key: NumericKey
  readonly label: string
  readonly min: number
  readonly max: number
  readonly step: number
}

export interface Group {
  readonly title: string
  readonly open?: boolean
  readonly sliders: readonly Slider[]
}

const s = (key: NumericKey, label: string): Slider => ({ key, label, ...FACE_BOUNDS[key] })

export const GROUPS: readonly Group[] = [
  {
    title: 'body',
    open: true,
    sliders: [
      s('bodyW', 'width'),
      s('bodyH', 'height'),
      s('waist', 'waist height'),
      s('upperShoulder', 'upper shoulder'),
      s('lowerShoulder', 'lower shoulder'),
      s('gripX', 'feature grip x'),
      s('gripY', 'feature grip y'),
      s('shadowX', 'shadow offset x'),
      s('shadowY', 'shadow offset y'),
    ],
  },
  {
    title: 'eyes',
    open: true,
    sliders: [
      s('eyeX', 'spacing'),
      s('eyeY', 'height'),
      s('eyeHw', 'half width'),
      s('eyeUpper', 'upper arc'),
      s('eyeLower', 'lower arc'),
      s('eyeTilt', 'tilt'),
      s('eyeRound', 'roundness'),
      s('eyeGlint', 'catchlight size'),
      s('gazeTravel', 'gaze travel'),
    ],
  },
  {
    title: 'mouth',
    sliders: [
      s('mouthY', 'height'),
      s('mouthHw', 'half width'),
      s('mouthUpper', 'upper arc'),
      s('mouthLower', 'lower arc'),
      s('mouthRound', 'roundness'),
      s('mouthOpenGain', 'open gain'),
    ],
  },
  {
    title: 'cheeks',
    sliders: [
      s('cheekAlpha', 'cheek alpha'),
      s('cheekX', 'cheek spacing'),
      s('cheekY', 'cheek height'),
      s('cheekR', 'cheek radius'),
    ],
  },
  {
    title: 'motion',
    sliders: [
      s('breathAmp', 'breath amount'),
      s('breathMs', 'breath period'),
      s('stiffness', 'spring k'),
      s('damping', 'spring c'),
    ],
  },
]

/**
 * Every numeric field reaches a slider, checked at load.
 *
 * The colours next door are a `Record<ColourKey, string>`, so forgetting one is
 * a compile error; `GROUPS` is an array, so forgetting one here is silent -- the
 * field simply has no control, and a designer's only clue is that a value they
 * cannot see is affecting their face. Adding `eyeGlint` is exactly the edit that
 * would have been forgotten, so the gap is closed rather than noted.
 *
 * A throw rather than a warning: this is a dev tool, and a tuner that is quietly
 * missing a control is worse than one that refuses to start and names the field.
 */
const covered = new Set(GROUPS.flatMap((group) => group.sliders.map((slider) => slider.key)))
const uncovered = (Object.keys(FACE_BOUNDS) as NumericKey[]).filter((key) => !covered.has(key))
if (uncovered.length > 0) {
  throw new Error(`[tuner] no slider for: ${uncovered.join(', ')} — add them to GROUPS`)
}

const COLOUR_LABELS: Readonly<Record<ColourKey, string>> = {
  colBody: 'body (flat)',
  colShadow: 'shadow',
  colInk: 'ink',
  colCheek: 'cheek',
  colGlint: 'catchlight',
}

export const COLOURS: ReadonlyArray<{ key: ColourKey; label: string }> = COLOUR_KEYS.map((key) => ({
  key,
  label: COLOUR_LABELS[key],
}))
