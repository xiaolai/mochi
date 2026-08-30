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
import { undoing } from '../../rules/undoing'
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
  /*
    The one step back, from the rule rather than from a comparison here.

    `undoing` answers three things at once — whether to offer the control, what
    the note becomes, and how many lines go — and a pane that worked out the
    first from `previous === null` and the third by counting would be keeping a
    second opinion about the same field. `null` is not `''`: a note that was
    empty before her first rewrite HAS a previous version, and it is the rewrite
    somebody most wants back.
  */
  const back = undoing(view.note)
  const undo = element('button', 'btn', 'Undo that line')
  undo.type = 'button'
  undo.disabled = !back.offered
  undo.addEventListener('click', () => {
    /*
      DISABLED on dispatch, not on the reload that follows it.

      `remember` keeps one step of history, so two restores in flight swap the
      note back to where it started — a double-click on undo undid the undo, and
      the pane looked like the button had done nothing.
    */
    undo.disabled = true
    forget.disabled = true
    // NAMED. The pane stays clickable while a character switch is in flight,
    // and main refuses an action for anybody but whoever is worn now.
    handlers.memory({ kind: 'restore', id: view.wornId })
  })

  /*
    ON A SURFACE OF ITS OWN — contract D2, which this control used to break.

    It was the arming pattern: click once to turn the label into "Really forget
    it all?", click again to erase. D2 forbids exactly that and names why — a
    double-click defeats it (both clicks land, and the notes are gone), it has no
    Escape, and it re-reads live state on the second press. This is the only
    place in the window that still did it, and the file's own comment argued for
    it on the grounds that a dialog was heavier than the action deserved.

    The action deserves it. `askToErase` opens the same sheet every other
    destruction here uses, which offers a copy before it offers the deletion and
    takes a snapshot that a second press cannot act on twice.
  */
  const forget = element('button', 'btn bad', forPronoun(SAYS.eraseKept, view.pronoun))
  forget.type = 'button'
  forget.disabled = view.note.text === ''
  forget.addEventListener('click', () => {
    handlers.askToErase(view.wornId)
  })

  /*
    HER LINES, one element each.

    A `<pre>` held the whole note as one block, which is what she wrote but not
    what it is: these are separate things she has recorded about somebody at
    separate times, and running them together makes four facts look like one
    paragraph. It also meant the note wrapped in a monospace measure inside a
    proportional column.
  */
  const lines = element('div', 'kept')
  if (view.note.text === '') {
    lines.append(element('p', 'empty-note', forPronoun(SAYS.noNotes, view.pronoun)))
  } else {
    for (const line of view.note.text.split('\n')) {
      // `textContent`, never `innerHTML`. A MODEL wrote this text.
      lines.append(element('p', 'kept-line', line))
    }
  }

  const wrap = section(
    forPronoun(SAYS.remembers, view.pronoun),
    forPronoun(SAYS.wroteThese, view.pronoun),
    lines,
  )
  /*
    What the undo will actually do, beside the control that does it.

    "Only the most recent change can be undone — she keeps one previous version,
    not a history." Said in words rather than left to be discovered by pressing
    it and finding the button now disabled.
  */
  if (back.offered) {
    const many = Math.abs(back.lines)
    const what =
      back.lines > 0
        ? `takes back ${String(many)} line${many === 1 ? '' : 's'}`
        : back.lines < 0
          ? `puts ${String(many)} line${many === 1 ? '' : 's'} back`
          : 'restores the previous version'
    wrap.append(element('p', 'note', `Only the most recent change can be undone — this ${what}.`))
  }
  /*
    Into the section's own head, beside the hint — and it THROWS if it is not
    there.

    This read `.head` and appended with `head?.append(...)`. `section()` builds
    `.section-head`; the class was renamed when nine of these headings turned out
    to be carrying a page header's padding, and this call site was missed. So the
    optional chain shrugged and BOTH BUTTONS have never been in the document —
    no error, no empty box, just a section with no controls, which looks exactly
    like a section that is not meant to have any.

    A missing head is now a crash rather than a shrug. This window is assembled
    from one document, so an element that is not there is a mistake in the
    document and not a state to survive — the same argument `need()` makes for
    every handle in `elements.ts`.
  */
  const head = wrap.querySelector('.section-head')
  if (head === null) throw new Error('a section with no head cannot carry its controls')
  /*
    What the erase costs, beside the control — A2b's "asks once, and offers a
    copy first".

    Without it the only way to find out what the button does is to press it, and
    what it does is open the one surface in this window that deletes something a
    model spent a month writing. The sentence is the difference between a control
    somebody avoids and one they can use.
  */
  head.append(
    element('span', 'grow'),
    undo,
    forget,
    element('span', 'hint', forPronoun(SAYS.eraseAsks, view.pronoun)),
  )

  /*
    THE FENCE, on the screen that shows what it fences.

    A2b's second section, and it is not decoration: her notes are written by a
    MODEL, so anything in them could try to change how she behaves. What stops
    that is a wrapper telling her to read them as background data — and the one
    place somebody reads her notes is the one place that boundary has to be
    stated, or removing it looks like tidying up a paragraph.
  */
  const both = element('div', 'kept-screen')
  both.append(
    wrap,
    section(
      forPronoun(SAYS.fenceHead, view.pronoun),
      forPronoun(SAYS.fenceWhere, view.pronoun),
      element('p', 'note', forPronoun(SAYS.fenceWhy, view.pronoun)),
    ),
  )
  return both
}
