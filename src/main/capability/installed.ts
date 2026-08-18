/**
 * Capabilities somebody installed, found and named — and not run.
 *
 * W2's honest first step. `loadCapabilities` already reads any directory, so
 * the missing piece was never the reading: it is that **this build has no
 * sandbox**, and running a stranger's code in the process that holds the
 * microphone, the archive and the credential is not a thing to do because the
 * loader happened to be reusable.
 *
 * So this discovers, reports by name, and stops. `createRegistry` is told
 * `mayRunInstalled = false`, which keeps the manifests out of `session.tools`
 * as well — see the note on `execution-unavailable` for why the description
 * matters as much as the code.
 *
 * The sandbox that would lift this is decided (core WebAssembly in a dedicated
 * hidden renderer, every privileged operation brokered in main) and is a
 * product, not a patch. Until it exists and has passed its controls, "found,
 * and refused, and told you so" is the whole feature.
 */

import { join } from 'node:path'
import type { CapabilityManifest } from '@shared/capability/manifest'
import { loadCapabilities, type LoadProblem } from './load'

export const CAPABILITIES_DIR = 'capabilities'

/** Where a person would put one. Named here so one string is not typed twice. */
export function installedRoot(userData: string): string {
  return join(userData, CAPABILITIES_DIR)
}

export interface Installed {
  /** Named so it can be shown; nobody has to guess where to look. */
  readonly root: string
  /** Read and valid — and still not run. */
  readonly manifests: readonly CapabilityManifest[]
  /** Folders that are there and broken. Reported, never skipped silently. */
  readonly problems: readonly LoadProblem[]
}

/**
 * Look, and say what is there.
 *
 * A missing folder is the normal case and produces nothing to report — a person
 * with no capabilities installed has not made a mistake. Anything actually
 * present is named, working or not, because the one message that must never be
 * sent is silence about a folder somebody filled on purpose.
 */
export function discoverInstalled(userData: string): Installed {
  const root = installedRoot(userData)
  const found = loadCapabilities(root)
  return { root, manifests: found.manifests, problems: found.problems }
}
