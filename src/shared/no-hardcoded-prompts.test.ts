import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The claim, as a check rather than as a sentence in a commit message.
 *
 * Every string this app puts in front of a model now lives in the prompt
 * catalogue, is displayed, and is overridable. That was true the day it was
 * done and is exactly the kind of property that decays: the next capability
 * added, or the next refusal worded inline, puts a prompt back out of reach
 * with nothing to notice.
 *
 * ## What it looks for
 *
 * The two shapes that carry model-facing prose — a `guidance:` field and a
 * `cannot(...)` call — must be handed a value rather than a literal. Both are
 * mechanical, which is what makes them checkable; the general question "is this
 * string read by a model" is not, and this does not pretend to answer it.
 *
 * ## What it cannot catch
 *
 * A brand-new shape. If somebody invents a third way to put prose in front of
 * her, this says nothing — so this is a ratchet on the paths that exist, not a
 * proof about the ones that do not. The catalogue's own test covers the other
 * half: every capability's description and every argument must appear in it.
 */

const HERE = fileURLToPath(new URL('.', import.meta.url))
const SRC = join(HERE, '..')

function filesUnder(directory: string): readonly string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) return filesUnder(path)
    return path.endsWith('.ts') && !path.endsWith('.test.ts') ? [path] : []
  })
}

/** `guidance:` or `cannot(` followed by a quote rather than by an expression. */
const LITERAL = /(?:\bcannot\(|\bguidance:)\s*(?:'|`|")/

describe('no prompt is hardcoded', () => {
  const files = filesUnder(SRC).filter((path) => !path.endsWith('prompts.ts'))

  it('finds the source tree it is checking', () => {
    // Counted first. A glob that matched nothing would make every assertion
    // below pass while checking not one line — the failure this repository
    // names as "green is not evidence that anything happened".
    expect(files.length).toBeGreaterThan(50)
  })

  it('hands every guidance a value, never a literal', () => {
    /*
      These reach the model as tool output: "say so plainly rather than
      inventing an answer" is an instruction, and it used to be typed at the
      call site where nobody could see it or change it.

      They come from `deps.prompt(key)` now, filled through `fill` when they
      name something only the caller knows.
    */
    const offenders = files
      .map((path) => ({ path, lines: readFileSync(path, 'utf8').split('\n') }))
      .flatMap(({ path, lines }) =>
        lines
          .map((line, index) => ({ line, at: index + 1 }))
          .filter(({ line }) => LITERAL.test(line))
          .map(({ at, line }) => `${path.slice(SRC.length + 1)}:${String(at)} ${line.trim()}`),
      )
    expect(offenders).toEqual([])
  })
})
