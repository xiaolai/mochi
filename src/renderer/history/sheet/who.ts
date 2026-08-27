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
export function whoBand(
  view: ShelfView,
  worn: ShelfCharacter,
  handlers: ShelfHandlers,
): HTMLElement {
  // `who-band`, not `who`: this window already styles `.who` as the speaker
  // label over a turn in a transcript. See the stylesheet for the four earlier
  // collisions of exactly this shape.
  const band = element('div', 'who-band')
  band.append(faceTile(worn.face, 108))

  const name = element('input', 'who-name')
  name.type = 'text'
  // Her name can be cleared to nothing in the field before it is put back on
  // `change`, and the h1 has no box of its own — so without this there is one
  // keystroke of a pane with nothing on it. See the field rule in `tokens.css`.
  name.placeholder = forPronoun(SAYS.namePlaceholder, view.pronoun)
  name.value = worn.name
  name.addEventListener('change', () => {
    if (name.value.trim() === worn.name) {
      // Nothing to save — and the field is put back rather than left showing
      // the spaces somebody added. A control displaying a value that was never
      // stored is the small version of the failure this window avoids.
      name.value = worn.name
      return
    }
    handlers.save({ id: worn.id, name: name.value })
  })

  const called = element('input', 'inline')
  called.type = 'text'
  called.value = worn.addressUser
  // The placeholder is what she DOES when the field is empty, not a suggestion.
  // `addressLine` omits the instruction entirely rather than telling her to call
  // somebody "you", so an empty box is a real answer and says which one.
  called.placeholder = 'nobody has said'
  called.addEventListener('change', () => {
    if (called.value.trim() === worn.addressUser) {
      called.value = worn.addressUser
      return
    }
    handlers.save({ id: worn.id, addressUser: called.value })
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
