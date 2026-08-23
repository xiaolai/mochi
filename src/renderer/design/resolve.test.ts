import { describe, expect, it } from 'vitest'
import { tokensThatDidNotResolve } from './resolve'

/** What each probe read back for one token, under the two fallbacks. */
const read = (token: string, a: string, b: string) => ({ token, under: [a, b] as const })

describe('deciding whether a design token resolved', () => {
  it('accepts a token whose value happens to BE the old sentinel', () => {
    /*
      THE bug this shape exists for.

      The check used to be `value === 'rgb(255, 0, 255)'`, and `--her` is
      written onto the document by `applyAccent` from the WORN face. §13 says
      in terms that the accent is user data — `FaceSpec.colBody` can be set to
      anything in the tuner, which is why that entry proves its contrast
      guarantee by sweeping the whole colour cube. So a persona entitled to pick
      magenta resolved to exactly the sentinel and was reported as a document
      that does not load tokens.css, throwing out of `resolvePalette`.

      A defined token resolves to its own value under BOTH fallbacks, whatever
      that value is.
    */
    expect(
      tokensThatDidNotResolve([read('--her', 'rgb(255, 0, 255)', 'rgb(255, 0, 255)')]),
    ).toEqual([])
  })

  it('accepts a token whose value is the OTHER fallback too', () => {
    // The same argument, and it is why a second single sentinel would not have
    // been a fix — only the disagreement is safe.
    expect(
      tokensThatDidNotResolve([read('--her', 'rgb(0, 255, 255)', 'rgb(0, 255, 255)')]),
    ).toEqual([])
  })

  it('reports a token that fell through to its fallback', () => {
    // Undefined: each probe reports the fallback it was given, so they differ.
    expect(
      tokensThatDidNotResolve([read('--paper', 'rgb(255, 0, 255)', 'rgb(0, 255, 255)')]),
    ).toEqual(['--paper'])
  })

  it('names every missing token rather than only the first', () => {
    expect(
      tokensThatDidNotResolve([
        read('--paper', 'magenta', 'cyan'),
        read('--ink', 'rgb(0, 0, 0)', 'rgb(0, 0, 0)'),
        read('--alarm', 'magenta', 'cyan'),
      ]),
    ).toEqual(['--paper', '--alarm'])
  })

  it('says nothing is missing when nothing was read', () => {
    expect(tokensThatDidNotResolve([])).toEqual([])
  })
})
