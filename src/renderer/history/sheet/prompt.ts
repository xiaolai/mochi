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
import { type ShelfHandlers, section } from './row'
import { type ShelfCharacter, type ShelfView } from '@shared/history-window'
import { forPronoun } from '@shared/pronoun'
/**
 * Her manner, and the two moments she is given words for.
 *
 * Editable here now, not only in her file. `style` is what `instructionsFor`
 * sends as the character half of the prompt; the two `SpokenMoment`s decide
 * what she conveys on waking and on going back to sleep.
 */
export function promptSection(
  view: ShelfView,
  worn: ShelfCharacter,
  handlers: ShelfHandlers,
): HTMLElement {
  const style = element('textarea')
  style.rows = 5
  style.value = worn.style
  style.spellcheck = false
  style.addEventListener('change', () => {
    if (style.value === worn.style) return
    handlers.save({ id: worn.id, style: style.value })
  })

  const moments = element('div', 'moments')
  for (const moment of [
    { key: 'greeting', label: 'On waking', value: worn.greeting },
    { key: 'farewell', label: 'On going to sleep', value: worn.farewell },
  ] as const) {
    const box = element('input')
    box.type = 'text'
    // Both of these are legitimately empty — a character can have nothing to
    // convey on waking — and an unboxed empty field is a blank patch of paper.
    box.placeholder = 'nothing in particular'
    box.value = moment.value
    box.addEventListener('change', () => {
      if (box.value.trim() === moment.value) {
        box.value = moment.value
        return
      }
      handlers.save({ id: worn.id, [moment.key]: box.value })
    })
    // `moment`, not `field`: the Machine tab already styles `.field` as a
    // label-beside-control grid, and it would centre these.
    const field = element('div', 'moment')
    field.append(element('span', 'label', moment.label), box)
    moments.append(field)
  }
  /*
    The INSTRUCTION half only, and the section does not pretend otherwise.

    A `SpokenMoment` also carries `verbatim` — exact words a manifest author
    wrote for her to say. There is no control for it here and `applyChange`
    leaves it alone, so editing this field narrows what she is told to convey
    without discarding words somebody chose.
  */
  return section(
    forPronoun(SAYS.whoSheIs, view.pronoun),
    forPronoun(SAYS.whoSheIsHint, view.pronoun),
    style,
    moments,
  )
}
