import type { CodexSpeaker, HeaderRow, SpokenRow } from './read'
import { startedByAPerson } from './read'

/**
 * One row of somebody else's archive, turned into the pieces this can index.
 *
 * Pure, and separate from the reader for the reason `turn-row.ts` is separate
 * from the store: the two hardest rules in this feature are both about how a
 * fragment is ATTRIBUTED, and neither can be tested against a live database.
 *
 * ## Rule one: there is exactly one header text, not three
 *
 * `threads` looks like it carries three descriptions of a conversation —
 * `title`, `first_user_message` and `preview`. Measured, they are the same
 * text:
 *
 * | | |
 * | --- | --- |
 * | `preview` = `first_user_message` | 9,293 rows |
 * | `preview` ≠ `first_user_message` | **0 rows** |
 * | `title` = `first_user_message` | 9,079 of 9,099 |
 * | titles over 300 characters | **8,223** |
 *
 * Indexing all three would enter every document three times, inflating the
 * corpus and skewing term-frequency ranking toward threads that happen to have
 * more of the columns populated. And `title` is not a title: 8,223 of them are
 * longer than the bound that exists for quoted speech, so it cannot be used as
 * a label either.
 *
 * So: **one canonical text per thread** — `first_user_message`, falling back to
 * `preview`, falling back to `title` — indexed once.
 *
 * That column is also often not a "first message" in any conversational sense:
 * 4,411 of 9,093 values are over 2,000 characters and the longest is 148,357.
 * Those are pasted documents, and she must not attribute a 145 KB paste as
 * "what you said at the start" — hence `kind`, which distinguishes an opening
 * remark from a pasted body without her having to guess.
 *
 * ## Rule two: the voice blob has two speakers and cannot carry one `who`
 *
 * The `<realtime_delegation>` header — the record this whole feature exists to
 * find — is a `first_user_message` containing an `<input>` and a
 * `<transcript_delta>` of interleaved `user:` and `assistant:` lines. Indexed
 * whole, a search matching an assistant line inside it would be reported as
 * **"you said"**. It is the only such wrapper in 9,099 headers, so generic
 * scaffolding is not a problem here; this specific one is.
 *
 * It is therefore split into per-speaker fragments, each carrying its own
 * `who`. Anything the split cannot attribute — including the `<input>`, which
 * has no speaker label — is `unknown`, and she says "somewhere in that
 * conversation" rather than naming a person. Being wrong in that direction
 * costs a vaguer sentence; being wrong in the other puts a tool's words in
 * somebody's mouth.
 */

/** Where a fragment came from, which decides how she may describe it. */
export type FragmentKind =
  /** The opening of a thread, short enough to be one. */
  | 'opening'
  /** The opening FIELD of a thread, holding a pasted document. */
  | 'pasted'
  /** A projected turn: what was actually said, in order. */
  | 'said'

export interface Fragment {
  /** `''` for a header fragment: `thread_realtime_items` has no turn either. */
  readonly turnId: string
  readonly itemId: string
  readonly kind: FragmentKind
  readonly who: CodexSpeaker
  readonly at: number
  readonly text: string
}

/**
 * Where an opening stops being an opening.
 *
 * 2,000 characters, from the measurement above: 4,411 of 9,093 header values
 * are longer than this and are pasted files rather than remarks. The number is
 * a property of the corpus and is named here so a reader can check it against
 * the corpus rather than against taste.
 */
export const PASTED_CHARS = 2_000

/**
 * How a delegation blob opens, and how a well-formed one closes.
 *
 * ## Two tests, because the two failures pull in opposite directions
 *
 * It began as a bare `includes`, which was wrong in the obvious direction: a
 * document that merely QUOTED the encoding — an example in a design note, a bug
 * report about it — was split on whatever `user:` lines came after and called an
 * opening however long it was.
 *
 * Anchoring both ends fixed that and broke the other direction, which matters
 * more. A blob that opens like a delegation and does not close like one stopped
 * being recognised at all, so it fell through to the ordinary path and was
 * attributed to the PERSON — and its `assistant:` lines with it. That is exactly
 * the misattribution this whole file exists to prevent, arriving through the fix
 * for something else.
 *
 * So: `OPENS` decides whether this is delegation-shaped at all, and `CLOSES`
 * decides whether it is well-formed enough to SPLIT. Something that opens like
 * one and does not close like one is kept whole and attributed to nobody —
 * which is the honest answer for a record this build cannot read.
 */
