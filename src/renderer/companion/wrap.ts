import { isDense } from '@shared/script'

/**
 * Where a line may break, for text that is routinely both English and Chinese.
 *
 * The first version broke between any two glyphs, which is correct for Chinese
 * and wrong for English — it produced `just re / ady` and `brainstor / m
 * something`. Breaking only at spaces is the mirror of that mistake: Chinese has
 * no spaces, so a paragraph of it would be one unbreakable line.
 *
 * So neither rule is applied to everything. The text is first cut into **atoms**
 * — the smallest runs that may not be split — and lines are filled with atoms:
 *
 * - An English word is one atom, trailing space included.
 * - Each Chinese, Japanese or Korean glyph is its own atom.
 * - Punctuation that may not begin a line (`，。、！？）」…`, and the ASCII
 *   equivalents) joins the atom before it, so a line never starts with a comma.
 * - Punctuation that may not end a line (`（「《([{`) joins the atom after it,
 *   so an opening bracket never dangles.
 *
 * The last two are the beginning of 禁則処理. Not all of it — full rules also
 * govern numerals, units and repeated punctuation — but these two are the ones
 * that are conspicuous in a two-line bubble, and the rest costs a table.
 *
 * Widths come from the caller. This file never measures, so it is testable
 * against a made-up metric and unchanged by the canvas it is drawn on.
 */

/** May not begin a line, so it clings to whatever precedes it. */
const NO_START = /[，。、；：？！）］｝」』〉》〕】…‥・ー～,.;:!?)\]}%]/u

/** May not end a line, so it clings to whatever follows it. */
const NO_END = /[（［｛「『〈《〔【([{]/u

/**
 * A break is allowed after these, and they stay on the line above.
 *
 * Without it `tasks—just` is one indivisible atom, and a long enough dashed
 * phrase falls through to the last-resort break that splits between glyphs —
 * reintroducing the very bug this file exists to fix, in a rarer case.
 */
const BREAK_AFTER = /[—–\-/]/u

/**
 * Whole user-perceived characters, not code points.
 *
 * `for…of` over a string is code points, which keeps astral characters intact
 * but still splits a ZWJ emoji sequence and detaches a combining mark from the
 * letter it belongs to — both of which end up as half a character alone at the
 * start of a line. Built once: constructing a `Segmenter` per frame is real
 * work, and this runs inside `requestAnimationFrame`.
 */
const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

function glyphsOf(text: string): string[] {
  const glyphs: string[] = []
  for (const { segment } of GRAPHEMES.segment(text)) glyphs.push(segment)
  return glyphs
}

/**
 * Cut text into the smallest runs that may not be split.
 *
 * A newline survives as its own atom rather than being dropped, because a
 * deliberate break is not a break opportunity — it is a break.
 */
function atomize(text: string): string[] {
  const atoms: string[] = []
  let current = ''

  const close = (): void => {
    if (current !== '') atoms.push(current)
    current = ''
  }

  for (const glyph of glyphsOf(text)) {
    if (glyph === '\n') {
      close()
      atoms.push('\n')
      continue
    }
    // A space ends the word it follows and rides along with it, so the width of
    // a line is measured without a trailing space hanging off its end.
    if (/\s/u.test(glyph)) {
      current += glyph
      close()
      continue
    }
    if (NO_START.test(glyph)) {
      // It clings to what PRECEDES it, and after a CJK glyph that has already
      // been closed off into its own atom — so reaching for `current`, which is
      // empty by then, would leave the comma standing alone at a line start.
      if (current === '' && atoms.length > 0) atoms[atoms.length - 1] += glyph
      else current += glyph
      continue
    }
    if (isDense(glyph)) {
      // An opening bracket in hand keeps this glyph with it; closing first would
      // push the bracket out as an atom of its own and let a line end on it.
      if (current !== '' && NO_END.test(current.slice(-1))) current += glyph
      else {
        close()
        current = glyph
      }
      if (!NO_END.test(glyph)) close()
      continue
    }
    current += glyph
    if (BREAK_AFTER.test(glyph)) close()
  }
  close()
  return atoms
}

/**
 * Greedy fill: atoms onto a line until the next one does not fit.
 *
 * @param widthOf measures a string in whatever unit `maxWidth` is given in.
 */
export function wrapByWord(
  text: string,
  maxWidth: number,
  widthOf: (text: string) => number,
): string[] {
  const lines: string[] = []
  let line = ''

  // Trailing whitespace is not width. Without this, a line ending in a space is
  // measured as wider than it looks and wraps one word early.
  const fits = (candidate: string): boolean => widthOf(candidate.trimEnd()) <= maxWidth

  for (const atom of atomize(text)) {
    if (atom === '\n') {
      lines.push(line)
      line = ''
      continue
    }
    if (line !== '' && fits(line + atom)) {
      line += atom
      continue
    }
    if (line !== '') {
      lines.push(line)
      line = ''
    }
    if (fits(atom)) {
      line = atom
      continue
    }
    // One atom wider than an entire line — a URL, a long identifier, or a bubble
    // narrower than a single glyph. Broken between glyphs, because the only
    // alternative is a word running off the edge and out of the window.
    let piece = ''
    for (const glyph of glyphsOf(atom)) {
      if (piece !== '' && !fits(piece + glyph)) {
        lines.push(piece)
        piece = ''
      }
      piece += glyph
    }
    line = piece
  }

  if (line !== '') lines.push(line)
  return lines
}
