/**
 * What every section of her sheet is built from: a heading, and a row of
 * choices where exactly one is current.
 *
 * Below the sections rather than beside them. `shelf.ts` holds the ORDER the
 * sections appear in and imports each one; each one needs this vocabulary, so
 * leaving it in `shelf.ts` would have made every section import the file that
 * imports it.
 */

import { SAYS } from '../shelf-says'
import { element } from '../../element'
import { faceTile } from './face-tile'
import { type ShelfHandlers, chooser } from './row'
import { type ShelfCharacter, type ShelfView } from '@shared/history-window'
import { PRONOUNS, forPronoun } from '@shared/pronoun'
/**
 * Her face, her name, what she calls you, which words she takes, where she
 * lives.
 *
 * The name is an h1-sized field with no box until it is touched, per the
 * artifact: the largest thing on the pane is her name, and the fact that it is
 * editable is worth less than the fact that it is her name.
 */
/**
 * A one-line field that saves what was typed, and puts itself back when nothing
 * was.
 *
 * Both fields on this band did the same four things — set a value, set a
 * placeholder, compare a trimmed edit against what is stored, and either put
 * the box back or dispatch a save. Written out twice, and the halves that are
 * easy to lose are the two that are not about saving: the reset, and comparing
 * the TRIMMED value so that typing a space and deleting it is not a change.
 *
 * A control displaying a value that was never stored is the small version of
 * the failure this whole window exists to avoid.
 */
function savedField(options: {
  readonly className: string
  readonly value: string
  readonly placeholder: string
  readonly save: (value: string) => void
}): HTMLInputElement {
  const field = element('input', options.className)
  field.type = 'text'
  field.placeholder = options.placeholder
  field.value = options.value
  field.addEventListener('change', () => {
    if (field.value.trim() === options.value) {
      // Nothing to save — and the field is put back rather than left showing
      // the spaces somebody added.
      field.value = options.value
      return
    }
    options.save(field.value)
  })
  return field
}

export function whoBand(
  view: ShelfView,
  worn: ShelfCharacter,
  handlers: ShelfHandlers,
): HTMLElement {
  // `who-band`, not `who`: this window already styles `.who` as the speaker
  // label over a turn in a transcript. See the stylesheet for the four earlier
  // collisions of exactly this shape.
  const band = element('div', 'who-band')
  // 52px, which is the delivery's. It was 108 — a portrait at the top of a
  // scrolling column of her properties. On a subject row beside her name it is
  // a face on a line of type, and 108 makes the line as tall as the views under
  // it.
  band.append(faceTile(worn.face, 52))
  /*
    The same admission the rail makes — contract C4.

    Without it her face is a 108px hole in the subject row and the name starts a
    face-width in from the views under it, which reads as a layout mistake
    rather than as "this character has no face". The rail said so and the
    subject did not, so the one place a person looks first was the one place
    that stayed quiet about it.
  */
  if (worn.face === undefined) band.classList.add('faceless')

  const name = savedField({
    className: 'who-name',
    value: worn.name,
    // Her name can be cleared to nothing in the field before it is put back on
    // `change`, and the h1 has no box of its own — so without this there is one
    // keystroke of a pane with nothing on it. See the field rule in `tokens.css`.
    placeholder: forPronoun(SAYS.namePlaceholder, view.pronoun),
    save: (value) => {
      handlers.save({ id: worn.id, name: value })
    },
  })

  const called = savedField({
    className: 'inline',
    value: worn.addressUser,
    // The placeholder is what she DOES when the field is empty, not a
    // suggestion. `addressLine` omits the instruction entirely rather than
    // telling her to call somebody "you", so an empty box is a real answer and
    // says which one.
    placeholder: 'nobody has said',
    save: (value) => {
      handlers.save({ id: worn.id, addressUser: value })
    },
  })

  const facts = element('div', 'who-facts')
  facts.append(
    element('span', 'label', 'calls you'),
    called,
    chooser(
      'switchers',
      PRONOUNS.map((one) => ({ value: one, label: one })),
      worn.pronoun,
      (value) => {
        handlers.save({ id: worn.id, pronoun: value })
      },
    ),
    element('span', 'grow'),
    // Where her file is — the one line that answers "which of these on disk am
    // I editing".
    element('span', 'meta', worn.source ?? forPronoun(SAYS.noFile, view.pronoun)),
  )

  const of = element('div', 'who-of')
  of.append(name, facts)
  band.append(of)
  return band
}
