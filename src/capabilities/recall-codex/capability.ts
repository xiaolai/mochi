/**
 * Searching what they already told Codex, and answering before her next breath.
 *
 * ## Borrowing, not remembering — and that is why this is a second tool
 *
 * The README says, of what she remembers: *"a note you can read, edit and
 * delete, not something accumulating invisibly in a context window."* A
 * nine-thousand-thread Codex archive is the opposite of that sentence. It is
 * uncurated, it is not editable through this app, and nobody wrote it for her.
 *
 * That does not kill the capability; it decides its shape. This is a SEPARATE
 * capability with its own switch rather than an extension of
 * `recall_conversations` — different provenance, different promise, different
 * off-switch — and every hit is attributed out loud, with which repository it
 * came from and whose line it was. One merged tool would have made attribution
 * a field she can drop rather than a tool she chose.
 *
 * ## `kind: 'immediate'`, and what pays for that
 *
 * The steady-state path is an index this machine already holds: 32 ms to decide
 * what has changed, single-digit milliseconds to answer. The COLD build is not
 * immediate — 6,141 ms on the measured archive, reading alone — so it is a
 * background job, and the capability is simply not offered until it has
 * finished. `deps.codexArchive()` answering null is what enforces that, and it
 * is the same null a withheld permission produces.
 *
 * Everything about WHAT comes back — the statuses, the masking, the fencing,
 * the bound on a hit — is `memory/codex-answer.ts`'s and stays there, for the
 * reason `recall-conversations/capability.ts` gives: a capability is a manifest,
 * a kind and the wiring between them.
 */

import { codexRecallPayloadFor, codexUnavailable } from '../../main/memory/codex-answer'
import { MAX_HITS } from '../../main/memory/answer'
import { toMatchQuery } from '../../main/store/segment'
import type { Capability } from '../kind'
import type { CodexRecall } from '../../main/codex/archive/index-store'

/**
 * How many hits are asked of the index, against the five that survive.
 *
 * NOT `MAX_HITS`. A document can be dropped AFTER the search — one whose text
 * masks away to nothing, or which flattens to an empty line — so asking for
 * exactly five would quietly return three. Headroom rather than a second bound:
 * `codexAnswerFor` is what decides how many she is handed.
 */
const SEARCHED = MAX_HITS * 4

/**
 * The longest query this will act on.
 *
 * `toMatchQuery` runs `Intl.Segmenter` over every character, synchronously, on
 * the main thread — the same thread that draws her window and receives what
 * somebody is saying. The argument arrives from a model, through a renderer,
 * and nothing between here and there bounds its length, so a megabyte of text
 * is a way to make this process stop answering.
 *
 * Generous: a remembered phrase is a sentence, and 2,000 characters is far more
 * than anybody says out loud. Over it the query is refused as unsearchable,
 * which is already one of the answers she has — she says she could not look
 * rather than being handed nothing and guessing why.
 */
export const MAX_QUERY_CHARS = 2_000

export const capability: Capability = {
  manifest: {
    name: 'recall_codex',
    description:
      'Search their earlier sessions with Codex, the coding tool they use on this machine — both what they asked it and what it answered, including documents they pasted into it. This is their history with a tool, not your conversations with them, so use it when they refer to something they worked on, asked Codex about, or were told by Codex, and say where each result came from rather than presenting it as your own knowledge. Answers immediately, so there is no need to say you are checking. Say plainly when nothing was found, and plainly when you could not look.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'The words to search for. Use the words they are likely to have actually typed or said.',
        },
      },
      required: ['query'],
    },
  },
  kind: 'immediate',
  handler: (args, deps) => {
    /** The three sentences, resolved once for every path out of here. */
    const guidance = {
      found: deps.prompt('recallCodex.guidance'),
      nothing: deps.prompt('recallCodex.nothing'),
      unavailable: deps.prompt('recallCodex.unavailable'),
    }
    /*
      A query with nothing searchable in it is NOT a search that found nothing.

      Asked with the INDEX'S OWN predicate rather than a guess at it, exactly as
      `recall_conversations` does and for the defect that file records: an empty
      MATCH is a syntax error in FTS5, so the store returns `[]` without running
      a query, and passing that on produced `status: 'nothing'` — she would then
      say she had searched and found nothing, about a search that never ran.
      `trim() === ''` is not the same test: `!!!` is not blank and still reduces
      to no terms.
    */
    const query = args['query'] ?? ''
    // BOUNDED BEFORE SEGMENTING, not after: the cost this guards against is the
    // segmentation itself. See `MAX_QUERY_CHARS`.
    if (query.length > MAX_QUERY_CHARS) return codexUnavailable(guidance)
    if (toMatchQuery(query) === null) return codexUnavailable(guidance)

    const archive: CodexRecall | null = deps.codexArchive()
    /*
      NULL is three situations and one answer.

      Not permitted, not built yet, or not readable — all of them are "I could
      not look", which is deliberately NOT the same answer as looking and
      finding nothing. A model handed an empty object picks one of those at
      random and only one of them is true.
    */
    const search = archive === null ? null : () => archive.search(query, SEARCHED)
    // The QUERY goes through, so a hit in a long pasted document is quoted where
    // it matched rather than from the top of the file. See `windowInto`.
    return codexRecallPayloadFor(search, deps.now(), guidance, query)
  },
}
