/**
 * What each persona remembers, filed under her id.
 *
 * ## Why this is not a field of `Persona`
 *
 * A persona is what somebody WROTE; memory is what came of using it. The two
 * have different lifetimes, and that is the whole argument: a persona can be
 * replaced by a newer version of itself -- edited, re-imported, one day
 * shipped as a package -- and the memory has to survive that. Held inside the
 * persona, "update" and "wipe her history" would be the same operation.
 *
 * It is also a privacy boundary rather than a tidiness one. A work persona and
 * a personal one sharing a memory is a fault, not a smell, so the file is per
 * id and nothing merges them.
 *
 * ## Bounded, because it is billed
 *
 * Every byte here is concatenated into a system prompt and sent on every wake.
 * `PERSONA_LIMITS.memory` is the ceiling and it is enforced HERE, on the way
 * out as well as in: a file edited by hand is exactly as capable of holding a
 * novel as a bug is, and the cost lands on the user either way.
 *
 * ## Who writes it
 *
 * The `remember_this` capability, when somebody asks her out loud to remember
 * something — one line, appended under its own heading. And the sleep-time
 * summariser in `memory/summarise.ts`, which rewrites the whole note from the
 * presence that just ended; it was wired on 2026-08-26, having been written,
 * tested and called by nothing until then.
 *
 * A writer must read through `recallState` rather than `recall`. See its note:
 * `recall` answers "" for a note that could not be read, which is right for the
 * read path and destroys the file for anything that appends and saves.
 */

import { unlinkSync } from 'node:fs'
import { storeRoot } from './store-root'
import { join } from 'node:path'
import { logBoundedRead, readBounded } from './read-bounded'
import { PERSONA_LIMITS } from '@shared/persona'
import { isPersonaId } from '@shared/parse-persona'
import { boundedHead } from '@shared/text'
import { writeJsonAtomically } from './json-file'

export const MEMORY_DIR = 'memory'

export function memoryRoot(userData: string): string {
  return storeRoot(userData, MEMORY_DIR)
}

/**
 * The file holding one persona's notes.
 *
 * `id` has already passed the persona grammar, which admits no dot and no
 * separator -- so this join cannot escape the folder. The assertion is not
 * defence in depth for its own sake: this function turns an id into a PATH,
 * and it is the one place where a grammar change that let a `/` through would
 * become a traversal rather than a lookup failure.
 */
function memoryPath(userData: string, id: string): string {
  if (!isPersonaId(id))
    throw new Error(`refusing to build a memory path from ${JSON.stringify(id)}`)
  return join(memoryRoot(userData), `${id}.json`)
}

/**
 * What she remembers, or nothing.
 *
 * Nothing is the ordinary case and is never an error: a persona nobody has
 * talked to has no notes, and reporting that identically to "her memory could
 * not be read" would put a warning in front of every new character.
 *
 * A file that cannot be read or does not hold text yields nothing too, and
 * says so in the log. Failing to start because a note is corrupt would be
 * worse than starting without it -- but doing that silently is what leaves
 * somebody wondering why she has forgotten them.
 */
export function recall(userData: string, id: string): string {
  const read = recallState(userData, id)
  return read.ok ? read.notes : ''
}

/**
 * What she remembers, AND whether the answer is trustworthy.
 *
 * `recall` collapses "there is no note" and "there is a note and it could not
 * be read" into the same empty string, which is right for the read path: both
 * mean she starts the conversation without one, and refusing to launch over a
 * corrupt file would be worse than launching without it.
 *
 * It is wrong for anything that then WRITES. A caller that appends to `''` and
 * saves has replaced an unreadable note with a one-line one and filed `''` as
 * the version to undo to — so the file that could not be parsed, and might
 * still have been recoverable by hand, is gone. `remember_this` is the caller
 * that made this reachable; the distinction is computed here already and was
 * simply being thrown away.
 *
 * `ok: false` means there IS something at that path and it could not be
 * understood. Absent is `ok: true` with no notes, because a persona nobody has
 * talked to has not got a problem.
 */
