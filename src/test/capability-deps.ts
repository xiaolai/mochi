/**
 * A `CapabilityDeps` for a test, with everything answered and nothing real.
 *
 * One shape is handed to every handler, so a test that built one by hand would
 * be nine fields of noise around the two it cares about — and would need
 * editing every time the shape grows, in every capability's test, for a
 * dependency it does not use. Override what the case is about; the rest answer
 * plausibly and touch nothing.
 *
 * The defaults are deliberately the "cannot" answers where there is one — no
 * archive, nobody worn, no Codex — so a test that forgot to provide what it
 * needs fails on the assertion rather than quietly reaching a real path.
 */

import type { CapabilityDeps } from '../capabilities/kind'

/** A fixed instant, so nothing here depends on how fast the suite runs. */
export const TEST_NOW = 1_755_432_000_000

export function stubDeps(overrides: Partial<CapabilityDeps> = {}): CapabilityDeps {
  return {
    userData: () => '/nowhere',
    wearing: () => null,
    transcripts: () => null,
    otherPersonaIds: () => new Set(),
    codexPath: () => null,
    workspace: () => '/nowhere',
    guardStopAt: () => '/nowhere',
    webSearch: () => 'disabled',
    codexProfile: () => null,
    now: () => TEST_NOW,
    ...overrides,
  }
}
