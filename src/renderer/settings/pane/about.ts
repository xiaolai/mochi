/** The "about" group of settings. One pane per file; `panes.ts` keeps only the order. */
/** Where the app's own files are, so somebody can go and edit one. */
/** What this build is, and where the rest of the settings went. */
/**
 * What this install is, and where it keeps things.
 *
 * ## Two groups, and the second was inside the first already
 *
 * `Where things live` was a group of its own: two rows — avatars and personas —
 * each with a Show button. This pane ENDED with the sentence "Everything of
 * hers is under `~/…/Mochi`", which is the parent of those two folders. One
 * group named the root in prose and another listed two of its children with
 * buttons, and somebody looking for either had to know which of the two words
 * this repository had chosen for the same subject.
 *
 * `Looking things up` was the other candidate for absorbing it, and it is the
 * wrong one on the same test. Its folder — the workspace — is one the USER
 * points her at, deliberately outside anything of hers, and its first control
 * is a health check for a capability. A pane holding an amber "the Codex
 * sign-in has expired" card is not a pane about where files are.
 *
 * ## The order: what it is, then where it keeps things, then what is not here
 *
 * The rows sit between the version and the two notes rather than after them,
 * because the notes are about the rows: one says what folder they are inside,
 * the other says which of her things are deliberately not in this window at
 * all. A note that comes before what it qualifies is a note read twice.
 */
import { element } from '../../element'
import { type Pane, type PaneHandlers } from '../pane'
import { type Revealable } from '@shared/ipc'
import { forPronoun } from '@shared/pronoun'
import { SAYS } from '../panes-says'
import { field } from '../pane'
/**
 * The hatch that empties the archive for EVERY character.
 *
 * ## Why it is here and not in the archive
 *
 * The archive is scoped to whoever is worn, and its own delete controls say
 * "hers" because the surrounding page makes that legible. This one is not about
 * a character at all -- it reaches rows belonging to characters that were
 * deleted by hand, packages that have gone unreadable, and ids that were
 * refused as duplicates, none of which are in the catalogue to be named. Put
 * among per-character controls it would read as one more of them, and its
 * label would be false in exactly the situations somebody reaches for it.
 *
 * About is where this window keeps what is true whoever is worn. This is that.
 *
 * ## Why it looks like nothing much
 *
 * On purpose. It is placed last, under the notes rather than above them, and
 * carries no colour until the pointer is on it. Nobody should arrive here by
 * following the most prominent thing on the pane.
 */
function everything(handlers: PaneHandlers): HTMLElement {
  const wrap = element('div', 'folder')
  const left = element('div')
  left.append(
    element('div', undefined, 'Every conversation, every character'),
    element(
      'code',
      undefined,
      'Characters, voices and looks are untouched. This cannot be undone.',
    ),
  )
  const go = element('button', 'btn bad', 'Delete…')
  go.type = 'button'
  // It only ASKS. The confirmation is a separate surface, and the deletion
  // happens there or not at all.
  go.addEventListener('click', () => {
    handlers.forgetEveryTalk()
  })
  wrap.append(left, go)
  return wrap
}

export const ABOUT: Pane = {
  id: 'about',
  label: 'About',
  attention: () => null,
  render(view, handlers) {
    const rows = (Object.keys(view.folders) as Revealable[]).map((kind) => {
      const row = element('div', 'folder')
      const left = element('div')
      left.append(element('div', undefined, kind), element('code', undefined, view.folders[kind]))
      const open = element('button', 'btn', 'Show')
      open.type = 'button'
      // A KIND, never the path beside it. The string on screen is for reading.
      open.addEventListener('click', () => {
        handlers.reveal(kind)
      })
      row.append(left, open)
      return row
    })

    const where = element('p', 'note')
    where.append(
      forPronoun(SAYS.everythingOf, view.pronoun),
      element('code', undefined, view.about.userData),
    )
    return [
      field('Application', element('div', undefined, `${view.about.name} ${view.about.version}`)),
      field('Electron', element('div', undefined, view.about.electron)),
      ...rows,
      where,
      // What is NOT here, and why. Her memory and her conversations are per
      // character and live on the shelf; this window holds only what is true
      // whoever is worn.
      element('p', 'note', forPronoun(SAYS.kept, view.pronoun)),
      element('p', 'note', forPronoun(SAYS.whoSheIs, view.pronoun)),
      everything(handlers),
    ]
  },
}
