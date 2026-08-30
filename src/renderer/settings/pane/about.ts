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
    /*
      THE BUILD, AS ONE LINE — B7's `0.0.1 · arm64 · electron 33`.

      It was two label-beside-value rows, "Application · Mochi 0.1.2" and
      "Electron · 43.3.0", which spends two rows and two labels on three facts
      that are one fact: which build this is. The architecture was not on screen
      at all, and it is the one a bug report needs that the version does not
      carry — the same version on the wrong architecture runs under translation,
      and nothing else here says so.

      The Electron version is cut to its major. `43.3.0` is a number nobody can
      act on; `electron 43` is the one people quote.
    */
    const build = element('div', 'build')
    build.append(
      element('div', 'build-name', view.about.name),
      element(
        'div',
        'build-facts',
        `${view.about.version} \u00b7 ${view.about.arch} \u00b7 electron ${
          view.about.electron.split('.')[0] ?? view.about.electron
        }`,
      ),
    )
    return [
      build,
      /*
        WHAT IT IS BUILT ON, which was on no screen.

        B7 draws it and the reason is in the last line: zero runtime
        dependencies is a choice, not an accident, and a page that says nothing
        about what it stands on cannot make that claim checkable. Everything
        here is a fact about this repository — the versions are the ones the
        build reports, and `node:sqlite` has no version of its own because it is
        part of the runtime.
      */
      field('What it is built on', builtOn(view.about.electron), {
        note: forPronoun(SAYS.typefaces, view.pronoun),
      }),
      // Where the rest of her went, said once, here — because this is the group
      // somebody lands on when they cannot find something.
      element('p', 'note', forPronoun(SAYS.whoSheIs, view.pronoun)),
    ]
  },
}

/**
 * The four things this build stands on, and the claim that there is nothing
 * else.
 *
 * The last row is the point: "none — zero runtime dependencies" is a statement
 * somebody can check against `package.json`, and it is the reason the other
 * three are listed at all. A list of what a program depends on that omits the
 * total is a list you cannot conclude anything from.
 *
 * Electron's version comes from the running process; the rest are properties of
 * the repository and are written here, beside the sentence that reads them.
 */
function builtOn(electron: string): HTMLElement {
  const table = element('div', 'built-on')
  for (const [what, detail] of [
    ['Electron', `${electron} · MIT`],
    ['node:sqlite', 'part of the runtime — no package of its own'],
    ['Outfit', 'SIL OFL 1.1 · bundled'],
    ['JetBrains Mono', 'SIL OFL 1.1 · bundled'],
    ['everything else', 'none — zero runtime dependencies'],
  ] as const) {
    const row = element('div', 'built-row')
    row.append(element('span', 'built-what', what), element('span', 'built-detail', detail))
    table.append(row)
  }
  return table
}