/** What `threads.thread_source` says on a thread that came from a voice session. */
const REALTIME_VOICE = 'realtime_voice'

const OPENS = /^\s*<realtime_delegation>/

const CLOSES = /<\/realtime_delegation>\s*$/

/** `<input>…</input>`, which is one line in every instance measured. */
const INPUT = /<input>([\s\S]*?)<\/input>/

/** The transcript block, to its closing tag or to the end of the blob. */
const TRANSCRIPT = /<transcript_delta>([\s\S]*?)(?:<\/transcript_delta>|<\/realtime_delegation>|$)/

/** A line that names its speaker. Both labels are Codex's own spelling. */
const SPEAKER_LINE = /^(user|assistant):\s?(.*)$/

/**
 * The one text a thread is indexed under. See rule one in the header.
 *
 * The order is deliberate and is not "longest wins": `first_user_message` is
 * the column Codex fills from the conversation, `preview` is its duplicate, and
 * `title` is the same text a third time. Falling back rather than concatenating
 * is what stops one document being entered twice.
 */
export function canonicalHeaderText(header: HeaderRow): string {
  if (header.firstUserMessage !== '') return header.firstUserMessage
  if (header.preview !== '') return header.preview
  return header.title
}

/** When a header is dated, tolerating Codex's nullable millisecond columns. */
function headerAt(header: HeaderRow): number {
  if (header.createdAtMs > 0) return header.createdAtMs
  return header.updatedAtMs
}

/**
 * The pieces of one `<realtime_delegation>` blob, each with its own speaker.
 *
 * Returns null when the text is not a delegation, so the caller can take the
 * ordinary path rather than this function having to answer for both.
 */
interface Piece {
  readonly who: CodexSpeaker
  readonly text: string
  /**
   * What this piece IS, which is not the same for every piece of a blob.
   *
   * The transcript lines are turns that were taken, in order — `said`. The
   * `<input>` is how the delegation began — `opening`. Labelling them all
   * `opening` made her able to describe the fourth thing Codex said as how the
   * conversation started, which the guidance defines `opening` to mean.
   */
  readonly kind: FragmentKind
}

interface Delegation {
  /** Whether it closes as well as opens. Only a well-formed one may be split. */
  readonly wellFormed: boolean
  readonly pieces: readonly Piece[]
}

function delegationPieces(header: HeaderRow, text: string): Delegation | null {
  if (!OPENS.test(text)) return null
  /*
    CODEX'S OWN DISCRIMINATOR, and it is the one that separates the record from
    a description of it.

    The tags alone cannot: a pasted XML document bounded by them, containing an
    example `<transcript_delta>`, is a document about the encoding rather than an
    instance of it — and splitting it would attribute its example lines to real
    speakers. `thread_source` is what Codex sets on a thread that actually came
    from a voice session, and the F4 thread on the measured machine carries
    `realtime_voice`.

    Anything else that is delegation-SHAPED is still recognised — it is just kept
    whole and attributed to nobody, which is what `wellFormed: false` means. The
    cost of being wrong here is a vaguer sentence; the cost of the split being
    wrong is a tool's words in somebody's mouth.
  */
  if (header.threadSource !== REALTIME_VOICE) {
    return { wellFormed: false, pieces: [{ who: 'unknown', text, kind: 'opening' }] }
  }
  if (!CLOSES.test(text)) {
    // Delegation-shaped and not a delegation. Not split — a half wrapper is no
    // evidence of who said what — and not attributed to anybody either.
    return { wellFormed: false, pieces: [{ who: 'unknown', text, kind: 'opening' }] }
  }
  const pieces: Piece[] = []

  const input = INPUT.exec(text)
  if (input !== null && input[1] !== undefined && input[1].trim() !== '') {
    /*
      UNKNOWN, and this is the judgement call in the module.

      `<input>` is the thing the voice session handed to Codex, so it is very
      probably the person's words. "Very probably" is not what `who` claims:
      the element carries no speaker label, and it sits inside a blob whose
      other half is explicitly two-speaker. Calling it theirs would be inferring
      an attribution from a tag name, which is the shape of mistake this whole
      field exists to prevent.
    */
    pieces.push({ who: 'unknown', text: input[1].trim(), kind: 'opening' })
  }

  const transcript = TRANSCRIPT.exec(text)
  if (transcript !== null && transcript[1] !== undefined) {
    let current: Piece | null = null
    for (const line of transcript[1].split('\n')) {
      const labelled = SPEAKER_LINE.exec(line.trim())
      if (labelled !== null) {
        if (current !== null) pieces.push(current)
        current = {
          who: labelled[1] === 'user' ? 'them' : 'codex',
          text: labelled[2] ?? '',
          // A turn that was taken, in order. NOT an opening: only the `<input>`
          // above is how this began.
          kind: 'said',
        }
        continue
      }
      // A continuation of whoever spoke last. A line before any label belongs
      // to nobody, which is a real state and not a parse failure.
      if (current === null) {
        if (line.trim() !== '') {
          pieces.push({ who: 'unknown', text: line.trim(), kind: 'said' })
        }
        continue
      }
      current = { ...current, text: `${current.text}\n${line}` }
    }
    if (current !== null) pieces.push(current)
  }

  /*
    NOTHING PARSED is still a fragment, and it is `unknown`.

    A delegation encoding this build does not recognise must not vanish from the
    index — "I could not read that conversation" and "there was nothing in it"
    are the distinction the whole feature is arranged around. So the blob is
    kept whole and attributed to nobody.
  */
  if (pieces.length === 0) {
    return { wellFormed: true, pieces: [{ who: 'unknown', text, kind: 'opening' }] }
  }
  return { wellFormed: true, pieces: pieces.filter((piece) => piece.text.trim() !== '') }
}

