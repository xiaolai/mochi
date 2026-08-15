import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Anything derived from a snapshot must be re-applied when a NEW one arrives.
 *
 * This window has now got that wrong three times, and `redraw.ts` documents the
 * first two: redrawing on everything destroyed the control under the pointer,
 * then redrawing only on a persona change left auth and shortcuts silently
 * stale. The third was her accent -- applied once in `boot` and never again, so
 * picking a colour recoloured HER and left this window on the previous palette
 * until it was closed and reopened. The form redrew correctly around five stale
 * custom properties, which is why nobody noticed.
 *
 * One defect class, three faces. The fix is structural -- the accent is applied
 * by `paint`, the function that builds the DOM -- and this pins the property
 * that makes it hold: `boot` runs ONCE, so nothing it does to the document can
 * ever be refreshed. Everything else goes through `adopt` and `paint`, which run
 * on every update.
 *
 * A source check rather than a render, for the reason `redraw.ts` gives: this
 * module touches `document` and the bridge at load, so a test cannot import it.
 * The property is architectural and checkable from the text, exactly like the
 * boundary in `main/voice/key-store.test.ts`.
 */
const MAIN = fileURLToPath(new URL('./main.ts', import.meta.url))

/** The body of a top-level `function name(`, by brace matching. */
function bodyOf(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`)
  expect(start, `no function ${name} in main.ts`).toBeGreaterThan(-1)
  const open = source.indexOf('{', start)
  let depth = 0
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    else if (source[index] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(open, index + 1)
    }
  }
  throw new Error(`unbalanced braces in ${name}`)
}

describe('what a snapshot changes is re-applied on every snapshot', () => {
  const source = readFileSync(MAIN, 'utf8')

  it('applies her accent from exactly one place', () => {
    // Counted, not merely present. A second call site is how this returns: the
    // first one stays in `paint` and keeps the test green while the new one --
    // added to `boot`, or to a handler that runs once -- reintroduces a path
    // where the accent and the form disagree.
    const calls = source.match(/accentVariables\(/g) ?? []
    expect(calls).toHaveLength(1)
  })

  it('applies it from the function that draws the window', () => {
    // In `paint`, so drawing this window without the accent it belongs to is
    // not expressible.
    expect(bodyOf(source, 'paint')).toContain('accentVariables(')
  })

  it('leaves boot with nothing of its own to do to the document', () => {
    // `boot` runs once. Anything it writes to the document directly can never
    // be refreshed, whatever arrives later -- so it must write nothing, and
    // hand the snapshot to `render` instead.
    const boot = bodyOf(source, 'boot')
    const direct = ['document.', 'setProperty(', 'replaceChildren('].filter((call) =>
      boot.includes(call),
    )
    expect(direct, `boot writes to the document: ${direct.join(', ')}`).toEqual([])
  })
})
