/**
 * Refuse to look at a workspace that can talk back.
 *
 * See `shared/delegation.ts` for the measurement. The gate is here, before the
 * process starts, and it is an assertion rather than a preference: there is no
 * legitimate reason for an instruction file to be in a directory she has been
 * pointed at, so finding one means something is wrong and the honest response
 * is to stop and say which file.
 *
 * ## Why the ancestors too
 *
 * Codex reads `AGENTS.md` from the working root UPWARD. Guarding only the leaf
 * would leave a hole one directory up.
 *
 * The walk stops at `stopAt`, which the caller sets to a boundary it owns.
 * Above that is somebody's home directory, and refusing to work because they
 * keep an `AGENTS.md` in `~` would be punishing them for a file that predates
 * this application and is none of its business. That is a real limit and is
 * stated as one: a global `~/.codex/AGENTS.md` most likely does reach these
 * runs, and this guard does not stop it.
 */

import { dirname, join, resolve } from 'node:path'
import { RESERVED_NAMES, type WorkspaceHazard, type WorkspaceVerdict } from '@shared/delegation'

export interface GuardOptions {
  /** The directory Codex will be pointed at with `-C`. */
  readonly workspace: string
  /**
   * Inclusive upper bound of the walk.
   *
   * Required rather than defaulted. A default would be a guess about where the
   * caller's data lives, and a guard whose scope is guessed is a guard whose
   * scope is wrong somewhere.
   */
  readonly stopAt: string
  /**
   * Injected: the entry names in this directory.
   *
   * Injected so the interesting cases — a `.codex` one level up, an unreadable
   * directory, a name differing only in case — are testable without building
   * them on a real disk, and so a filesystem that throws is exercised rather
   * than hoped about.
   */
  readonly list: (directory: string) => readonly string[] | Promise<readonly string[]>
}

/**
 * Every directory from the workspace up to and including `stopAt`.
 *
 * Throws when `stopAt` is not an ancestor. That is a programming error — the
 * caller has passed two unrelated paths and the walk would run to the
 * filesystem root scanning directories nobody meant to scan. Loud, because a
 * guard that silently widens its own scope is worse than one that is absent.
 */
function chain(workspace: string, stopAt: string): readonly string[] {
  const top = resolve(stopAt)
  const directories: string[] = []
  let current = resolve(workspace)
  for (;;) {
    directories.push(current)
    if (current === top) return directories
    const parent = dirname(current)
    // `dirname('/')` is `/`, so this is the filesystem root and `stopAt` was
    // never on the path.
    if (parent === current) {
      throw new Error(`stopAt ${top} is not an ancestor of ${resolve(workspace)}`)
    }
    current = parent
  }
}

/**
 * May she look at this workspace?
 *
 * Reports EVERY hazard rather than the first. Somebody who has to clear three
 * files should be told about three files once, not discover the next one each
 * time they retry.
 *
 * ## What this is not, and cannot be
 *
 * IT IS A SCAN, AND THE SCAN ENDS BEFORE CODEX STARTS. This walks the workspace
 * and its ancestors and then a subprocess reads the same directories a moment
 * later. A file arriving between the two is not seen — there is no way for one
 * process to hand another a snapshot of a directory tree, and nothing here can
 * change that.
 *
 * So the guarantee is "no reserved file was present when we looked", which is
 * the state that actually occurs: a repository somebody cloned last week with
 * an `AGENTS.md` in it. It is not "no reserved file can be read", and the two
 * differ exactly when something is racing this on purpose.
 *
 * Stated rather than narrowed, because narrowing it is the trap. Re-scanning
 * closer to the spawn, or scanning twice, buys a smaller window and reads as a
 * fix — and a window nobody can measure is worse than one written down.
 *
 * ## What would close part of it
 *
 * `AGENTS.md` is the largest of the four hazards and Codex has a setting for
 * it: `project_doc_max_bytes`, a `usize`, which at 0 should leave the project
 * document empty however it arrives. That would make this guard defence in
 * depth for that one kind rather than the only line, and it is time-independent
 * — the file could appear during the run and still reach nothing.
 *
 * NOT DONE HERE, because it is unverified. The key exists and is typed — a
 * deliberately wrong value gives `invalid type: string, expected usize` at
 * config-parse time, before any model call, on codex-cli 0.150.1. Whether `0`
 * means "read none" or is treated as "no limit" was not measured: three
 * attempts to run `codex exec` to completion on this machine hung with no
 * output. A security flag nobody has watched work is a comment claiming a
 * guard, which is the defect this file has spent its life removing.
 *
 * The other three — `.rules`, `.agents`, `.codex` — have no such setting, so
 * the scan remains the only answer for them either way.
 */
export async function guardWorkspace(options: GuardOptions): Promise<WorkspaceVerdict> {
  const { workspace, stopAt, list } = options
  const hazards: WorkspaceHazard[] = []

  for (const directory of chain(workspace, stopAt)) {
    let entries: readonly string[]
    try {
      entries = await list(directory)
    } catch {
      // Fail closed. The reason is deliberately not carried through: it would
      // be an errno from the filesystem, and this layer does not write
      // sentences for anybody to read.
      return { ok: false, why: 'unreadable', path: directory }
    }
    for (const entry of entries) {
      const kind = RESERVED_NAMES[entry.toLowerCase()]
      if (kind !== undefined) hazards.push({ kind, path: join(directory, entry) })
    }
  }

  return hazards.length === 0 ? { ok: true } : { ok: false, why: 'reserved', hazards }
}
