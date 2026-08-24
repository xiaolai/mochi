import { KEPT_LIMITS } from '../../main/store/kept'
import type { Capability } from '../kind'

/**
 * Write one entry into her own store.
 *
 * The general form of `remember_this`: that one keeps a sentence about the
 * person in a single document, this keeps a named document in a named
 * collection. Both write STATE. Neither touches what she IS — a manifest hook
 * was considered and rejected, because a downloaded character able to edit its
 * own manifest can rewrite what any tool claims to do.
 *
 * She never says which persona's store to write to. `deps.wearing()` answers
 * that, which is why one character cannot reach another's entries.
 */
function cannot(guidance: string): { status: 'refused'; guidance: string } {
  return { status: 'refused', guidance }
}

export const capability: Capability = {
  manifest: {
    name: 'keep',
    description:
      'Write something into your own long-term store, under a collection and a name you choose. Call this when they ask you to keep, note, track or remember something that has a NAME — a project, a preference, a person. For a single loose fact about them, use remember_this instead. Re-using a name replaces what was there, so use the same name when you are correcting yourself.',
    parameters: {
      type: 'object',
      properties: {
        collection: {
          type: 'string',
          description:
            'What kind of thing this is, as one plain lowercase word or hyphenated words — for example `projects`, `preferences`, `people`.',
        },
        key: {
          type: 'string',
          description:
            'What this particular entry is called, in the same plain lowercase form. Re-using one replaces what it held.',
        },
        value: {
          type: 'string',
          description: 'What to keep under that name, in your own words.',
        },
      },
      required: ['collection', 'key', 'value'],
    },
  },
  kind: 'immediate',
  handler: (args, deps) => {
    const personaId = deps.wearing()
    const store = deps.transcripts()
    if (personaId === null || store === null) return cannot(deps.prompt('kept.noCharacter'))

    const wrote = store.kept.put(
      personaId,
      String(args['collection'] ?? ''),
      String(args['key'] ?? ''),
      String(args['value'] ?? ''),
    )
    switch (wrote.refused) {
      case 'bad-collection':
      case 'bad-key':
        return cannot(deps.prompt('kept.badName'))
      case 'empty-value':
        return cannot(deps.prompt('kept.nothingToKeep'))
      case 'value-too-long':
        return cannot(deps.prompt('kept.tooLong'))
      case 'full':
        return cannot(deps.prompt('kept.full'))
      default:
        break
    }

    /*
      A replacement says what it replaced.

      `memory.ts` keeps one step back for notes because "one step back is what
      makes an automatic rewrite reviewable", and a store she writes to
      unprompted has the same problem: a silent overwrite is discovered when she
      says something wrong out loud, which is the worst discovery channel there
      is.
    */
    return {
      status: 'done',
      guidance:
        wrote.previous === null ? deps.prompt('kept.written') : deps.prompt('kept.replaced'),
      replaced: wrote.previous,
      room: KEPT_LIMITS.rows,
    }
  },
}
