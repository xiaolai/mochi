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
import { checkbox, element } from '../../element'
import { type ShelfHandlers, section, settingRow } from './row'
import { type ShelfCharacter, type ShelfView } from '@shared/history-window'
import { SIDE_NAMES } from '@shared/persona'
import { forPronoun, label as copyFor, type ByPronoun } from '@shared/pronoun'
import { anchor } from '../../field'
import { HER_FIELDS } from './fields'
/**
 * Her words on your desktop: whether they are drawn, and where.
 *
 * ## A section of its own, and the hint is why
 *
 * Both halves lived in Voice — the switch because it had always been there, the
 * side because it moved off the Machine tab to join it. That section's hint
 * says "a change is a reconnect, so it lands on its next wake", which is true
 * of a voice and of the switch and NOT of the side: `setBubbleSide` pushes
 * straight to her window, deliberately, because somebody who picks a side wants
 * to see her words move now.
 *
 * A hint makes a promise about everything under it. One control disobeying it
 * is the section being wrong rather than the control, so the two that belong
 * together got a heading and a hint that covers both honestly.
 *
 * ## "Show it", not a sentence
 *
 * The switch read *"Show her words beside her while she speaks"* — prose in a
 * column of controls, and it carried its own location claim next to the control
 * that sets the location. The heading names the thing; the switch says what it
 * does. That is the shape every other control in these windows already has,
 * and with no pronoun left in it the label stops being a three-way table.
 */
/**
 * Whether anything she says is written down at all.
 *
 * ## The name is the feature
 *
 * It says "Save NEW conversations", and the note underneath says plainly that
 * turning it off leaves the existing ones alone and points at where they are
 * removed. Calling this "retention" is what let the old website sentence lie
 * for months: a privacy switch whose scope has to be inferred will be inferred
 * in the unsafe direction, and the person doing the inferring will be somebody
 * who wanted their words gone.
 *
 * ## Per character, and on her sheet
 *
 * The policy is filed per character, so the control is where the character is.
 * It is NOT on her manifest -- see `SettingsPersona.keeps` -- so a package
 * cannot arrive having decided this for whoever installs it.
 */
export function savingSection(
  view: ShelfView,
  worn: ShelfCharacter,
  handlers: ShelfHandlers,
): HTMLElement {
  const keeps = checkbox('keeps', worn.keeps, (on) => {
    handlers.save({ id: worn.id, keeps: on })
  })
  const label = element('label', undefined, 'Save new conversations')
  label.htmlFor = keeps.id
  const row = element('div', 'row')
  row.append(keeps, label)

  return anchor(
    HER_FIELDS.conversations,
    section(
      'Conversations',
      forPronoun(SAYS.keeps, view.pronoun),
      row,
      element('p', 'note', copyFor(SAYS.keptAlready, view.pronoun)),
    ),
  )
}

export function bubbleSection(
  view: ShelfView,
  worn: ShelfCharacter,
  handlers: ShelfHandlers,
): HTMLElement {
  const bubble = checkbox('bubble', worn.bubble, (on) => {
    handlers.save({ id: worn.id, bubble: on })
  })
  const label = element('label', undefined, 'Show it')
  label.htmlFor = bubble.id
  const row = element('div', 'row')
  row.append(bubble, label)

  const side = document.createElement('select')
  for (const one of worn.bubbleSides) {
    const option = document.createElement('option')
    option.value = one
    /*
      The names the TRAY uses, from the one table both read.

      This drew `above`, `left`, `wherever there is room` — a second vocabulary
      for a setting the menu bar already had words for. Somebody who picked
      "To her left" from the tray and then opened her sheet found "left", and
      had to decide whether those were the same thing.
    */
    // `?? auto` keeps a side this table has no name for readable rather than
    // blank — the tray's own submenu makes the same allowance for the same
    // reason: `bubbleSides` crosses the wire as strings.
    const named = (SIDE_NAMES as Record<string, ByPronoun>)[one] ?? SIDE_NAMES.auto
    option.textContent = forPronoun(named, view.pronoun)
    option.selected = one === worn.bubbleSide
    side.append(option)
  }
  side.addEventListener('change', () => {
    handlers.save({ id: worn.id, bubbleSide: side.value })
  })
  return anchor(
    HER_FIELDS.bubble,
    section(
      'Speech bubble',
      forPronoun(SAYS.bubbleWhen, view.pronoun),
      row,
      /*
        `settingRow`, not a `.field` of its own — A1 draws this as an 82px label
        beside the chooser, which is the shape every setting on her page has and
        the reason that helper exists. It was the last user of the Machine tab's
        150px label-beside-control grid, so one row on her page was composed by
        the other page's rule.
      */
      settingRow('Which side', side),
      element('p', 'note', forPronoun(SAYS.bubbleSide, view.pronoun)),
    ),
  )
}
