import { type ShelfCharacter, type ShelfView } from '@shared/history-window'
import { PRONOUNS, forPronoun } from '@shared/pronoun'
import { element } from '../../element'
import { SAYS } from '../shelf-says'
import { type ShelfHandlers, chooser, savedField, section } from './row'

/**
 * Who she is: her name, the words she takes, and what she calls you.
 *
 * ## Why these three moved out of the masthead
 *
 * They were in the band above the views — her name as a field, a pronoun
 * chooser and a "calls you" box. So the masthead both STATED the subject and
 * edited it, while view I, the view actually called "Who she is", did not
 * contain the two fields most obviously about who she is.
 *
 * The delivery draws it the other way round and it is the right way round: the
 * band says who "she" is so the numbered views underneath can name parts of
 * her, and a band that is also a form has to be read before it can be trusted
 * as a label. What is left up there is her face, her name and three machine
 * facts — nothing you can change by clicking it.
 *
 * ## The name is still editable, in one place
 *
 * Here rather than in both. Two fields bound to one value is the shape this
 * window has been bitten by before: the last write wins rather than the last
 * click, and which one that is depends on which pane re-read first.
 */
export function whoSection(
  view: ShelfView,
  worn: ShelfCharacter,
  handlers: ShelfHandlers,
): HTMLElement {
  const name = savedField({
    className: 'who-field',
    value: worn.name,
    // Her name can be cleared to nothing in the field before it is put back on
    // `change`, so without this there is one keystroke of a control with nothing
    // in it. See the field rule in `tokens.css`.
    placeholder: forPronoun(SAYS.namePlaceholder, view.pronoun),
    save: (value) => {
      handlers.save({ id: worn.id, name: value })
    },
  })

  const called = savedField({
    className: 'who-field',
    value: worn.addressUser,
    /*
      The placeholder is what she DOES when the field is empty, not a
      suggestion. `addressLine` omits the instruction entirely rather than
      telling her to call somebody "you", so an empty box is a real answer and
      says which one.

      The delivery's word, and it is better: "nothing yet" is what is true,
      where "nobody has said" is a small story about how it got that way.
    */
    placeholder: 'nothing yet',
    save: (value) => {
      handlers.save({ id: worn.id, addressUser: value })
    },
  })

  const rows = element('div', 'who-rows')
  rows.append(
    labelled(forPronoun(SAYS.herName, view.pronoun), name),
    labelled(
      forPronoun(SAYS.herWords, view.pronoun),
      chooser(
        'switchers',
        PRONOUNS.map((one) => ({ value: one, label: one })),
        worn.pronoun,
        (value) => {
          handlers.save({ id: worn.id, pronoun: value })
        },
      ),
    ),
    labelled('Calls you', called),
  )

  return section(
    forPronoun(SAYS.whoHead, view.pronoun),
    forPronoun(SAYS.whoHint, view.pronoun),
    rows,
  )
}

/** A field under the word for what it is. The delivery's own arrangement. */
function labelled(what: string, control: HTMLElement): HTMLElement {
  const row = element('div', 'who-row')
  row.append(element('div', 'who-label', what), control)
  return row
}
