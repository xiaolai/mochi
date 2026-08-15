/**
 * Making CJK text findable in FTS5, on both sides of the index.
 *
 * ## The measurement this exists because of
 *
 * FTS5's default tokenizer cannot search Chinese. It
 * splits on whitespace and punctuation, and Chinese has neither between words,
 * so `今天我想吃苹果` is one enormous token and `苹果` matches nothing. Trigram
 * does not rescue it either -- it requires a query of at least three
 * characters, and most Chinese words are two. Shipping `unicode61` would mean
 * transcript search is dead in this project's primary language, silently.
 *
 * The verified answer is to split CJK runs into individual characters going
 * in, and to rewrite CJK queries as quoted phrases coming out: `苹果` becomes
 * `"苹 果"`, which matches the adjacent pair and therefore any substring.
 *
 * ## Why both halves are in one module
 *
 * They are one decision with two ends. Written apart, the day somebody changes
 * which ranges count as CJK on one side and not the other, search stops
 * finding things and NOTHING fails -- the index is still built, the query is
 * still valid, and the answer is just empty. That is the least debuggable
 * outcome a search box has, so the two functions live together and are tested
 * against each other.
 */

/**
 * Scripts written without spaces between words.
 *
 * Han, hiragana and katakana. Hangul is deliberately absent: Korean is written
 * WITH spaces, so the default tokenizer already handles it, and splitting it
 * per syllable would make its search worse rather than better.
 */
const RUN = /[㐀-䶿一-鿿豈-﫿぀-ヿ]+/g

/**
 * Splitting a run into what a person sees as one character.
 *
 * `[...run]` iterates CODE POINTS, which is right for the BMP ranges above and
 * silently wrong the day somebody widens them: the CJK extension blocks live
 * past U+FFFF, so a spread would cut those characters in half and index two
 * halves of something nobody can type. `persona.ts` chose `Intl.Segmenter`
 * over both `.length` and spreading for the same reason, and ranges like these
 * are exactly the kind of thing that gets widened later.
 */
const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

function characters(run: string): string[] {
  return [...GRAPHEMES.segment(run)].map((piece) => piece.segment)
}

/**
 * The form stored in the index.
 *
 * Latin is untouched -- the tokenizer already handles it, and splitting
 * `hello` into letters would make every English word match every other.
 */
export function segment(text: string): string {
  return text.replace(RUN, (run) => characters(run).join(' '))
}

/**
 * A user's words, as an FTS5 MATCH expression that cannot mean anything else.
 *
 * EVERY run is quoted, including Latin. That is not only for CJK: a MATCH
 * expression is a query language, so `NEAR`, `OR`, `*`, a bare `-`, or an
 * unbalanced `"` typed into a search box would either change the meaning of
 * the search or throw. Quoting everything makes the box a search box rather
 * than a query console, which is what somebody typing into it expects.
 *
 * The cost is that operators are unavailable. That is the right trade for a
 * settings window; the day it is not, the safe form is still what this
 * returns and an explicit syntax can be added beside it.
 */
export function toMatchQuery(text: string): string | null {
  const terms: string[] = []
  // Split into CJK runs and everything else, so each can be treated its own
  // way while staying in the order they were typed.
  let index = 0
  for (const match of text.matchAll(RUN)) {
    const before = text.slice(index, match.index)
    terms.push(...latinTerms(before))
    terms.push(`"${characters(match[0]).join(' ')}"`)
    index = match.index + match[0].length
  }
  terms.push(...latinTerms(text.slice(index)))

  // Null rather than an empty string: an empty MATCH throws in FTS5, and a
  // caller that has nothing to search for should not be running a query.
  return terms.length === 0 ? null : terms.join(' ')
}

/** Non-CJK words, quoted so no FTS5 operator can survive being typed. */
function latinTerms(chunk: string): string[] {
  return (
    chunk
      .split(/\s+/)
      .map((word) => word.replace(/"/g, ''))
      // Punctuation-only fragments become nothing once the quotes are stripped,
      // and an empty quoted phrase is a syntax error rather than a no-op.
      .filter((word) => /[\p{L}\p{N}]/u.test(word))
      .map((word) => `"${word}"`)
  )
}
