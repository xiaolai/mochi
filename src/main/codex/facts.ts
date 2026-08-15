/**
 * Everything the delegation section needs, gathered in one place.
 *
 * ## Why this is not part of `buildSnapshot`
 *
 * Two file reads and, on a cold start, a process. `buildSnapshot` is
 * synchronous and runs on every repaint of the settings window, so putting any
 * of this behind it would put a twenty-second worst case in front
 * of a redraw. So the facts are gathered asynchronously, cached, and pushed;
 * the snapshot only ever reports what was already known.
 *
 * ## What is deliberately NOT carried out of here
 *
 * `CodexStatus` holds an expiry date, a resolved binary path, and every
 * directory that was searched for it -- and a search path is a home directory,
 * which is a username. Only the kind and the remedy leave this module. Same for
 * trust: the window is told trusted, untrusted, absent or unreadable, never the
 * errno.
 */

import type { DelegationSettings, DelegationView } from '@shared/delegation'
import { loadModelCatalog } from './models'
import { readTrustState } from './trust'
import { NO_DEFAULTS, readCodexDefaults } from './defaults'
import { checkCodex, codexHome, readinessOf, remedyFor, type CodexStatus } from './status'

export interface FactsInput {
  /** Where Codex keeps `models_cache.json` and `config.toml`. */
  readonly home: string
  /** The directory a delegation would be pointed at. */
  readonly workspace: string
  readonly settings: DelegationSettings
  /**
   * Injected so a caller that already probed does not probe again.
   *
   * Checking costs a process and up to three deadlines, which is why
   * `main/probe.ts` exists at all. A caller holding a recent answer should pass
   * it; passing `null` means "find out", and only then does this spawn.
   */
  readonly status?: CodexStatus | null
}

/**
 * What to show before anything has been read.
 *
 * `unreadable` rather than `ready`, because an optimistic placeholder would
 * render a pane claiming a working Codex for as long as the first read takes,
 * and a wrong green is worse than a brief grey one.
 */
export function unknownDelegation(settings: DelegationSettings): DelegationView {
  return {
    settings,
    catalog: { models: [], problem: null },
    readiness: 'unreadable',
    remedy: 'retry',
    trust: 'unreadable',
    trustIsOurs: false,
    codexDefault: NO_DEFAULTS,
  }
}

export async function gatherDelegationFacts(input: FactsInput): Promise<DelegationView> {
  const status = input.status ?? (await checkCodex())
  // Concurrent: two independent file reads under the same directory, and
  // neither informs the other. Sequential would double the latency of opening
  // the settings window for no gain.
  const [catalog, trust, codexDefault] = await Promise.all([
    loadModelCatalog(input.home),
    readTrustState(input.home, input.workspace),
    readCodexDefaults(input.home),
  ])
  return {
    settings: input.settings,
    catalog,
    readiness: readinessOf(status),
    remedy: remedyFor(status),
    trust: trust.kind,
    trustIsOurs: trust.kind === 'trusted' && trust.ours,
    codexDefault,
  }
}

export { codexHome }
