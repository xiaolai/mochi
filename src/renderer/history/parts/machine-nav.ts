import type { SettingsView } from '@shared/ipc'
import { forPronoun, label as paneLabel } from '@shared/pronoun'
import { element } from '../../element'
import { PANES } from '../../settings/panes'
import { SAYS } from '../main-says'

/**
 * The machine's seven groups, down the left of its page.
 *
 * ## Why it is its own file
 *
 * It was inline in `main.ts`, which is 2,200 lines and orchestrates every place
 * this window can show. The v2 delivery draws the rail, the masthead and this as
 * three shared components, and records that its own artboards drifted in exactly
 * the places where those three were re-drawn per screen rather than shared. The
 * same holds one layer down — see `parts/rail.ts` and `parts/masthead.ts`.
 *
 * ## It is the rail's row in miniature, deliberately
 *
 * Same 14px corner, same one step of grey for the chosen one, same 10/14
 * padding. Two lists of things you pick between, in one window, that looked like
 * two different controls: this one was a column of hairline-separated rows and
 * the rail was a column of filled ones. The hairlines are gone with the rest —
 * v2 groups by space, and a rule under every item is a mark doing what the gap
 * already does.
 */
export function machineNav(
  view: SettingsView,
  openGroup: string,
  onOpen: (id: string) => void,
): readonly HTMLElement[] {
  const groups = PANES.map((one, at) => {
    const button = element('button', 'tab')
    button.type = 'button'
    button.setAttribute('aria-current', String(one.id === openGroup))
    /*
      Numbered, as the delivery draws them.

      Not decoration: a column of seven sentences with no other structure is a
      list you have to read to count, and the numeral is what lets somebody say
      "the third one" — which is how people refer to a settings group they are
      half-remembering. `aria-hidden`, because a screen reader already announces
      position in a list and would otherwise say it twice.
    */
    const numeral = element('span', 'tab-n', String(at + 1))
    numeral.setAttribute('aria-hidden', 'true')
    button.append(numeral, element('span', 'tab-label', paneLabel(one.label, view.pronoun)))
    /*
      A dot means somebody should look, not that something is off.

      A withheld grant is a decision and never wears one; the two that do are a
      key another application has taken and a Codex CLI that is not installed,
      both of which otherwise present as her declining to help. `panes.ts` owns
      that judgement — this only draws it.

      The delivery asks for the mark to be PER ROW rather than only counted at
      the foot, and the reason is in its own audit: a foot reading "2 need
      attention" says there is something wrong without saying where, so it costs
      a hunt through seven groups to act on.
    */
    /*
      The mark CARRIES the sentence, rather than discarding it.

      `attention` answers a reason — "the Codex CLI could not be found on this
      machine. She cannot look anything up." — and the dot threw it away, so a
      screen reader met a decorative span and the nav said, to that reader,
      exactly nothing. The two are one fact and are drawn as one element.
    */
    const why = one.attention(view)
    if (why !== null) {
      const dot = element('span', 'dot')
      dot.title = why
      dot.append(element('span', 'said-quietly', why))
      button.append(dot)
    }
    button.addEventListener('click', () => {
      onOpen(one.id)
    })
    return button
  })

  /*
    What this whole page is for, under the seven groups.

    The delivery puts it there and it earns its place: her page and this one both
    hold switches, and the difference between them — who she IS versus what is
    true whoever is worn — is `plan-shell.md`'s split, which nothing on screen
    said out loud. It is the sentence that stops somebody looking for her voice
    in here.
  */
  return [...groups, element('p', 'nav-foot', forPronoun(SAYS.machineIsFor, view.pronoun))]
}