export type Recalled =
  | {
      readonly ok: true
      readonly notes: string
      /**
       * The other two fields of the same file, from the SAME read.
       *
       * Carried here rather than fetched by a second call, because there is
       * only one file and a writer that reads it twice can compose a hybrid:
       * `remember` took the notes through this function and then the cursor
       * through `summarisedThrough`, and `markSummarised` took the notes here
       * and then `previous` through `previousNote`. An edit landing between the
       * two reads — hers from another path, or somebody's by hand — produces an
       * object whose halves never coexisted on disk.
       *
       * `recallState` already parses the whole value to find `notes`, so this
       * costs nothing and removes the second read entirely.
       */
      readonly previous: string | null
      readonly summarisedThrough: number
    }
  | { readonly ok: false; readonly why: string }

export function recallState(userData: string, id: string): Recalled {
  // OUTSIDE the try, and that placement is the whole point. Inside it, the
  // refusal in `memoryPath` was caught by the handler below, which reads
  // `error.code`, finds no `ENOENT`, logs a warning and returns "" -- so an id
  // that should have been a loud programming error became "she has no memory",
  // which is a legitimate answer this function gives every day. The assertion
  // existed and could not be reached.
  const path = memoryPath(userData, id)
  // BOUNDED, and not through a symlink. Memory reaches a system prompt, so a
  // `memory/<id>.json` pointing somewhere else on the disk would send whatever
  // it points at to a model. See `read-bounded.ts`.
  const read = readBounded(path)
  if (!read.ok) {
    if (read.reason.kind === 'absent')
      return { ok: true, notes: '', previous: null, summarisedThrough: 0 }
    const why = logBoundedRead(read.reason)
    console.warn(`[memory] ${id} ${why}`)
    return { ok: false, why }
  }
  let value: unknown
  try {
    value = JSON.parse(read.text)
  } catch (error: unknown) {
    console.warn(`[memory] ${id} is not valid JSON:`, error)
    return { ok: false, why: 'is not valid JSON' }
  }
  const notes = (value as { notes?: unknown } | null)?.notes
  if (typeof notes !== 'string') {
    console.warn(`[memory] ${id} has no notes to read`)
    return { ok: false, why: 'has no notes to read' }
  }
  /*
    TRUNCATED rather than refused. The bound exists to stop an unbounded request
    going out on every wake; dropping her whole memory because it grew past the
    ceiling would be a worse answer to that than keeping what fits.

    Through `boundedHead` rather than `.slice`, and that is a correctness fix
    rather than tidiness: a raw slice cuts on a UTF-16 UNIT, so a limit landing
    between the two halves of an astral character leaves a LONE SURROGATE.
    Measured — 20,000 units of text ending mid-emoji comes back with
    `isWellFormed() === false` — and this string is written to her note file and
    then into her system prompt. `shared/text.ts` exists for exactly this and
    says so; it had simply stopped being called.

    It also marks the cut with an ellipsis, which the silent slice did not.
  */
  const heldPrevious = (value as { previous?: unknown } | null)?.previous
  const heldCursor = (value as { summarisedThrough?: unknown } | null)?.summarisedThrough
  return {
    ok: true,
    notes: boundedHead(notes, PERSONA_LIMITS.memory),
    // Bounded like the notes, and for the same reason: this reaches a window,
    // and a file edited by hand can hold anything.
    previous:
      typeof heldPrevious === 'string' ? boundedHead(heldPrevious, PERSONA_LIMITS.memory) : null,
    summarisedThrough: isCursor(heldCursor) ? heldCursor : 0,
  }
}

/**
 * Replace what she remembers.
 *
 * Whole-file, not append. Memory is meant to stay inspectable and deletable --
 * that is the argument for keeping it an explicit string rather than an
 * implicit accumulation in somebody's context window -- and an append-only log
 * quietly becomes the second thing.
 *
 * THROWS rather than overwriting a note it could not read. The rollback value
 * this stores is the previous note, and reading that through `recall` would
 * yield "" for a file that exists and could not be parsed -- so the write would
 * replace something possibly recoverable and record "nothing" as the version to
 * go back to. That rule was a sentence in this header telling callers to
 * pre-check, which is the kind of rule that holds until the second caller; it
 * is enforced here instead. `remember_this` still checks first, because it has
 * a sentence for her to say and an exception does not.
 */
