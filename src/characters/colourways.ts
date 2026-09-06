import type { FaceSpec } from '../core/spec.js'

/** The five colour fields of a face, and nothing else. */
export type Colourway = Pick<FaceSpec, 'colBody' | 'colShadow' | 'colInk' | 'colCheek' | 'colGlint'>

/**
 * Mochi in six flavours.
 *
 * Derived rather than picked: the relationships were measured off her own
 * palette and then applied to new hues, which is why `matcha` reproduces
 * `#8ec8a8`, `#7dbd99` and `#24463a` exactly. That round-trip is the check that
 * the rules describe her rather than approximate her.
 *
 * - `colShadow` is the body hue at 5.5 points less lightness — a darker tone of
 *   the same colour, not a blend toward black.
 * - `colInk` is the body hue rotated 11.9 degrees and taken right down. Her ink
 *   is never black.
 * - `colCheek` is a fixed warm blush, because a blush is warm whatever she is
 *   made of — EXCEPT on a warm body, where it has no hue contrast left and
 *   disappears. Within 60 degrees of the blush hue it goes darker than the body
 *   instead and contrasts by lightness. Sakura, kinako and yuzu take that path;
 *   the other three are untouched. Contrast is the requirement, and hue was
 *   only ever how it was being met.
 *
 * Same licence as `mochi.ts`: these are her, in another colour.
 */
export const COLOURWAYS = {
  /** Green tea. The original. */
  matcha: {
    colBody: '#8ec8a8',
    colShadow: '#7dbd99',
    colInk: '#24463a',
    colCheek: '#ef8f86',
    colGlint: '#ffffff',
  },
  /** Cherry blossom. Blush deepened. */
  sakura: {
    colBody: '#c88e9d',
    colShadow: '#bd7d8e',
    colInk: '#462426',
    colCheek: '#e44435',
    colGlint: '#ffffff',
  },
  /** Roasted soybean flour. Blush deepened. */
  kinako: {
    colBody: '#c8b08e',
    colShadow: '#bda27d',
    colInk: '#463f24',
    colCheek: '#e44435',
    colGlint: '#ffffff',
  },
  /** Citrus. Blush deepened. */
  yuzu: {
    colBody: '#c8c38e',
    colShadow: '#bdb77d',
    colInk: '#424624',
    colCheek: '#e44435',
    colGlint: '#ffffff',
  },
  /** Soda. The only cool one. */
  ramune: {
    colBody: '#8eb3c8',
    colShadow: '#7da6bd',
    colInk: '#243346',
    colCheek: '#ef8f86',
    colGlint: '#ffffff',
  },
  /** Grape. The deepest hue at the same lightness. */
  budo: {
    colBody: '#b38ec8',
    colShadow: '#a57dbd',
    colInk: '#402446',
    colCheek: '#ef8f86',
    colGlint: '#ffffff',
  },
} as const satisfies Record<string, Colourway>

export type ColourwayName = keyof typeof COLOURWAYS

/** Mochi wearing one of her colourways. Geometry untouched; five fields swapped. */
export function mochiIn(name: ColourwayName, base: FaceSpec): FaceSpec {
  return { ...base, ...COLOURWAYS[name] }
}
