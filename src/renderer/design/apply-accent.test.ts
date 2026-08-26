import { describe, expect, it } from 'vitest'

import { MOCHI, type FaceSpec } from '@shared/avatar-spec'
import { accentVariables, contrastFailures } from './accent'
import { applyAccent } from './apply-accent'

/**
 * The one moment a stranger's colour becomes the interface's colour.
 *
 * `accent.ts` states the stake: her colour becomes the UI's, so shipping a
 * persona is shipping a theme. The eight built-in themes are swept by a test
 * because their hues are known in advance — a hue somebody else chose has never
 * been seen by anything, and this is the only place it is checked.
 *
 * It had no test. The decision it makes is not cosmetic: applied, an unreadable
 * palette is a window nobody can read; refused silently, it is a character that
 * visibly had no effect and no reason given.
 *
 * No DOM emulator — `vitest.config.ts` argues against one, and this needs
 * nothing but somewhere to record what was set.
 */

/** Just enough of an element to record what was written to it. */
function root(): HTMLElement & { readonly written: Map<string, string> } {
  const written = new Map<string, string>()
  return {
    written,
    style: {
      setProperty: (name: string, value: string) => {
        written.set(name, value)
      },
    },
  } as unknown as HTMLElement & { readonly written: Map<string, string> }
}

/** A hue that cannot carry readable text on its own surface. */
function unreadable(): FaceSpec {
  // Pale yellow: the classic failure, and the reason this check exists at all.
  return { ...MOCHI, colBody: '#ffffcc' }
}

describe('putting her colour on the document', () => {
  it('writes every variable her palette defines', () => {
    const el = root()
    applyAccent(el, MOCHI)
    const expected = accentVariables(MOCHI)
    expect(el.written.size).toBe(Object.keys(expected).length)
    for (const [name, value] of Object.entries(expected)) {
      expect(el.written.get(name), name).toBe(value)
    }
  })

  it('reports nothing wrong with the built-in', () => {
    // The fallback has to be clean, or falling back to it is no remedy.
    expect(applyAccent(root(), MOCHI)).toEqual([])
    expect(contrastFailures(MOCHI)).toEqual([])
  })
})

describe('a hue nobody could read', () => {
  it('is refused rather than applied', () => {
    const face = unreadable()
    // Guard: if this hue ever stops failing, the tests below prove nothing.
    expect(contrastFailures(face).length, 'the fixture must actually fail').toBeGreaterThan(0)

    const el = root()
    applyAccent(el, face)
    const builtIn = accentVariables(MOCHI)
    for (const [name, value] of Object.entries(builtIn)) {
      expect(el.written.get(name), name).toBe(value)
    }
  })

  it('does not leave a single variable from the unreadable palette behind', () => {
    /*
      A PARTIAL application would be the worst outcome.

      Half her hue and half the built-in's is a palette neither test has ever
      swept, and it would pass a check that only asked "did we fall back?".
    */
    const face = unreadable()
    const el = root()
    applyAccent(el, face)
    const hers = accentVariables(face)
    for (const [name, value] of Object.entries(hers)) {
      if (accentVariables(MOCHI)[name] === value) continue
      expect(el.written.get(name), `${name} kept the unreadable value`).not.toBe(value)
    }
  })

  it('says what failed, so the caller can tell somebody', () => {
    // Falling back silently leaves somebody looking at a green window
    // wondering why the character they chose had no effect — the same class of
    // failure as an avatar that quietly did not load.
    const failures = applyAccent(root(), unreadable())
    expect(failures.length).toBeGreaterThan(0)
    expect(failures).toEqual(contrastFailures(unreadable()))
  })

  it('names the pairing rather than just saying no', () => {
    for (const one of applyAccent(root(), unreadable())) {
      expect(one).not.toBe('')
    }
  })
})

describe('every built-in theme', () => {
  it('applies its own palette, never the fallback by accident', () => {
    /*
      The join between this and `accent.test.ts`.

      That file sweeps the built-in hues for contrast; this asserts that a hue
      which PASSES is actually the one written. A fallback that fired for every
      face would satisfy every other test in this file.
    */
    for (const colBody of ['#e79ab8', '#8ab4e7', '#9ae7b4', '#e7c89a']) {
      const face = { ...MOCHI, colBody }
      if (contrastFailures(face).length > 0) continue
      const el = root()
      applyAccent(el, face)
      const hers = accentVariables(face)
      for (const [name, value] of Object.entries(hers)) {
        expect(el.written.get(name), `${colBody} ${name}`).toBe(value)
      }
    }
  })
})
