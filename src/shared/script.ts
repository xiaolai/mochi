/**
 * What script a glyph belongs to, and what that costs — in ONE place.
 *
 * This predicate had already been written twice, in `renderer/companion/wrap.ts`
 * and `renderer/companion/pace.ts`, and W4 wanted a third copy in main. Three
 * copies of "is this Chinese" is three chances to update two of them.
 *
 * The class of bug it exists to prevent has bitten this codebase three times:
 * a per-script rule applied as though there were one script. Line WRAPPING
 * broke English words in half; PACING ran the cursor through Chinese at the
 * Latin rate; and the first cut-point design used `lastIndexOf(' ')`, which on
 * `"好的 今天天气很好我们出去走走吧然后再说"` with an estimate of 16 keeps **two**
 * characters.
 */

/**
 * Scripts written without spaces, which may break between any two glyphs.
 *
 * Kana, CJK ideographs and radicals, Hangul, compatibility and full-width forms.
 * **Everything else falls to the Latin treatment**, which is right for Cyrillic
 * and Greek and is a known gap for Thai, Devanagari and Arabic — see `costOf`.
 */
const NO_SPACES = /[⺀-〿぀-ヿ㐀-䶿一-鿿豈-﫿가-힯＀-￯]/u

export function isDense(glyph: string): boolean {
  return NO_SPACES.test(glyph)
}

/**
 * How long a glyph takes to say, relative to one Latin character.
 *
 * §57 measured 15.1 chars/s for English against 4.1 for Chinese — the same
 * voice, a third of the characters, because a Chinese glyph carries far more.
 * §60 then measured that the weighting WORKS: five traces across both languages
 * land between 14.7 and 18.7 cost-units per second of sound, with no
 * language separation in the spread.
 *
 * **The default is the known gap.** A script outside `NO_SPACES` takes the
 * Latin cost of 1, and if it is denser than Latin the cursor runs fast and the
 * estimate runs LONG — words she never said, which is the one direction the
 * whole design exists to avoid. Thai, Devanagari and Arabic are in that bucket.
 * Until one of them is measured, `UNKNOWN_DENSE_COST` is what a conservative
 * caller should reach for; erring slow only loses a word from a turn already
 * marked as interrupted.
 */
export const CJK_COST = 15.1 / 4.1

/** For a caller that would rather under-run than over-run on an unmeasured script. */
export const UNKNOWN_DENSE_COST = CJK_COST

export function costOf(glyph: string): number {
  return isDense(glyph) ? CJK_COST : 1
}

/**
 * Round an index back to a boundary a reader would accept, never forward.
 *
 * Latin runs are not split: the index walks back to the space before the word
 * it landed inside. A dense script may break between any two glyphs, so an
 * index inside one is already a boundary and is returned unchanged — which is
 * exactly what `lastIndexOf(' ')` gets catastrophically wrong on mixed text,
 * where the nearest space can be an entire clause behind.
 *
 * **Never forward**, because this decides what is recorded as spoken and the
 * two error directions are not symmetric.
 */
export function boundaryAt(text: string, index: number): number {
  if (index <= 0) return 0
  if (index >= text.length) return text.length

  // Already at a break: the glyph about to be cut off is dense, or the cut
  // falls on whitespace.
  const here = text[index] ?? ''
  if (isDense(here) || /\s/u.test(here)) return index
  const before = text[index - 1] ?? ''
  if (isDense(before) || /\s/u.test(before)) return index

  // Inside a Latin word. Walk back to where it began.
  let at = index
  while (at > 0) {
    const glyph = text[at - 1] ?? ''
    if (/\s/u.test(glyph) || isDense(glyph)) break
    at -= 1
  }
  return at
}
