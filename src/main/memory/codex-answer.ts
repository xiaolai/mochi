import { fenced } from '@shared/instructions'
import { oneLine } from '@shared/text'
import { MEASURED_DENSE } from '@shared/script'

import { MAX_HITS, MAX_HIT_CHARS, type RecallGuidance } from './answer'
import { elapsedWords } from './elapsed'
import { masked } from '../codex/archive/mask'
import type { CodexHit } from '../codex/archive/index-store'
import { problems } from '../problems'

/**
 * What comes back from a `recall_codex` call.
 *
 * ## A sibling of `answer.ts`, not a copy of it
 *
 * The three statuses, the fencing, the bound on how much of a hit survives and
 * the "data, not prose" rule are all that module's and are IMPORTED rather than
 * restated. `MAX_HITS` and `MAX_HIT_CHARS` in particular: the plan's own
 * argument is that this capability inherits the attribution rule *verbatim*
 * rather than paraphrasing it, for the reason `answer.ts` gives about two
 * wordings of one rule.
 *
 * ## What is genuinely different, and why each difference exists
 *
 * **The archive is not hers.** `recall_conversations` searches what she and the
 * person said to each other; this searches what the person and a tool said to
 * each other, which nobody wrote for her and which she cannot edit or delete
 * through this app. So every hit carries more than "when" and "what":
 *
 * - **`who` has three values, not two.** There are three parties here and one
 *   of them is a tool. Saying "you said" of something Codex wrote would put a
 *   tool's words in the person's mouth, and `unknown` exists so she can say
 *   "somewhere in that conversation" rather than guessing.
 * - **`source` says which archive the line came from.** 82% of threads have no
 *   projected turns at all, so most hits are the opening field of a thread
 *   rather than a turn — and that field is over 2,000 characters in 4,411 of
 *   9,093 cases, which makes it a pasted document rather than an opening
 *   remark. "You said this at the start" and "this is what was said" are
 *   different claims and she must not make the stronger one from the weaker
 *   evidence.
 * - **`where` names the repository.** Attribution is the whole safety property
 *   and voice gives the listener no citation to check, so "in
 *   smartcube-web-bluetooth" is what makes a hit sayable at all.
 *
 * ## Everything source-derived is masked, flattened, bounded AND fenced
 *
 * `where` is source-derived text too, and the first version of it went out raw
 * — `fenced` and `MAX_HIT_CHARS` protect `said` only, so a repository named
 * after an instruction would have walked straight past both. Both fields now go
 * through the same four steps, in this order:
 *
 * 1. **masked** — known credential shapes removed, because a capability result
 *    is transmitted to OpenAI's Realtime service and not merely spoken;
 * 2. **flattened** — `oneLine`, so a hit cannot forge a second speaker's line;
 * 3. **bounded** — a `function_call_output` is billed for the rest of the
 *    session;
 * 4. **fenced** — Codex transcripts are, verbatim, records of people
 *    instructing models. Quoting them unfenced into her context is prompt
 *    injection with extra steps.
 */

/** The tag a quote sits inside. See `fenced`. */
const SAID = 'said'

/** The tag the place sits inside. Fenced for the same reason `said` is. */
const WHERE = 'where'

/** Which archive a hit came from, as a tag she branches on rather than prose. */
export type CodexHitSource = 'opening' | 'pasted' | 'said'

export type CodexRecalledHit = {
  /** "about 3 days ago". App-generated, so it is safe as plain text. */
  readonly when: string
  /**
   * Whose line it was. THREE, and none of them is her.
   *
   * `them` is the person she talks to; `codex` is the tool; `unknown` is a
   * fragment that genuinely cannot be attributed, which she reports as
   * "somewhere in that conversation".
   */
  readonly who: 'them' | 'codex' | 'unknown'
  /** What was said: masked, flattened, truncated and fenced. */
  readonly said: string
  /** Which repository, fenced for the same reasons. Empty when unrecorded. */
  readonly where: string
  /** Whether this was a turn, an opening line, or a pasted document. */
  readonly source: CodexHitSource
}

