import { lstatSync, realpathSync } from 'node:fs'
import { join } from 'node:path'

/**
 * A directory this process stores things in, verified not to be a redirection.
 *
 * ## What this is defending against
 *
 * Every store here builds `join(userData, '<name>')` and trusts it. The
 * per-FILE defences are already good — `readBounded` reports a symlinked file
 * rather than following it, and each `<name>Path` refuses to build a path from
 * an id that has not passed the persona grammar — but nothing looked at the
 * DIRECTORY. Replace `userData/grants` with a symlink and every read, write,
 * migration and delete lands somewhere else entirely, with all the per-file
 * checks passing because each individual file is exactly what it claims to be.
 *
 * ## Why absent is allowed
 *
 * A store that has never been written has no directory, and creating it is the
 * ordinary path. Absent is the one answer that is safe to accept; anything that
 * is there and is not a plain directory is refused loudly, because a store that
 * quietly writes somewhere else is worse than one that will not open.
 *
 * ## Why the answer is remembered
 *
 * These are called on every read — `memoryPath` runs per lookup — and an
 * `lstat` per call is a syscall per lookup for an answer that does not change
 * within a run. Somebody who can swap the directory mid-session can do worse
 * than defeat this cache, so it buys nothing to re-ask.
 */
const verified = new Set<string>()

export function storeRoot(userData: string, name: string): string {
  /*
    THE CHAIN ABOVE IT, not only the leaf.

    Every check below is on `userData/name`. None of them said anything about
    `userData` itself, or any component of it — so a symlink one level up
    passed silently, and the guard reported a directory it had never looked at.
    `lstat` on the leaf is exactly the wrong tool for that: it refuses to
    follow the last link and says nothing about the ones before it.

    Resolved rather than refused, which is the same choice `transcripts.ts`
    makes and for the same reason: somebody who deliberately relocates their
    Application Support directory — onto another volume, into a synced folder —
    has done something legitimate, and refusing would lose them the app. What
    must not happen is the guard believing it checked a path it did not.

    Resolving also makes the registry's key honest. Two aliases of one
    directory produce one canonical string now, so "one connection per file"
    cannot be defeated by pointing at the same store twice.
  */
  const root = canonicalRoot(userData)
  const path = join(root, name)
  if (verified.has(path)) return path

  let held
  try {
    held = lstatSync(path)
  } catch (error: unknown) {
    // Not there yet is the ordinary case, and is not remembered: the next call
    // sees whatever was created in between.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return path
    throw error
  }

  if (held.isSymbolicLink()) {
    throw new Error(`refusing to use ${name} because it is a symbolic link, not a directory`)
  }
  if (!held.isDirectory()) {
    throw new Error(`refusing to use ${name} because it is not a directory`)
  }
  verified.add(path)
  return path
}

/**
 * `userData` with every symlink in it already followed.
 *
 * Cached because it is a syscall per store per call for an answer that does
 * not change while the app runs — and because `realpath` throws for a path
 * that does not exist yet, which is the ordinary state on a first launch.
 */
const roots = new Map<string, string>()

function canonicalRoot(userData: string): string {
  const known = roots.get(userData)
  if (known !== undefined) return known
  let resolved: string
  try {
    resolved = realpathSync(userData)
  } catch {
    // Not there yet. Not cached either, so the next call sees it once it is.
    return userData
  }
  roots.set(userData, resolved)
  return resolved
}

/** For tests: forget what has been verified, so a fresh tree is looked at again. */
export function forgetVerifiedRoots(): void {
  roots.clear()
  verified.clear()
}
