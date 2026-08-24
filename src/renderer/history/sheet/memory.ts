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
import { type ShelfView } from '@shared/history-window'
import { forPronoun } from '@shared/pronoun'
/**
 * What she remembers, with the one step back.
 *
 * The note is the one thing on this pane a MODEL writes — `remember_this` when
 * somebody asks out loud, and the sleep summariser when it lands — so it is the
 * one thing that needs an undo at all.
 */
export function memorySection(view: ShelfView, handlers: ShelfHandlers): HTMLElement {
  const undo = element('button', 'btn', 'Undo the last change')
  undo.type = 'button'
  // Null means nothing has ever been rewritten. That is NOT the same as going
  // back to an empty note, which is a real version somebody may want.
  undo.disabled = view.note.previous === null
  undo.addEventListener('click', () => {
    /*
      DISABLED on dispatch, not on the reload that follows it.

      `remember` keeps one step of history, so two restores in flight swap the
      note back to where it started — a double-click on "Undo the last change"
      undid the undo, and the pane looked like the button had done nothing.
    */
    undo.disabled = true
    forget.disabled = true
    // NAMED. The pane stays clickable while a character switch is in flight,
    // and main refuses an action for anybody but whoever is worn now.
    handlers.memory({ kind: 'restore', id: view.wornId })
  })

  // TWO STEPS rather than a dialog. This throws away something a person may
  // have spent months accumulating, and a button that does it on one click is a
  // button somebody hits by accident. It is undoable, and it should still ask.
  const forget = element('button', 'btn', 'Forget everything')
  forget.type = 'button'
  forget.disabled = view.note.text === ''
  let armed = false
  forget.addEventListener('click', () => {
    if (!armed) {
      armed = true
      forget.textContent = 'Really forget it all?'
      forget.classList.add('arming')
      return
    }
    handlers.memory({ kind: 'clear', id: view.wornId })
  })

  const text = element('pre')
  text.textContent = view.note.text === '' ? forPronoun(SAYS.noNotes, view.pronoun) : view.note.text
  if (view.note.text === '') text.classList.add('empty-note')

  const wrap = section(
    forPronoun(SAYS.remembers, view.pronoun),
    forPronoun(SAYS.wroteThese, view.pronoun),
    text,
  )
  // Into the section's own head, beside the hint, which is where the artifact
  // puts the two buttons — a second row of controls under the heading would
  // read as belonging to the note rather than to the section.
  const head = wrap.querySelector('.head')
  head?.append(element('span', 'grow'), undo, forget)
  return wrap
}
