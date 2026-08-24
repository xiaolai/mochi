import type { Capability } from '../kind'

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

    if (collection === '') {
      const held = store.kept.collections(personaId)
      if (held.length === 0) return cannot(deps.prompt('kept.nothingKeptAtAll'))
      return {
        status: 'done',
        collections: held.map((one) => ({ collection: one.collection, entries: one.entries })),
      }
    }

    if (key === '') {
      const entries = store.kept.inCollection(personaId, collection)
      if (entries.length === 0) return cannot(deps.prompt('kept.nothingUnderThatName'))
      return {
        status: 'done',
        entries: entries.map((one) => ({ key: one.key, value: one.value })),
      }
    }

    const one = store.kept.one(personaId, collection, key)
    if (one === null) return cannot(deps.prompt('kept.nothingUnderThatName'))
    return { status: 'done', key: one.key, value: one.value }
  },
}
