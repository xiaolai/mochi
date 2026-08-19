/**
 * Searching what was actually said, and answering before her next breath.
 *
 * The fast one: it reads an index this machine already holds, so there is
 * nothing to defer and nothing to say she is checking. `kind: 'immediate'` is
 * what the dispatch reads to settle the call outright.
 *
 * Everything about WHAT comes back — the three statuses, the fencing, the
 * bound on how much of a hit survives — is `memory/answer.ts`'s, and stays
 * there. A capability is a manifest, a kind and the wiring between the two;
 * pulling the payload rules in here would make them a second place to get the
 * "I looked and found nothing" / "I could not look" distinction wrong.
 */

import { recallPayloadFor, unavailable } from '../../main/memory/answer'
import { toMatchQuery } from '../../main/store/segment'
import type { Capability } from '../kind'

export const capability: Capability = {
  manifest: {
    name: 'recall_conversations',
    description:
      'Search what was actually said in your earlier conversations with this person. Answers immediately, so there is no need to say you are checking. Use it when they refer to something from an earlier conversation, or when you would otherwise be guessing at what was said. Each result says when it was said; attribute it to that conversation rather than presenting it as your own knowledge, and say plainly when nothing was found.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'The words to search for. Use the words they are likely to have actually said.',
        },
      },
      required: ['query'],
    },
  },
  kind: 'immediate',
  handler: (args, deps) => {
    // A query with nothing searchable in it is NOT a search that found nothing.
    //
    // `transcripts.search` returns `[]` WITHOUT running a query when the words
    // reduce to an empty FTS expression — an empty `MATCH` is a syntax error in
    // FTS5, so it cannot do otherwise. Passing that `[]` on produced
    // `status: 'nothing'`, whose guidance tells her "you searched and found
    // nothing". She would then say so, about a search that never ran, and the
    // person would believe their conversation was not in the archive.
    //
    // Asked with the STORE'S OWN predicate rather than a guess at it. A
    // `trim() === ''` check here was the first attempt and let `!!!` through —
    // it is not blank, and it still reduces to no terms. Two rules for "is
    // there anything to search for" is exactly the disagreement `segment.ts`
    // says produces a valid index, a valid query and an empty answer with
    // nothing failing anywhere.
    const query = args['query'] ?? ''
    if (toMatchQuery(query) === null) return unavailable()

    const store = deps.transcripts()
    const personaId = deps.wearing()
    // A `null` search means the store could not be asked, which
    // `recallPayloadFor` reports as `unavailable` — deliberately NOT the same
    // answer as searching and finding nothing. A model handed an empty object
    // picks one of those at random, and only one of them is true.
    const search =
      store === null || personaId === null ? null : () => store.search(personaId, query)
    return recallPayloadFor(search, deps.now())
  },
}
