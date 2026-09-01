import { label as paneLabel, type ByPronoun } from '@shared/pronoun'
import { type SettingsView } from '@shared/ipc'
import { type Pane, type Field } from './pane'
import { type Place } from '../history/tabs'
import { PANES } from './panes'
import { MAY_DO } from './pane/may-do'
import { herFields } from '../history/sheet/fields'
import { type ShelfView } from '@shared/history-window'

/**
 * Every setting in this window, flattened into one list, and finding one in it.
 *
 * ## Why this exists
 *
 * The window holds around fifty-five things somebody can change, across two
 * pages and ten groups. That is small enough that the navigation IS the index —
 * three settings a group, all of them named — with one exception that is not
 * small at all: `prompts.ts` draws thirty editors into a single scrolling column
 * and its own comment concedes the problem, *"this pane opened straight into the
 * first of twenty-seven editors"*. Knowing which text you want has never been
 * the same as being able to reach it.
 *
 * So this is a way to reach a setting by NAME rather than by remembering which
 * of ten groups somebody filed it under.
 *
 * ## It is derived, never written
 *
 * Nothing here restates a setting's name. `destinations` walks the panes and
 * reads `Pane.fields`, which is the same declaration `render` draws from — one
 * string, read twice, and `fields.test.ts` renders every pane to prove the two
 * agree. A hand-written index would have been faster to write and would have
 * been the third copy of every label in this window; the two that already
 * existed are why `panes-says.ts` and `pronoun-copy.test.ts` exist.
 *
 * ## Why `jump` and not `search` or `finding`
 *
 * Both are taken and both mean something else here. `finding` is the archive's
 * search over what she has SAID — `#q`, `findingEl`, a field already on her page
 * — and `lookup` is Codex. A third thing called search, in a window that
 * already has one, is the collision this file would otherwise be the tenth of.
 *
 * The verb is also the honest one: nothing is run, nothing is changed. It moves
 * you to where a setting lives and leaves you looking at it.
 */

/** One place in the window that can be reached by name. */
export interface Destination {
  /** The `data-field` to scroll to, once the right page is showing. */
  readonly fieldId: string
  /** What it is called, with the worn character's pronoun already resolved. */
  readonly label: string
  /** The group it sits in — shown beside the label, because "Rest" alone is ambiguous. */
  readonly group: string
  /** Which page has to be showing before `fieldId` is in the document. */
  readonly place: Place
  /** Which machine group has to be open, or null when the place is not the machine's page. */
  readonly paneId: string | null
  readonly keywords: readonly string[]
}

/**
 * Which page a pane's fields live on.
 *
 * `MAY_DO` is a `Pane` that is not in `PANES`: the grants are per character, so
 * the delivery moved them to view III of her page. It keeps the pane shape
 * because it is drawn like one, and the split is exactly what this table
 * records — see `panes.ts`, which carries the argument at length.
 */
const WHERE: readonly { readonly pane: Pane; readonly place: Place }[] = [
  ...PANES.map((pane) => ({ pane, place: 'machine' as const })),
  { pane: MAY_DO, place: 'permits' as const },
]

/**
 * The name her own sheet goes under in a result list.
 *
 * A group is what tells somebody which of two similar things they are about to
 * be taken to, and every other entry has one. Hers is the sheet's own subject:
 * a row reading "Voice · Who she is" says whose voice, which is the question a
 * bare "Voice" leaves open on a machine with four characters on it.
 */
const HER_GROUP: ByPronoun = { she: 'Who she is', he: 'Who he is', it: 'What it is' }

/**
 * Everything reachable by name, in the order the window draws it.
 *
 * `shelf` is separate from `view` because the two halves of this window are read
 * from two places, and that split is the delivery's — `SettingsView` is the
 * machine's answer and `ShelfView` is hers. It is nullable because the shelf is
 * read asynchronously at startup and the panel opens from anywhere; without it,
 * her sheet is still indexed and only the one state-dependent field falls back
 * to what a fresh install looks like.
 */
