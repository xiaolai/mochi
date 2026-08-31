/**
 * The Codex profile a lookup runs under, and the file somebody edits to change it.
 *
 * ## Why a profile rather than more flags
 *
 * Codex has a large surface — model, reasoning effort, providers, MCP servers.
 * Re-exposing it one flag at a time is a settings window that never finishes,
 * and every flag added is another one this project has to reason about. `-p`
 * hands the whole surface to configuration the user already owns, in a format
 * Codex documents, and leaves this project owning only the part it must: the
 * envelope that makes a voice-triggered lookup safe.
 *
 * ## Why NOT `<workspace>/.codex/config.toml`
 *
 * That was the obvious shape and it is the wrong one, twice over. `.codex` is a
 * RESERVED name — `guardWorkspace` refuses any workspace containing one, so she
 * would simply stop looking. And the reason it is reserved is the reason the
 * idea fails: the workspace is a directory somebody drops files into, and
 * putting the run's configuration inside it means dropping a file changes how
 * the tool behaves. A `config.toml` is strictly worse there than the `AGENTS.md`
 * that was already measured, because it can nominate MCP servers and hooks
 * rather than merely say something.
 *
 * The config belongs where the user's other Codex config lives: `$CODEX_HOME`,
 * outside anything a workspace can reach.
 *
 * ## Seeding into somebody else's directory
 *
 * `$CODEX_HOME` is Codex's, not ours, and that shapes every rule here:
 *
 * - **Only if it already exists.** If the user has never run Codex there is
 *   nothing to configure and `ask_workspace` cannot run anyway; creating a
 *   half-populated home for another application is not ours to do.
 * - **Never clobber.** `wx` — if the file is there it is theirs, whatever is in
 *   it. `seedAvatars` learned this the hard way: a plain existence check left a
 *   stale file on disk forever, and re-seeding over one would throw away
 *   somebody's edits.
 * - **The documentation is INSIDE the file.** `seedAvatars` writes a
 *   `README.txt` beside its example, which is right in a directory we own and
 *   litter in one we do not. TOML comments travel with the thing they describe
 *   and cannot be separated from it.
 * - **Every word of it true.** The avatars README told people to run `pnpm
 *   tuner` for months; there is no such script. A README that lies is worse
 *   than none, and it is worse still in a directory the reader did not ask you
 *   to write in. Fixed in `store/avatars.ts` — kept here as the precedent,
 *   because the rule is what matters and the instance is how it was learned.
 */

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** The profile this project seeds. A name, not a path — see `isProfileName`. */
export const SEEDED_PROFILE = 'mochi'

export function profileFile(codexHome: string, name: string): string {
  return join(codexHome, `${name}.config.toml`)
}

/**
 * Where Codex keeps its configuration.
 *
 * `CODEX_HOME` when it is set, `~/.codex` otherwise — verified against
 * `codex-cli 0.148.0`, which honours the variable in both `exec` and `doctor`.
 * Read from the environment rather than assumed, because somebody who has moved
 * it has moved it for a reason and writing to the wrong place would produce a
 * file that is never read and never noticed.
 */
export function codexHome(env: NodeJS.ProcessEnv, home: string): string {
  const set = env['CODEX_HOME']
  return set !== undefined && set !== '' ? set : join(home, '.codex')
}

/**
 * What the seeded file says.
 *
 * EMPTY of settings on purpose. A layer that sets nothing changes nothing, so
 * seeding it cannot alter how anybody's lookups already behave — the file is an
 * invitation, not a default anybody has to undo.
 *
 * The commented examples are real keys with real values. `web_search` is listed
 * with Codex's own value set rather than an invented one: this project shipped
 * `"on"`/`"off"` once, which typechecked, passed its tests, and was rejected by
 * the CLI on the first real run.
 */
const SEED = `# Codex settings for Mochi's workspace lookups.
#
# This file is yours to edit. Mochi runs its lookups with:
#
#     codex exec -p ${SEEDED_PROFILE} ...
#
# which layers this file on top of your own config.toml. Anything Codex accepts
# in config.toml works here, and applies ONLY to Mochi's lookups.
#
# Nothing is set below, so as it stands this file changes nothing.
#
# Some things you might want:
#
#   model = "gpt-5.6-sol"
#   model_reasoning_effort = "low"
#   web_search = "live"        # disabled | cached | indexed | live
#
# Two things to know:
#
#   1. Mochi always passes -s read-only and empties
#      project_doc_fallback_filenames. Neither can be changed from here, and
#      that is deliberate: the second one is what lets Mochi refuse a workspace
#      containing files that would instruct Codex rather than be read by it.
#
#   2. Everything else here DOES apply — including MCP servers and hooks. A
#      lookup is described to Mochi as read-only, and that describes the
#      filesystem sandbox, not the tools you add here.
#
# Delete this file and Mochi's lookups fall back to your config.toml alone.
`

/**
 * Which profile a lookup should actually layer.
 *
 * An explicit choice wins. Otherwise the seeded one is used IF ITS FILE EXISTS
 * — which is what makes two claims in the seeded file true rather than nearly
 * true: that lookups run with `-p mochi`, and that deleting it falls back to
 * the user's `config.toml` alone.
 *
 * The existence check is not defensive padding. `codex-cli 0.148.0` tolerates
 * `-p` naming a file that is not there, silently — but that is undocumented
 * behaviour, and building the fallback on it would mean the seeded file's last
 * line is a promise about a version rather than about this code.
 */
export function profileFor(
  home: string,
  chosen: string | null,
  exists: (path: string) => boolean,
): string | null {
  if (chosen !== null) return chosen
  return exists(profileFile(home, SEEDED_PROFILE)) ? SEEDED_PROFILE : null
}

export type Seeded =
  | { readonly kind: 'written'; readonly path: string }
  /** Already there, and therefore the user's. Never overwritten. */
  | { readonly kind: 'kept'; readonly path: string }
  /** No Codex home. Nothing to configure, and not ours to create. */
  | { readonly kind: 'no-codex-home'; readonly path: string }
  | { readonly kind: 'failed'; readonly path: string; readonly why: string }

/**
 * Put the file there if it is not, and never touch it if it is.
 *
 * `exists` is injected rather than stat-ed here so the interesting case — the
 * directory is absent — is testable without depending on whether the machine
 * running the tests happens to have Codex installed.
 */
export function seedProfile(
  home: string,
  exists: (path: string) => boolean,
  name: string = SEEDED_PROFILE,
): Seeded {
  const path = profileFile(home, name)
  if (!exists(home)) return { kind: 'no-codex-home', path }
  try {
    // `wx`: fails when it is already there, which is the whole point. A read
    // followed by a write would race, and an unconditional write would throw
    // away whatever somebody had put in it.
    writeFileSync(path, SEED, { flag: 'wx' })
    return { kind: 'written', path }
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return { kind: 'kept', path }
    return { kind: 'failed', path, why: String(error) }
  }
}
