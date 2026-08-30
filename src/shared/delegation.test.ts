import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CONFINEMENT_MEASURED_AGAINST } from './delegation'

/**
 * The measured version, and the script that measured it, cannot drift apart.
 *
 * `CONFINEMENT_MEASURED_AGAINST` is not a preference — it is the date of an
 * experiment, and `scripts/verify-codex-precedence.sh` is the experiment. Two
 * copies of that number would be two experiments, and the one people would
 * believe is the one in TypeScript, which nobody re-runs.
 *
 * This is the same binding `design-values.test.ts` makes between the halo's
 * tokens and `halo.ts`'s constants, for the same reason: the file says the two
 * agree, so the claim is made a thing that fails.
 *
 * The state this guards was removed once, on the reasoning that no such number
 * existed. It did — in that script's header, where a search for a TypeScript
 * constant did not look.
 */
describe('the version the confinement was measured on', () => {
  const script = readFileSync(
    fileURLToPath(new URL('../../scripts/verify-codex-precedence.sh', import.meta.url)),
    'utf8',
  )

  it('is the version the script that measures it records', () => {
    expect(script).toContain(CONFINEMENT_MEASURED_AGAINST)
  })

  it('is a bare version, so the comparison has something to parse', () => {
    // Not `codex-cli 0.148.0`. The CLI prints its own name and `readiness.ts`
    // digs the number out of that; the constant is the other operand and has no
    // reason to carry the noise.
    expect(CONFINEMENT_MEASURED_AGAINST).toMatch(/^\d+(?:\.\d+)+$/)
  })
})
