import { MEASURED_DENSE } from '@shared/script'

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
 * Han, hiragana and katakana, by SCRIPT EXTENSION rather than by a hand-written
 * list of ranges. The list was `[㐀-䶿一-鿿豈-﫿぀-ヿ]`, whose comment claimed it
 * was those three scripts and was not: it missed every supplementary Han block
 * (`𠀀` and everything past U+FFFF), `〇`, `々`, half-width katakana (`ｶ`), the
 * kana extension blocks, and the combining dakuten -- so a legitimate Japanese
 * or Chinese sentence containing any of them was indexed one way and searched
 * another, and the search box simply returned nothing.
 *
 * Script EXTENSIONS, not `Script`, because the marks that matter here belong to
 * no single script: `々` and `ー` are `Common` and `゙` is `Inherited`, and
 * all three appear inside ordinary words. The cost is that ideographic
 * punctuation (`、`, `。`) comes along; that is harmless, because it reaches
 * FTS5's tokenizer as punctuation on BOTH sides and is dropped from the index
 * and from the phrase alike.
 *
 * Hangul is deliberately absent: Korean is written WITH spaces, so the default
 * tokenizer already handles it, and splitting it per syllable would make its
 * search worse rather than better.
 *
 * ## The set comes from `@shared/script`, and that is the point
 *
 * It was a second literal here. `shared/script.ts` asks the same question for
 * pacing and wrapping, and it still held the hand-written list this comment
 * describes moving off -- so the two modules disagreed about whether `𠀀` is
 * Chinese, and each was right about its own half of the app. One source, two
 * flags: this one is global, because it replaces every run in a string.
 *
 * `MEASURED_DENSE` rather than everything `isDense` covers, and the difference
 * is Hangul and Thai. Those belong to the typography question, not to this one:
 * splitting a spaced script per character is what the paragraph above refuses.
 */
const RUN = new RegExp(`[${MEASURED_DENSE}]+`, 'gu')

/**
 * Splitting a run into what a person sees as one character.
 *
 * `Intl.Segmenter` rather than `[...run]`, and the reason is NOT that spreading
 * cuts astral characters in half -- string spread iterates code points and
 * keeps a surrogate pair together, so that claim, which this comment used to
 * make, was simply false. The real limitation is that one grapheme can be
 * several code points: `が` written as か plus a combining dakuten is two, and a
 * spread indexes it as two tokens while a precomposed `が` elsewhere in the
 * same archive indexes as one. `persona.ts` chose `Intl.Segmenter` over both
 * `.length` and spreading for the same reason.
 */
const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

function characters(run: string): string[] {
  return [...GRAPHEMES.segment(run)].map((piece) => piece.segment)
}

/**
 * Splitting a run into WORDS, for the widening query only.
 *
 * ICU carries dictionaries for the scripts that need one, so this is real
 * Chinese and Japanese word segmentation rather than a guess: `苹果老师` comes
 * back as `苹果` and `老师`, and `今日は天気がいい` as five pieces. The locale is
 * left unset deliberately -- ICU picks the dictionary from the SCRIPT of the
 * text, so a machine running in English still segments Chinese correctly, and
 * naming a locale here would be asserting which language a transcript is in.
 */
const WORDS = new Intl.Segmenter(undefined, { granularity: 'word' })

function words(run: string): string[] {
  return [...WORDS.segment(run)]
    .filter((piece) => piece.isWordLike === true)
    .map((piece) => piece.segment)
}

/**
 * The one spelling both sides agree on.
 *
 * Neither half used to normalise, so canonically equivalent Japanese did not
 * match itself: `が` typed on one keyboard is one code point and on another is
 * か plus U+3099, and FTS5 compares tokens byte for byte. NFC because it is the
 * composed form nearly every input method and file already produces, so it is
 * the cheapest agreement to reach.
 *
 * Applied in `segment` and in `matchTerms`, which is what makes it an
 * agreement rather than a preference -- normalising one side alone would move
 * the mismatch rather than remove it.
 */
function normalise(text: string): string {
  return text.normalize('NFC')
}

/**
 * The form stored in the index.
 *
 * Latin is untouched -- the tokenizer already handles it, and splitting
 * `hello` into letters would make every English word match every other.
 */
