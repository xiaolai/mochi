import { element } from '../../element'
import { type Destination } from '../../settings/jump'

/**
 * The rows under the find-a-setting field.
 *
 * Its own file for `machine-nav.ts`'s reason: `main.ts` is 2,800 lines and
 * orchestrates every place this window can show, and a list of rows with a
 * current one is a component rather than a step in that orchestration.
 *
 * It draws and nothing else. Which destinations to show is `settings/jump.ts`,
 * which is pure and tested; where a press takes you is `main.ts`, which is the
 * only thing that knows what page is open. This file knows neither.
 */

/** The id a row carries, so `aria-activedescendant` can name it. */
export function rowId(at: number): string {
  return `jump-row-${String(at)}`
}

export function jumpRows(
  found: readonly Destination[],
  /** Which one Enter would take. An index, because the list is rebuilt per keystroke. */
  chosen: number,
  onPick: (one: Destination) => void,
): readonly HTMLElement[] {
  return found.map((one, at) => {
    /*
      A `div` with `role="option"`, not a button.

      The field keeps focus the whole time — that is what lets somebody carry on
      typing while the arrow keys move the selection — so nothing in this list
      may be focusable. A row of buttons would put a second tab stop under every
      result and take focus out of the control being typed in on the first Tab.

      The current one is NAMED by `aria-activedescendant` on the field instead,
      which is the combobox pattern and the only way to announce a selection
      that does not hold focus.
    */
    const row = element('div', 'jump-row')
    row.id = rowId(at)
    row.setAttribute('role', 'option')
    row.setAttribute('aria-selected', String(at === chosen))
    /*
      WHAT, then WHERE — and the group is on the row rather than in a heading.

      "Rest" and "Workspace" say nothing on their own in a list of fifty. The
      alternative, grouping the results under group headings, was rejected for
      the reason the results are ranked at all: somebody who has typed three
      letters wants the best answer first, and headings impose an order that is
      about filing rather than about what they asked for.
    */
    row.append(element('span', 'jump-what', one.label), element('span', 'jump-where', one.group))
    /*
      `mousedown`, not `click`.

      A click on a row inside an open dialog fires after the field has lost the
      pointer, and the handler below navigates and closes — so by the time a
      `click` would land, the element it was going to land on has been removed
      and the press is swallowed on the first attempt. `mousedown` acts while
      the row is still under the cursor.
    */
    row.addEventListener('mousedown', (event: MouseEvent) => {
      /*
        THE PRIMARY BUTTON ONLY.

        `mousedown` fires for every button, so without this a right-click — the
        gesture somebody makes to open a context menu — navigated the window and
        closed the panel, and a middle-click did the same. `click` gives this for
        free; `mousedown` is what buys the timing argued above, so the check it
        skips has to be written out.
      */
      if (event.button !== 0) return
      // The field must not lose focus: closing restores focus to whatever had
      // it before, and a blur first sends it to `<body>` instead.
      event.preventDefault()
      onPick(one)
    })
    return row
  })
}
