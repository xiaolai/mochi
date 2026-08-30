/**
 * Where everything is kept, and how to remove all of it.
 *
 * ## Why this is its own group
 *
 * These three things were the second half of "About", which answered two
 * unrelated questions at once: what this build IS — its name, its version, the
 * Electron it runs on — and where the things it looks after live. Nothing joins
 * those except that both are short.
 *
 * The consequence was not merely untidy. The most irreversible action in this
 * application — forgetting every conversation of every character, including
 * characters that no longer exist — sat at the foot of a pane called About,
 * under a version number. A destructive action has to be findable and legible
 * without being inviting; it was legible and unfindable, which is the one
 * combination that gets it pressed by somebody who was looking for something
 * else.
 *
 * The delivered design names this group and draws no content for it anywhere,
 * so what is here comes from the code rather than from the document: the two
 * folders `settings:reveal` can open, the root they sit under, and the deletion
 * that empties all of it.
 *
 * ## What is deliberately NOT here
 *
 * **Export.** It reads `transcripts().exportFor(wornId())` — one character's
 * conversations, not the store — so its scope is hers and it belongs with what
 * she has said. It looks like a storage control and is not one.
 *
 * **Retention.** `keepsFor(userData, personaId)` is per character, so whether
 * conversations are kept at all belongs on her page beside the character it is
 * stored against. See Rule 6 of the delivery: the machine is not her.
 *
 * **How much space any of it uses.** Nothing in `transcripts.ts` or `schema.ts`
 * asks the database how big it is — no `page_count`, no `page_size`, no `stat`.
 * Showing a size would be a new feature wearing a layout change's clothes, so
 * it is left out rather than estimated.
 */
import { element } from '../../element'
import { field, type Pane, type PaneHandlers } from '../pane'
import { type Revealable } from '@shared/ipc'
import { forPronoun } from '@shared/pronoun'
import { SAYS } from '../panes-says'

/** One folder, and the button that opens it. */
function folder(kind: Revealable, path: string, handlers: PaneHandlers): HTMLElement {
  const row = element('div', 'folder')
  const left = element('div')
  left.append(element('div', undefined, kind), element('code', undefined, path))
  const open = element('button', 'btn', 'Show')
  open.type = 'button'
  // A KIND, never the path beside it. The string on screen is for reading; a
  // renderer that could hand main an arbitrary path to open would be a file
  // browser with the user's authority, reachable from a page.
  open.addEventListener('click', () => {
    handlers.reveal(kind)
  })
  row.append(left, open)
  return row
}

/**
 * Every conversation of every character.
 *
 * Not `dropHers`, which is the one on her own page and takes only the worn
 * character's. This one reaches characters that are no longer installed, which
 * is exactly why it cannot live beside a character: there is no character it is
 * about.
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

export const STORAGE: Pane = {
  id: 'storage',
  label: 'Storage',
  attention: () => null,
  render(view, handlers) {
    const where = element('p', 'note')
    where.append(
      forPronoun(SAYS.everythingOf, view.pronoun),
      element('code', undefined, view.about.userData),
    )
    /*
      THE FOLDERS UNDER A HEADING — B6's "On disk".

      They were loose rows in the pane's column, under a sentence naming the root
      they sit beneath, so a reader scanning for section headings found the
      destruction below them and nothing above them. A row with a Show button is
      a control, and every other control in this window is under a heading that
      says what the group of them is.
    */
    const disk = element('div', 'on-disk')
    disk.append(
      ...(Object.keys(view.folders) as Revealable[]).map((kind) =>
        folder(kind, view.folders[kind], handlers),
      ),
    )
    return [
      field(forPronoun(SAYS.onDisk, view.pronoun), disk),
      where,
      // Last, and under everything it acts on. The rows above say what is
      // there; this one is the only way to make them all empty, and reading
      // what it will take before reaching it is the point of the order.
      everything(handlers),
      // What is NOT here, and why — her memory and her conversations are per
      // character and live with the character they belong to.
      element('p', 'note', forPronoun(SAYS.kept, view.pronoun)),
    ]
  },
}
