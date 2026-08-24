import type { Capability } from '../kind'

/**
 * Remove one entry from her own store.
 *
 * Deliberately one entry at a time. Clearing a whole collection is a gesture
 * that belongs to the person, on the shelf, where it can be seen before it
 * happens — the same reason permanent deletion of conversations needs two
 * gestures rather than one tool call.
 */
function cannot(guidance: string): { status: 'refused'; guidance: string } {
  return { status: 'refused', guidance }
}

export const capability: Capability = {
  manifest: {
    name: 'forget_kept',
    description:
      'Remove one entry you kept earlier. Call this ONLY when they have asked you to forget or drop something in those words, or plainly meaning it. Do not call it to tidy up.',
    parameters: {
      type: 'object',
      properties: {
        collection: { type: 'string', description: 'Which collection the entry is in.' },
        key: { type: 'string', description: 'Which entry to forget.' },
      },
      required: ['collection', 'key'],
    },
  },
  kind: 'immediate',
  handler: (args, deps) => {
    const personaId = deps.wearing()
    const store = deps.transcripts()
    if (personaId === null || store === null) return cannot(deps.prompt('kept.noCharacter'))

    const gone = store.kept.forgetOne(
      personaId,
      String(args['collection'] ?? ''),
      String(args['key'] ?? ''),
    )
    if (!gone) return cannot(deps.prompt('kept.nothingUnderThatName'))
    return { status: 'done', guidance: deps.prompt('kept.forgotten') }
  },
}
