/**
 * Lucide icons, as elements, without a framework.
 *
 * ## Why the library and not a handful of copied paths
 *
 * Eight glyphs could be pasted in as `<path d="…">` and cost no dependency,
 * which is the argument this project makes about every package. What that buys is
 * eight arbitrary drawings: nothing keeps a ninth on the same 24×24 grid, the
 * same 2px stroke, the same corner radius, or the same optical weight, and the
 * first icon somebody adds by eye is the one that makes the set look wrong.
 * Lucide is that consistency, maintained by other people. ISC, no runtime, no
 * DOM assumptions — its icons are plain data.
 *
 * ## Why not `lucide.createElement`
 *
 * The package ships one, and it is fine. This does two things it does not:
 * marks the icon `aria-hidden` by default, and refuses to guess a size. Both
 * are decisions this app has already made elsewhere and should not re-make per
 * call site.
 *
 * ## createElementNS, not createElement
 *
 * `document.createElement('svg')` returns an `HTMLUnknownElement`. It goes into
 * the DOM, it inspects as `<svg>`, and it draws absolutely nothing — no error,
 * no warning, just a gap where the icon was. SVG needs its namespace, and that
 * is the whole reason this file exists rather than the generic `el()` helper.
 */

import type { IconNode } from 'lucide'

const SVG_NS = 'http://www.w3.org/2000/svg'

/**
 * Lucide's canvas and stroke. Not tokens: these are properties of the ARTWORK,
 * the coordinates every icon in the set is drawn against, and changing them
 * does not restyle an icon so much as distort it.
 */
const CANVAS = { viewBox: '0 0 24 24', strokeWidth: '2' } as const

export interface IconOptions {
  /**
   * A name, for an icon carrying meaning ON ITS OWN.
   *
   * Omit it — the default — whenever the icon sits beside a text label, which
   * is every icon in this app so far. A labelled icon next to the same word is
   * read out twice, and the second reading is noise.
   */
  readonly label?: string
}

/**
 * Build one.
 *
 * `currentColor`, always: an icon takes the colour of the text it sits with, so
 * it is legible wherever that text is legible and cannot introduce a colour the
 * contrast sweep has never measured. Size comes from `1em`, so it scales with
 * the type it accompanies rather than needing a token per context.
 */
export function icon(node: IconNode, options: IconOptions = {}): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', CANVAS.viewBox)
  svg.setAttribute('width', '1em')
  svg.setAttribute('height', '1em')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', CANVAS.strokeWidth)
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('class', 'icon')

  // A blank label counts as no label. `role="img"` with an empty `aria-label`
  // is an image a screen reader must announce and has no words for -- strictly
  // worse than the decorative case, which it announces as nothing at all
  // because that is what it is. `undefined` is the ordinary way to ask for
  // decorative; `''` is a caller who meant to pass something and did not.
  if (options.label === undefined || options.label.trim() === '') {
    // Decorative. Hidden from assistive technology AND from the accessibility
    // tree's focus order, because it is beside a label that already says this.
    svg.setAttribute('aria-hidden', 'true')
  } else {
    svg.setAttribute('role', 'img')
    svg.setAttribute('aria-label', options.label)
  }

  for (const [tag, attributes] of node) {
    const child = document.createElementNS(SVG_NS, tag)
    for (const [name, value] of Object.entries(attributes)) {
      child.setAttribute(name, String(value))
    }
    svg.append(child)
  }
  return svg
}
