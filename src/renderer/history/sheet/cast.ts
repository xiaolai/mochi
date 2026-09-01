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
import { section, type ShelfHandlers } from './row'
import { type ShelfCharacter, type ShelfView } from '@shared/history-window'
import { type Pronoun, forPronoun } from '@shared/pronoun'
import { anchor } from '../../field'
import { herDangerous } from './fields'
/**
 * Making a character, from the rail.
 *
 * ## Two words, and that is the whole control
 *
 * The delivered design draws exactly `New` and `Duplicate` here, as underlined
 * words in Sora — no field, no third action, and no character's name in either
 * label. What stood here was a text input and up to four bordered buttons, one
 * of which said "Delete <her name>".
 *
 * ## The name is asked for where names are edited
 *
 * Main refuses a character with no name, and the rail has nowhere to type one.
 * So both actions supply a default and the caller puts the cursor in the name
 * field of her subject row — which is the one place in this window a character
 * is renamed, and is now the only one. `deriveId` resolves collisions with a
 * numeric suffix, so two characters called "New character" are two characters
 * rather than an error.
 *
 * The mockup draws no `<input>` ANYWHERE — its search field and its file paths
 * are styled spans — so the absence of a field here cannot be read as "there is
 * no field". What it does say is that the field is not in the rail, and that is
 * what has been taken from it.
 *
 * ## Deleting is not here, and that is the substantive change
 *
 * `Delete` acted on the WORN character while sitting under a list of all of
 * them. It named her, so it was not lying, but its position said "the one you
 * are pointing at" and its behaviour said "the one being worn" — and those are
 * different rows the moment there are two characters. It is on her own page
 * now, under her own name, where there is only one character it could mean.
 */
export function castActions(view: ShelfView, handlers: ShelfHandlers): readonly HTMLElement[] {
  const worn = view.characters.find((one) => one.id === view.wornId)
  // Nothing to duplicate when nothing is loaded, and "New" alone wants the
  // empty state's own words rather than a lone word under a list that is not
  // there.
  if (worn === undefined) return []

  const guarded: HTMLButtonElement[] = []
  const once = (act: () => void): void => {
    for (const button of guarded) button.disabled = true
    act()
  }

  const word = (label: string, act: () => void): HTMLButtonElement => {
    /*
      `btn rail-word` — the window's button, with the rail's tighter padding.

      The comment here argued for a separate class on the grounds that "`.btn` is
      a bordered, filled control and these are two underlined words". Both halves
      stopped being true: `Rail.dc.html` draws them as `12.5/500, #fff, 1px
      #d4d4d8, pill, padding 6px 14px`, which IS `button.btn` at every value but
      the padding, and the underline went when they became pills.

      What was left was a fifth vocabulary for one control. It kept the class's
      own hover — `border-bottom-color: var(--ink-3)` — which was right for an
      underline and, on a fully bordered pill, darkens one side and reads as a
      bottom border appearing under the word. `rail-word` is now the padding and
      nothing else.
    */
    const button = element('button', 'btn rail-word', label)
    button.type = 'button'
    button.addEventListener('click', () => {
      once(act)
    })
    guarded.push(button)
    return button
  }

  return [
    word('New', () => {
      handlers.persona({ kind: 'create', name: NEW_NAME })
    }),
    // "Duplicate", not "Duplicate <her name>". The row sits under her row in the
    // list and the design does not repeat what is directly above it.
    word('Duplicate', () => {
      handlers.persona({ kind: 'duplicate', name: `${worn.name} copy` })
    }),
  ]
}

/**
 * What a character is called before anybody has called it anything.
 *
 * Not empty: main refuses that, and an id has to be derived from something. Not
 * her name either — a second "Mochi" is the one name that makes the list
 * useless.
 */
export const NEW_NAME = 'New character'

/**
 * Removing a character, and putting the built-in back.
 *
 * On her page rather than in the rail, because both act on ONE character and
 * her page is the only surface where which one is not a question. The note is
 * the sentence that has to be read before the button beneath it, which is why
 * it is above it and not a tooltip on it.
 */
/*
  `HTMLElement`, NOT `HTMLElement | null`.

  Nothing here has ever returned null: the built-in offers "put back" and a
  character with a file offers "delete", and those two cases are exhaustive. The
  nullable type made `characterSheet` guard on a branch that could not be taken,
  and made `sheet/fields.ts` write a paragraph explaining why it was listing this
  section unconditionally anyway. A type that permits a state nothing produces
  costs a guard at every call site and buys nothing.
*/
export function castDangerous(
  worn: ShelfCharacter,
  pronoun: Pronoun,
  handlers: ShelfHandlers,
): HTMLElement {
  const row = element('div', 'row')
  const guarded: HTMLButtonElement[] = []
  const once = (act: () => void): void => {
    for (const button of guarded) button.disabled = true
    act()
  }

  /*
    The built-in cannot be deleted and a character with a file cannot be
    restored, so exactly one of these is ever offered — and on a fresh install
    with only the built-in, that is `restore`.
  */
  if (worn.source === null) {
    const restore = element('button', 'btn', forPronoun(SAYS.restore, pronoun))
    restore.type = 'button'
    restore.addEventListener('click', () => {
      once(() => {
        handlers.persona({ kind: 'restore-built-in' })
      })
    })
    row.append(restore, element('span', 'hint', forPronoun(SAYS.restoreOnly, pronoun)))
    guarded.push(restore)
  } else {
    /*
      Through the SAME guard, and straight out rather than armed.

      An arming step means two clicks are needed, and the second and third land
      before the reload replaces the pane — so a double-click on the confirm
      sent two deletions, and the second answered "there is no character called
      …" over a deletion that had just worked.
    */
    const remove = element('button', 'btn bad', `Delete ${worn.name}`)
    remove.type = 'button'
    remove.addEventListener('click', () => {
      once(() => {
        handlers.persona({ kind: 'delete', id: worn.id })
      })
    })
    row.append(remove)
    guarded.push(remove)
  }

  return anchor(
    herDangerous(worn),
    section('This character', 'a character is a folder · deleting one takes its memory', row),
  )
}
