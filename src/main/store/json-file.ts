/**
 * Reading and writing the small JSON files that make up her state.
 *
 * ONE implementation, because there were two. `persona.ts` and
 * `store/worn.ts` -- `preferences.ts` when this was written -- had grown the
 * same eight lines of temp-file-and-rename
 * independently, down to the `0o600` mode and the trailing newline — and the
 * careful reasoning about why the rename matters was written out in only one of
 * them. Two copies of a careful thing are one careful thing and one liability:
 * whichever gets the next fix, the other keeps the bug.
 *
 * Both files are heading for SQLite. Keeping the surface this narrow is what
 * makes that a change to two functions rather than to every caller.
 */

import { randomUUID } from 'node:crypto'
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname } from 'node:path'
import { readBounded } from './read-bounded'

/**
 * Write it through a temporary file and a rename.
 *
 * `writeFileSync` onto the live path truncates first: a crash or a full disk
 * between truncate and write leaves a zero-byte file, and the next launch reads
 * it as corrupt and silently reverts the user to the defaults. `rename` within
 * one directory is atomic on every platform this ships to.
 *
 * `0o600` because a persona is personal, and it will shortly sit next to
 * transcripts.
 */
export function writeJsonAtomically(path: string, value: unknown): void {
  writeTextAtomically(path, `${JSON.stringify(value, null, 2)}\n`)
}

/**
 * The same write, for a file that is not JSON.
 *
 * Extracted rather than copied, which is this file's own opening argument: the
 * symlink reasoning below is careful and there must be exactly one of it. The
 * system prompt is a markdown document read on every wake, so it wants the same
 * rename — a half-written one is a session configured with half a sentence.
 *
 * EXACTLY the text it is given, with no trailing newline added. What is stored
 * is what somebody typed, and `readPrompt` trims on the way back out, so an
 * appended newline would be a byte nobody wrote that nothing can see.
 */
export function writeTextAtomically(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true })
  // UNPREDICTABLE, and refused if it already exists.
  //
  // `${path}.tmp` is a name anybody can work out, and several of these live in
  // directories the user (and anything running as them) can write: a symlink
  // planted at that name is followed by `writeFileSync`, so the write lands
  // wherever the link points, with this process's privileges and `0o600` on
  // the wrong file. A random name makes it unguessable; `wx` makes it a
  // failure rather than a follow if the guess lands anyway.
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    /*
      FLUSHED BEFORE THE RENAME, which is the half that makes this atomic.

      `rename` is atomic with respect to the DIRECTORY ENTRY -- the name points
      at the old file or the new one, never at neither. It says nothing about
      the new file's CONTENTS having reached the disk. `writeFileSync` returns
      once the data is in the page cache, so a crash between the write and the
      flush leaves the rename already durable and the bytes not: the file is
      there, at the right name, holding zeroes.

      That is worse than the torn write this dance exists to prevent, because
      it looks like a successful save. A persona, a prompt or a grants file
      that reads back as empty is indistinguishable from one somebody cleared.

      `fsync` on the file, not the directory: the rename's durability is the
      filesystem's business, and every platform this ships on orders the two
      correctly once the data is flushed first.
    */
    const handle = openSync(temporary, 'wx', 0o600)
    try {
      writeFileSync(handle, text)
      fsyncSync(handle)
    } finally {
      closeSync(handle)
    }
    renameSync(temporary, path)
  } catch (error: unknown) {
    // Never leave the scratch file behind. Unlike the fixed name it replaced,
    // a random one is not reused, so a stray would accumulate rather than be
    // overwritten on the next save.
    rmSync(temporary, { force: true })
    throw error
  }
}

/** Why a file could not be turned into a value, in the caller's words. */
export type ReadProblem =
  | { readonly kind: 'absent' }
  | { readonly kind: 'unreadable'; readonly detail: string }
  | { readonly kind: 'malformed'; readonly detail: string }

export type JsonRead =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly problem: ReadProblem }

/*
  `readJsonFile` was here, and every store uses `readBounded` instead.

  Exported, documented, and covered by seven tests that all passed — with no
  caller anywhere. `readBounded` answers the same three outcomes AND caps the
  read, which is why it won; this one simply outlived the migration.

  `JsonRead` and `ReadProblem` stay: `readBounded` answers in the same shape,
  and two vocabularies for "absent, unreadable, malformed" is how the next
  reader comes to disagree with this one about what a missing file means.
*/

/**
 * The object as it is ON DISK, before any parser normalised it.
 *
 * Every per-file store here reads, validates into a known shape, and writes
 * that shape back — which silently drops any key this build does not know
 * about. That is fine until a NEWER build has written one: rolling back, or
 * running an older window against the same profile, erases somebody's opt-out
 * from a feature this build has never heard of.
 *
 * `preferences.json` already avoids this with `writeMerged`. This is the same
 * idea for the per-character files, and the reason writes merge onto this
 * rather than onto the parsed value.
 *
 * An unreadable or non-object file answers `{}`: there is nothing to preserve,
 * and the caller has already decided what to do about the failure itself.
 */
export function rawObject(path: string): Record<string, unknown> {
  const read = readBounded(path)
  if (!read.ok) return {}
  try {
    const held: unknown = JSON.parse(read.text)
    if (typeof held !== 'object' || held === null || Array.isArray(held)) return {}
    return held as Record<string, unknown>
  } catch {
    return {}
  }
}
