import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  parseManifest,
  type CapabilityManifest,
  type ManifestProblem,
} from '@shared/capability/manifest'

/** One folder, one capability, one file. The filesystem is the index. */
export const MANIFEST = 'manifest.json'

/**
 * A manifest is a file somebody else wrote, so it is read with a ceiling rather
 * than with `readFileSync` alone. 64 KB is far above any legitimate manifest —
 * the largest built-in description is 514 characters — and far below anything
 * that could wedge a startup path.
 */
const MAX_BYTES = 64 * 1024

export type LoadProblem =
  | { readonly kind: 'unreadable'; readonly folder: string }
  | { readonly kind: 'too-large'; readonly folder: string; readonly bytes: number }
  | { readonly kind: 'not-json'; readonly folder: string }
  | { readonly kind: 'invalid'; readonly folder: string; readonly problem: ManifestProblem }
  | { readonly kind: 'name-mismatch'; readonly folder: string; readonly name: string }

export interface LoadResult {
  readonly manifests: readonly CapabilityManifest[]
  readonly problems: readonly LoadProblem[]
}

/**
 * Read a directory of capabilities.
 *
 * Used for BOTH the built-ins and whatever the user has installed, and that is
 * the point rather than a convenience: if the built-ins went through a
 * privileged path — a TypeScript constant, an import, a special case — then the
 * thing a user installs would be travelling a route nobody exercises, and the
 * first person to find a bug in it would be a user. One loader means the
 * built-ins are the test.
 *
 * A missing root is not a problem: a person with no capabilities installed is
 * the normal case, not an error to report. A folder that IS there and is broken
 * is always reported, never skipped silently — every return here carries the
 * folder name, because "one of your capabilities failed" is the message that
 * makes people delete the directory and start over.
 */
export function loadCapabilities(root: string): LoadResult {
  let entries: readonly string[]
  try {
    entries = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
  } catch {
    return { manifests: [], problems: [] }
  }

  const manifests: CapabilityManifest[] = []
  const problems: LoadProblem[] = []

  for (const folder of entries) {
    const file = join(root, folder, MANIFEST)

    let bytes: number
    try {
      bytes = statSync(file).size
    } catch {
      problems.push({ kind: 'unreadable', folder })
      continue
    }
    if (bytes > MAX_BYTES) {
      problems.push({ kind: 'too-large', folder, bytes })
      continue
    }

    let text: string
    try {
      text = readFileSync(file, 'utf8')
    } catch {
      problems.push({ kind: 'unreadable', folder })
      continue
    }

    let value: unknown
    try {
      value = JSON.parse(text)
    } catch {
      problems.push({ kind: 'not-json', folder })
      continue
    }

    const result = parseManifest(value)
    if (!result.ok) {
      problems.push({ kind: 'invalid', folder, problem: result.problem })
      continue
    }

    // The folder names the capability, so a manifest that disagrees with its
    // own folder is refused rather than reconciled. Allowing the mismatch would
    // mean the name a person sees on disk is not the name that reaches the
    // model, and "which folder do I delete to remove this tool" would stop
    // having an answer.
    if (result.manifest.name !== folder) {
      problems.push({ kind: 'name-mismatch', folder, name: result.manifest.name })
      continue
    }

    manifests.push(result.manifest)
  }

  return { manifests, problems }
}