export type CodexRecallPayload =
  | {
      readonly status: 'found'
      readonly hits: readonly CodexRecalledHit[]
      readonly guidance: string
    }
  /** Searched, and there was nothing. An ANSWER, not a failure. */
  | { readonly status: 'nothing'; readonly guidance: string }
  /** Could not be asked at all. Distinguished so she does not say "nothing". */
  | { readonly status: 'unavailable'; readonly guidance: string }

/** The payload for a search that could not run. See `answer.ts`'s `unavailable`. */
export function codexUnavailable(guidance: RecallGuidance): CodexRecallPayload {
  return { status: 'unavailable', guidance: guidance.unavailable }
}

/** Written without spaces between words. The same set `segment.ts` uses. */
const DENSE = new RegExp(`[${MEASURED_DENSE}]`, 'u')

/**
 * The words a query is actually looking for, lower-cased.
 *
 * Crude on purpose. This is not the search — FTS5 already did that, and this
 * runs over one hit — it is only "where in this document did the match happen".
 *
 * ## Why the length filter does not apply to Chinese
 *
 * Short fragments are noise at this job: `on` appears inside `configuration`,
 * and letting it match sent the excerpt back to the top of the document. But
 * **most Chinese words are two characters**, so the same filter deleted every
 * CJK term and made the window fall back to the opening for exactly the
 * language this project is primarily used in — the failure `segment.ts` was
 * written to stop, arriving one layer up.
 *
 * So the bound applies to spaced scripts only, and "which scripts are written
 * without spaces" comes from `@shared/script` rather than from a second list
 * here. Two modules disagreeing about whether `苹` is dense is precisely what
 * that constant exists to prevent.
 */
function wanted(query: string): readonly string[] {
  return query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 2 || DENSE.test(word))
}