/**
 * What one thread's header contributes to the index.
 *
 * Usually one fragment. More than one only for the delegation encoding, which
 * is one row in 9,099 and is the row this feature was built for.
 */
export function headerFragments(header: HeaderRow): readonly Fragment[] {
  const text = canonicalHeaderText(header)
  if (text.trim() === '') return []
  const at = headerAt(header)

  const delegation = delegationPieces(header, text)
  if (delegation !== null && delegation.wellFormed) {
    return delegation.pieces.map((piece, index) => ({
      turnId: '',
      itemId: `header:${String(index)}`,
      // The PIECE's own kind: the transcript lines are turns and the `<input>`
      // is the opening. None of them is a pasted body, whatever the blob around
      // them weighs.
      kind: piece.kind,
      who: piece.who,
      at,
      text: piece.text,
    }))
  }

  return [
    {
      turnId: '',
      itemId: 'header:0',
      kind: text.length > PASTED_CHARS ? 'pasted' : 'opening',
      /*
        A sub-agent's opening message was written by another agent, not by the
        person — about sixty threads on the measured machine. `source` is read
        as a string and never as an enum, because that is what those rows put
        in it.
      */
      /*
        Nobody, when it opened like a delegation and did not close like one.

        The ordinary rule below is about who STARTED the thread. It cannot apply
        to a record whose own encoding says two people are in it and which this
        build could not read: attributing that to the person would put a tool's
        lines in their mouth, which is the one outcome this file refuses.
      */
      who: delegation !== null ? 'unknown' : startedByAPerson(header.source) ? 'them' : 'unknown',
      at,
      text,
    },
  ]
}

/**
 * What one projected row contributes, or null when there is nothing in it.
 *
 * Null rather than an empty fragment: a row whose text this build cannot read
 * is a row to skip, and an empty document in an FTS index is a hit that can
 * never be quoted.
 */
export function itemFragment(row: SpokenRow): Fragment | null {
  if (row.text.trim() === '') return null
  return {
    turnId: row.turnId,
    itemId: row.itemId,
    kind: 'said',
    who: row.who,
    at: row.createdAtMs,
    text: row.text,
  }
}

/**
 * The repository a conversation happened in, as one word she can say.
 *
 * The basename of `cwd`, because that is what somebody calls the project out
 * loud — "in smartcube-web-bluetooth" — and the full path is neither sayable
 * nor anybody's business to have read aloud. Empty when Codex recorded no
 * directory, which the payload treats as "an earlier Codex conversation"
 * rather than inventing a place.
 *
 * NOT the title. `title` is a duplicate of the opening message in 9,079 rows
 * and is over 300 characters in 8,223 of them, so a label built from it would
 * be a paragraph.
 */
export function placeOf(cwd: string): string {
  const trimmed = cwd.replace(/[/\\]+$/, '')
  if (trimmed === '') return ''
  const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return cut === -1 ? trimmed : trimmed.slice(cut + 1)
}
