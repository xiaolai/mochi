/**
 * Reading a hex colour, which is the only interpretation this engine does.
 *
 * Inlined rather than imported. In the host application this lived beside the
 * accent-colour machinery, which also knows about WCAG luminance, CSS custom
 * properties and a theme — none of which an engine that fills two flat tones
 * has any business depending on. Twenty lines is cheaper than the coupling.
 *
 * The forms accepted here are exactly the forms `parseFaceSpec` accepts, and
 * that is not a coincidence: a colour that passes validation must be one this
 * can read, or a face loads and then fails to paint. That equivalence used to
 * be approximate — this trimmed its input and the validator did not, so
 * `' #abc '` was readable here and rejected there. It does not trim any more.
 *
 * **Alpha is discarded.** `#rgba` and `#rrggbbaa` parse, and their alpha
 * channel is dropped: the return type is RGB, and the one caller wants the
 * channels so it can build its own transparent stop. Named for what it returns.
 */

import { HEX_COLOUR } from './spec'

export interface Rgb {
  readonly r: number
  readonly g: number
  readonly b: number
}

export function parseHexRgb(hex: string): Rgb | null {
  const text = hex
  // Checked BEFORE parsing, not after. `red` is three characters, so it took
  // the shorthand path and `parseInt('rr', 16)` handed back NaN channels --
  // a colour object that passes every null check and paints nothing.
  if (!HEX_COLOUR.test(text)) return null
  const body = text.slice(1)
  const expand = (index: number): number => Number.parseInt(body.charAt(index).repeat(2), 16)
  if (body.length <= 4) {
    return { r: expand(0), g: expand(1), b: expand(2) }
  }
  // No NaN check and no trailing `return null`: the regex admits exactly the
  // four lengths handled above and below, so both were unreachable.
  const value = Number.parseInt(body.slice(0, 6), 16)
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 }
}
