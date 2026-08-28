/**
 * The small pieces this window builds rows out of.
 *
 * Pure: each takes what it draws from and reads no window state, which is what
 * makes them importable by a test. They were in `main.ts`, which resolves the
 * document at load and therefore cannot be imported at all -- so `marked`, the
 * function that decides which characters of a search result are highlighted,
 * had no test and no way to get one.
 */
import { element } from '../element'
import { highlight } from './format'
import { RAN_FOR, TURNS, fact } from './glyph'
export function empty(parent: HTMLElement, text: string): void {
  const said = document.createElement('p')
  said.className = 'empty'
  said.textContent = text
  parent.replaceChildren(said)
}

/** One line, with the query marked inside it. See `highlight` for why not HTML. */
export function marked(text: string, term: string): DocumentFragment {
  const fragment = document.createDocumentFragment()
  for (const segment of highlight(text, term)) {
    if (!segment.hit) {
      fragment.append(document.createTextNode(segment.text))
      continue
    }
    const hit = document.createElement('mark')
    hit.textContent = segment.text
    fragment.append(hit)
  }
  return fragment
}

/* ---- her state, across the top ----------------------------------------- */

/**
 * A small square button whose whole content is an SVG path or two.
 *
 * `copyButton` and `arrow` each rebuilt the namespace, the viewBox, the sizing,
 * the `aria-hidden` on the graphic and the accessible name on the button — the
 * same eight lines twice, and the accessibility half is exactly the part that
 * is quietly dropped when somebody adds a third by copying one of them.
 *
 * The LABEL is on the button and the graphic is hidden, always. A path with no
 * name announces as "button", and a name on both announces twice.
 */
export function iconButton(
  className: string,
  label: string,
  paths: readonly string[],
  px: number,
): HTMLButtonElement {
  const NS = 'http://www.w3.org/2000/svg'
  const button = document.createElement('button')
  button.className = className
  button.type = 'button'
  button.title = label
  button.setAttribute('aria-label', label)

  const svg = document.createElementNS(NS, 'svg')
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('width', String(px))
  svg.setAttribute('height', String(px))
  svg.setAttribute('aria-hidden', 'true')
  for (const d of paths) {
    const path = document.createElementNS(NS, 'path')
    path.setAttribute('d', d)
    svg.append(path)
  }
  button.append(svg)
  return button
}

/**
 * How many turns, and how long — as glyphs, in the two places that draw them.
 *
 * ## Why not the words
 *
 * `14 turns · 7 min` on every row of a day's list is the same two nouns down
 * the whole column, and the numbers are what somebody is actually comparing.
 * The glyph carries the noun once, in a shape, and the sentence survives as the
 * accessible name — see `glyph.ts`, which states the rule the microphone in the
 * top strip already follows.
 *
 * ## The mark is per ROW, not per format
 *
 * The first version tested whether the label started with a digit, which left
 * `under a minute` — the one phrase `lengthLabel` used to return — bare, on the
 * grounds that a glyph belongs beside a number. A photograph of the column
 * settled it the other way: one row without the mark its six neighbours carry
 * reads as a row missing something, and the clock is not a unit — it is the
 * word "for". That phrase is gone and every answer is now `7 min` or `1 h 20
 * min`, so the case cannot recur; the rule it settled is what is kept.
 *
 * ## One function, called from both places
 *
 * These two facts were built as strings in the list and again in the transcript
 * header, so a change to one of them was a change to one of them.
 */
export function facts(turns: number, length: string | null): readonly Node[] {
  const said: Node[] = [
    fact(TURNS, String(turns), `${String(turns)} ${turns === 1 ? 'turn' : 'turns'}`),
  ]
  // Null while she is still awake in it — see `lengthLabel`, which refuses to
  // answer at all rather than reporting a backwards span as a real duration.
  if (length !== null) said.push(fact(RAN_FOR, length, `ran for ${length}`))
  return said
}

/**
 * What she reached for in one conversation, as chips.
 *
 * ## Why chips rather than another glyph
 *
 * `facts` says how many turns and how long, in marks, because those are two
 * nouns repeated down a whole column and the numbers are what somebody
 * compares. A capability is the opposite shape: the NAME is the information
 * and the count is the footnote. `ask_workspace` cannot be a mark somebody
 * learns, and there is no column of them to deduplicate — a conversation has
 * none, one, or two.
 *
 * ## The count is only drawn when it is more than one
 *
 * `ask_workspace ×1` is the same fact as `ask_workspace` with more to read,
 * and every chip carrying a `×1` makes the one that says `×3` harder to spot
 * rather than easier. The accessible name carries the whole sentence either
 * way, which is the rule `glyph.ts` states for the marks above.
 */
export function toolChips(tools: readonly { name: string; uses: number }[]): readonly Node[] {
  return tools.map((tool) => {
    const chip = element('span', 'tool-chip')
    chip.append(element('span', 'tool-name', tool.name))
    if (tool.uses > 1) chip.append(element('span', 'tool-uses', `×${String(tool.uses)}`))
    // The sentence, for a reader that does not get the layout. `time`/`times`
    // rather than the `×`, which a screen reader says as "x".
    chip.title = `${tool.name}, called ${String(tool.uses)} ${tool.uses === 1 ? 'time' : 'times'}`
    chip.setAttribute('aria-label', chip.title)
    return chip
  })
}
