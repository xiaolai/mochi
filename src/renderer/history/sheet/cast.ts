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
import { type ShelfHandlers } from './row'
import { type ShelfCharacter, type ShelfView } from '@shared/history-window'
import { type Pronoun, forPronoun } from '@shared/pronoun'
/**
 * Making, copying and removing characters — under the LIST they act on.
 *
 * ## Why it is not a section of the sheet
 *
 * It was the eighth one, and it was the only thing on that pane not about the
 * open character: New, Duplicate and Delete change what is in the column, not
 * who somebody is. `characterSheet`'s own ordering argues that the pane runs
 * "from what she IS toward what has happened to her", and none of these is
 * either. Being last also put the control that makes a second character below
 * the fold of a long scroll on the one install that has exactly one.
 *
 * ## It still names the open character, and has to
 *
 * "Duplicate Loki" and "Delete Loki" are about whoever is open, which on this
 * shelf is whoever is worn — clicking a card wears them. So it takes the same
 * `worn` the sheet does, and the two cannot disagree because there is one
 * answer to who that is.
 *
 * A NAME, never an id. The id is derived in main against what is already taken
 * AND what a pending deletion still reserves, because an id is what her memory
 * and her conversations are filed under: choosing one from here would be
 * choosing whose leftovers a new character inherits.
 */
export function castActions(view: ShelfView, handlers: ShelfHandlers): readonly HTMLElement[] {
  const worn = view.characters.find((one) => one.id === view.wornId)
  // Nothing to duplicate or delete when nothing is loaded, and "New" alone
  // wants the empty state's own words rather than a lone button under a list
  // that is not there.
  if (worn === undefined) return []
  return castRow(worn, view.pronoun, handlers)
}

export function castRow(
  worn: ShelfCharacter,
  pronoun: Pronoun,
  handlers: ShelfHandlers,
): readonly HTMLElement[] {
  const row = element('div', 'row')

  const name = element('input')
  name.type = 'text'
  name.placeholder = 'name'
  const named = (): string => name.value.trim()

  /**
   * Disabled the moment one is pressed, and left that way.
   *
   * The write is asynchronous and the pane is replaced when it lands, so an
   * ordinary double-click sent TWO create actions — and each derives its own id
   * against what was taken when it ran, so it made two characters rather than
   * failing. They are re-enabled by the re-render, which is what the reload
   * does.
   */
  const guarded: HTMLButtonElement[] = []
  const once = (act: () => void): void => {
    for (const button of guarded) button.disabled = true
    act()
  }

  const make = element('button', 'btn primary', 'New')
  make.type = 'button'
  make.addEventListener('click', () => {
    if (named() === '') return handlers.say('A new character needs a name.', true)
    once(() => {
      handlers.persona({ kind: 'create', name: named() })
    })
  })

  const copy = element('button', 'btn', `Duplicate ${worn.name}`)
  copy.type = 'button'
  copy.addEventListener('click', () => {
    if (named() === '') return handlers.say('Give the copy a name first.', true)
    once(() => {
      handlers.persona({ kind: 'duplicate', name: named() })
    })
  })

  row.append(name, make, copy)
  guarded.push(make, copy)

  if (worn.source === null) {
    // The built-in has no file to delete. What somebody actually wants here is
    // her original prompt back, which lives in the source and not in this
    // window — so without this, editing her is a one-way door.
    const restore = element('button', 'btn', forPronoun(SAYS.restore, pronoun))
    restore.type = 'button'
    restore.addEventListener('click', () => {
      once(() => {
        handlers.persona({ kind: 'restore-built-in' })
      })
    })
    row.append(restore)
    guarded.push(restore)
  } else {
    // TWO STEPS. This takes her notes and her conversations with her, and unlike
    // the note there is no one-step undo waiting behind it.
    const remove = element('button', 'btn', `Delete ${worn.name}`)
    remove.type = 'button'
    let armed = false
    remove.addEventListener('click', () => {
      if (!armed) {
        armed = true
        // The pronoun, not "her". A he/him character was told his own deletion
        // would take "her notes and her conversations".
        remove.textContent = `Delete ${worn.name}, ${forPronoun(SAYS.deleting, pronoun)}?`
        remove.classList.add('arming')
        return
      }
      /*
        Through the SAME guard the other three actions use.

        Delete went straight out. The arming step means two clicks are needed,
        and the second and third land before the reload replaces the pane — so a
        double-click on the confirm sent two deletions, and the second answered
        "there is no character called …" over a deletion that had just worked.
      */
      once(() => {
        handlers.persona({ kind: 'delete', id: worn.id })
      })
    })
    row.append(remove)
    guarded.push(remove)
  }

  /*
    A footer, not a section, and not a wrapper either.

    `section()` draws a caps heading with a hint beside it, which is the shape
    the SHEET uses for a field. Under the list this is the same thing the drawer
    is to the window — controls that belong to what is above them — so it gets
    the one-line note and no second heading, because the column already says
    "Characters" a few pixels above the list these act on.

    Returned as a LIST rather than inside a `div` of its own: `#cast-actions`
    already exists in the markup with the padding and the rule on it, and a
    second box inside it would be two containers for one thing — the mistake
    `#panel-wake` was carrying when it wore `.panel` inside `.cast-wake`.
  */
  return [row, element('p', 'note', 'a character is a folder · deleting one takes its memory')]
}