export function segment(text: string): string {
  // SPACES ON BOTH SIDES of the run, not only between its characters.
  //
  // Splitting the inside and leaving the edges glued the run to whatever
  // touched it: `2026年` indexed as the single token `2026年`, `abc中文def` as
  // `abc中 文def`, `深圳weather` as `深 圳weather`. The query side segments the
  // same text into separate terms, so none of those could ever be found again.
  // Pure CJK was unaffected, which is why §29 read as fixed.
  //
  // Collapsed and trimmed afterwards, because the tokenizer counts a run of
  // spaces as one separator anyway and a leading one only makes the stored form
  // harder to read in a debugger.
  return normalise(text)
    .replace(RUN, (run) => ` ${characters(run).join(' ')} `)
    .replace(/\s+/g, ' ')
    .trim()
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
  const found = matchTerms(text, 'whole')
  // Null rather than an empty string: an empty MATCH throws in FTS5, and a
  // caller that has nothing to search for should not be running a query.
  return found.length === 0 ? null : found.join(' ')
}

/**
 * The same words, but ANY of them rather than ALL of them.
 *
 * Space-separated terms are an AND in FTS5, which is right for a search box
 * somebody is refining by hand and wrong for the way she searches. She is told
 * to use "the words they are likely to have actually said", so her queries are
 * whole remembered phrases -- and an AND over six words demands that one turn
 * contain every one of them. Measured on a real archive: `audio voice
 * transcript hear full transcript` matched 0 turns as an AND and 18 as an OR,
 * in a database that plainly held the conversation.
 *
 * ## Why the CJK run has to be broken up here and not above
 *
 * This used to widen nothing at all in the language it matters most for.
 * Chinese is written without spaces, so a whole query is ONE run and one quoted
 * phrase -- `toAnyQuery('苹果老师')` was byte-for-byte `toMatchQuery('苹果老师')`,
 * and the OR only ever appeared when the caller had inserted spaces by hand.
 * Split into words, it becomes `"苹 果" OR "老 师"`, which is the widening the
 * function's name promises.
 *
 * Ranking is what makes this safe rather than noisy: FTS5 orders by `rank`,
 * and a turn carrying five of the words scores far above one carrying only
 * `full`. See `search`, which tries the precise form first.
 */
export function toAnyQuery(text: string): string | null {
  const found = matchTerms(text, 'words')
  return found.length === 0 ? null : found.join(' OR ')
}

/** How much of a CJK run one term covers. See `toAnyQuery`. */
type Grain = 'whole' | 'words'

/** The quoted terms, in the order they were typed. Shared by both joiners. */
function matchTerms(text: string, grain: Grain): string[] {
  const source = normalise(text)
  const terms: string[] = []
  // Split into CJK runs and everything else, so each can be treated its own
  // way while staying in the order they were typed.
  let index = 0
  for (const match of source.matchAll(RUN)) {
    const before = source.slice(index, match.index)
    terms.push(...otherTerms(before))
    terms.push(...cjkTerms(match[0], grain))
    index = match.index + match[0].length
  }
  terms.push(...otherTerms(source.slice(index)))
  return terms
}

/** One run as phrases of adjacent characters, matching how the index stores it. */
function cjkTerms(run: string, grain: Grain): string[] {
  const pieces = grain === 'whole' ? [run] : words(run)
  return (
    pieces
      // Nothing to search for, same test as `otherTerms`. A run can be pure
      // ideographic punctuation now that script EXTENSIONS decide what CJK is --
      // `。。` is a run of two -- and a phrase whose every character the
      // tokenizer discards is a MATCH expression with no terms in it.
      .filter((piece) => /[\p{L}\p{N}]/u.test(piece))
      .map((piece) => characters(piece).join(' '))
      .map((phrase) => `"${phrase}"`)
  )
}

/**
 * Everything the CJK pass did not claim, quoted so no operator survives.
 *
 * Named for what it is. It was `latinTerms`, which described neither its input
 * nor its behaviour: everything `RUN` does not match arrives here, including
 * Arabic, Cyrillic and Hangul, and the name made the incomplete CJK
 * classification above look narrower than it was.
 */
function otherTerms(chunk: string): string[] {
  return (
    chunk
      .split(/\s+/)
      // ESCAPED, not deleted. Stripping the quote from `foo"bar` produced the
      // phrase `"foobar"`, and the index holds `foo` followed by `bar` -- so the
      // one thing the user typed could never be found. FTS5 spells an embedded
      // quote as two of them, and the phrase then tokenizes to the same pair the
      // index holds.
      .map((word) => word.replace(/"/g, '""'))
      // Punctuation-only fragments are nothing to search for, and an empty
      // quoted phrase is a syntax error rather than a no-op.
      .filter((word) => /[\p{L}\p{N}]/u.test(word))
      .map((word) => `"${word}"`)
  )
}
