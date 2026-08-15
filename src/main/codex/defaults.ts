/**
 * What "follow my Codex" actually resolves to.
 *
 * `model` and `model_reasoning_effort` are top-level keys in
 * `~/.codex/config.toml`, so the choice is not opaque to us -- and treating it
 * as opaque cost the user two things:
 *
 * 1. The effort control disappeared entirely while the model followed Codex,
 *    on the reasoning that an unknown model has an unknown set of levels. The
 *    model is not unknown; it is written down one file away.
 * 2. "Follow my Codex" said nothing about what it was following. On the
 *    development machine that is `gpt-5.6-sol` at `ultra`, which is why a
 *    delegation took sixty-six seconds -- a fact the user could have acted on
 *    and could not see.
 *
 * A deliberately small parser. This reads two scalar keys from the top of a
 * file another program owns; it is not a TOML implementation and must not grow
 * into one. Anything it cannot confidently read comes back `null`, which the
 * interface already knows how to say.
 */

import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { isDelegationSlug } from '@shared/delegation'

/** Same ceiling as the trust reader: the path is user-writable. */
const MAX_CONFIG_BYTES = 4 * 1024 * 1024

/**
 * A bare top-level key, before the first table header.
 *
 * Anchored to the start of the file's top section on purpose. `model = …`
 * inside `[some.table]` belongs to that table and is not the global default,
 * and reading it as one would report a setting the user never made.
 */
function topLevelString(text: string, key: string): string | null {
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    // The top section ends at the first table header.
    if (line.startsWith('[')) return null
    if (!line.startsWith(key)) continue
    const rest = line.slice(key.length).trim()
    if (!rest.startsWith('=')) continue
    const value = rest.slice(1).trim()
    const quote = value[0]
    if (quote !== '"' && quote !== "'") return null
    const end = value.indexOf(quote, 1)
    return end === -1 ? null : value.slice(1, end)
  }
  return null
}

export interface CodexDefaults {
  /** `null` when the file does not say, which is ordinary rather than wrong. */
  readonly model: string | null
  readonly effort: string | null
}

export const NO_DEFAULTS: CodexDefaults = { model: null, effort: null }

export async function readCodexDefaults(home: string): Promise<CodexDefaults> {
  try {
    const path = join(home, 'config.toml')
    const stats = await stat(path)
    if (stats.size > MAX_CONFIG_BYTES) return NO_DEFAULTS
    const text = await readFile(path, 'utf8')
    const model = topLevelString(text, 'model')
    const effort = topLevelString(text, 'model_reasoning_effort')
    // Held to the same grammar everything else is: these are shown to the user
    // and compared against catalog slugs, and a value that fails the check here
    // would fail it at every later step anyway.
    return {
      model: isDelegationSlug(model) ? model : null,
      effort: isDelegationSlug(effort) ? effort : null,
    }
  } catch {
    return NO_DEFAULTS
  }
}
