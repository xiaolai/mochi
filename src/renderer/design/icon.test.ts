import { Window } from 'happy-dom'
import { Archive, AudioLines, Info, Keyboard, Mic, Monitor } from 'lucide'
import { beforeEach, describe, expect, it } from 'vitest'
import { icon } from './icon'

/**
 * A DOM, because this module's whole job is producing elements.
 *
 * Installed on `globalThis` rather than passed in: `icon()` calls
 * `document.createElementNS` the way the renderer does, and threading a
 * document through every call site to suit a test would change the production
 * signature to test the wrong thing.
 */
beforeEach(() => {
  const window = new Window()
  Object.assign(globalThis, { document: window.document })
})

const SVG_NS = 'http://www.w3.org/2000/svg'

describe('icon', () => {
  it('is built in the SVG namespace, not as an unknown HTML element', () => {
    // The failure this exists for is silent and total. `createElement('svg')`
    // returns an HTMLUnknownElement: it appends without complaint, it inspects
    // as `<svg>` in devtools, and it renders absolutely nothing. No error, no
    // warning, just a gap. Namespace is the one property worth asserting first.
    const svg = icon(Mic)
    expect(svg.namespaceURI).toBe(SVG_NS)
    for (const child of svg.children) expect(child.namespaceURI).toBe(SVG_NS)
  })

  it('draws every shape the icon data describes', () => {
    // Mic is three shapes; dropping one produces a recognisable-but-wrong
    // glyph, which is harder to notice than a missing icon.
    expect(Mic).toHaveLength(3)
    expect(icon(Mic).children).toHaveLength(3)
    expect(icon(Mic).querySelectorAll('path')).toHaveLength(2)
    expect(icon(Mic).querySelectorAll('rect')).toHaveLength(1)
  })

  it('copies each shape’s attributes through', () => {
    const svg = icon(Mic)
    const first = svg.querySelector('path')
    expect(first?.getAttribute('d')).toBe('M12 19v3')
  })

  it('takes the colour and size of the text it sits with', () => {
    // `currentColor` is what keeps icons inside the token system: an icon is
    // legible exactly where its label is, and can never introduce a colour the
    // contrast sweep has not measured. `1em` is the same argument for size.
    const svg = icon(Info)
    expect(svg.getAttribute('stroke')).toBe('currentColor')
    expect(svg.getAttribute('fill')).toBe('none')
    expect(svg.getAttribute('width')).toBe('1em')
    expect(svg.getAttribute('height')).toBe('1em')
  })

  it('is hidden from assistive technology unless it is given a name', () => {
    // Every icon in this app sits beside its own label, so the default has to
    // be silence -- an icon named the same as the word next to it is read out
    // twice.
    const decorative = icon(Keyboard)
    expect(decorative.getAttribute('aria-hidden')).toBe('true')
    expect(decorative.hasAttribute('aria-label')).toBe(false)

    const named = icon(Keyboard, { label: 'Keys' })
    expect(named.getAttribute('aria-label')).toBe('Keys')
    expect(named.getAttribute('role')).toBe('img')
    expect(named.hasAttribute('aria-hidden')).toBe(false)
  })

  it('puts every icon on the same grid and the same stroke', () => {
    // The reason for taking the dependency rather than pasting in eight paths:
    // a set is only a set if the next glyph matches. This asserts the property
    // the library provides.
    for (const node of [AudioLines, Mic, Monitor, Keyboard, Archive, Info]) {
      const svg = icon(node)
      expect(svg.getAttribute('viewBox')).toBe('0 0 24 24')
      expect(svg.getAttribute('stroke-width')).toBe('2')
      expect(svg.children.length).toBeGreaterThan(0)
    }
  })
})
