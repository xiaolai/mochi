import type { CapabilityManifest, CapabilityParameters } from './manifest'

/** Exactly what goes into `session.update`'s `tools` array. */
export interface WireTool {
  readonly type: 'function'
  readonly name: string
  readonly description: string
  readonly parameters: CapabilityParameters
}

export interface Registry {
  /** In the order they were collected. Deterministic across machines. */
  readonly tools: readonly WireTool[]
  has(name: string): boolean
  get(name: string): CapabilityManifest | null
}

function wire(manifest: CapabilityManifest): WireTool {
  return {
    type: 'function',
    name: manifest.name,
    description: manifest.description,
    parameters: manifest.parameters,
  }
}

/**
 * The manifests as the wire wants them, and the table the dispatch reads.
 *
 * `tools` is the payload; `get`/`has` is the dispatch table. A new capability
 * adds a folder under `src/capabilities/` and changes neither this function nor
 * its callers.
 *
 * ## There is no second source any more
 *
 * This took a second list — capabilities found in the user's folder — and
 * refused it, with three named reasons: `execution-unavailable` because this
 * build has no sandbox, `shadows-builtin` because a folder named
 * `ask_workspace` would receive every call the real one was meant to answer,
 * and `duplicate-name`. All three answered the same question, which was what to
 * do about code somebody else wrote. That category no longer exists: this
 * project is forked and built, so every capability in a build is one the person
 * running it compiled. The reasoning for the sandbox those refusals were
 * holding the door for is kept in `dev-docs/plan-v2.md` under W2, because it is
 * a good decision about a problem this project no longer has.
 *
 * Two capabilities claiming one name is refused by `collect` in
 * `src/capabilities/index.ts` before anything reaches here — from module
 * evaluation, so `pnpm test` catches it and, failing that, the app does not
 * start. (Not `pnpm build`: that bundles the module without running it.)
 *
 * Refused HERE as well, and not as belt and braces. The two views this returns
 * would otherwise disagree — `tools` would carry both manifests onto the wire
 * while the lookup silently kept the last one — so every call to the shadowed
 * name would reach the wrong capability. That is the `shadows-builtin` hazard
 * this module used to name, arriving through a caller that skipped `collect`.
 */
export function createRegistry(manifests: readonly CapabilityManifest[]): Registry {
  const byName = new Map<string, CapabilityManifest>()
  for (const manifest of manifests) {
    if (byName.has(manifest.name)) {
      throw new Error(`two capabilities are named ${manifest.name}`)
    }
    byName.set(manifest.name, manifest)
  }

  return {
    tools: manifests.map(wire),
    has: (name) => byName.has(name),
    get: (name) => byName.get(name) ?? null,
  }
}