export function remember(userData: string, id: string, notes: string): void {
  // Same rule as `recall`'s, through the same function — see the note there.
  const kept = boundedHead(notes, PERSONA_LIMITS.memory)
  // The version being replaced is kept, ONE deep.
  //
  // Not a history: one step back is what makes an automatic rewrite reviewable,
  // and it is the whole safety story for letting a model maintain a document
  // about somebody. Without it, a summary that quietly drops half the note is
  // discovered when she says something wrong out loud, which is the worst
  // possible discovery channel. With it, the SHELF shows the note beside the
  // character it belongs to and offers one step back — `shelf:memory`, which
  // reaches this same function with `previousNote`'s answer. That sentence
  // described a window that did not exist until 2026-08-19; it describes one
  // that does now, and the channel moved to the shelf with the note when the
  // per-character half left the settings window.
  //
  // Deeper would be a second archive with no retention policy and no delete
  // button, sitting beside one that has both -- which is the shape this project
  // refuses everywhere else.
  //
  // Read BEFORE the write and through the store, so the previous value is the
  // one that was actually in force: reading the raw file would keep a version
  // that `recall` may have been truncating all along.
  const held = recallState(userData, id)
  if (!held.ok) {
    throw new Error(`refusing to overwrite ${id}'s notes, which ${held.why}`)
  }
  const previous = held.notes
  // AN UNCHANGED WRITE ROTATES NOTHING. Without this, saving the same text
  // twice makes `previous` equal `notes` and the one useful rollback version is
  // gone -- and the settings window would still offer an undo that now does
  // nothing. The summariser can legitimately return an identical note, and the
  // save button can be pressed twice.
  if (kept === previous) return
  // The cursor is CARRIED, not dropped. It lives in this file so it dies with
  // her — see `summarisedThrough` — and every other writer of this file must
  // leave it alone rather than rewrite the object without it.
  writeJsonAtomically(memoryPath(userData, id), {
    notes: kept,
    previous,
    // From the SAME read as `previous` above, not a second one. See `Recalled`.
    summarisedThrough: held.summarisedThrough,
  })
}

/**
 * The instant her note was last brought up to date, or 0 when it never was.
 *
 * ## Why it lives in her memory file
 *
 * It is a fact about her note, it is worthless without her note, and it must
 * not outlive her: an id is a derived name slug handed out again once free, so
 * a cursor left behind would tell the next character of that name that a
 * conversation she never had was already summarised. Keeping it here means
 * `forgetMemory` takes it, and every argument that file already makes about
 * per-id filing covers it too.
 *
 * ## Why it is not written by `remember`
 *
 * `remember` returns without writing when the note is unchanged, which is
 * right — an unchanged write would rotate the one rollback version away. But
 * the summariser legitimately returns an identical note, and that run still
 * covered its conversations. Riding on `remember` would have left the cursor
 * unmoved on exactly those runs, and the same conversations would be
 * re-summarised for ever.
 *
 * ## Why 0 rather than "now" when it is absent
 *
 * Absent means this installation has never summarised her, which is true of
 * every install before this existed. The CALLER decides what to do with that —
 * `main/index.ts` starts from launch instead, because summarising a whole
 * history on first sleep is not what "the presence that just ended" means.
 */
/**
 * Whether a value can be a summary cursor.
 *
 * ONE predicate, used by the reader and now by the writer. `summarisedThrough`
 * has always refused anything that is not a non-negative safe integer — a
 * cursor read from nonsense would silently skip whatever it landed past — while
 * `markSummarised` stored whatever it was handed. So a `NaN`, an infinity, a
 * negative or a fraction was written happily and read back as 0, which
 * re-summarises the whole history on every sleep, for ever, with nothing to say
 * why.
 */
