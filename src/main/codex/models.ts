/**
 * Which models the local Codex can actually use.
 *
 * Read from `~/.codex/models_cache.json`, a file the CLI writes itself at
 * session start. So this costs a file read and nothing else -- no network, no
 * process. That is the whole reason to prefer the cache over asking: filling it
 * means running a real `codex exec`, and §8 measured that at twenty seconds
 * minimum on this network. **Nothing here ever spawns to populate it.** A
 * startup path that can block for twenty seconds is a startup path that will.
 *
 * Shaped like `auth.ts` beside it: a pure function over `unknown` for the
 * parsing, and a small async reader that does the I/O, so every interesting
 * case is testable without a Codex installed.
 */

import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import {
  isDelegationSlug,
  type CatalogProblem,
  type CodexModel,
  type ModelCatalog,
} from '@shared/delegation'
import { describeReadFailure } from './auth'

/**
 * A ceiling on the file, for `auth.json`'s reason.
 *
 * This one is genuinely large -- 216 KB on the development machine, because
 * every model carries prose descriptions for each of its reasoning levels. So
 * the bound is generous where `MAX_AUTH_BYTES` is tight; it exists to stop an
 * unbounded read of a user-writable path, not to express an expected size.
 */
const MAX_CACHE_BYTES = 4 * 1024 * 1024

/** The empty answer, with the reason attached. */
const nothing = (problem: CatalogProblem): ModelCatalog => ({ models: [], problem })

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * One entry, or null when it is not one we can offer.
 *
 * Every field is checked rather than asserted. This file is written by another
 * program on the user's disk: its shape is not ours to assume, and a cache from
 * a newer or older Codex is an ordinary thing to meet rather than a corruption.
 * A malformed entry is dropped and its neighbours still load, because one odd
 * record should not cost the user the whole list.
 */
function toModel(value: unknown): CodexModel | null {
  if (!isRecord(value)) return null
  const { slug, display_name, visibility, supported_in_api } = value

  // The SAME grammar `readDelegation` accepts. Offering a slug that saving
  // would silently turn into null is a picker whose selection does not stick,
  // with nothing on screen to say why.
  if (typeof slug !== 'string' || !isDelegationSlug(slug)) return null
  // `visibility` does the filtering that would otherwise need a hand-kept
  // blocklist: two of the nine models on this machine are `hide`, and they are
  // internal (`gpt-5.6-sol-wm`, `codex-auto-review`). Anything that is not
  // explicitly listable is not offered -- unknown values fail closed, so a new
  // visibility state cannot leak an internal model into a user-facing picker.
  if (visibility !== 'list') return null

  const levels = value['supported_reasoning_levels']
  const efforts = Array.isArray(levels)
    ? levels
        .map((level) => (isRecord(level) ? level['effort'] : null))
        .filter((effort): effort is string => isDelegationSlug(effort))
    : []
  // A model with no readable levels is still offerable -- the effort control
  // simply has nothing to show for it, and `null` effort means "follow my Codex
  // config" anyway. Dropping the model instead would hide it for a reason the
  // user cannot see or fix.

  // The advertised default only counts if this model actually lists it.
  // Accepting it blindly let the pane save a level the same catalog says the
  // model does not support -- the exact mismatch the per-model list exists to
  // prevent, arriving through the field meant to be the safe answer.
  const fallback = value['default_reasoning_level']
  const defaultEffort =
    typeof fallback === 'string' && efforts.includes(fallback) ? fallback : (efforts[0] ?? '')

  return {
    slug,
    displayName: typeof display_name === 'string' && display_name !== '' ? display_name : slug,
    efforts,
    defaultEffort,
    // Absent means NOT usable through the API, not "probably fine". The
    // permissive reading would offer a model that fails at run time, and the
    // failure would arrive as a dead delegation rather than as a missing entry.
    inApi: supported_in_api === true,
  }
}

/**
 * Parse a cache that has already been read.
 *
 * Sorted by the file's own `priority`, ascending -- 1 is the model Codex puts
 * first. Sorting here rather than in the interface keeps "which order does this
 * list come in" a property of the data instead of a decision each pane makes
 * differently.
 */
export function readModelCatalog(contents: unknown): ModelCatalog {
  if (!isRecord(contents)) return nothing('malformed')
  const raw = contents['models']
  if (!Array.isArray(raw)) return nothing('malformed')

  const ranked = raw
    .map((entry) => ({
      model: toModel(entry),
      priority:
        isRecord(entry) && typeof entry['priority'] === 'number'
          ? entry['priority']
          : Number.MAX_SAFE_INTEGER,
    }))
    .filter((row): row is { model: CodexModel; priority: number } => row.model !== null)
    .sort((a, b) => a.priority - b.priority)

  // An empty list from a well-formed file is not a problem: it is a Codex that
  // offers nothing, which the interface says by showing nothing rather than by
  // showing a fault.
  return { models: ranked.map((row) => row.model), problem: null }
}

/**
 * Read and parse the cache under a Codex home.
 *
 * Never throws and never spawns. Missing is the ordinary state on a machine
 * whose Codex has not been run yet, so it is reported as `absent` and left for
 * the interface to explain, not treated as a failure.
 */
export async function loadModelCatalog(home: string): Promise<ModelCatalog> {
  const path = join(home, 'models_cache.json')
  try {
    const stats = await stat(path)
    if (!stats.isFile()) return nothing('unreadable')
    if (stats.size > MAX_CACHE_BYTES) return nothing('unreadable')
    return readModelCatalog(JSON.parse(await readFile(path, 'utf8')))
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return nothing('absent')
    // `describeReadFailure` is reused for its discipline about not leaking the
    // path, even though only the category is kept here.
    void describeReadFailure(error)
    return nothing(error instanceof SyntaxError ? 'malformed' : 'unreadable')
  }
}
