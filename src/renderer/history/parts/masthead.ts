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

import { element } from '../../element'
import { PRONOUN_CAPS, faceTile } from '../sheet/face-tile'
import { type ShelfCharacter, type ShelfView } from '@shared/history-window'

function masthead(
  worn: ShelfCharacter,
  /*
    ONE SIZE, and no view decides it.

    It was 104 on her sheet and 52 on the other two, so the band's height moved
    when you moved between numbered views and everything under it moved with it.
    The delivery draws one component at one size, which is the point of it being
    a component.

    Still a parameter rather than a literal in the tile call, because `faceTile`
    writes the size as an inline style — a canvas has to be rendered at the size
    it is shown or it is blurry, so this cannot be a class the stylesheet scales.
  */
  px = 64,
): HTMLElement {
  // `who-band`, not `who`: this window already styles `.who` as the speaker
  // label over a turn in a transcript. See the stylesheet for the four earlier
  // collisions of exactly this shape.
  const band = element('div', 'who-band')
  /*
    64, on every view.

    It was 104 on her sheet and 52 on the other two, which made the masthead a
    different height depending on which numbered view was open — so moving
    between them moved everything under them. The delivery draws one component at
    one size, which is the point of it being a component: "the artboards drifted
    in exactly the places where these three were not shared."
  */
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

  /*
    HER NAME, and it is not a field here.

    It was one, so the band that says who "she" is was also the control that
    renames her — and a label you can type into has to be read before it can be
    trusted as a label. The field is in view I now, which is the view called
    "Who she is"; this is the subject the numbered views name parts of.
  */
  const name = element('div', 'who-name', worn.name)

  /*
    HER MACHINE FACTS, under her name.

    Which words she takes, which voice she speaks in, and where she is stored —
    the three things that tell two characters apart once the face has. In mono,
    because that is what the second face is for, and beside the name rather than
    in the sheet because the masthead's whole job is to say who "she" is before
    the numbered views name parts of her.
  */
  /*
    HER MACHINE FACTS, under her name — and they are FACTS, not controls.

    This row held the pronoun chooser and the "calls you" field: two controls in
    the band whose job is to say who "she" is before the numbered views name
    parts of her. So the masthead both stated the subject and edited it, and view
    I — the view actually called "Who she is" — did not contain the two fields
    most obviously about who she is.

    They move into the sheet, where the delivery draws them. What is left here is
    the three things that tell two characters apart once the face has: which
    words she takes, which voice she speaks in, and whether she came from a file.
    In mono, because that is what the second face is for.
  */
  const facts = element(
    'div',
    'who-facts',
    `${PRONOUN_CAPS[worn.pronoun]} · ${worn.voice} · ${
      worn.source === null ? 'built-in' : 'from a file'
    }`,
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
export function characterSubject(view: ShelfView): HTMLElement | null {
  const worn = view.characters.find((one) => one.id === view.wornId)
  if (worn === undefined) return null
  return masthead(worn)
}