/** A term as a regular expression that cannot mean anything but itself. */
function literal(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Where the query first appears in the text, or -1.
 *
 * ## Two passes, and the second one is for Chinese
 *
 * The first looks for a term with nothing alphanumeric either side of it. That
 * is what stops `on` matching inside `configuration` — which it did, and which
 * sent the excerpt back to the top of the document, defeating the whole
 * mechanism while looking like it worked.
 *
 * Those boundaries are wrong for a language written without spaces: in
 * `今天我想吃苹果` the characters either side of `苹果` are letters, so a bounded
 * search finds nothing and would fall back to the opening for every CJK query.
 * So a plain substring pass follows, which is exactly right there and merely
 * imprecise elsewhere — and elsewhere it only runs when the precise pass found
 * nothing at all.
 */
function firstMatch(haystack: string, terms: readonly string[]): number {
  if (terms.length === 0) return -1
  const bounded = new RegExp(
    `(?<![\\p{L}\\p{N}])(?:${terms.map(literal).join('|')})(?![\\p{L}\\p{N}])`,
    'u',
  )
  const found = bounded.exec(haystack)
  if (found !== null) return found.index
  let earliest = -1
  for (const term of terms) {
    const at = haystack.indexOf(term)
    if (at !== -1 && (earliest === -1 || at < earliest)) earliest = at
  }
  return earliest
}

/**
 * Where to start reading a document so the excerpt contains the match.
 *
 * ## The defect this exists for
 *
 * A hit is bounded to three hundred characters, and it took them FROM THE
 * FRONT. FTS5 matches anywhere in a document, and 3,924 of the documents in the
 * measured corpus are pasted files — some of them over a hundred thousand
 * characters. So a match four pages in came back as the first paragraph of an
 * unrelated file: she would quote text that does not contain what was asked
 * about, confidently, with the attribution attached.
 *
 * That is the worst failure this feature has, because it is invisible. A wrong
 * answer that LOOKS like a right one is what the fencing, the bounding and the
 * three statuses are all arranged against.
 *
 * ## Why the window is centred and not cut at the match
 *
 * A quotation starting exactly at the matched word reads as a fragment. Half
 * the budget before it gives the sentence somewhere to begin, which is what
 * makes the result sayable rather than merely correct.
 */
function windowInto(text: string, terms: readonly string[]): number {
  if (text.length <= MAX_HIT_CHARS) return 0
  const at = firstMatch(text.toLowerCase(), terms)
  // No term found in the readable text — which happens: the index is segmented
  // and the query is widened, so a document can match on a form that is not a
  // literal substring. The opening is the honest fallback.
  if (at === -1) return 0
  return Math.max(0, at - Math.floor(MAX_HIT_CHARS / 2))
}

/** Masked, flattened, bounded — the steps before fencing. */
function safeText(text: string, terms: readonly string[] = []): string {
  const flat = oneLine(masked(text))
  if (flat.length <= MAX_HIT_CHARS) return flat
  const from = windowInto(flat, terms)
  const excerpt = flat.slice(from, from + MAX_HIT_CHARS)
  // Ellipses on the side that was cut, so she can hear that this is a passage
  // out of something longer rather than the whole of a short thing.
  return `${from > 0 ? '…' : ''}${excerpt}${from + MAX_HIT_CHARS < flat.length ? '…' : ''}`
}

/**
 * One payload, whatever happens — `answer.ts`'s rule, and for its reason.
 *
 * A tool call that never receives a `function_call_output` sits unanswered in
 * the conversation for the rest of the session. This one can genuinely fail:
 * the archive is another application's, Codex rebuilds it from rollouts by
 * design, and the index is a file on a disk that can go wrong.
 *
 * `null` means the archive is not there to be asked, which is deliberately NOT
 * the same answer as a search that found nothing.
 */
export function codexRecallPayloadFor(
  search: (() => readonly CodexHit[]) | null,
  now: number,
  guidance: RecallGuidance,
  /** What was searched for. See `codexAnswerFor`. */
  query = '',
): CodexRecallPayload {
  if (search === null) return codexUnavailable(guidance)
  try {
    return codexAnswerFor(search(), now, guidance, query)
  } catch (error: unknown) {
    // Swallowed on purpose, and loudly, exactly as `recallPayloadFor` does:
    // this runs on the voice event path, so a throw escaping would take down
    // the listener that receives speech.
    console.warn('[recall-codex] the search failed:', error)
    problems.note('recall', null, `a search of the Codex archive failed: ${String(error)}`)
    return codexUnavailable(guidance)
  }
}

/**
 * Hits from the index, turned into what goes back on the wire.
 *
 * `now` is injected rather than read, so this stays a pure function and the
 * elapsed wording is testable without freezing a clock — the same seam
 * `answerFor` makes, for the same reason.
 */
export function codexAnswerFor(
  hits: readonly CodexHit[],
  now: number,
  guidance: RecallGuidance,
  /**
   * What was searched for, so a long document can be quoted where it MATCHED.
   *
   * Optional, and the default is the old behaviour — the opening of the
   * document. A caller that has the query should pass it; `windowInto` explains
   * what it buys.
   */
  query = '',
): CodexRecallPayload {
  const terms = wanted(query)
  const kept: CodexRecalledHit[] = []
  for (const hit of hits) {
    if (kept.length >= MAX_HITS) break
    const said = safeText(hit.text, terms)
    if (said === '') continue
    const where = safeText(hit.place)
    kept.push({
      when: elapsedWords(now - hit.at),
      who: hit.who,
      said: fenced(SAID, said),
      // NORMALISED FIRST, then tested. This checked the raw value, so a place
      // that was only whitespace — or only a credential the mask removes —
      // produced a fence around nothing, which reads as a place she failed to
      // name. Empty stays empty, and the guidance tells her to say "an earlier
      // Codex conversation" instead.
      where: where === '' ? '' : fenced(WHERE, where),
      source: hit.kind,
    })
  }
  // EXPLICIT, not an empty list inside a `found`. Handing her
  // `{status:'found', hits:[]}` asks her to work out which sentence she is in.
  if (kept.length === 0) return { status: 'nothing', guidance: guidance.nothing }
  return { status: 'found', hits: kept, guidance: guidance.found }
}
