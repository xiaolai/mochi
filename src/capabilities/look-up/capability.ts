import { fenced } from '@shared/instructions'
import type { Capability } from '../kind'

/**
 * How much one lookup may hand back.
 *
 * A collection may legally hold 500 entries of 4,000 graphemes, so an unbounded
 * listing is megabytes in a single tool result that then rides the session for
 * the rest of the conversation. Names are cheap and always complete; values are
 * capped, and the caller is told when it was cut rather than left to assume the
 * collection was small.
 */
const MOST_ENTRIES = 25
const MOST_CHARACTERS = 4_000

/**
 * Read back what she kept.
 *
 * With no `key`, this LISTS — collections when given nothing, entries when
 * given a collection. That is deliberate and is half the answer to the problem
 * a store has: she cannot ask for a name she does not know she filed. The other
 * half is the index in her prompt, which tells her the collections exist at all.
 */
function cannot(guidance: string): { status: 'refused'; guidance: string } {
  return { status: 'refused', guidance }
}

export const capability: Capability = {
  manifest: {
    name: 'look_up',
    description:
      'Read back something you kept earlier. Give nothing to see what collections you hold, a collection to see what is in it, or a collection and a name to read one entry. Call this before saying you do not know something they may have asked you to keep.',
    parameters: {
      type: 'object',
      properties: {
        collection: {
          type: 'string',
          description: 'Which collection to read. Leave this out to list the collections you hold.',
        },
        key: {
          type: 'string',
          description: 'Which entry to read. Leave this out to list the collection.',
        },
      },
      required: [],
    },
  },
  kind: 'immediate',
  handler: (args, deps) => {
    const personaId = deps.wearing()
    const store = deps.transcripts()
    if (personaId === null || store === null) return cannot(deps.prompt('kept.noCharacter'))

    const collection = String(args['collection'] ?? '')
    const key = String(args['key'] ?? '')

    // A key with no collection is not a listing request — it is a lookup with
    // half its address missing. Answering it by listing everything would look
    // like the entry did not exist.
    if (collection === '' && key !== '') return cannot(deps.prompt('kept.badName'))

    if (collection === '') {
      const held = store.kept.collections(personaId)
      if (held.length === 0) return cannot(deps.prompt('kept.nothingKeptAtAll'))
      return {
        status: 'done',
        collections: held.map((one) => ({ collection: one.collection, entries: one.entries })),
      }
    }

    if (key === '') {
      const entries = store.kept.inCollection(personaId, collection, MOST_ENTRIES)
      if (entries.length === 0) return cannot(deps.prompt('kept.nothingUnderThatName'))
      /*
        Every KEY, always. Only the documents are cut.

        Truncating the list hid names permanently: there is no cursor, so one
        oversized document could push every remaining name out of reach and she
        would report them as not existing. Names are cheap — 500 of them at 64
        graphemes is nothing next to one document — so they all come back.
      */
      const keys = entries.map((one) => one.key)
      const shown: { key: string; value: string }[] = []
      let spent = 0
      for (const entry of entries) {
        if (spent + entry.value.length > MOST_CHARACTERS) break
        spent += entry.value.length
        shown.push({ key: entry.key, value: fenced('kept', entry.value) })
      }
      return {
        status: 'done',
        keys,
        entries: shown,
        // Said rather than implied: a truncated list that looks complete is how
        // she comes to state confidently that something is not there.
        unread: keys.length - shown.length,
        guidance: deps.prompt('kept.isData'),
      }
    }

    const one = store.kept.one(personaId, collection, key)
    if (one === null) return cannot(deps.prompt('kept.nothingUnderThatName'))
    return {
      status: 'done',
      key: one.key,
      value: fenced('kept', one.value),
      guidance: deps.prompt('kept.isData'),
    }
  },
}
