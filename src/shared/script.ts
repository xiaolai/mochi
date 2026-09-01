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
 *
 * ## And then it bit a fourth time, HERE, in the module written to end it
 *
 * The set was a hand-written list of ranges,
 * `[⺀-〿぀-ヿ㐀-䶿一-鿿豈-﫿가-힯＀-￯]`, and it was wrong in three independent
 * ways at once. `store/segment.ts` had already moved off exactly this list for
 * the first two reasons and said so in its own header; this file kept it.
 *
 * 1. **It missed every supplementary-plane Han block** — `𠀀` and everything
 *    past U+FFFF — and the kana extension blocks.
 * 2. **The two `豈` are different characters.** The range was meant to be the
 *    CJK Compatibility Ideographs block, whose first character is `豈` **U+F900**.
 *    The literal in the source was the ordinary `豈` **U+8C48**, which looks
 *    identical in every editor. So `豈-﫿` spanned **28,344** codepoints instead
 *    of 512, and swallowed Yi, Lisu, Vai, Syloti Nagri, Latin Extended-E and
 *    much else — all of it charged the Chinese cost and broken between any two
 *    glyphs, which is this file's opening sentence happening to somebody else's
 *    alphabet.
 * 3. **Scripts that genuinely are dense were absent** — Thai, Lao, Khmer,
 *    Myanmar, Tibetan — which is `findings.md` §60's named danger: a script
 *    denser than Latin runs the cursor fast and the estimate LONG, and long is
 *    the direction that puts words she never said into her memory.
 *
 * Ranges are not written by hand here any more. `Script_Extensions` is asked
 * instead, for `segment.ts`'s reason: the marks that matter belong to no single
 * script — `々` and `ー` are `Common`, `゙` is `Inherited` — and all three appear
 * inside ordinary words.
 *
 * ## Two questions, kept apart
 *
 * `isDense` answers *may a line break between this glyph and its neighbour*,
 * which is typography. `costOf` answers *how long does it take to say*, which
 * is timing. They agree on Chinese and Japanese and they do not have to agree
 * everywhere, and conflating them is what made one range list carry two jobs
 * and get both wrong.
 */

/**
 * Written without spaces, and **measured**: §57 and §60.
 *
 * Han, hiragana and katakana, by script extension. Hangul is deliberately not
 * here — see `UNSPACED_UNMEASURED`. Ideographic punctuation (`、`, `。`) comes
 * along, which is correct on both questions: it may end a line and it takes a
 * beat to say.
 *
 * Exported as a source string rather than a regex because `store/segment.ts`
 * needs the same set with the global flag, and two literals is how the two
 * halves of a search come to disagree about what Chinese is — the exact failure
 * `segment.ts`'s own header describes.
 */
export const MEASURED_DENSE =
  '\\p{Script_Extensions=Han}\\p{Script_Extensions=Hiragana}\\p{Script_Extensions=Katakana}'

/**
 * Written without spaces, and **nobody has timed them**.
 *
 * Hangul, Thai, Lao, Khmer, Myanmar, Tibetan, plus the CJK Symbols and
 * Punctuation and Halfwidth-and-Fullwidth-Forms blocks — the last two written
 * as ranges because JavaScript's property escapes have no `Block`.
 *
 * Korean is spaced BETWEEN WORDS, so it is not unspaced in the sense Chinese
 * is; it is here because a Hangul syllable carries far more than a Latin letter
 * and breaking between syllables is what a Korean line does. It has never been
 * measured, and putting it in this bucket rather than the one above is the
 * whole of the honesty available: the two constants carry the same number
 * today and the day somebody times one of these, only one of them moves.
 */
const UNSPACED_UNMEASURED =
  '\\p{Script_Extensions=Hangul}\\p{Script=Thai}\\p{Script=Lao}' +
  '\\p{Script=Khmer}\\p{Script=Myanmar}\\p{Script=Tibetan}\\u3000-\\u303F\\uFF00-\\uFFEF'

const MEASURED = new RegExp(`[${MEASURED_DENSE}]`, 'u')
const UNMEASURED = new RegExp(`[${UNSPACED_UNMEASURED}]`, 'u')

/**
 * May a line break between this glyph and the next?
 *
 * Both buckets, because both are written without spaces between words and a
 * reader of either expects a break wherever the line runs out. **Everything
 * else falls to the Latin treatment**, which is right for Cyrillic, Greek,
 * Armenian, Georgian and the Latin extensions — and is what the old range list
 * was accidentally denying several of them.
 */
export function isDense(glyph: string): boolean {
  return MEASURED.test(glyph) || UNMEASURED.test(glyph)
}

/**
 * How long a glyph takes to say, relative to one Latin character.
 *
 * §57 measured 15.1 chars/s for English against 4.1 for Chinese — the same
 * voice, a third of the characters, because a Chinese glyph carries far more.
 * §60 then measured that the weighting WORKS: five traces across both languages
 * land between 14.7 and 18.7 cost-units per second of sound, with no
 * language separation in the spread.
 */
const CJK_COST = 15.1 / 4.1

/**
 * What an unspaced script that nobody has timed is charged.
 *
 * The same number as `CJK_COST`, and a **separate constant on purpose**. §60
 * named this gap and named its direction: if a script is denser than Latin and
 * is charged the Latin cost, the cursor runs fast and the estimate runs LONG —
 * words she never said, filed as her memory, which is the one direction the
 * whole design exists to avoid. Erring slow instead only loses a word from a
 * turn already marked `cut`.
 *
 * So the conservative choice is the highest cost anybody has a measurement for,
 * which is Chinese. That is a floor argument, not a claim about Thai: nothing
 * here says a Thai glyph takes as long as a Han one. Measuring one is
 * `cost = 15.1 ÷ its measured chars-per-second` (§60's consequence 1 — a new
 * script needs its constant derived once, not a full capture-transcribe-score
 * cycle), and moving it means moving this constant and taking that script out
 * of `UNSPACED_UNMEASURED`.
 */
export const UNKNOWN_DENSE_COST = CJK_COST

export function costOf(glyph: string): number {
  if (MEASURED.test(glyph)) return CJK_COST
  return UNMEASURED.test(glyph) ? UNKNOWN_DENSE_COST : 1
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
