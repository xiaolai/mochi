/**
 * Removing a character, and the half-removed states that outlive a crash.
 *
 * The callers of `deleting.ts`: a delete marks her, removes the package, then
 * clears the mark, so a process killed in the middle leaves a record that the
 * next launch sweeps. Kept beside that module rather than inside the
 * catalogue, because loading personas and destroying one are different jobs
 * with different failure modes.
 */
import { forgetMemory } from './memory'
import { type PersonaCatalog } from './personas'
import { MANIFEST, manifestId, personasRoot } from './persona-files'
import { forgetPolicy } from './policy'
import { readBounded } from './read-bounded'
import { type Transcripts } from './transcripts'
import { renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { isPackageFolder, markDeleting, unfinishedDeletions, unmarkDeleting } from './deleting'
import { forgetGrants } from './grants'
import { problems } from '../problems'
/**
 * What was at a package path once we had taken it, and nobody else could.
 *
 * `absent` and `notHers` are different answers and callers act on them
 * differently — one is the ordinary idempotent case, the other is the one this
 * whole mechanism exists to refuse.
 */
type Claim =
  | { readonly kind: 'held'; readonly path: string }
  | { readonly kind: 'absent' }
  | { readonly kind: 'notHers'; readonly claims: string | null }

/**
 * Take a package OUT of the personas root, then ask what it is.
 *
 * ## Why the order is that way round
 *
 * Every destructive path here used to read the manifest, decide the folder was
 * hers, and then remove it — two operations on a path anybody else can swap in
 * between. `deletePersona` did the read and `finishDeletion` did the remove,
 * with four filesystem operations between them; the recovery sweep did no read
 * at all and removed whatever folder a mark file happened to name.
 *
 * Checking harder does not close that. A check answers a question about the
 * past tense, and `rmSync` acts in the present.
 *
 * `renameSync` does close it, because it is one operation and it takes the
 * DIRECTORY ENTRY. Once it returns, the thing we are about to delete sits at a
 * path nobody else has a name for, so the manifest read afterwards describes
 * exactly the bytes that will be removed. If it turns out not to be hers, it
 * goes back where it was and nothing has been destroyed.
 *
 * ## The leftover, and why clearing it is safe
 *
 * A process killed between the rename and the remove leaves `.discarding-<x>`
 * behind. It is dot-prefixed, so `loadPersonas` skips it exactly as it skips
 * `.staging-<id>`, and the name is derived from the source rather than random —
 * which is what lets the next attempt clear it rather than accumulate one per
 * try. It is ours by construction: no other code in this project writes that
 * prefix.
 */
function claimPackage(userData: string, id: string, source: string): Claim {
  const root = personasRoot(userData)
  const from = join(root, source)
  const held = join(root, `.discarding-${source}`)
  rmSync(held, { recursive: true, force: true })
  try {
    renameSync(from, held)
  } catch (error: unknown) {
    // Already gone. The ordinary case on a retry, and on a deletion somebody
    // finished by hand.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'absent' }
    throw error
  }
  const standing = readBounded(join(held, MANIFEST))
  const claims = standing.ok ? manifestId(standing.text) : null
  if (claims === id) return { kind: 'held', path: held }
  /*
    PUT BACK, because we are holding somebody else's package.

    A rename back can itself fail — the original name may have been taken in the
    moment we held it — and then the package is parked under a dot-prefixed name
    the catalogue does not read, which looks to its owner exactly like it
    vanished. Reported rather than swallowed for that reason: it is recoverable
    by hand, and only if somebody is told.
  */
  try {
    renameSync(held, from)
  } catch (error: unknown) {
    console.error(`[persona] could not put ${source} back after refusing to delete it:`, error)
    problems.note(
      'personas',
      id,
      `a folder that is not ${id} was moved aside and could not be put back; it is at .discarding-${source}`,
    )
  }
  return { kind: 'notHers', claims }
}

/**
 * Remove a persona file that was just written and must not survive.
 *
 * Only ever called on a FORK whose follow-up step failed -- the file did not
 * exist a moment ago, so removing it restores what was there rather than
 * destroying anything. An ordinary edit overwrites a file that is already
 * somebody's, and rolling that back would turn a failed save into data loss;
 * the caller is responsible for telling the two apart.
 */
export function discardWrite(userData: string, id: string, source: string): void {
  // The allowlist, at the last thing before a recursive remove. `deleting.ts`
  // carries the argument: `'.'` passed the old blocklist and `join(root, '.')`
  // IS the root, so one bad value took every persona. That guard was added
  // where marks are read; these two removals are the other doors to the same
  // `rmSync`, and a rule applied at one door is not a rule.
  if (!isPackageFolder(source)) {
    console.error(`[persona] refusing to discard an unusable folder: ${source}`)
    return
  }
  try {
    /*
      CLAIMED, then checked, then removed — and the id is why this takes one.

      The rollback used to remove `source` on the strength of it having been
      created a moment ago. That is true and it is not enough: "a moment ago" is
      four filesystem operations and a `writeWornPersonaId` away, and a sync
      client restoring a backup into that name in between would have had its
      package deleted by our rollback. `Written` already carries the id, so
      there was never a reason not to ask.

      A package is a FOLDER, which is the other thing this used to get wrong:
      it was `unlinkSync`, so it threw `EPERM` on every call and the rollback it
      exists to perform never once happened.
    */
    const claim = claimPackage(userData, id, source)
    if (claim.kind === 'held') rmSync(claim.path, { recursive: true, force: true })
    else if (claim.kind === 'notHers') {
      console.warn(
        `[persona] not rolling back ${source}: it now claims ${claim.claims ?? 'nothing'}, not ${id}`,
      )
    }
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
  const claims = standing.ok ? manifestId(standing.text) : null
  if (claims !== id) {
    throw new Error(`${source} is no longer ${id}; reopen mochi before deleting this persona`)
  }
  // THE MARK FIRST, and everything else after it.
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
  // concerned -- `loadPersonas` skips a marked id -- and `sweepDeletions`
  // finishes the job on this launch or the next one. So the states are "not
  // deleted" and "deleted, possibly still being tidied up", with nothing in
  // between where she is half gone and fully present.
  markDeleting(userData, id, source)
  finishDeletion(userData, id, source, history)
}

/**
 * Every store that holds something filed under her, emptied. Idempotent.
 *
 * Safe to run again after any failure, which is the whole point of running it
 * behind a mark: each step either removes something or finds it already
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
  // write: the mark makes her deleted from the moment it lands, so there
  // is no state in which she is loaded again and needs her opt-out back.
  forgetPolicy(userData, id)
  forgetGrants(userData, id)
  // The WHOLE package. Her face lives in there too, and leaving an orphaned
  // folder behind would be read as a persona that failed to load rather than
  // one that was deleted.
  //
  // Guarded like `discardWrite`, and it is the sharper of the two: this runs
  // from the recovery sweep as well as from a deliberate delete, so its
  // `source` can come from a mark file somebody edited. THROWS rather than
  // returning, because a deletion that silently skipped the package would
  // unmark her below and leave the folder behind for ever — the one state this
  // function's ordering exists to prevent.
  if (!isPackageFolder(source)) {
    throw new Error(`refusing to delete an unusable folder: ${source}`)
  }
  /*
    AND IT MUST STILL BE HERS, which only one of this function's two callers
    ever checked.

    `deletePersona` reads the manifest and refuses when the folder no longer
    claims the id — good, and it happens before the mark, five filesystem
    operations before the removal below. `sweepDeletions` does not check at all:
    it takes an `id` and a `source` out of a file on disk and deletes whatever
    folder that names. A mark left by a crash, and a package renamed by hand
    afterwards, is enough to erase a different character entirely.

    So the check moves HERE, where both callers reach it, and it is done by
    claiming the folder rather than by reading it — see `claimPackage` for why
    a read cannot close this and a rename can.

    `absent` is not a failure. The package being gone already is the ordinary
    state on a retry, and the remaining stores below have been emptied.
  */
  const claim = claimPackage(userData, id, source)
  if (claim.kind === 'notHers') {
    throw new Error(
      `${source} claims ${claim.claims ?? 'nothing'}, not ${id}; refusing to delete it`,
    )
  }
  if (claim.kind === 'held') rmSync(claim.path, { recursive: true, force: true })
  // LAST. While this is here she is deleted and the work may be unfinished;
  // once it is gone, every store agrees she never existed.
  unmarkDeleting(userData, id)
}

/**
 * Finish any deletion a previous run left half-done.
 *
 * Called at startup, once the transcript store is open. The mark outlives the
 * process that wrote it, so a crash or a disk error partway through a deletion
 * is recovered rather than left as a persona whose memory is gone and whose
 * conversations are not.
 */
export function sweepDeletions(userData: string, history: Pick<Transcripts, 'forget'>): void {
  for (const [id, source] of unfinishedDeletions(userData)) {
    try {
      finishDeletion(userData, id, source, history)
    } catch (error: unknown) {
      // Left in place, so the next launch tries again. Loud, because a
      // deletion that keeps failing is somebody's data outliving their
      // request to remove it.
      console.error(`[personas] could not finish deleting ${id}; will retry next launch:`, error)
      /*
        Somebody asked for this to be gone and it is not.

        "Will retry next launch" is true and is not a reason for silence: until
        that launch happens their data is still on disk, and they have every
        reason to believe otherwise.
      */
      problems.note('personas', id, `this character could not be fully deleted: ${String(error)}`)
    }
  }
}
