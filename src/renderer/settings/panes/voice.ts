/**
 * Who she is, how she sounds, and what she says arriving and leaving.
 *
 * Every control here commits the moment it is left, exactly like every other
 * control in this window. It used to be the one pane that GATHERED
 * instead: its fields wrote into a whole-persona draft and waited for a Save
 * button at the foot of the sheet -- on a sheet where the shelf, the colour and
 * the shared rules all applied on the spot. One page, two rules, and nothing on
 * screen able to say which control obeyed which.
 *
 * A `Commit` takes the field's PATH as `parsePersona` names it, and a function
 * that builds the patch. Both matter:
 *
 * - the path is what lets a refusal be shown against the box that caused it
 *   rather than in a list at the foot of the pane;
 * - the patch is a function so it reads the persona at COMMIT time. Two fields
 *   of one moment sit side by side, and a patch built from the persona as it
 *   was when the pane was drawn would put the neighbour's committed value back.
 */

import { PRONOUNS, type Pronoun } from '@shared/pronoun'
import { VOICE_NAMES, type Persona, type VoiceName } from '@shared/persona'
import { el, field, select, textArea, textInput } from '../form'
import type { Copy } from '../copy'

/**
 * Every persona field this pane edits: where it lands, and which box it is.
 *
 * The key is the path `parsePersona` reports a problem against; the value is
 * the control's id in the document. One table, because three places need the
 * correspondence -- the builders below, the window's `commit`, and whatever
 * throws a held draft away -- and three copies of it is how a refusal comes to
 * be shown under the wrong box.
 */
export const PERSONA_CONTROLS = {
  name: 'name',
  addressUser: 'address',
  pronoun: 'pronoun',
  style: 'style',
  voice: 'voice',
  'greeting.instruction': 'greeting-instruction',
  'greeting.verbatim': 'greeting-verbatim',
  'farewell.instruction': 'farewell-instruction',
  'farewell.verbatim': 'farewell-verbatim',
} as const

export type PersonaPath = keyof typeof PERSONA_CONTROLS

export const PERSONA_PATHS = Object.keys(PERSONA_CONTROLS) as readonly PersonaPath[]

/**
 * Where one box's uncommitted text is filed.
 *
 * Scoped by PERSONA, not by control. The tray can switch character while this
 * window is open; a key of `name` alone would show A's
 * half-typed name against B's sheet and commit it to B on the next blur.
 */
export function holdKey(personaId: string, path: PersonaPath): string {
  return `${personaId}/${path}`
}

/** Every hold belonging to one character. What "discard my changes" clears. */
export function holdsFor(personaId: string): readonly string[] {
  return PERSONA_PATHS.map((path) => holdKey(personaId, path))
}

/**
 * Store one field, or say why it cannot be stored.
 *
 * `patch` is handed the persona as it stands at the moment of the commit —
 * never the one captured when the pane was built.
 */
export type Commit = (path: PersonaPath, patch: (person: Persona) => Partial<Persona>) => void

export function identitySection({ t, say }: Copy, person: Persona, commit: Commit): HTMLElement {
  return el('section', { class: 'section' }, [
    el('h2', { class: 'section-title' }, [document.createTextNode(say(t.identity))]),
    field(
      PERSONA_CONTROLS.name,
      t.name,
      textInput(holdKey(person.id, 'name'), person.name, (next) =>
        commit('name', () => ({ name: next })),
      ),
      say(t.nameHint),
    ),
    field(
      PERSONA_CONTROLS.addressUser,
      t.addressUser,
      textInput(holdKey(person.id, 'addressUser'), person.addressUser, (next) =>
        commit('addressUser', () => ({ addressUser: next })),
      ),
      say(t.addressUserHint),
    ),
    field(
      PERSONA_CONTROLS.pronoun,
      say(t.pronoun),
      select<Pronoun>(
        PRONOUNS,
        (value) => t.pronounLabel[value],
        person.pronoun,
        (next) => commit('pronoun', () => ({ pronoun: next })),
      ),
      t.pronounHint,
    ),
    /**
     * Her own prompt, and the only per-character one there is.
     *
     * It was editable ONLY by opening her folder and finding it in a JSON file,
     * while the box two sections up is labelled "Shared rules" and reaches every
     * character. So the one thing that makes a persona a persona was the one
     * thing this window could not change -- and the box that looked like it
     * could was the one that changes everybody.
     *
     * A `textArea`, because this is paragraphs and somebody is meant to READ it
     * before deciding whether to touch it. No placeholder: it is required, so an
     * empty box is refused rather than falling back to anything, and greyed text
     * offering a default that will not be used is a lie.
     */
    field(
      PERSONA_CONTROLS.style,
      t.personaStyle,
      textArea(
        PERSONA_CONTROLS.style,
        person.style,
        '',
        (next) => commit('style', () => ({ style: next })),
        holdKey(person.id, 'style'),
      ),
      say(t.personaStyleHint),
    ),
  ])
}

export function voiceSection({ t }: Copy, person: Persona, commit: Commit): HTMLElement {
  return el('section', { class: 'section' }, [
    el('h2', { class: 'section-title' }, [document.createTextNode(t.voiceSection)]),
    field(
      PERSONA_CONTROLS.voice,
      t.voice,
      select<VoiceName>(
        VOICE_NAMES,
        // Voice names are the service's identifiers and are NOT translated:
        // they are what you would type into the API, and a localised label
        // would make two names for one thing.
        (value) => value,
        person.voice,
        (next) => commit('voice', () => ({ voice: next })),
      ),
      t.voiceHint,
    ),
  ])
}

export function momentFields(
  { t, say }: Copy,
  person: Persona,
  which: 'greeting' | 'farewell',
  heading: string,
  commit: Commit,
): readonly HTMLElement[] {
  return [
    el('h2', { class: 'section-title' }, [document.createTextNode(heading)]),
    field(
      PERSONA_CONTROLS[`${which}.instruction`],
      say(t.instruction),
      textInput(holdKey(person.id, `${which}.instruction`), person[which].instruction, (next) =>
        // `live[which]`, not the persona this pane was drawn from: an edit to
        // the OTHER field of the same moment has already been committed, and
        // rebuilding the moment from a stale copy would put it back.
        commit(`${which}.instruction`, (live) => ({
          [which]: { ...live[which], instruction: next },
        })),
      ),
    ),
    field(
      PERSONA_CONTROLS[`${which}.verbatim`],
      t.verbatim,
      textInput(holdKey(person.id, `${which}.verbatim`), person[which].verbatim ?? '', (next) =>
        // Empty string collapses to null at the edge, so "no override" has one
        // representation on the wire rather than two the far side has to agree
        // about.
        commit(`${which}.verbatim`, (live) => ({
          [which]: { ...live[which], verbatim: next.trim() === '' ? null : next },
        })),
      ),
      say(t.verbatimHint),
    ),
  ]
}
