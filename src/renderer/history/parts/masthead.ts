/**
 * The masthead: whose page this is.
 *
 * ## Why it is `parts/` and not `sheet/`
 *
 * It was `sheet/who.ts`, and it is not a section of her sheet — it is the band
 * ABOVE the sheet, present on all three of her views and answering the question
 * the numbered views only mean anything under: who "she" is. The file held one
 * export and 105 of its 164 lines were it, so the directory was the only thing
 * claiming otherwise.
 *
 * The v2 delivery draws it as `HerHead`, one of three shared components, and
 * records that its own artboards drifted in exactly the places where those three
 * were re-drawn per screen instead of shared. Three components in the design are
 * three modules here — see `parts/rail.ts` for the same argument.
 *
 * The header that used to sit here described `sheet/row.ts` and had followed
 * this file around; it is gone rather than moved, because `row.ts` already
 * carries it.
 */

import { SAYS } from '../shelf-says'
import { element } from '../../element'
import { faceTile } from '../sheet/face-tile'
import { type ShelfHandlers, chooser } from '../sheet/row'
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

function masthead(
  view: ShelfView,
  worn: ShelfCharacter,
  handlers: ShelfHandlers,
  /**
   * How big her face is drawn, which the VIEW decides.
   *
   * Passed rather than set in the sheet because `faceTile` writes the size as
   * an inline style — a canvas has to be rendered at the size it is shown or it
   * is blurry, so this cannot be a class the stylesheet scales.
   */
  px = 52,
): HTMLElement {
  // `who-band`, not `who`: this window already styles `.who` as the speaker
  // label over a turn in a transcript. See the stylesheet for the four earlier
  // collisions of exactly this shape.
  const band = element('div', 'who-band')
  // 52px, which is the delivery's. It was 108 — a portrait at the top of a
  // scrolling column of her properties. On a subject row beside her name it is
  // a face on a line of type, and 108 makes the line as tall as the views under
  // it.
  band.append(faceTile(worn.face, px))
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
    // The delivery's word, and it is better: "nothing yet" is what is true,
    // where "nobody has said" is a small story about how it got that way.
    placeholder: 'nothing yet',
    save: (value) => {
      handlers.save({ id: worn.id, addressUser: value })
    },
  })

  /*
    ONE LINE: the words she takes, then what she calls you.

    "she he it  calls you nothing yet" reads as a sentence about her, and that
    is the point of the order — the pronoun is the subject of the clause the
    field completes. Split across two lines it was two facts; on one line it is
    one statement, and the control that changes the first half sits next to the
    half it changes.

    Her file goes at the far end of the same line, which is where it was: it
    answers "which of these on disk am I editing", and it is the only thing here
    nobody came looking for.
  */
  const calls = element('span', 'who-calls')
  calls.append(document.createTextNode('calls you '), called)

  const facts = element('div', 'who-facts')
  facts.append(
    chooser(
      'switchers',
      PRONOUNS.map((one) => ({ value: one, label: one })),
      worn.pronoun,
      (value) => {
        handlers.save({ id: worn.id, pronoun: value })
      },
    ),
    calls,
    /*
      A middot, not a spacer.

      `grow` was here and pushed nothing: `.who-band` has no width of its own,
      so there was no room to distribute and her file simply sat two spaces
      after "nothing yet" — two facts with nothing saying they were two. The
      delivery joins this line with a middot in `--rule-2`, which is quieter
      than a gap wide enough to read as a separator and cannot collapse.
    */
    element('span', 'who-dot', '·'),
    element('span', 'meta', worn.source ?? forPronoun(SAYS.noFile, view.pronoun)),
  )

  const of = element('div', 'who-of')
  of.append(name, facts)
  band.append(of)
  return band
}

/**
 * Her face and her name, which are the page's SUBJECT rather than its first
 * section.
 *
 * It used to be the first block of the reading column, which put the thing the
 * page is about inside the scrolling list of its properties — so her name
 * scrolled away and the column above it read as belonging to nobody. The
 * delivered design gives the subject its own row above the views, and the views
 * name the parts of it: I Who she is, II What she has said, III What she may do
 * only mean anything under a subject that says who "she" is.
 */
export function characterSubject(
  view: ShelfView,
  handlers: ShelfHandlers,
  px?: number,
): HTMLElement | null {
  const worn = view.characters.find((one) => one.id === view.wornId)
  if (worn === undefined) return null
  return masthead(view, worn, handlers, px)
}
