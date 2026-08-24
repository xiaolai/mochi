/**
 * Removing a character, and the half-removed states that outlive a crash.
 *
 * The callers of `unfinished.ts`: a delete writes a tombstone, removes the
 * package, then clears the tombstone, so a process killed in the middle leaves
 * a mark that the next launch sweeps. Kept beside that module rather than
 * inside the catalogue, because loading personas and destroying one are
 * different jobs with different failure modes.
 */
import { forgetMemory } from './memory'
import { type PersonaCatalog } from './personas'
import { MANIFEST, personasRoot } from './persona-files'
import { forgetPolicy } from './policy'
import { readBounded } from './read-bounded'
import { type Transcripts } from './transcripts'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { claimedId } from './persona-files'
import { clearTombstone, readTombstones, writeTombstone } from './unfinished'
/**
 * Remove a persona file that was just written and must not survive.
 *
 * Only ever called on a FORK whose follow-up step failed -- the file did not
 * exist a moment ago, so removing it restores what was there rather than
 * destroying anything. An ordinary edit overwrites a file that is already
 * somebody's, and rolling that back would turn a failed save into data loss;
 * the caller is responsible for telling the two apart.
 */
export function discardWrite(userData: string, source: string): void {
  try {
    // A package is a FOLDER. This was `unlinkSync`, which is from before that
    // was true -- so it threw `EPERM` on every call, got caught by the handler
    // below, and logged. The rollback it exists to perform has never once
    // happened: a fork whose follow-up failed stayed on disk, the save
    // reported failure, and the extra persona was in the list anyway.
    rmSync(join(personasRoot(userData), source), { recursive: true, force: true })
  } catch (error: unknown) {
    // Best effort. An orphan persona is visible in the list and recoverable by
    // hand; failing the rollback loudly here would replace one survivable mess
    // with a crash during error handling.
    console.warn(`[persona] could not remove ${source} after a failed save:`, error)
  }
}

/**
 * Remove a persona and everything filed under her.
 *
 * The MEMORY goes too, and that is not tidiness. Ids are derived from names,
 * so `deriveId` will hand out `ada` again the moment nothing holds it -- and a
 * new persona inheriting a stranger's notes is the privacy failure the whole
 * per-id filing exists to prevent. Leaving the notes behind would make that
 * inevitable rather than unlikely.
 *
 * Everything filed under her goes: the package, the memory, the transcripts.
 * The store is a PARAMETER so that omitting it cannot compile -- the first
 * version of this function forgot the transcripts, which is a defect with no
 * symptom until a recycled id hands somebody else's conversations to a new
 * persona.
 *
 * The built-in has no file and cannot be removed; the caller checks that,
 * because it needs to say so in the user's language rather than throw.
 */
export function deletePersona(
  userData: string,
  catalog: PersonaCatalog,
  id: string,
  history: Pick<Transcripts, 'forget'>,
): void {
  const source = catalog.sources.get(id)
  if (source === undefined) throw new Error(`${id} has no file to remove`)
  // The folder must still be there AND still be hers. Checking only that the
  // name exists leaves the case that matters: a folder renamed and a different
  // package moved into its place, at which point this erases one persona's
  // notes and conversations and then removes another persona's package.
  const standing = readBounded(join(personasRoot(userData), source, MANIFEST))
  const claims = standing.ok ? claimedId(standing.text) : null
  if (claims !== id) {
    throw new Error(`${source} is no longer ${id}; reopen mochi before deleting this persona`)
  }
  // THE TOMBSTONE FIRST, and everything else after it.
  //
  // This used to delete her memory and her conversations -- both irreversible
  // -- and only then reach the parts that can fail. A transcript failure, or a
  // package removal that could not complete, left her present in the catalog
  // with her history already destroyed, and the only thing compensated was the
  // retention policy. There is no rollback available for the other two, so the
  // answer cannot be one: what is recorded instead is the INTENT, durably,
  // before anything is touched.
  //
  // From that moment she is deleted as far as the rest of the app is
  // concerned -- `loadPersonas` skips a tombstoned id -- and `sweepDeletions`
  // finishes the job on this launch or the next one. So the states are "not
  // deleted" and "deleted, possibly still being tidied up", with nothing in
  // between where she is half gone and fully present.
  writeTombstone(userData, id, source)
  finishDeletion(userData, id, source, history)
}

/**
 * Every store that holds something filed under her, emptied. Idempotent.
 *
 * Safe to run again after any failure, which is the whole point of running it
 * behind a tombstone: each step either removes something or finds it already
 * gone.
 */
function finishDeletion(
  userData: string,
  id: string,
  source: string,
  history: Pick<Transcripts, 'forget'>,
): void {
  forgetMemory(userData, id)
  // Her CONVERSATIONS too, and the store is a required argument rather than
  // something the caller might remember. This was missed once already: memory
  // was forgotten and transcripts were not, so deleting `ada` and letting the
  // name come round again -- which it does, because ids are derived from
  // names -- would have handed a stranger's conversations to a new character.
  // A parameter makes that omission a compile error instead of a privacy bug.
  history.forget(id)
  // Her retention setting goes with the rest of her state. The ordering
  // argument that used to live here -- delete it before or after the package,
  // and put it back if the package could not go -- is gone with the compensating
  // write: the tombstone makes her deleted from the moment it lands, so there
  // is no state in which she is loaded again and needs her opt-out back.
  forgetPolicy(userData, id)
  // The WHOLE package. Her face lives in there too, and leaving an orphaned
  // folder behind would be read as a persona that failed to load rather than
  // one that was deleted.
  rmSync(join(personasRoot(userData), source), { recursive: true, force: true })
  // LAST. While this is here she is deleted and the work may be unfinished;
  // once it is gone, every store agrees she never existed.
  clearTombstone(userData, id)
}

/**
 * Finish any deletion a previous run left half-done.
 *
 * Called at startup, once the transcript store is open. A tombstone outlives
 * the process that wrote it, so a crash or a disk error partway through a
 * deletion is recovered rather than left as a persona whose memory is gone and
 * whose conversations are not.
 */
export function sweepDeletions(userData: string, history: Pick<Transcripts, 'forget'>): void {
  for (const [id, source] of readTombstones(userData)) {
    try {
      finishDeletion(userData, id, source, history)
    } catch (error: unknown) {
      // Left in place, so the next launch tries again. Loud, because a
      // deletion that keeps failing is somebody's data outliving their
      // request to remove it.
      console.error(`[personas] could not finish deleting ${id}; will retry next launch:`, error)
    }
  }
}
