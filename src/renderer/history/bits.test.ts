import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { descendants, structuralDocument, textOf, type FakeNode } from '../../test/structural-dom'

/**
 * The small pieces this window builds rows out of.
 *
 * This module's own header says why it exists: the builders were in `main.ts`,
 * which resolves the document at load and cannot be imported, *"so `marked`,
 * the function that decides which characters of a search result are
 * highlighted, had no test and no way to get one"*.
 *
 * It then had no way to get one and still did not get one. Extracting for
 * testability and stopping there is the same defect as the `face.ts` split,
 * which claimed three tests and shipped one.
 *
 * `highlight()` — the actual decision inside `marked` — is tested in
 * `format.test.ts` with eight assertions. What is asserted here is the part
 * that was never covered: which ELEMENTS come out, in what order, carrying
 * what text and which accessible names. See `test/structural-dom.ts` for why
 * that is a fair question to ask without a browser.
 */

const dom = structuralDocument()

beforeEach(() => {
  vi.stubGlobal('document', dom.document)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// Imported after the stub is described, but the module reads `document` per
// call rather than at load, so a normal import is fine.
const { empty, facts, iconButton, marked, toolChips } = await import('./bits')

/** The double is structural; the module is typed against the real DOM. */
const asNode = (value: unknown): FakeNode => value as FakeNode

describe('marking a search hit', () => {
  it('wraps only the matched run in a `mark`', () => {
    const out = asNode(marked('the quick brown fox', 'quick'))
    const marks = descendants(out).filter((one) => one.tag === 'mark')
    expect(marks).toHaveLength(1)
    expect(marks[0]?.textContent).toBe('quick')
  })

  it('keeps every character, in order', () => {
    /*
      The property that matters most and is easiest to lose.

      A builder that dropped or reordered a segment would still produce marks
      in the right places, and the transcript would quietly read differently
      from what was said.
    */
    const said = 'the quick brown fox jumps'
    expect(textOf(asNode(marked(said, 'brown')))).toBe(said)
    expect(textOf(asNode(marked(said, 'the')))).toBe(said)
    expect(textOf(asNode(marked(said, 'zzz')))).toBe(said)
    expect(textOf(asNode(marked(said, '')))).toBe(said)
  })

  it('produces no `mark` when nothing matched', () => {
    const out = asNode(marked('the quick brown fox', 'zebra'))
    expect(descendants(out).filter((one) => one.tag === 'mark')).toHaveLength(0)
  })

  it('marks every occurrence, not just the first', () => {
    const out = asNode(marked('fox fox fox', 'fox'))
    expect(descendants(out).filter((one) => one.tag === 'mark')).toHaveLength(3)
  })

  it('survives text that is entirely a match', () => {
    const out = asNode(marked('fox', 'fox'))
    expect(textOf(out)).toBe('fox')
    expect(descendants(out).filter((one) => one.tag === 'mark')).toHaveLength(1)
  })
})

describe('an icon button', () => {
  const PATH = 'M1 1 L15 15'

  it('carries its name on the BUTTON', () => {
    // A path with no name announces as "button"; a name on both announces
    // twice. This module's comment says the accessibility half is exactly what
    // gets dropped when somebody adds a third by copying one of the others.
    const button = asNode(iconButton('copy', 'Copy this turn', [PATH], 16))
    expect(button.attributes.get('aria-label')).toBe('Copy this turn')
    expect(button.title).toBe('Copy this turn')
  })

  it('hides the graphic from the accessibility tree', () => {
    const button = asNode(iconButton('copy', 'Copy this turn', [PATH], 16))
    const svg = descendants(button).find((one) => one.tag === 'svg')
    expect(svg?.attributes.get('aria-hidden')).toBe('true')
  })

  it('never names the graphic as well as the button', () => {
    // Announcing twice is the failure the split exists to prevent.
    const button = asNode(iconButton('copy', 'Copy this turn', [PATH], 16))
    for (const one of descendants(button)) {
      expect(one.attributes.has('aria-label'), `${one.tag} is named too`).toBe(false)
    }
  })

  it('draws every path it is given', () => {
    const button = asNode(iconButton('arrow', 'Open', [PATH, 'M2 2 L14 14'], 12))
    const paths = descendants(button).filter((one) => one.tag === 'path')
    expect(paths).toHaveLength(2)
    expect(paths.map((one) => one.attributes.get('d'))).toEqual([PATH, 'M2 2 L14 14'])
  })

  it('sizes the graphic as asked, and keeps one viewBox', () => {
    const button = asNode(iconButton('copy', 'Copy', [PATH], 20))
    const svg = descendants(button).find((one) => one.tag === 'svg')
    expect(svg?.attributes.get('width')).toBe('20')
    expect(svg?.attributes.get('height')).toBe('20')
    // The viewBox is fixed while the size varies, or every path would need
    // redrawing per call site.
    expect(svg?.attributes.get('viewBox')).toBe('0 0 16 16')
  })

  it('builds the graphic in the SVG namespace', () => {
    // `createElement('svg')` produces an HTML element the browser renders as
    // nothing at all, and nothing about it looks wrong in a snapshot.
    const button = asNode(iconButton('copy', 'Copy', [PATH], 16))
    expect(descendants(button).some((one) => one.tag === 'svg')).toBe(true)
  })
})

describe('the facts under a conversation', () => {
  /**
   * The plural rule lives in the ACCESSIBLE NAME, not the visible text.
   *
   * The visible part is a glyph and a bare number — a reader sees "1" beside a
   * speech-bubble icon. What says "1 turn" is `aria-label`, which is the only
   * thing a screen reader gets, so the grammar matters there and nowhere else.
   * A first draft of this file asserted on the visible text and found "1".
   */
  const namesIn = (turns: number, length: string | null): string =>
    facts(turns, length)
      .map((one) => asNode(one).attributes.get('aria-label') ?? '')
      .join(' ')

  it('says "1 turn", not "1 turns"', () => {
    expect(namesIn(1, null)).toContain('1 turn')
    expect(namesIn(1, null)).not.toContain('1 turns')
  })

  it('says "2 turns"', () => {
    expect(namesIn(2, null)).toContain('2 turns')
  })

  it('handles zero turns without claiming one', () => {
    expect(namesIn(0, null)).toContain('0 turns')
  })

  it('shows the bare number to somebody who can see it', () => {
    // Both halves matter: the glyph carries the meaning visually and the name
    // carries it otherwise, and neither should start repeating the other.
    expect(
      facts(7, null)
        .map((one) => textOf(asNode(one)))
        .join(''),
    ).toContain('7')
  })

  it('says nothing about length while she is still awake in it', () => {
    /*
      Null is not "zero", it is "do not answer".

      `lengthLabel` refuses rather than reporting a backwards span as a real
      duration, and a builder that rendered the null anyway would print an
      empty or nonsense duration beside a live conversation.
    */
    expect(facts(3, null)).toHaveLength(1)
  })

  it('adds the length once there is one', () => {
    expect(facts(3, '4m')).toHaveLength(2)
    expect(namesIn(3, '4m')).toContain('4m')
  })

  it('names the graphic once, on the wrapper', () => {
    // Named on both the wrapper and the svg, it announces twice.
    for (const one of facts(2, '1m')) {
      const named = descendants(asNode(one)).filter((child) => child.attributes.has('aria-label'))
      expect(named, 'the graphic is named as well as its wrapper').toHaveLength(0)
    }
  })
})

describe('emptying a pane', () => {
  /** A host with something already in it, as a live pane always has. */
  function populated(): FakeNode {
    const made = asNode(
      (dom.document as { createElement: (tag: string) => unknown }).createElement('div'),
    )
    made.append(
      asNode(
        (dom.document as { createElement: (tag: string) => unknown }).createElement('article'),
      ),
    )
    return made
  }

  it('replaces what was there rather than appending to it', () => {
    // Appending leaves the previous list UNDER the new message, which reads as
    // "nothing here" above a screen full of rows.
    const host = populated()
    empty(host as unknown as HTMLElement, 'Nothing yet.')
    expect(host.children.some((one) => one.tag === 'article')).toBe(false)
  })

  it('says what it was given', () => {
    const host = populated()
    empty(host as unknown as HTMLElement, 'No conversations yet.')
    expect(textOf(host)).toContain('No conversations yet.')
  })

  it('leaves exactly one thing behind', () => {
    // Two messages stacked is what a second call would produce if this
    // appended, and it is the shape that looks like a rendering bug.
    const host = populated()
    empty(host as unknown as HTMLElement, 'First.')
    empty(host as unknown as HTMLElement, 'Second.')
    expect(host.children).toHaveLength(1)
    expect(textOf(host)).toBe('Second.')
  })
})

/**
 * The chips the header drew in the artifact and could not draw in the build.
 *
 * `transcriptHead` carried a comment saying they were left out rather than
 * invented, because nothing archived a capability call. `session_tool` is what
 * closed that; these are the rules for what the chips say.
 */
describe('what she reached for, as chips', () => {
  it('draws one chip per capability, naming it', () => {
    const chips = toolChips([
      { name: 'ask_workspace', uses: 1 },
      { name: 'remember_this', uses: 1 },
    ])
    expect(chips).toHaveLength(2)
    expect(textOf(asNode(chips[0]))).toBe('ask_workspace')
    expect(textOf(asNode(chips[1]))).toBe('remember_this')
  })

  it('shows a count only when it is more than one', () => {
    /*
      `ask_workspace ×1` is the same fact as `ask_workspace` with more to read,
      and every chip carrying a ×1 makes the one that says ×3 harder to find
      rather than easier.
    */
    const [once] = toolChips([{ name: 'ask_workspace', uses: 1 }])
    expect(textOf(asNode(once))).toBe('ask_workspace')
    const [twice] = toolChips([{ name: 'ask_workspace', uses: 2 }])
    expect(textOf(asNode(twice))).toBe('ask_workspace×2')
  })

  it('carries the whole sentence as the accessible name, either way', () => {
    // The rule `glyph.ts` states for the marks above: the shape is for the
    // eye, and the sentence survives for a reader that does not get it.
    const [once] = toolChips([{ name: 'ask_workspace', uses: 1 }])
    expect(asNode(once).attributes.get('aria-label')).toBe('ask_workspace, called 1 time')
    const [twice] = toolChips([{ name: 'remember_this', uses: 3 }])
    expect(asNode(twice).attributes.get('aria-label')).toBe('remember_this, called 3 times')
  })

  it('says nothing at all when she reached for nothing', () => {
    // The ordinary conversation. An empty row would be a row half the time.
    expect(toolChips([])).toEqual([])
  })
})
