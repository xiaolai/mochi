/**
 * Enough `document` to assert on the SHAPE a builder produces.
 *
 * ## Why this is not the fake DOM `vitest.config.ts` argues against
 *
 * That comment is about the rig: *"a fake DOM would only make the rig look
 * tested"* — and it is right, because there the pixels are the subject and a
 * stub renders none. It uses `@napi-rs/canvas`, a real rasteriser, for exactly
 * that reason.
 *
 * The builders in `history/bits.ts` and `history/sheet/face-tile.ts` have a
 * different subject. What is worth asserting about them is **which elements,
 * in what order, carrying what text** — whether a search hit becomes a `mark`,
 * whether one turn reads "1 turn" and two read "2 turns", whether a tile that
 * is worn carries the mark. None of that is a rendering question, and a
 * structural record answers it exactly rather than approximately.
 *
 * The line this draws: **this double never claims anything about layout,
 * style, measurement, or events.** It records parentage, tag names, text and
 * attributes, and a test that wants more than those should not be using it.
 *
 * ## Why not jsdom
 *
 * It would answer the same questions at the cost of a dependency this project
 * has none of — `package.json` ships `dependencies: {}` — and it would answer
 * a great many more questions unreliably. Fifty lines that do one thing
 * honestly beat a browser emulator that invites assertions it cannot keep.
 */

export interface FakeNode {
  readonly tag: string
  readonly children: FakeNode[]
  readonly attributes: Map<string, string>
  className: string
  title: string
  textContent: string
  append: (...nodes: readonly FakeNode[]) => void
  replaceChildren: (...nodes: readonly FakeNode[]) => void
  setAttribute: (name: string, value: string) => void
}

function node(tag: string): FakeNode {
  const self: FakeNode = {
    tag,
    children: [],
    attributes: new Map<string, string>(),
    className: '',
    title: '',
    textContent: '',
    append: (...nodes) => {
      self.children.push(...nodes)
    },
    replaceChildren: (...nodes) => {
      self.children.length = 0
      self.children.push(...nodes)
    },
    setAttribute: (name, value) => {
      self.attributes.set(name, value)
    },
  }
  return self
}

/**
 * Install a `document` for the duration of a test file.
 *
 * Returns nothing to un-install: the caller uses `vi.unstubAllGlobals()`, which
 * is the same shape every other stubbing test here uses.
 */
export function structuralDocument(): {
  document: unknown
  /** Every tag created since the last reset, in creation order. */
  created: () => readonly string[]
} {
  const created: string[] = []
  return {
    created: () => created,
    document: {
      createElement: (tag: string) => {
        created.push(tag)
        return node(tag)
      },
      // The rig's icons are SVG. Namespaced creation is a different call and a
      // builder that used the wrong one would produce an element the browser
      // renders as nothing at all.
      createElementNS: (_ns: string, tag: string) => {
        created.push(tag)
        return node(tag)
      },
      createTextNode: (text: string) => {
        const made = node('#text')
        made.textContent = text
        return made
      },
      createDocumentFragment: () => node('#fragment'),
    },
  }
}

/** Depth-first, so an assertion can name what it is looking for. */
export function descendants(root: FakeNode): readonly FakeNode[] {
  return root.children.flatMap((child) => [child, ...descendants(child)])
}

/** Every text node's content, joined — what a reader would actually see. */
export function textOf(root: FakeNode): string {
  if (root.children.length === 0) return root.textContent
  return root.children.map(textOf).join('')
}
