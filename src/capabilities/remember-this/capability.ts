/**
 * Writing one line into her long-term note, because somebody asked her to.
 *
 * ## Assembly, not invention
 *
 * Every rule this needs already exists and is tested elsewhere, and every one
 * of them is REUSED rather than restated:
 *
 * - `entryProblem` decides what a note may contain. One function for this
 *   caller and the summariser's whole-note rewrite, because two copies of that
 *   rule would be two places to get it subtly differently and the weaker copy
 *   is the one that would matter. It is a DENYLIST and is not claimed to be
 *   more: it catches a URL with a scheme, the path shapes it names, another
 *   character's id, and a handful of shell constructs — `./notes.txt` and a
 *   bare hostname go through. Its own comment states that residual risk and
 *   states what holds instead: the note is data inside a fenced block rather
 *   than an address anything resolves. Widening it is a decision about what a
 *   note may contain, which belongs there and not here.
 * - `noteWith` decides where the line goes and refuses rather than truncating
 *   when the note is full. It uses a replacement CALLBACK because this line is
 *   model output, and a `$&` inside a replacement string would splice the
 *   heading into itself and corrupt durable memory.
 * - `recallState` and `remember` are the store, and `remember` keeps the
 *   previous version one deep so an unwanted line can be put back.
 *
 * `recallState` and NOT `recall`, which is the whole of one bug. `recall`
 * answers "" for a note that could not be read as well as for one that is not
 * there, and appending to that "" would save a one-line note over the
 * unreadable file and record "" as the version to undo to. A note nobody can
 * parse may still be recoverable by hand; one that has been overwritten is
 * gone.
 *
 * ## It was declared and unbuilt, which is the defect this layout removes
 *
 * `remember_this` shipped as a manifest with `notBuilt` behind it: she was told
 * she could remember things, tried, and was told she could not. Under this
 * layout the manifest cannot exist without the handler beside it, so the state
 * is a missing property rather than a sentence she says out loud.
 *
 * ## Every refusal is a sentence, not a status
 *
 * A note that was not written and a note that was are different things to say,
 * and a model handed a bare failure picks one at random. Each `cannot` below
 * carries what she should say and, where there is one, what the person could
 * do about it.
 */

import { looksEmpty, oneLine } from '@shared/text'
import { entryProblem, MAX_ENTRY_CHARS, noteWith } from '../../main/memory/summarise'
import { recallState, remember } from '../../main/store/memory'
import type { Capability } from '../kind'

function cannot(guidance: string): { status: 'refused'; guidance: string } {
  return { status: 'refused', guidance }
}

export const capability: Capability = {
  manifest: {
    name: 'remember_this',
    description:
      'Write one short fact into your long-term notes about this person. Call this ONLY when they have asked you to remember something, in those words or plainly meaning it. Do not call it because something seemed interesting or worth keeping — everything said is already reviewed later. Record what is true about them, not what was said in this conversation.',
    parameters: {
      type: 'object',
      properties: {
        note: {
          type: 'string',
          description: 'The single fact to keep, as one plain sentence about the person.',
        },
      },
      required: ['note'],
    },
  },
  kind: 'immediate',
  handler: (args, deps) => {
    // FLATTENED first, with `oneLine` rather than a local `\s+` collapse: the
    // note is a markdown list and a newline in this line would forge a second
    // bullet. `oneLine` also removes the C1 block, which every renderer treats
    // as a line break and a bare `\s+` leaves intact.
    const line = oneLine(args['note'] ?? '')
    // `looksEmpty`, not `=== ''`. A zero-width space or a bidi mark survives
    // `oneLine`, is not the empty string, and would be filed as a fact that
    // renders as nothing — a bullet in her memory that nobody can see or
    // remove. The repository already has this helper for exactly that.
    if (looksEmpty(line)) {
      return cannot('Nothing was said to remember. Ask them what they want kept.')
    }
    // The same ceiling the summariser's entries have, and the same constant. A
    // paragraph here would sit in the note until the next rewrite trimmed it,
    // and "one plain sentence" is what the manifest asked for.
    if (line.length > MAX_ENTRY_CHARS) {
      return cannot(
        'That is too long to keep as one note. Ask them for the short version — one sentence.',
      )
    }

    const personaId = deps.wearing()
    if (personaId === null) {
      // Nobody is worn, so there is no note this belongs to. Filing it under a
      // guess would put it in a stranger's memory.
      return cannot('You could not save that just now. Say so plainly rather than pretending.')
    }

    const why = entryProblem(line, deps.otherPersonaIds())
    if (why !== null) {
      // NAMED, because the alternative is a refusal she repeats without ever
      // being able to say what would work instead.
      return cannot(
        why === 'names-a-persona'
          ? 'That names another character, and notes are kept per character. Say you cannot ' +
              'keep that one, and offer to write it in your own words instead.'
          : `That looks like a ${why} rather than something about them. Notes are about the ` +
              'person — say so, and offer to keep the plain version.',
      )
    }

    const userData = deps.userData()
    const current = recallState(userData, personaId)
    if (!current.ok) {
      // REFUSED, and the file is left exactly as it is. Writing here would
      // replace something unreadable with one line and file "" as the undo.
      return cannot(
        'Your notes could not be read, so nothing was written — and nothing was ' +
          'overwritten either. Say that plainly: the note is still on disk and needs ' +
          'looking at before anything more can be kept.',
      )
    }
    const next = noteWith(current.notes, line)
    if (next === null) {
      // REFUSED rather than truncated. Truncating would cut the old note to fit
      // the new line, which is the one direction nobody asked for.
      return cannot(
        'Your notes are full, so that was not saved. Say so, and that something already ' +
          'in them would have to go first.',
      )
    }

    // NOTHING CHANGED is not the same as saved, and saying "saved" for it is a
    // false statement she then repeats. `noteWith` returns the note untouched
    // when the line is already somewhere in it — including as part of a longer
    // sentence written under a different heading — so this is reachable without
    // anybody asking twice.
    if (next === current.notes) {
      return {
        status: 'already-known',
        note: line,
        guidance:
          'That is already in your notes, so nothing was added. Say you already have it ' +
          'rather than saying you have just written it down.',
      }
    }

    remember(userData, personaId, next)
    return {
      status: 'saved',
      note: line,
      guidance:
        'It is written down and will still be there next time. Say so plainly and briefly ' +
        '— do not read the whole note back.',
    }
  },
}