function isCursor(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

export function summarisedThrough(userData: string, id: string): number {
  const read = readBounded(memoryPath(userData, id))
  if (!read.ok) return 0
  try {
    const held = (JSON.parse(read.text) as { summarisedThrough?: unknown } | null)
      ?.summarisedThrough
    // A stored instant has to be one. Anything else is a file somebody edited
    // by hand, and a cursor read from nonsense would silently skip whatever it
    // happened to land past.
    return isCursor(held) ? held : 0
  } catch {
    // Unreadable JSON is `recallState`'s problem to report; here it simply
    // means no cursor, which re-summarises rather than skipping.
    return 0
  }
}

/**
 * Record that her note now covers everything up to `at`.
 *
 * Written even when the note did not change, and separately from it — see
 * `summarisedThrough`. Never throws: a cursor that could not be stored costs a
 * repeated summary, and the alternative is failing a sleep over bookkeeping.
 */
export function markSummarised(userData: string, id: string, at: number): void {
  /*
    REFUSED rather than stored, because the reader will not accept it either.

    `summarisedThrough` takes only a non-negative safe integer; anything else
    reads back as 0, which re-summarises the whole history on every sleep for
    ever. Writing one is therefore not a cursor that is slightly wrong, it is a
    cursor that silently does not exist — and the write reported success.
  */
  if (!isCursor(at)) {
    console.warn(`[memory] refusing to store ${String(at)} as ${id}'s summary cursor`)
    return
  }
  /*
    THE WHOLE BODY, so "never throws" is true.

    `recallState` sat outside this `try` and can throw: `memoryPath` refuses an
    unusable id loudly and deliberately — its own comment explains why that
    assertion must not be swallowed — and the store root can fail. So the
    docblock's promise held for the write and not for the read before it, which
    is the half more likely to fail on a machine having a bad day. A sleep is
    not a thing to fail over bookkeeping, which is what the promise is for.
  */
  try {
    const held = recallState(userData, id)
    if (!held.ok) return
    writeJsonAtomically(memoryPath(userData, id), {
      notes: held.notes,
      // From the SAME read as the notes. Two reads could compose a hybrid: a
      // newer note overwritten by a stale one while keeping the newer rollback.
      previous: held.previous,
      summarisedThrough: at,
    })
  } catch (error: unknown) {
    console.warn(`[memory] ${id}'s summary cursor could not be stored:`, error)
  }
}

/**
 * The note as it stood before the last rewrite, or `null` when there was none.
 *
 * `null`, NOT an empty string, and the distinction is the whole undo. A persona
 * whose memory was empty when the first automatic rewrite ran has a previous
 * note, and it is `''` -- so collapsing the two made that first rewrite the one
 * that cannot be undone, which is exactly the rewrite somebody most wants back.
 * The window checks this field rather than comparing the two strings, and it
 * could not tell "nothing has been rewritten" from "it used to be blank".
 *
 * `null` is the ordinary case for a persona nobody has summarised yet, and it
 * is never an error -- the same rule `recall` follows, for the same reason.
 */
export function previousNote(userData: string, id: string): string | null {
  const read = readBounded(memoryPath(userData, id))
  if (!read.ok) return null
  let value: unknown
  try {
    value = JSON.parse(read.text)
  } catch {
    // Silent here, unlike `recall`. That function already warns about this exact
    // file on this exact failure, and two warnings for one corrupt file reads as
    // two problems.
    return null
  }
  const previous = (value as { previous?: unknown } | null)?.previous
  if (typeof previous !== 'string') return null
  // Bounded on the way out like `recall`'s, and for the same reason: this
  // reaches a window, and a file edited by hand can hold anything.
  return boundedHead(previous, PERSONA_LIMITS.memory)
}

/**
 * Delete what a persona remembered.
 *
 * Called when she is deleted, so a later persona that happens to derive the
 * same id cannot inherit her notes. Absent is success: there is nothing to
 * remove for a character nobody ever spoke to, and treating that as a failure
 * would make deleting her report an error for having been quiet.
 */
export function forgetMemory(userData: string, id: string): void {
  try {
    unlinkSync(memoryPath(userData, id))
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    // THROWN, not warned. The comment here used to say the persona file was
    // already gone by the time this ran, so failing would only make things
    // worse -- and that stopped being true when `deletePersona` was reordered
    // to remove the package LAST. Her package is what reserves her id, so a
    // swallowed failure here releases `ada` to the next persona of that name
    // with a stranger's notes still filed under it, which is the whole outcome
    // the reordering exists to prevent. Failing keeps her, and her notes,
    // until it can be done properly.
    throw error
  }
}
