import type { CapabilityManifest, CapabilityParameters } from './manifest'

/** Exactly what goes into `session.update`'s `tools` array. */
export interface WireTool {
  readonly type: 'function'
  readonly name: string
  readonly description: string
  readonly parameters: CapabilityParameters
}

/**
 * Why an installed capability was refused.
 *
 * `shadows-builtin` is the one that matters. A capability named `ask_workspace`
 * would receive every call the real one was meant to answer, which is privilege
 * escalation by naming — the same attack v1's persona store already refuses
 * with its `reserved-id` check. Refused rather than merged, and refused rather
 * than thrown: one bad folder must not stop the other capabilities loading.
 */
export type RegistryProblem =
  | { readonly kind: 'shadows-builtin'; readonly name: string }
  | { readonly kind: 'duplicate-name'; readonly name: string }
  /**
   * This build will not run third-party capability code, so it will not offer
   * it either.
   *
   * The refusal is here, in the thing that builds `tools`, rather than at the
   * call site declining to pass the manifests along. Both keep the code out of
   * the process; only this one keeps the DESCRIPTION out of the model's
   * context. A capability that is described to her but cannot be called is
   * strictly worse than one she has never heard of — she will offer to do it,
   * try, and fail, and the description is attacker-controlled text either way.
   *
   * Lifted only when execution exists and has passed its controls. See W2 in
   * `plan-v2.md` for what those are.
   */
  | { readonly kind: 'execution-unavailable'; readonly name: string }

export interface Refusal {
  readonly manifest: CapabilityManifest
  readonly problem: RegistryProblem
}

export interface Registry {
  /** Built-ins in declared order, then installed sorted by name. Deterministic. */
  readonly tools: readonly WireTool[]
  readonly refused: readonly Refusal[]
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
 * The whole of what v1 spread across five files.
 *
 * `tools` is the payload; `get`/`has` is the dispatch table. A new capability
 * adds a folder and changes neither this function nor its callers — which is
 * the claim this module exists to make checkable, and `registry.test.ts`
 * checks it by loading a fourth capability that no source file mentions.
 *
 * Built-ins keep their declared order because that order is on the wire today
 * and an unnecessary difference is an unnecessary risk; installed capabilities
 * are sorted by name so that a directory listing's order — which is a property
 * of the filesystem, not of the user's intent — cannot change what gets sent.
 */
export function createRegistry(
  builtin: readonly CapabilityManifest[],
  installed: readonly CapabilityManifest[],
  /**
   * Whether anything installed may run. **Default false**, deliberately.
   *
   * A default that widens authority is the wrong direction for a default to
   * fail in — the preload already made that mistake once with its role check.
   * Turning this on is a decision somebody has to write down at the call site.
   */
  mayRunInstalled = false,
): Registry {
  const byName = new Map<string, CapabilityManifest>()
  for (const manifest of builtin) byName.set(manifest.name, manifest)

  const reserved = new Set(byName.keys())
  const refused: Refusal[] = []
  const accepted: CapabilityManifest[] = []

  for (const manifest of [...installed].sort((a, b) => (a.name < b.name ? -1 : 1))) {
    // First, before any other question about it: nothing installed is offered
    // while nothing installed can be run.
    if (!mayRunInstalled) {
      refused.push({ manifest, problem: { kind: 'execution-unavailable', name: manifest.name } })
      continue
    }
    if (reserved.has(manifest.name)) {
      refused.push({ manifest, problem: { kind: 'shadows-builtin', name: manifest.name } })
      continue
    }
    if (byName.has(manifest.name)) {
      refused.push({ manifest, problem: { kind: 'duplicate-name', name: manifest.name } })
      continue
    }
    byName.set(manifest.name, manifest)
    accepted.push(manifest)
  }

  const tools = [...builtin, ...accepted].map(wire)

  return {
    tools,
    refused,
    has: (name) => byName.has(name),
    get: (name) => byName.get(name) ?? null,
  }
}
