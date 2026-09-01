import { type Field } from '../../field'
import { SAYS } from '../shelf-says'
import { type ShelfCharacter } from '@shared/history-window'

/**
 * Everything on HER sheet that somebody could go looking for, named once.
 *
 * The counterpart of a machine pane's `fields`, and it exists for the same
 * reason: a name written in the middle of the builder that draws it cannot be
 * read by anything else, so the moment search needs the list it gets a second
 * copy and the two drift. `Field` carries that argument in full.
 *
 * ## Why it is a separate list rather than a seventh `Pane`
 *
 * A `Pane` is a group on the machine's page: it has a nav entry, an attention
 * dot and a `render` that takes a `SettingsView`. Her sheet has none of those.
 * It is one scrolling document about a character, drawn from a `ShelfView`, and
 * `panes.ts` argues at length that the two must not be folded together — "the
 * machine is not her". Making her sheet a pane to reuse one interface would put
 * her back inside the machine's page in everything but where it is drawn.
 *
 * What IS shared is the field vocabulary and the `data-field` anchor, which is
 * the part search needs.
 *
 * ## Her grants are not here
 *
 * They are view III of her page and they ARE a `Pane` — `MAY_DO`, which never
 * moved to the machine's navigation. `jump.ts` reads them from there.
 */

/**
 * The sections her sheet always draws, in the order it draws them.
 *
 * Labels are `ByPronoun` tables wherever the heading is about her, read at the
 * point of drawing exactly as a pane's are. Keywords never are — a search index
 * that held different words per worn character is the failure `Field`
 * records and `pronoun-copy.test.ts` enforces.
 */
export const HER_FIELDS = {
  who: {
    id: 'her-who',
    label: SAYS.whoHead,
    // The three pronouns are NOT keywords, though this is the section that
    // chooses one. A keyword is matched against typed text, so listing them
    // would put gendered words into a search index — the rule `Field`
    // states and `pronoun-copy.test.ts` enforces. "pronoun" reaches it.
    keywords: ['name', 'called', 'calls you', 'pronoun', 'rename'],
  },
  colour: {
    id: 'her-appearance',
    label: 'Appearance',
    keywords: ['colour', 'color', 'theme', 'avatar', 'face', 'look', 'dark', 'light'],
  },
  size: {
    id: 'her-size',
    label: SAYS.sizeHeading,
    keywords: ['bigger', 'smaller', 'scale', 'how large'],
  },
  voice: {
    id: 'her-voice',
    label: 'Voice',
    keywords: ['speaks', 'sounds', 'accent', 'audio', 'which voice'],
  },
  bubble: {
    id: 'her-speech-bubble',
    label: 'Speech bubble',
    keywords: ['words', 'caption', 'subtitles', 'which side', 'left', 'right'],
  },
  conversations: {
    id: 'her-conversations',
    label: 'Conversations',
    keywords: ['save', 'keep', 'record', 'written down', 'privacy', 'history', 'retention'],
  },
  file: {
    id: 'her-face-file',
    label: 'Face',
    keywords: ['file', 'json', 'drawing', 'where it reads'],
  },
  faces: {
    id: 'her-expressions',
    label: SAYS.deeperFaces,
    keywords: ['expressions', 'emotions', 'moods', 'happy', 'sad'],
  },
  notes: {
    id: 'her-memory',
    label: SAYS.deeperNotes,
    keywords: ['memory', 'remembers', 'notes', 'kept', 'forget'],
  },
  instruction: {
    id: 'her-instruction',
    label: SAYS.deeperInstruction,
    keywords: ['system prompt', 'told', 'style', 'personality', 'character'],
  },
} as const satisfies Readonly<Record<string, Field>>

/**
 * What can be done TO the worn character — deleting her, or putting her back.
 *
 * ## It is indexed, and being destructive is not a reason to hide it
 *
 * Jumping presses nothing. It scrolls a control into view and leaves it alone,
 * so what search changes here is how long somebody hunts, not how easily a
 * character is deleted by accident. `storage.ts` indexes "Every conversation,
 * every character" on the same reasoning, and its own header makes the argument
 * this follows: a destructive action has to be FINDABLE and legible without
 * being inviting, and it was the unfindable half that got it pressed by people
 * who came for something else.
 *
 * ## Always drawn
 *
 * The built-in offers "put back" and a character with a file offers "delete",
 * and those two cases are exhaustive — so the section is unconditional and
 * `castDangerous` is typed `HTMLElement` to say so. It was `HTMLElement | null`
 * with a guard at the call site, and this paragraph used to explain why it was
 * being listed unconditionally anyway; a type admitting a state nothing produces
 * costs exactly that, an explanation at every reader.
 *
 * The KEYWORDS are conditional even though the section is not, which is the
 * distinction that matters here: one control is drawn, never both, so a keyword
 * naming the other one sends somebody to a button that is not there.
 */
export function herDangerous(worn: ShelfCharacter | null): Field {
  /*
    THE KEYWORDS FOLLOW THE STATE, because the section's one control does.

    They were a fixed list — delete, remove, reset, put back, built-in,
    duplicate — and `castDangerous` draws exactly ONE button: "put back" for the
    built-in, "delete" for a character with a file of its own. So on any machine
    half the list promised an action that was not at the destination, and
    `duplicate` promised one that is nowhere near it: Duplicate is a rail
    control, in `castActions`, two sections away.

    Duplicate and New are not indexed at all, and that is deliberate rather than
    an omission: they are always on screen in the rail, which is present on every
    page. Search exists for things that need scrolling to, and a control that
    never leaves the viewport is not one of them.
  */
  const removable = worn !== null && worn.source !== null
  return {
    id: 'her-this-character',
    label: 'This character',
    keywords: [
      'character',
      ...(removable ? ['delete', 'remove', 'erase'] : ['put back', 'restore', 'reset', 'built-in']),
    ],
  }
}

/**
 * Her sheet's fields, in the order it draws them.
 *
 * Takes the worn character because one field's keywords depend on it: the last
 * section offers deleting her OR putting the built-in back, never both, and a
 * keyword naming the absent one sends somebody to a control that is not there.
 * `null` — no character resolved — is treated as the built-in, which is what a
 * fresh install is.
 */
export function herFields(worn: ShelfCharacter | null): readonly Field[] {
  return [
    HER_FIELDS.who,
    HER_FIELDS.colour,
    HER_FIELDS.size,
    HER_FIELDS.voice,
    HER_FIELDS.bubble,
    HER_FIELDS.conversations,
    HER_FIELDS.file,
    HER_FIELDS.faces,
    HER_FIELDS.notes,
    HER_FIELDS.instruction,
    herDangerous(worn),
  ]
}
