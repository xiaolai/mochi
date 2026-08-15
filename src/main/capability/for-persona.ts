/**
 * Which capability a persona has, if any.
 *
 * ONE place dispatches on `kind`, so `index.ts` never learns what any of them
 * are and a new shape costs a branch here and nothing else.
 *
 * A refused artifact is REPORTED and produces no capability. The alternative
 * -- approximating, or falling back to an ordinary companion in silence -- is
 * a persona that loads, looks right, and does nothing, which is the least
 * debuggable outcome this feature can have.
 */

import { saidAdvance } from '@shared/artifact'
import { readProgress, writeProgress } from '../store/capability-state'
import { readArtifact } from '../store/artifact'
import type { Capability } from './capability'
import { walkAList } from './walk-a-list'

export function capabilityFor(
  userData: string,
  personaId: string,
  sources: ReadonlyMap<string, string>,
): Capability | null {
  const { artifact, problems } = readArtifact(userData, personaId, sources)
  if (problems.length > 0) {
    for (const problem of problems) console.error(`[capability] ${personaId}: ${problem}`)
  }
  if (artifact === null) return null

  switch (artifact.kind) {
    case 'walk-a-list':
      return walkAList('walk-a-list', {
        // No cast: `readArtifact` returns a `ResolvedArtifact`, whose items are
        // a list by construction. The cast that used to be here was the only
        // thing holding an invariant the type system is perfectly able to hold.
        items: artifact.items,
        advanceOn: (said) => saidAdvance(said, artifact.advanceOn),
        say: artifact.say,
        onRestart: artifact.onRestart,
        read: () => readProgress(userData, personaId),
        write: (progress) => {
          writeProgress(userData, personaId, progress)
        },
      })
  }
}
