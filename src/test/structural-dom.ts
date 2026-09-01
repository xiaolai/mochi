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
  /**
   * Inline styles, RECORDED and never computed.
   *
   * A plain bag, in the same spirit as `attributes`: this fake says what a
   * builder set, not what a layout engine would make of it. It exists because
   * pinning a canvas's CSS size is a real decision a builder makes — a canvas
   * sized only by its attributes is a replaced element at `width: auto`, so its
   * border falls outside the box and `box-sizing` has nothing to apply to.
   * Without somewhere to record that, the one line that fixes it cannot be
   * tested and setting it crashes the fake.
   */
  readonly style: Record<string, string>
  /**
   * `data-*`, recorded the way a real element records it.
   *
   * The same bag as `style` and for the same reason: `about.ts` writes
   * `dataset.opens` so the rendered gate can tell which address a row opens
   * without pressing it, and a builder that sets it must be constructible here.
   */
  readonly dataset: Record<string, string>
  title: string
  textContent: string
  /**
   * Nodes, or plain strings — which the real one turns into text nodes.
   *
   * It took nodes only, and a builder that appends a sentence beside an element
   * is ordinary: `storage.ts` writes `where.append(forPronoun(…), element('code',
   * …))`. That stored a bare string among the children, so anything walking the
   * tree afterwards met something with no `children` and threw — which is a
   * failure of this double rather than of the builder.
   */
  append: (...nodes: readonly (FakeNode | string)[]) => void
  replaceChildren: (...nodes: readonly (FakeNode | string)[]) => void
  setAttribute: (name: string, value: string) => void
  /**
   * RECORDED AND NEVER FIRED, which is the whole of what this promises.
   *
   * The file's line above says this double claims nothing about events, and
   * that still holds: nothing here dispatches, bubbles, or captures. What it
   * does is let a builder that BINDS be constructed at all — and almost every
   * builder binds, so without this the settings panes could not be rendered in
   * a test even to ask what they drew.
   *
   * A test that wants to know what a click DOES should not reach for this. The
   * decisions worth testing are pulled out as pure functions with their
   * dependencies injected — `whatWasPressed`, `editing`, `readinessOf` — which
   * is the rule `vitest.config.ts` states and the reason those three exist.
   */
  addEventListener: (type: string, listener: unknown, options?: unknown) => void
  /** Enough of `classList` for a builder that adds or removes a name. */
  readonly classList: {
    add: (...names: readonly string[]) => void
    remove: (...names: readonly string[]) => void
    contains: (name: string) => boolean
  }
}

/** A string becomes a text node, exactly as `Element.append` does. */
function asNode(given: FakeNode | string): FakeNode {
  if (typeof given !== 'string') return given
  const made = node('#text')
  made.textContent = given
  return made
}

function node(tag: string): FakeNode {
  const names = (): Set<string> => new Set(self.className.split(' ').filter((one) => one !== ''))
  const self: FakeNode = {
    tag,
    children: [],
    attributes: new Map<string, string>(),
    style: {},
    dataset: {},
    /*
      Backed by `className` rather than by a set of its own.

      Two stores for one fact is how a fake starts disagreeing with itself: a
      builder that sets `className` and then calls `classList.add` would, with a
      separate set, produce a node whose class depended on which of the two the
      assertion happened to read.
    */
    classList: {
      add: (...added) => {
        const has = names()
        for (const one of added) has.add(one)
        self.className = [...has].join(' ')
      },
      remove: (...gone) => {
        const has = names()
        for (const one of gone) has.delete(one)
        self.className = [...has].join(' ')
      },
      contains: (name) => names().has(name),
    },
    addEventListener: () => {
      // Deliberately nothing. See the declaration: bindings are permitted so a
      // builder can be constructed, never so behaviour can be asserted.
    },
    className: '',
    title: '',
    textContent: '',
    append: (...nodes) => {
      self.children.push(...nodes.map(asNode))
    },
    replaceChildren: (...nodes) => {
      self.children.length = 0
      self.children.push(...nodes.map(asNode))
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