export function destinations(
  view: SettingsView,
  shelf: ShelfView | null = null,
): readonly Destination[] {
  const fromPanes = WHERE.flatMap(({ pane, place }) =>
    pane.fields(view).map((field: Field) => ({
      fieldId: field.id,
      label: paneLabel(field.label, view.pronoun),
      group: paneLabel(pane.label, view.pronoun),
      place,
      // Only the machine's page has groups to open. Her page is reached by the
      // place alone, so a pane id here would be a value nothing could act on.
      paneId: place === 'machine' ? pane.id : null,
      keywords: field.keywords ?? [],
    })),
  )
  /*
    HER SHEET TOO, and it is not optional.

    A search that finds "Halo" and not "Voice" is worse than no search: the
    first three misses teach somebody that it only knows about some of the
    window, and after that they go back to hunting for everything. Her sheet is
    not a `Pane` — `sheet/fields.ts` says why at length — so its list is read
    from there rather than from `WHERE`.

    FIRST, because her page is the one this window opens on and the one most of
    these settings are about. Ties keep declaration order, so this is also the
    order equally good matches come back in.
  */
  const worn = shelf?.characters.find((one) => one.id === shelf.wornId) ?? null
  const hers = herFields(worn).map((field) => ({
    fieldId: field.id,
    label: paneLabel(field.label, view.pronoun),
    group: paneLabel(HER_GROUP, view.pronoun),
    place: 'cast' as const,
    paneId: null,
    keywords: field.keywords ?? [],
  }))
  return [...hers, ...fromPanes]
}

/**
 * How good a match is, lowest first — or null when it is not one at all.
 *
 * ## Why the label outranks a keyword, always
 *
 * Somebody who types the word printed on the screen means that setting. A
 * keyword is a guess this repository made on their behalf about what they might
 * type instead, and a guess must never outrank the thing it was guessing about:
 * "rest" is the LABEL of the sleep setting and a KEYWORD of nothing, but the day
 * one is added, the labelled one still has to come first.
 *
 * ## Why a word boundary is its own rank
 *
 * "search" should find "Web search" above anything merely containing the
 * letters. Ranking a bare substring equally would put a word buried in the
 * middle of a prompt's purpose alongside a heading, which is how a result list
 * stops looking sorted.
 */
const NO_MATCH = null

function rank(one: Destination, needle: string): number | null {
  const label = one.label.toLowerCase()
  if (label.startsWith(needle)) return 0
  if (label.split(/\s+/).some((word) => word.startsWith(needle))) return 1
  if (label.includes(needle)) return 2
  const keywords = one.keywords.map((word) => word.toLowerCase())
  if (keywords.some((word) => word.startsWith(needle))) return 3
  if (keywords.some((word) => word.includes(needle))) return 4
  // The group is last on purpose: typing "keys" should offer the keys before
  // anything, but everything in that group matches it, so a group hit must
  // never displace a labelled one.
  if (one.group.toLowerCase().includes(needle)) return 5
  return NO_MATCH
}

/**
 * The destinations somebody typing `typed` meant, best first.
 *
 * ## Every word has to match something
 *
 * "web se" is two terms and both are part of one intent, so a destination is
 * offered only when EVERY term hits it somewhere. Matching on any one term
 * instead makes typing more letters return more results, which is the opposite
 * of what a person doing it expects and the reason they stop after two.
 *
 * The rank is the FIRST term's, because that is the word somebody chose while
 * they still knew nothing about what the list would show them. Later terms are
 * a narrowing, and letting one of them decide the order re-sorts a list under
 * somebody who is still typing.
 *
 * ## Ties keep declaration order
 *
 * `sort` is stable, so equally good matches come back in the order the window
 * draws them. That is the only order in this window that means anything, and
 * the alternative — alphabetical, or by length — would be a ranking this file
 * invented and nothing on screen agrees with.
 */
export function matching(all: readonly Destination[], typed: string): readonly Destination[] {
  const terms = typed.toLowerCase().trim().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return []
  const [first] = terms
  if (first === undefined) return []
  const scored: { one: Destination; score: number }[] = []
  for (const one of all) {
    if (!terms.every((term) => rank(one, term) !== NO_MATCH)) continue
    const score = rank(one, first)
    if (score === NO_MATCH) continue
    scored.push({ one, score })
  }
  return scored.sort((a, b) => a.score - b.score).map((each) => each.one)
}
