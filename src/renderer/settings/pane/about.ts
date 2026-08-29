/** The "about" group of settings. One pane per file; `panes.ts` keeps only the order. */
/**
 * What this build is.
 *
 * ## It used to be two panes wearing one name
 *
 * This answered "what is this application" and "where does it keep everything"
 * in the same list, and the join was that both are short. Its last row was the
 * deletion that forgets every conversation of every character — the most
 * irreversible thing this application can do, under a version number, in a
 * group called About. Legible and unfindable, which is the combination that
 * gets a destructive control pressed by somebody who came for something else.
 *
 * The folders, the root they sit under and that deletion are `storage.ts` now.
 * What is left is three facts about the build, which is what the word means.
 *
 * ## Why it is still last
 *
 * The order runs from what she does with the world outside this window, through
 * what the window itself is, to what the build is — and a version number is the
 * one thing here nobody arrives looking for.
 */
import { element } from '../../element'
import { type Pane } from '../pane'
import { forPronoun } from '@shared/pronoun'
import { SAYS } from '../panes-says'
import { field } from '../pane'

export const ABOUT: Pane = {
  id: 'about',
  label: 'About',
  attention: () => null,
  render(view) {
    return [
      field('Application', element('div', undefined, `${view.about.name} ${view.about.version}`)),
      field('Electron', element('div', undefined, view.about.electron)),
      // Where the rest of her went, said once, here — because this is the group
      // somebody lands on when they cannot find something.
      element('p', 'note', forPronoun(SAYS.whoSheIs, view.pronoun)),
    ]
  },
}
