/**
 * A few Lucide icons as DOM, for the facts that repeat on every row.
 *
 * ## Why this is not `companion/icons.ts`
 *
 * That file holds the same library on the same 24x24 grid, and it is deliberate
 * that this is a second table rather than an import. It stores PATH DATA for a
 * canvas: an `Icon` there is `paths` plus `rects`, because those are the two
 * shapes `ctx` is taught to draw. Two of the three below are circles, and
 * widening that type would mean either teaching the canvas drawer a shape
 * nothing on the canvas uses, or letting it silently skip one — which is how an
 * icon comes to render as half of itself with nothing failing.
 *
 * So: same library, same grid, same stroke conventions (width 2, round caps and
 * joins), same regeneration command, different output medium. Regenerate with:
 *
 *     node -e 'console.log(require("node:fs").readFileSync(
 *       "node_modules/lucide-static/icons/clock.svg", "utf8"))'
 *
 * `lucide-static` is a devDependency and none of it reaches the bundle — the
 * geometry below is what ships.
 *
 * ## The words are not replaced, they are moved
 *
 * Every glyph carries its sentence as the accessible name. The microphone in
 * the top strip already states the rule this follows: an icon alone *"is only a
 * statement to somebody already looking at it"*. A row reading `14 · 7 min`
 * with two pictures is quicker to scan and no less readable to somebody who
 * cannot see them, which is the only trade worth making here.
 */

const NS = 'http://www.w3.org/2000/svg'

export interface Glyph {
  /** SVG path data on Lucide's 24x24 grid. */
  readonly paths: readonly string[]
  /** Lucide states some shapes as `<circle>`; drawn as one rather than traced. */
  readonly circles: readonly { readonly cx: number; readonly cy: number; readonly r: number }[]
}

/** `messages-square` — lucide-static 1.31.0. How many turns were taken. */
export const TURNS: Glyph = {
  circles: [],
  paths: [
    'M16 10a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 14.286V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z',
    'M20 9a2 2 0 0 1 2 2v10.286a.71.71 0 0 1-1.212.502l-2.202-2.202A2 2 0 0 0 17.172 19H10a2 2 0 0 1-2-2v-1',
  ],
}

/** `clock` — lucide-static 1.31.0. How long it ran. */
export const RAN_FOR: Glyph = {
  circles: [{ cx: 12, cy: 12, r: 10 }],
  paths: ['M12 6v6l4 2'],
}

/** `at-sign` — lucide-static 1.31.0. Who made it. */
export const AUTHOR: Glyph = {
  circles: [{ cx: 12, cy: 12, r: 4 }],
  paths: ['M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8'],
}

/**
 * `git-branch` — lucide-static 1.31.0. Where the source is.
 *
 * Lucide ships no GitHub mark; brand glyphs were removed from the set. This
 * says "the source" rather than naming a host, which is the more honest label
 * anyway — the row's words carry the address.
 */
export const SOURCE: Glyph = {
  circles: [
    { cx: 18, cy: 6, r: 3 },
    { cx: 6, cy: 18, r: 3 },
  ],
  paths: ['M15 6a9 9 0 0 0-9 9V3'],
}

/** `globe` — lucide-static 1.31.0. The application's own site. */
export const SITE: Glyph = {
  circles: [{ cx: 12, cy: 12, r: 10 }],
  paths: ['M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20', 'M2 12h20'],
}

/** `tag` — lucide-static 1.31.0. Which build this is. */
export const VERSION: Glyph = {
  circles: [{ cx: 7.5, cy: 7.5, r: 0.5 }],
  paths: [
    'M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z',
  ],
}

/**
 * The graphic on its own, at whatever size the caller draws it.
 *
 * Lifted out of `fact` at its SECOND use rather than copied into the About
 * pane — the extraction rule this repository states, applied to eleven lines
 * that would otherwise exist twice with one of them silently drifting when a
 * shape is added to `Glyph`.
 *
 * `aria-hidden` here rather than at the call site, because a bare graphic
 * announcing itself is never what is wanted: every caller wraps it in something
 * that carries the words.
 */
export function glyphSvg(glyph: Glyph, px: number): SVGElement {
  const svg = document.createElementNS(NS, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('width', String(px))
  svg.setAttribute('height', String(px))
  svg.setAttribute('aria-hidden', 'true')
  for (const circle of glyph.circles) {
    const drawn = document.createElementNS(NS, 'circle')
    drawn.setAttribute('cx', String(circle.cx))
    drawn.setAttribute('cy', String(circle.cy))
    drawn.setAttribute('r', String(circle.r))
    svg.append(drawn)
  }
  for (const path of glyph.paths) {
    const drawn = document.createElementNS(NS, 'path')
    drawn.setAttribute('d', path)
    svg.append(drawn)
  }
  return svg
}

/**
 * One fact, as a glyph and a number, announced as a sentence.
 *
 * `role="img"` plus `aria-label` on the WRAPPER rather than on the `<svg>`, and
 * the number hidden from the accessibility tree with it — otherwise a screen
 * reader reads "14 turns" and then "14" again. The same shape `wornMark` in
 * `shelf.ts` uses, and for the same reason.
 *
 * `title` too, so a pointer gets the words without a screen reader. An icon
 * whose meaning is only available to assistive technology is an icon that is
 * merely decorative to everybody else.
 */
export function fact(glyph: Glyph, value: string, says: string): HTMLElement {
  const wrap = document.createElement('span')
  wrap.className = 'fact'
  wrap.setAttribute('role', 'img')
  wrap.setAttribute('aria-label', says)
  wrap.title = says

  // Announced by the wrapper above it, so the graphic itself stays out of the
  // tree rather than being named twice — `glyphSvg` sets that.
  const svg = glyphSvg(glyph, 13)

  const said = document.createElement('span')
  said.textContent = value
  // Hidden from the tree, not from the eye: the wrapper's label already says
  // the number in words, and both being read is the double announcement above.
  said.setAttribute('aria-hidden', 'true')

  wrap.append(svg, said)
  return wrap
}
