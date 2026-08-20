import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Every element a renderer insists on is actually in its document.
 *
 * TWO documents now, not three. Settings stopped being a window when the shell
 * grew its Machine tab; `panes.ts` is imported by the shelf and is checked by
 * `panes.test.ts`, which never needed a document.
 *
 * ## Why this test exists
 *
 * All three renderers open with the same shape: `document.querySelector('#x')`,
 * an `instanceof` check, and `throw new Error('… the document is not the one
 * this expects')`. That is the right behaviour — rendering into nothing is
 * indistinguishable from a slow start — but it is a RUNTIME throw in a window
 * this repository does not test, so an id renamed on one side of the pair is a
 * blank window with a message in a console a packaged app does not have.
 *
 * It stopped being hypothetical the day the settings window was rebuilt into
 * six panes and the conversations window grew character cards: both documents
 * were restructured and both renderers were rewritten, in four separate edits.
 *
 * ## What it is NOT
 *
 * Not a test of what the windows look like or of what they do. `plan-shell.md`
 * is explicit that the two window items are checked live, and this does not
 * replace that — it checks the one property that is mechanical, and says so.
 *
 * The ids are listed here rather than parsed out of the renderer, deliberately.
 * A test that derived them from the same file it is checking would agree with
 * itself: renaming `#nav` in both places would keep it green, which is exactly
 * the change that must not be silent. This list is the third opinion.
 */

function documentAt(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
}

const DOCUMENTS: readonly {
  readonly name: string
  readonly file: string
  readonly ids: readonly string[]
}[] = [
  {
    name: 'the companion',
    file: './companion/index.html',
    ids: ['face', 'app'],
  },
  {
    name: 'the shelf',
    file: './history/index.html',
    // Both halves: the character cards and the conversations that were here
    // first, plus the strip every write says what happened in.
    ids: [
      'mark',
      'state',
      'state-how',
      'mic',
      'mic-label',
      'count',
      'characters',
      'characters-count',
      'pane',
      // `tabs` is gone with the inspector's own two-tab strip: Cast used to
      // carry a "next wake" panel and a "conversations" panel side by side, and
      // the Archive has the whole window now.
      'panel-wake',
      'q',
      'list',
      'talk',
      'troubles',
      'troubles-label',
      'export',
      'said',
      // The shell's three places. Listed explicitly because the renderer reaches
      // for them through a template literal — `need(\`tab-${id}\`)` — which the
      // extraction below cannot see, so without these they would be the one part
      // of the window nothing checks.
      'shell-tabs',
      'tab-cast',
      'tab-archive',
      'tab-machine',
      'nav-groups',
      'machine-pane',
      'machine-tools',
      'topbar-context',
    ],
  },
]

describe.each(DOCUMENTS)('$name', ({ file, ids }) => {
  const html = documentAt(file)

  it.each(ids)('carries #%s, which its renderer throws without', (id) => {
    expect(html).toContain(`id="${id}"`)
  })

  it('loads its own module and nobody else’s', () => {
    // Each document is built as its own entry (`electron.vite.config.ts`), and
    // a document pointing at a sibling's script would expose that sibling's
    // API expectations to the wrong preload role.
    expect(html).toContain('<script type="module" src="./main.ts">')
  })
})

describe('the renderers agree with the documents about what is required', () => {
  it.each(DOCUMENTS)('$name asks for nothing the document does not have', ({ file, ids }) => {
    // The other direction, and the one that catches a renderer growing a new
    // requirement without the markup: every `#id` the entry module looks up has
    // to be one this document actually carries.
    const module = documentAt(file.replace('/index.html', '/main.ts'))
    // Both spellings: the direct `querySelector('#x')` the companion uses, and
    // the `need('x')` helper the two bigger windows use to fail loud.
    const asked = [
      ...module.matchAll(/querySelector\('#([\w-]+)'\)/g),
      ...module.matchAll(/\bneed\('([\w-]+)'/g),
    ]
      .map((one) => one[1])
      .filter((one): one is string => one !== undefined)
    expect(asked.length).toBeGreaterThan(0)
    for (const id of asked) expect(ids).toContain(id)
  })
})
