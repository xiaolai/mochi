import type { ShelfView } from '@shared/history-window'
import { element } from '../../element'
import { PRONOUN_CAPS, faceTile } from '../sheet/face-tile'

/**
 * The rail: who exists, and the machine underneath them.
 *
 * ## Why this is its own file
 *
 * It was in `shelf.ts`, which also builds the whole character sheet — 414 lines
 * doing two unrelated jobs, so a change to the rail meant opening the file that
 * owns her voice, her colour and her prompt. The v2 delivery draws the rail, the
 * masthead and the machine's nav as three shared components and says in as many
 * words that the artboards drifted in exactly the places where they were not
 * three. The same argument holds one layer down: three components in the design
 * are three modules here, or the drift moves into the code.
 *
 * ## A COLUMN, not a row of cards
 *
 * The characters were a column of cards inside one tab, so the list of who
 * exists was only visible from one of three places. It is the window's table of
 * contents now and it never goes away — a list you have to navigate to in order
 * to find out what you could navigate to is not a table of contents.
 *
 * ## Clicking one WEARS her
 *
 * Not "selects" her. The sections re-read and the assembled prompt re-renders; a
 * wake opens a new session, so nothing has to be torn down. It is also what
 * keeps the transcript channels honest: they read whoever is worn, decided in
 * main, and a row that merely selected somebody would mean the conversations
 * pane had to name a persona to a query — which is the property this window's
 * allowlist exists to keep.
 */

/**
 * Her two machine facts, or the one word that beats them.
 *
 * v1 put both through one element: the worn character read `worn now` and the
 * others read `SHE · BALLAD`, in Sora small caps. That is one slot carrying two
 * different kinds of claim, and it set a pair of machine facts in the face
 * reserved for things you operate.
 *
 * v2 separates them, and the separation is the point rather than the styling:
 * the pronoun and the voice are what tell two characters apart once the face
 * has, so every row gets them, in mono, always. Being WORN is a different fact
 * about a different question, so it gets its own mark — a pill, which is this
 * vocabulary's shape for a small standing label.
 */
function subLine(one: ShelfView['characters'][number]): HTMLElement {
  // The character itself rather than two loose strings: `PRONOUN_CAPS` is keyed
  // by the three pronouns the format allows, and widening that to `string` to
  // suit a helper is how an unchecked key gets in.
  return element('div', 'rail-worn', `${PRONOUN_CAPS[one.pronoun]} · ${one.voice}`)
}

/**
 * The rows, one per character.
 *
 * `openId` is which row is CURRENT, which is not always who is worn — the
 * machine's page is open with a character still worn behind it, and the rail has
 * to be able to say "none of these" without lying about who she is.
 */
export function characterRows(
  view: ShelfView,
  openId: string | null,
  onOpen: (id: string) => void,
): readonly HTMLElement[] {
  return view.characters.map((one) => {
    const row = element('button', 'rail-row')
    row.type = 'button'
    row.setAttribute('aria-current', String(one.id === openId))
    row.append(faceTile(one.face, 22))
    // Said out loud rather than shown as an identical row of built-in mochis.
    // Contract C4: a character with no face file is SAID, not substituted.
    if (one.face === undefined) row.classList.add('faceless')

    const titles = element('div', 'rail-titles')
    titles.append(element('div', 'rail-name', one.name))
    titles.append(subLine(one))
    row.append(titles)

    /*
      The worn mark, and it is a WORD as well as a shape.

      "Turning one off takes effect at once, and she is told" is the delivery's
      rule for switches; this is the same rule for a state. A pill with no text
      would be a mark somebody has to already know how to read, and being worn
      is the one fact on this row a person is actually looking for.
    */
    if (one.id === view.wornId) row.append(element('span', 'rail-mark', 'Worn'))

    row.addEventListener('click', () => {
      onOpen(one.id)
    })
    return row
  })
}
