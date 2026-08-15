/**
 * Reading a file the USER can write, without trusting it about its own size.
 *
 * Three loaders — the persona catalog, the avatar resolver and the memory
 * store — each did `JSON.parse(readFileSync(path, 'utf8'))` on a path inside a
 * user-writable folder. Two things were wrong with that, and they were wrong
 * in all three places, which is what makes this a module rather than three
 * patches.
 *
 * ## A symlink is followed, silently
 *
 * `readFileSync` resolves links. So `memory/tutor.json` pointing at a file
 * elsewhere on the disk is read as though it were hers — and memory reaches a
 * system prompt, so the contents of whatever it points at would be sent to a
 * model. The path-traversal argument the id grammar makes is about the STRING;
 * it says nothing about what the filesystem does with a valid one.
 *
 * ## What this does and does not promise
 *
 * `lstat` then `readFileSync` are two operations, so both checks describe the
 * file as it was a moment ago. Something that swaps a regular file for a
 * symlink, or grows it, between the two wins. Stating that plainly matters
 * more than the mitigation does: this is NOT "symlinks cannot be read" and it
 * is NOT "no more than a megabyte is ever read". It is "a symlink or an
 * oversized file sitting there is refused", which covers the case that
 * actually occurs -- a file the user or another program put in the folder --
 * and does not cover a deliberate race.
 *
 * Closing the race needs `open` with `O_NOFOLLOW` and `fstat` on the handle,
 * which Node exposes portably for neither. The attacker in that race already
 * has write access to this user's own data directory, so the remaining gap is
 * narrow; the reason to say so is that a comment claiming a guarantee this
 * code does not provide is worse than the gap.
 *
 * ## Size is checked after the bytes are already in memory
 *
 * Every field limit in this project — `PERSONA_LIMITS`, `FACE_BOUNDS` — is
 * applied to a value that has already been parsed. A 500MB `personas/x.json`
 * is therefore fully read and fully parsed on the main thread before anything
 * decides it is too big, which on a desktop app means the window does not
 * appear. The ceiling has to be enforced on the way in.
 */

import { lstatSync, readFileSync } from 'node:fs'

/**
 * The most any of these files may be.
 *
 * Generous against what the formats actually hold: the largest legitimate one
 * is a memory file bounded at 20,000 characters, and a face is a few hundred
 * numbers. A megabyte is a limit only a paste or a bug can reach.
 */
export const MAX_FILE_BYTES = 1_048_576

export type BoundedRead =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly reason: BoundedReadProblem }

export type BoundedReadProblem =
  /** No such file. The ordinary case, and never worth a warning on its own. */
  | { readonly kind: 'absent' }
  /** Not a regular file: a symlink, a directory, a device. */
  | { readonly kind: 'not-a-file' }
  /** Larger than this app will read. */
  | { readonly kind: 'too-large'; readonly bytes: number }
  /** Anything else the filesystem said. */
  | { readonly kind: 'unreadable'; readonly detail: string }

/**
 * Read it, or say precisely why not.
 *
 * `lstat` rather than `stat`, which is the whole point: `stat` follows the
 * link and reports on the target, so a symlink would pass a
 * "regular file?" check that used it.
 */
export function readBounded(path: string, limit: number = MAX_FILE_BYTES): BoundedRead {
  let stats
  try {
    stats = lstatSync(path)
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException).code
    return code === 'ENOENT'
      ? { ok: false, reason: { kind: 'absent' } }
      : { ok: false, reason: { kind: 'unreadable', detail: String(error) } }
  }

  if (!stats.isFile()) return { ok: false, reason: { kind: 'not-a-file' } }
  if (stats.size > limit) return { ok: false, reason: { kind: 'too-large', bytes: stats.size } }

  try {
    return { ok: true, text: readFileSync(path, 'utf8') }
  } catch (error: unknown) {
    return { ok: false, reason: { kind: 'unreadable', detail: String(error) } }
  }
}

/** One line of English for a log. Never for a window. */
export function logBoundedRead(problem: BoundedReadProblem): string {
  switch (problem.kind) {
    case 'absent':
      return 'is not there'
    case 'not-a-file':
      return 'is not a regular file (a symlink or a directory will not be followed)'
    case 'too-large':
      return `is ${String(problem.bytes)} bytes, past the ${String(MAX_FILE_BYTES)} this app reads`
    case 'unreadable':
      return `could not be read: ${problem.detail}`
  }
}
