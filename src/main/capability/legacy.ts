/**
 * The capabilities folder that used to mean something, found and said out loud.
 *
 * Until 2026-08-19 a person could drop a capability into
 * `<userData>/capabilities/`. It was never run — this build has no sandbox for
 * code somebody else wrote — but it was READ, listed in the settings window and
 * reported by name. Then the distribution model changed: this project is forked
 * and built, a capability is a folder in the source, and the loader that read
 * that directory is gone.
 *
 * Somebody has a folder there. Deleting the feature without a word would be
 * exactly the "the app ignored my files" failure this project keeps writing
 * rules about — the same one `problems` exists for. So the folder is looked at
 * once, and if it holds any capability SUBDIRECTORIES that is said once.
 *
 * Subdirectories, precisely: one folder was one capability, and the loose files
 * beside them — a `.DS_Store`, a readme somebody wrote — are not anybody's
 * work and would make this fire for nothing.
 *
 * ONE message, and only when there is something to say. An empty folder, or no
 * folder at all, is the normal case for almost everybody and is not a mistake
 * anybody made.
 */

import { opendirSync } from 'node:fs'
import { join } from 'node:path'

const LEGACY_CAPABILITIES_DIR = 'capabilities'

/** Where one used to go. Named here so the string is not typed twice. */
export function legacyCapabilitiesRoot(userData: string): string {
  return join(userData, LEGACY_CAPABILITIES_DIR)
}

/**
 * What is still sitting in the old folder.
 *
 * `ENOENT` ONLY for the empty answer, and that distinction is the whole value
 * of this function. Catching every error and answering "nothing there" would
 * suppress the one message it exists to send: a folder that cannot be listed —
 * permissions, a broken mount, an I/O error — is the case where somebody's
 * work is most likely to be sitting there unreachable, and it would be the case
 * this reported as fine.
 *
 * Never throws either way. This runs on the startup path and nothing here is
 * worth failing a launch over; the caller is handed the problem to report.
 *
 * Names rather than a sentence, so the caller decides the wording and this
 * stays testable without a message to match.
 *
 * BOUNDED as it reads, not sliced afterwards. This runs on the startup path,
 * and slicing a full listing would still have built and sorted every name in a
 * directory somebody could have filled with anything. `opendirSync` streams,
 * so at most `MAX_NAMED` names are ever held. The COUNT is not bounded and
 * cannot be — knowing how many there are means walking to the end — but a
 * counter is one number rather than an array.
 *
 * The names kept are therefore the first `MAX_NAMED` in directory order, then
 * sorted. For the folder this exists for, that is all of them; for a
 * pathological one, which twenty names come back matters far less than the
 * count does.
 */
export const MAX_NAMED = 20
export type Leftovers =
  | {
      readonly ok: true
      /** At most `MAX_NAMED` of them. `count` is how many there actually are. */
      readonly folders: readonly string[]
      readonly count: number
    }
  | { readonly ok: false; readonly why: string }

/**
 * One directory, read one entry at a time.
 *
 * Injected so the bounded-holding property can be ASSERTED rather than
 * described: a test hands this a thousand entries and checks that only
 * `MAX_NAMED` names are ever kept, which a implementation that read everything
 * and sliced afterwards would fail. `guardWorkspace` injects its `list` for the
 * same reason.
 */
export interface DirectoryEntry {
  readonly name: string
  isDirectory(): boolean
}
export interface DirectoryReader {
  readSync(): DirectoryEntry | null
  closeSync(): void
}

export function leftoverCapabilities(
  userData: string,
  open: (path: string) => DirectoryReader = opendirSync,
): Leftovers {
  const folders: string[] = []
  let count = 0
  let directory: DirectoryReader
  try {
    directory = open(legacyCapabilitiesRoot(userData))
  } catch (error: unknown) {
    // Not there at all is the ordinary case for almost everybody, and is not a
    // mistake anybody made. Anything else is reported: a folder that cannot be
    // opened is where somebody's work is most likely to be sitting unreachable.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ok: true, folders: [], count: 0 }
    }
    return { ok: false, why: String(error) }
  }
  try {
    for (;;) {
      const entry = directory.readSync()
      if (entry === null) break
      // One folder was one capability. The loose files beside them — a
      // `.DS_Store`, a readme somebody wrote — are not anybody's work.
      if (!entry.isDirectory()) continue
      count += 1
      if (folders.length < MAX_NAMED) folders.push(entry.name)
    }
  } catch (error: unknown) {
    // A read that fails PART WAY through is still a directory whose contents
    // are unknown, and unknown has to mean "say so" rather than "here is what I
    // happened to get before it broke".
    return { ok: false, why: String(error) }
  } finally {
    // The handle goes back whatever happened. A startup check that leaks a
    // directory handle on every launch is a slower version of the same bug.
    try {
      directory.closeSync()
    } catch {
      // Already closed, or the failure above closed it. Nothing to report: the
      // answer this function gives does not depend on it.
    }
  }
  return { ok: true, folders: folders.sort(), count }
}
