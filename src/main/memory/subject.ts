import { fenced } from '@shared/instructions'
import { tooLong } from '@shared/parse-persona'
import type { Turn } from '../store/turn-row'
import { transcriptOf } from './summarise'

/**
 * What one conversation was about, in a few words.
 *
 * ## Why this is not the summariser
 *
 * `summarise` rewrites her NOTE — what she carries about you across every
 * conversation — and `plan-v2.md` W5 is explicit that the two are different
 * jobs: *"though it rewrites her NOTE rather than titling a conversation."*
 * A note is cumulative and about a person; a subject is about one afternoon and
 * is never merged with anything.
 *
 * ## Why not the first line of the transcript
 *
 * W5 names that alternative and rejects it in the same sentence: *"the first
 * line of the transcript in a title's clothes is not the same thing and would
 * read as one."* A conversation that opens "hey" would be titled "hey", and a
 * column of those is worse than a column of times, because it looks like it
 * says something.
 *
 * ## Everything here is pure
 *
 * The wording is the part most likely to be wrong and the part a test can
 * actually hold, so the transport gets a finished prompt and has no opinion
 * about it — `summarise.ts`'s rule, and this follows it rather than inventing a
 * second one.
 */

/** The longest a subject may be. Beyond this it is a sentence, not a title. */
export const MAX_SUBJECT_CHARS = 80

/**
 * What the model may answer with.
 *
 * `maxLength` in the SCHEMA as well as checked on the way out. The schema is a
 * request and the check is the guarantee — `parseFields` draws the same line —
 * and a title that arrived at 4,000 characters would otherwise become a row
 * that pushes every other row off the pane.
 */
export const SUBJECT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['subject'],
  properties: {
    subject: { type: 'string', maxLength: MAX_SUBJECT_CHARS },
  },
}

/**
 * The whole prompt, as one string.
 *
 * The transcript is FENCED, like every other untrusted half in this codebase.
 * That is a mitigation rather than a guarantee, and it is not the only one:
 * whatever Codex is talked into answering still has to survive `subjectFrom`,
 * which refuses anything that is not a short single line.
 */
export function subjectPrompt(turns: readonly Turn[], instruction: string): string {
  return [instruction, '', fenced('conversation', transcriptOf(turns))].join('\n')
}

/**
 * The title from whatever came back, or null when nothing usable did.
 *
 * ## What it refuses, and why each one
 *
 * - **Not an object, or no string `subject`.** The transport answers `null` for
 *   a failure and this is the shape check for everything else.
 * - **Newlines.** A subject is drawn on one line under a row. A two-line answer
 *   would either be clipped — showing half a sentence as if it were the whole
 *   one — or push the row apart.
 * - **Empty after trimming.** "Nothing to say" is a real answer and it is
 *   spelled `null`, not `''`: a stored empty string is indistinguishable from a
 *   title somebody deleted, and the column would have two ways to mean nothing.
 * - **Over the bound.** Truncating would produce a title that stops mid-word
 *   and reads as a bug in the pane rather than a limit on the answer.
 *
 * Every refusal is the same answer — `null`, meaning the conversation keeps no
 * subject — because the caller has one rule: on null, store nothing. A
 * conversation without a title is the ordinary state and was the only state
 * until now.
 */
export function subjectFrom(answered: unknown): string | null {
  if (typeof answered !== 'object' || answered === null || Array.isArray(answered)) return null
  const said = (answered as { subject?: unknown }).subject
  if (typeof said !== 'string') return null
  // Every vertical separator, not just `\n`. A lone `\r`, U+2028 or U+2029
  // would pass a `\n` check and still break the line this is drawn on.
  if (/[\n\r\u2028\u2029]/.test(said)) return null
  const trimmed = said.trim()
  if (trimmed === '') return null
  /*
    `tooLong`, not `.length`, and the schema is why.

    `SUBJECT_SCHEMA` asks for `maxLength: 80` and JSON Schema measures that in
    CHARACTERS. `.length` measures UTF-16 code units, so a title of eighty
    emoji satisfies the schema this module sends and is refused by the check on
    the way back — the model answered exactly what it was asked for and the
    answer was thrown away.

    `tooLong` is the codebase's own answer to that mismatch and checks both
    ways: graphemes for the limit a person reads, code units for the one the
    wire pays for. So the bound the comment above promises still holds.
  */
  if (tooLong(trimmed, MAX_SUBJECT_CHARS)) return null
  return trimmed
}
