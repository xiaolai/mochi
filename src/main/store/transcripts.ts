/**
 * What was actually said, per session, per persona.
 *
 * ## Not memory, and the distinction decides the design
 *
 * Memory is a small curated string that goes into the system prompt on every
 * wake — so it is billed on every reconnect and bounded at 20,000 characters.
 * A transcript is a RECORD. It never enters HER prompt: the live session
 * already holds its own context, and injecting a growing history would be an
 * unbounded billed request that gets worse the longer somebody uses the app.
 *
 * **It does reach a model, and that is worth stating precisely**, because an
 * earlier version of this paragraph said "neither reader is the model" and
 * stopped being true on 2026-08-26. The sleep summariser hands ONE ended
 * presence to `codex exec` to rewrite her note from — off every latency path,
 * on the Codex subscription, once, and never into the Realtime session. The
 * distinction the design rests on is between the live prompt, which this must
 * never grow, and one bounded job at sleep.
 *
 * So this store has three readers: the person who wants to find something she
 * said, `recall_conversations`, and the summariser that decides what is worth
 * remembering.
 *
 * ## SQLite, without a native dependency
 *
 * `node:sqlite` ships inside Electron 43 with FTS5 compiled in — measured.
 * No rebuild step, no `better-sqlite3`, no prebuilt
 * binaries per platform. That is most of the reason the store is SQLite rather
 * than a folder of JSON.
 *
 * ## Searching the primary language
 *
 * FTS5 cannot tokenise Chinese. Everything written here goes
 * through `segment`, and every query through `toMatchQuery`. Both halves live
 * in one module because a disagreement between them produces a valid index, a
 * valid query and an empty answer, with nothing failing anywhere.
 *
 * ## Per persona, and deleted with her
 *
 * Same boundary as memory: a work persona and a personal one sharing history
 * is a privacy fault. And ids are DERIVED from names, so `ada` is handed out
 * again once nothing holds it — a new persona inheriting a stranger's
 * transcripts is the outcome per-id filing exists to prevent.
 */

import { lstatSync, mkdirSync, realpathSync, type Stats } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { segment, toAnyQuery, toMatchQuery } from './segment'
import { ARCHIVE_FORMAT, type Archive, type ImportResult, parseArchive } from './archive'
import {
  type Hit,
  type LiveSession,
  type Session,
  type ToolUse,
  type SessionToken,
  type Speaker,
  type Turn,
} from './turn-row'
import { endFor, sameConversation } from './archive'
import { toTurn } from './turn-row'
// Imported directly, and it is the only non-store module this file knows.
// `problems.ts` imports nothing at all, so there is no cycle to make -- and a
// store that can only reach the console is a store whose failures nobody sees,
// which is the whole reason these guards exist rather than the reason to skip
// reporting them.
import { problems } from '../problems'
import { readableInstant } from './instant'
import { applySchema } from './schema'
import { MAX_SUBJECT_CHARS } from '../memory/subject'
import { prepareAll } from './statements'

export const TRANSCRIPTS_FILE = 'transcripts.db'

/**
 * The most conversations one confirmed deletion may carry.
 *
 * Not a performance limit -- a sanity one. The list a person can select from is
 * their own archive, so a payload larger than this did not come from somebody
 * clicking, and the transaction should not be asked to find out.
 */
/**
 * The most conversations one `forgetSessions` call may name.
 *
 * A payload this large is not a request anybody made by hand, and the bound is
 * what stops a compromised renderer turning one message into a hundred-thousand
 * row transaction.
 *
 * **It TRIMS rather than refuses, and that is deliberate** — `transcripts.test.ts`
 * asserts it: a genuine token sitting among a flood still goes. A draft of this
 * change made it a refusal instead and was reverted, because declining the whole
 * request would discard the real deletion somebody actually asked for in order
 * to punish the noise around it.
 */
export const MOST_AT_ONCE = 1000

/**
 * The tokens a `forgetSessions` call will actually act on.
 *
 * Exported because **two** places need the same answer, and until now only one
 * of them had it. `forgetSessions` collapses duplicates and trims an absurd
 * payload — deliberate, and asserted: a flood from a compromised renderer must
 * not become a hundred-thousand-row transaction, while a real token sitting
 * among it still goes.
 *
 * The caller in `main/index.ts` then decides whether the LIVE conversation was
 * among those deleted, and it was reading the caller's own unbounded list. So a
 * request naming more than a thousand released the live token while its rows
 * were still on disk — recording restarted into a fresh conversation and the
 * old one stayed, which is the opposite of what "forget these" was asked to do.
 *
 * One function, so "what was deleted" cannot be answered two ways.
 */
export function boundedForgetSet(tokens: readonly SessionToken[]): readonly SessionToken[] {
  return [...new Set(tokens)].slice(0, MOST_AT_ONCE)
}

export interface Transcripts {
  /**
   * Start a session, or NULL when this instant already has one of hers.
   *
   * Null rather than a thrown error or a shifted timestamp. `UNIQUE
   * (persona_id, started_at)` refuses the insert when a clock correction or a
   * wake inside the same millisecond revisits an instant, and the two
   * alternatives are both worse: throwing fails the wake for a reason nobody
   * in the room can act on, and advancing the stored time produces a session
   * that began after the things said in it. Not storing one conversation is
   * the cheapest of the three, and it is the direction the rest of this
   * already points -- when the answer cannot be established, nothing is stored.
   */
  begin(personaId: string, at?: number): LiveSession | null
  /**
   * Write one turn down. Empty text is ignored — silence is not a turn,
   * EXCEPT a cut marker, which is empty on purpose (see `cut` below).
   *
   * `cut` marks a turn she was interrupted in. With text, that text is what the
   * server said survived; with EMPTY text it is a marker that she began and was
   * cut off, which is kept rather than dropped as silence.
   */
  say(session: LiveSession, who: Speaker, text: string, at?: number, cut?: boolean): void
  end(session: LiveSession, at?: number): void
  /**
   * Record that she reached for a capability in this conversation.
   *
   * Called on ARRIVAL, from the same observer that records "last used" — a call
   * that arrived is one she made whether or not it answered, and a lookup that
   * fails after twenty seconds is exactly the one worth seeing in a transcript.
   *
   * Silently does nothing when the token names no OPEN conversation of hers.
   * That is the ordinary case rather than an error: she can call a capability
   * during a session in which nobody has spoken yet, and `begin` deliberately
   * does not open a conversation until the first turn — so there is genuinely
   * nowhere to put it, and refusing loudly would report a fault on a path that
   * is working as designed.
   */
  tooled(session: LiveSession, name: string, at?: number): void
  /**
   * Give one FINISHED conversation of hers a subject, or take it away.
   *
   * `null` clears it, which is what makes a re-title idempotent rather than
   * additive — and it is the only way back for a title somebody disagrees with.
   *
   * Answers whether a row was written. FALSE for a conversation that is not
   * hers, is not there, or has not ended: the statement decides all three, so
   * ownership is settled by the write that actually ran rather than by a read
   * that happened a moment earlier — the rule every scoped delete here follows.
   */
  retitle(personaId: string, token: SessionToken, subject: string | null): boolean
  /**
   * Her finished conversations with no subject yet, newest first.
   *
   * BOUNDED by the caller, and the bound is liveness rather than thrift: each
   * title is a subprocess with a deadline, and an archive of three hundred
   * would hold the summariser's flag for over an hour on the first sleep after
   * this shipped — blocking the note rewrite that shares it. Newest first so
   * the ones somebody is most likely to be looking at are titled first, and
   * every sleep makes progress until there are none left.
   */
  untitled(personaId: string, most: number): readonly SessionToken[]
  sessions(personaId: string): readonly Session[]
  /**
   * What was said in one conversation of HERS, named by its opaque token.
   *
   * Takes the persona as well, because without the pair a window holding one
   * of A's conversations reads it while B is worn -- the scope widening that is
   * a privacy hole rather than a feature, arriving through the one read that
   * did not ask who was asking.
   *
   * A conversation belonging to somebody else answers EMPTY, which is also the
   * answer for one that was never there. Distinguishing them would disclose
   * that it exists, and "not even whether there is one" is the requirement.
   */
  turns(personaId: string, token: SessionToken): readonly Turn[]
  search(personaId: string, query: string, limit?: number): readonly Hit[]
  /**
   * Everything she has, for export.
   *
   * `this: void` because it was the ONE method here that read `this`, so
   * destructuring it off the store or passing it as a callback threw -- and
   * nothing in this interface said a caller may not do either. The annotation
   * makes that a compile error rather than a convention.
   */
  exportFor(this: void, personaId: string): Archive
  /** Read an archive INTO a persona the caller names. */
  importInto(personaId: string, value: unknown): ImportResult
  /**
   * Drop conversations of hers -- one, or several -- all together or not at all.
   *
   * The finer of the two grains. With only "delete all of hers", correcting one
   * conversation costs the whole archive, so the safe action is the expensive
   * one, and that is the shape that makes people keep what they wanted gone.
   *
   * ## Why not a loop over `forgetSession`
   *
   * That was the plan, and it gives one transaction and one scrub per token.
   * A failure at the second leaves the first permanently gone -- after a single
   * confirmation naming three. "Atomic per token" is the wrong boundary: the
   * unit the user agreed to is the batch, so the batch is the unit that
   * commits.
   *
   * Duplicates are collapsed and unknown tokens are skipped rather than
   * refused: a conversation that is already gone is the outcome being asked
   * for, and failing the whole batch over one would make the safe answer
   * "delete them one at a time", which is the shape this exists to avoid.
   *
   * The count is what was actually removed, read after the commit.
   */
  forgetSessions(personaId: string, tokens: readonly SessionToken[]): number
  /** Delete a persona's history. Called when she is deleted. */
  forget(personaId: string): void
  /**
   * Delete EVERY transcript in the file, whoever it belongs to.
   *
   * Not a loop over the personas someone can currently name, which is what
   * this used to be: rows survive a persona being deleted by hand, a package
   * going unreadable, or a duplicate id being refused, and none of those are
   * in the catalog to be iterated. The escape hatch is labelled "delete
   * everything, every persona", and a hatch that empties only what the app
   * happens to have loaded is one whose label is false in exactly the
   * situations somebody reaches for it.
   */
  forgetEverything(): void
  /**
   * Whether deleted text is still sitting in the write-ahead log.
   *
   * So a caller can say "deleted" and "not yet scrubbed" as the different
   * things they are. The rows are gone either way; the bytes follow when the
   * reader holding the log lets go.
   */
  scrubPending(): boolean
  /*
    `pruneBefore` was here: drop her sessions that ended before a cutoff.

    Correct, transactional, secure-scrubbed, tested, and called by nothing --
    the policy field that would have driven it was never read either. Removed
    with `Policy.keepDays` rather than finished, because conversations are kept
    until somebody deletes them now. `forgetSession` and `forgetEverything`
    above are the mechanism; they are the two that get controls.
  */
  close(): void
}

/**
 * Every file this process has open, so a second connection is refused.
 *
 * The comment here used to say that taking a DIRECTORY rather than a path
 * meant callers "cannot accidentally point two of these at one file". It does
 * not: two calls with the same directory open the same file twice, and the
 * signature has nothing to say about it. The connection is genuinely the thing
 * that has to be single -- `busy_timeout` is 0, so a second writer gets
 * `SQLITE_BUSY` immediately -- so the claim is now enforced instead of
 * asserted.
 */
const open = new Set<string>()

/**
 * Open the database, creating it if it is not there.
 *
 * Takes a directory rather than a path because the filename is this module's
 * business, not the caller's. Refuses a second connection to a file this
 * process already has open; see `open`.
 */
/** `lstat`, or null when there is nothing there. Does NOT follow a link. */
function statSyncOrNull(path: string): Stats | null {
  try {
    return lstatSync(path)
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

export function createTranscripts(userData: string): Transcripts {
  mkdirSync(userData, { recursive: true })
  // CANONICAL, not the joined string. The registry's whole claim is "one
  // connection per file", and a lexical key cannot make it: two directories
  // that are symlinked aliases of each other produce two different strings for
  // one file, so both `open.has` checks pass and the second connection meets a
  // `busy_timeout` of 0 and `SQLITE_BUSY` on its first write.
  //
  // Resolved AFTER the directory is created, because `realpath` needs the path
  // to exist; the file itself may not yet, so the directory is what is resolved.
  const path = join(realpathSync(userData), TRANSCRIPTS_FILE)
  /*
    The FILE, not just the directory it sits in.

    `realpathSync` above resolves `userData`; the filename is appended after,
    so a symbolic link AT `transcripts.db` is neither detected nor resolved —
    every conversation and the write-ahead log land wherever it points, with
    this process's privileges. Every other store in this app refuses that shape
    loudly via `storeRoot`; the database was the one that did not.

    Absent is fine: creating it is the ordinary first launch.
  */
  const held = statSyncOrNull(path)
  if (held !== null && !held.isFile()) {
    throw new Error(`refusing to open ${TRANSCRIPTS_FILE}: it is not a regular file`)
  }
  if (open.has(path)) {
    throw new Error(`${path} is already open in this process`)
  }
  const db = new DatabaseSync(path)
  open.add(path)
  // EXCEPTION-SAFE from here on. Anything that throws between the registration
  // above and the store below used to leak the handle AND leave the path
  // registered forever, with no object in anybody's hands to call `close()` on
  // -- so one failed migration made transcripts unopenable for the rest of the
  // run, and the only symptom was "already open in this process" on every
  // later attempt.
  try {
    return buildTranscripts(db, path)
  } catch (error: unknown) {
    try {
      db.close()
    } catch {
      // Already unusable. The registration is what must come off.
    }
    open.delete(path)
    throw error
  }
}

/** Schema, migrations, statements and the store itself. See `createTranscripts`. */
function buildTranscripts(db: DatabaseSync, path: string): Transcripts {
  const applied = applySchema(db)
  if (!applied.wal) {
    // A long read can now block a write mid-conversation.
    console.warn('[transcripts] the write-ahead log is not in use; this filesystem refused it')
    problems.note('transcripts', null, "this location does not support the archive's fast mode")
  }
  if (!applied.secureDelete) {
    /*
      "Delete for good?" is not the truth on this build.

      Without `secure_delete` the bytes stay in the file after a row is
      removed, and this app makes a point of saying that file is not
      encrypted. Somebody deleting a conversation for a reason deserves to
      know the guarantee did not hold.
    */
    console.warn('[transcripts] secure delete is unavailable; deleted text is not overwritten')
    problems.note(
      'transcripts',
      null,
      'deleted conversations are removed but not overwritten on this system',
    )
  }

  const stmt = prepareAll(db)

  const now = (): number => Date.now()

  /**
   * A truncation the log is still holding open, to be retried.
   *
   * `wal_checkpoint` reports contention in its RESULT ROW rather than by
   * throwing, and `db.exec` discards result rows -- so an active reader left
   * the deleted bytes sitting in `transcripts.db-wal` while `scrub` returned
   * normally and every caller believed the file had been cleaned. The one
   * failure this whole mechanism exists to catch was the one it could not see.
   */
  let pendingScrub = false

  /**
   * Fold the write-ahead log back into the database and start it empty.
   *
   * `secure_delete` scrubs a page when it is freed -- in the FILE. In WAL mode
   * the delete lands in the log first, and the log still holds the frames that
   * carried the text before it. So a conversation could be deleted, the main
   * database scrubbed, and the words still sat in `transcripts.db-wal` until
   * some later checkpoint happened to overwrite them.
   *
   * Called after anything destructive, and only there: a checkpoint is real
   * work, and doing it on every turn would pay it hundreds of times for the
   * one moment it matters.
   *
   * The busy column is READ, not assumed. SQLite documents the first result
   * column of `wal_checkpoint` as 1 when the checkpoint could not run to
   * completion, and it is the ordinary answer while a reader holds the log --
   * so a failed scrub is recorded and retried by the next destructive call and
   * again on `close()`, rather than reported as done.
   */
  /**
   * How many times to come back for a scrub a reader held off, and how long to
   * wait between attempts.
   *
   * Bounded, because the retry is a best effort and an unbounded timer that
   * never succeeds is a process that never idles. Contention here is a reader
   * inside this same app finishing a query, so the first retry usually wins.
   */
  const SCRUB_TRIES = 5
  const SCRUB_BACKOFF_MS = 250

  let scrubRetry: NodeJS.Timeout | null = null
  let scrubsLeft = 0

  /**
   * Come back for it once the reader has let go.
   *
   * ## Why waiting for the next delete or for quit is not enough
   *
   * That is what it did. A failed scrub was retried by the next destructive
   * call, and on `close()` -- and `close()` was never called by anything. So a
   * delete that raced a reader left the deleted words in `transcripts.db-wal`
   * for the entire run: a conversation deleted this morning could still be
   * recoverable from the log at midnight, while the app reported it gone.
   *
   * Deletion is the one place in this app where "eventually" is not a
   * synonym for "yes".
   */
  /**
   * True once `close()` has begun, so nothing arms a timer past the handle.
   *
   * `close()` clears the retry and then makes one last `scrub()` attempt --
   * and a failing attempt calls `retryScrubSoon()`, which armed a fresh timer
   * pointing at a connection that was closed microseconds later. It was
   * `unref`'d, so it usually died with the process rather than firing; on the
   * path where the app keeps running after a store is closed, it fired and
   * used a closed database.
   */
  let closing = false

  function retryScrubSoon(): void {
    if (closing || scrubRetry !== null || scrubsLeft <= 0) return
    scrubRetry = setTimeout(
      () => {
        scrubRetry = null
        scrubsLeft -= 1
        if (pendingScrub) scrub()
      },
      SCRUB_BACKOFF_MS * (SCRUB_TRIES - scrubsLeft + 1),
    )
    // Never a reason to hold the process open. If the app is otherwise done,
    // `close()` runs the last attempt with the connection still in hand.
    scrubRetry.unref()
  }

  function scrub(): void {
    try {
      const row = db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get()
      // Absent is treated as busy: a pragma that answered nothing has not told
      // us it finished, and the safe reading of silence here is "not yet".
      const busy = row === undefined || Number(row['busy'] ?? 1) !== 0
      pendingScrub = busy
      if (busy) {
        console.warn(
          '[transcripts] a reader held the write-ahead log open; deleted text is still in it',
        )
        retryScrubSoon()
      }
    } catch (error: unknown) {
      pendingScrub = true
      console.warn('[transcripts] could not truncate the write-ahead log after a delete:', error)
      // The one store whose whole justification is that deleting is real. If
      // this keeps failing, the deleted words are still in the file.
      problems.note(
        'transcripts',
        null,
        'deleted text could not be cleared from the file; it will be retried',
      )
      retryScrubSoon()
    }
  }

  /**
   * All of it, or none of it.
   *
   * Every delete here is at least two statements -- the index rows, then the
   * rows they point at -- and a failure between them is not a delete that did
   * not happen. It is turns that are still readable but can no longer be
   * found, or search hits pointing at turns that are gone, depending on which
   * statement went first. Both present as the store quietly lying, and no
   * ordering of the two avoids it; only the transaction does.
   *
   * Not reentrant: SQLite has no nested `BEGIN`, so nothing wrapped in this
   * may call something else that is.
   */
  function atomically<T>(run: () => T): T {
    db.exec('BEGIN')
    try {
      const result = run()
      db.exec('COMMIT')
      return result
    } catch (error: unknown) {
      /*
        THE ROLLBACK IS GUARDED, and the original error is what propagates.

        `ROLLBACK` was outside a try. It throws whenever no transaction is
        active -- which is precisely the case a failing `run()` can produce, if
        it failed *after* something already ended the transaction -- and that
        throw then REPLACED the real error on its way out. So the caller was
        handed "cannot rollback - no transaction is active", which names the
        recovery rather than the fault, and the actual reason the write failed
        was gone.

        Worse than the lost message: a rollback that did not happen leaves the
        transaction open, and every later write on this connection joins it.
        The store then looks fine and commits nothing.

        Reported, because a failed rollback is a state this process cannot
        reason about any further.
      */
      try {
        db.exec('ROLLBACK')
      } catch (rollback: unknown) {
        console.error('[transcripts] a write failed and could not be rolled back:', rollback)
        problems.note(
          'transcripts',
          null,
          'a write failed and could not be undone; the archive may be holding an unfinished change',
        )
      }
      throw error
    }
  }

  /** The row behind a token, or null when that conversation is gone. */
  function rowidOf(token: SessionToken): number | null {
    const found = stmt.rowidOf.get(token)?.['id']
    return found === undefined ? null : Number(found)
  }

  /**
   * The row behind a token that is still OPEN, and where it began.
   *
   * `say` checked only that the token still resolved, which is a weaker claim
   * than the one it needs: a handle held past `end()` -- a late transcript
   * arriving during teardown, a caller that kept the value -- appended turns to
   * a finished conversation, including turns dated after its own end. The
   * archive parser in this same file refuses exactly that shape on the way back
   * in, so the store was producing files it would not accept.
   */
  function openSession(token: SessionToken): { id: number; startedAt: number } | null {
    const row = stmt.openSession.get(token)
    if (row === undefined) return null
    return { id: Number(row['id']), startedAt: Number(row['started_at']) }
  }

  function recordTurn(
    sessionId: number,
    who: Speaker,
    text: string,
    at: number,
    cut = false,
  ): boolean {
    const body = text.trim()
    // Silence is not a turn. The wire emits empty transcripts for a breath, and
    // storing them would fill a conversation with blank rows nobody can search.
    //
    // EXCEPT a cut marker, which is empty ON PURPOSE: she was interrupted and
    // the surviving text could not be recovered. Dropping it here would lose
    // the one honest record that the turn happened at all -- the same
    // exception `parseVoiceReport` makes one layer up, for the same reason.
    if (body === '' && !cut) return false
    // The row was resolved by the caller, so this is a lookup rather than a
    // guard: `say` refuses a token whose conversation is gone, and `importInto`
    // passes a row it created a line earlier.
    const persona = stmt.personaOf.get(sessionId)?.['persona_id']
    if (persona === undefined) return false
    const inserted = stmt.say.run(sessionId, at, who, body, cut ? 1 : 0)
    // A cut marker has no body, so it indexes nothing and can never be a search
    // hit. That is correct: there is no text to find, and a row that matched
    // every query would be worse than one that matches none.
    stmt.index.run(segment(body), Number(inserted.lastInsertRowid), String(persona))
    return true
  }

  /** Her conversations, newest first. Closed over so `exportFor` needs no `this`. */
  function sessionsOf(personaId: string): readonly Session[] {
    /*
      ONE query for every conversation's tools, not one per conversation.

      The list is drawn on every open of the archive and a query per row is how
      a pane that is fine with twenty conversations stops being fine with two
      hundred. Grouped into a map here rather than joined onto `sessions`,
      because joining a second one-to-many through a query that already counts
      turns multiplies the rows before the count runs -- `toolsFor` says so.
    */
    const byToken = new Map<string, ToolUse[]>()
    for (const row of stmt.toolsFor.all(personaId)) {
      const token = String(row['token'])
      const uses = byToken.get(token) ?? []
      uses.push({ name: String(row['name']), uses: Number(row['uses']) })
      byToken.set(token, uses)
    }
    return stmt.sessions.all(personaId).map((row) => {
      const token = String(row['token'])
      return {
        token,
        startedAt: Number(row['started_at']),
        endedAt: row['ended_at'] === null ? null : Number(row['ended_at']),
        turns: Number(row['turns']),
        // A column that predates this build's writes reads as `undefined`
        // rather than `null` on some drivers, so both become null — the one
        // answer the rest of the app is written against.
        subject: typeof row['subject'] === 'string' ? row['subject'] : null,
        // EMPTY, never absent. Most conversations call nothing, and a caller
        // that had to tell "none" from "not loaded" would get it wrong once.
        tools: byToken.get(token) ?? [],
      }
    })
  }

  /**
   * The latest instant already committed to this conversation.
   *
   * `started_at` when it holds nothing yet. Used by `end` alone: `parseArchive`
   * refuses a turn dated after its conversation's end, so an `ended_at`
   * clamped only to the START would still exclude every turn already written.
   *
   * NOT used by `say`, which clamps to the start. Turns are filed out of order
   * on purpose and both readers sort by `at`.
   */
  function floorFor(sessionId: number, startedAt: number): number {
    const last = stmt.lastTurnAt.get(sessionId) as { at: number | null } | undefined
    const at = last?.at
    return typeof at === 'number' && at > startedAt ? at : startedAt
  }

  /** What was said in one of hers. Closed over for the reason `sessionsOf` is. */
  function turnsOf(personaId: string, token: SessionToken): readonly Turn[] {
    return stmt.turns.all(token, personaId).map(toTurn)
  }

  /** One MATCH expression, run and shaped into hits. See `search`. */
  /**
   * Prepared ONCE, not on every search.
   *
   * This called `db.prepare(...)` inside the function, so every keystroke in
   * the search box re-parsed and re-planned the same statement. Every other
   * query in this store is prepared up front in `statements.ts` for exactly
   * that reason; this one was written later and did not follow.
   *
   * Lazily rather than beside the others because it belongs to `search`, which
   * a session may never use at all.
   */
  let matchStatement: ReturnType<DatabaseSync['prepare']> | null = null

  function matching(match: string, personaId: string, limit: number): Hit[] {
    matchStatement ??= db.prepare(
      // Joined through to `session` so a hit names its conversation the way
      // everything else does. The index stores a turn id, which is a rowid
      // and therefore not something to hand outwards.
      `SELECT s.token, s.started_at, t.at, t.who, t.text, t.cut
         FROM turn_fts f
           JOIN turn t ON t.id = f.turn_id
           JOIN session s ON s.id = t.session_id
         WHERE turn_fts MATCH ? AND f.persona_id = ?
         ORDER BY rank LIMIT ?`,
    )
    return matchStatement.all(match, personaId, limit).map((row) => ({
      token: String(row['token']),
      startedAt: Number(row['started_at']),
      // Through the SAME decoders the turn reader uses. The two copies of
      // this had already coerced unexpected database values differently, and
      // a hit that disagrees with the turn it points at is the store quietly
      // contradicting itself.
      ...toTurn(row),
    }))
  }

  /*
    SCRUBBED AT OPEN, before the store is handed to anybody.

    `forgetSessions` commits and then scrubs, which is the right order -- but a
    crash between the two leaves the deleted words sitting in the write-ahead
    log across launches. Nothing looked for them on the way back up, and
    `pendingScrub` initialises `false`, so `history:forget` reported the file
    clean for the whole of that time.

    This is the one store whose entire justification is that deleting is real.
    A checkpoint on a database with nothing to clear costs a single pragma.
  */
  scrubsLeft = SCRUB_TRIES
  scrub()

  return {
    begin(personaId, at = now()) {
      /*
        Checked FIRST, before the row exists.

        `started_at` is the value every later guard compares against, so a
        poisoned one breaks the comparison as well as every read of the row --
        and unlike a turn, there is no larger thing still readable without it.
        See `instant.ts` for what `node:sqlite` does with the value itself.
      */
      if (!readableInstant(at)) {
        console.error(`[transcripts] refusing to begin ${personaId} at an unusable instant`)
        problems.note('transcripts', personaId, 'a conversation was refused an unusable start time')
        return null
      }
      // Refused rather than shifted. See the interface: advancing the stored
      // time to dodge the unique constraint would date a conversation after
      // the things said in it, and throwing would fail her wake.
      if (stmt.taken.get(personaId, at) !== undefined) {
        console.warn(`[transcripts] ${personaId} already has a conversation at ${String(at)}`)
        return null
      }
      const token = randomUUID()
      stmt.begin.run(personaId, at, token)
      return token
    },
    say(token, who, text, at = now(), cut = false) {
      // Wrapped HERE rather than inside `recordTurn`, because `importInto`
      // calls that from inside a transaction of its own and SQLite has no
      // nested `BEGIN`.
      //
      // Writing is the same two-statement problem as deleting, in the other
      // direction: the readable row and its index row are separate inserts, so
      // a crash between them leaves a turn somebody can read and no search can
      // ever find. That is the failure this store's whole reason for existing
      // -- finding something she said -- fails at, silently, for one turn.
      const row = openSession(token)
      if (row === null) {
        // Loud. The conversation was deleted or ended while something was still
        // writing into it, and every turn after that point disappears -- which
        // is indistinguishable from a quiet conversation, so nothing else would
        // ever say it happened.
        console.error(
          `[transcripts] conversation ${token} is gone or already ended; a turn was dropped`,
        )
        return
      }
      // Unreadable instants are dropped, not clamped. A turn whose time is
      // NaN or 1e17 carries no information about when it happened, so there is
      // nothing to preserve -- and writing it costs every future read of this
      // conversation. See `instant.ts`.
      if (!readableInstant(at)) {
        console.error(`[transcripts] a turn with an unusable time was dropped from ${token}`)
        problems.note('transcripts', null, 'a turn arrived with an unusable time and was dropped')
        return
      }
      /*
        CLAMPED, not dropped.

        Nothing can be said before the conversation began: the archive parser in
        this file refuses that shape, so storing it produces an export this
        store cannot read back.

        But dropping was the wrong answer to that. The value arrives from the
        renderer via `Date.now()`, and the ordinary way it goes backwards is an
        NTP correction -- after which EVERY remaining turn is dated before the
        start, the conversation records nothing for as long as the offset
        lasts, and `Conversation` never learns because this path returns
        normally. An hour of somebody's conversation lost to a clock step is a
        worse outcome than a turn whose order within its conversation is
        approximate.

        Noted rather than logged, because the console is not somewhere anybody
        looks and this one is invisible from the outside.
      */
      /*
        Clamped to the START, deliberately NOT to the latest turn already
        written.

        Turns arrive out of order by design: an interrupted turn settles when
        its `conversation.item.truncated` verdict arrives, which is after the
        turn that interrupted it (§58). `turns()` and `exportFor` both sort by
        `at`, so write order never reaches a reader -- clamping to the latest
        instead would drag every late-settling turn forward and destroy the
        one ordering this store works to preserve. Measured: it reorders the
        interruption case in `transcripts.test.ts`.
      */
      const stamped = at < row.startedAt ? row.startedAt : at
      if (stamped !== at) {
        problems.note(
          'transcripts',
          null,
          'the clock went backwards mid-conversation; a turn was filed at its start instead',
        )
      }
      atomically(() => recordTurn(row.id, who, text, stamped, cut))
    },
    end(token, at = now()) {
      /*
        The guard `say` argues for at length, finally applied here too.

        `say` refuses a turn dated before its conversation because that shape
        "produces an export this store cannot read back". A session whose
        `ended_at` precedes its `started_at` is the same defect one level up,
        and worse in effect: `parseArchive` rejects the whole file, so one such
        row makes the user's ENTIRE export unimportable rather than one
        conversation unreadable.

        Clamped to the start for the same reason `say` clamps -- a backward
        clock step should not decide that a conversation never ended, because
        an unended conversation is what the schema repair rewrites at launch.
      */
      if (!readableInstant(at)) {
        console.error(`[transcripts] refusing to end ${token} at an unusable instant`)
        problems.note('transcripts', null, 'a conversation was refused an unusable end time')
        return
      }
      const row = openSession(token)
      if (row === null) {
        // Already ended, or gone. `end` is idempotent by way of the statement's
        // own `ended_at IS NULL`, so this is not an error.
        const id = rowidOf(token)
        if (id !== null) stmt.end.run(at, id)
        return
      }
      const floor = floorFor(row.id, row.startedAt)
      stmt.end.run(at < floor ? floor : at, row.id)
    },
    tooled(token, name, at = now()) {
      // The boundary guard every write here carries. `at` reaches this store
      // from a clock main owns rather than from the renderer, so this is
      // cheaper than `say`'s case — and it is applied anyway, because
      // `instant.ts` exists precisely because one of three write paths was
      // missing the check the other two had.
      if (!readableInstant(at)) {
        console.error(`[transcripts] refusing to file a capability call at an unusable instant`)
        return
      }
      const row = openSession(token)
      // No OPEN conversation of hers. Ordinary rather than an error — see the
      // interface. Nothing to attach it to, and nothing to report.
      if (row === null) return
      atomically(() => {
        stmt.tooled.run(row.id, name, at)
      })
    },
    retitle(personaId, token, subject) {
      // The bound is applied here too, not only where the answer is parsed.
      // `subjectFrom` is the check on what a model said; this is the check on
      // what any caller passes, and the store is the last thing before disk.
      if (subject !== null && (subject.trim() === '' || subject.length > MAX_SUBJECT_CHARS)) {
        console.error('[transcripts] refusing a subject that is empty or too long')
        return false
      }
      const written = stmt.retitle.run(subject, token, personaId)
      return Number(written.changes) > 0
    },
    untitled(personaId, most) {
      // A non-positive bound is "none", not "all". `LIMIT -1` in SQLite means
      // no limit, so passing one through would turn a caller's mistake into
      // every conversation she has.
      if (!Number.isInteger(most) || most <= 0) return []
      return stmt.untitled.all(personaId, most).map((row) => String(row['token']))
    },
    sessions: sessionsOf,
    turns: turnsOf,
    search(personaId, query, limit = 50) {
      const match = toMatchQuery(query)
      // Nothing to search for is not an empty result from a query -- it is not
      // running one. An empty MATCH is a syntax error in FTS5.
      if (match === null) return []
      const hits = matching(match, personaId, limit)
      if (hits.length > 0) return hits
      // PRECISE FIRST, THEN WIDER.
      //
      // The exact form is an AND, which is what somebody refining a search box
      // by hand wants. It is not what SHE sends: she is told to search with
      // "the words they are likely to have actually said", so her queries are
      // remembered phrases, and an AND over six words needs one turn holding
      // every one of them. Measured on a real archive: her query matched 0
      // turns as an AND and 18 as an OR, in a database that plainly held the
      // conversation -- and she reported, correctly and uselessly, that she
      // had no record of it.
      //
      // Widened only when the precise form found NOTHING, so a query that
      // already works is never made noisier. `ORDER BY rank` then does the
      // rest: a turn carrying five of the words outranks one carrying `full`.
      const any = toAnyQuery(query)
      return any === null || any === match ? hits : matching(any, personaId, limit)
    },
    exportFor(personaId) {
      // Through the local readers, not through `this`. It was the one method in
      // the store that depended on dynamic binding, so destructuring it off the
      // object or passing it as a callback made `this.sessions` throw -- and
      // nothing in the interface says a caller may not do either.
      return {
        version: ARCHIVE_FORMAT,
        personaId,
        exportedAt: now(),
        sessions: sessionsOf(personaId).map((session) => ({
          startedAt: session.startedAt,
          endedAt: session.endedAt,
          turns: turnsOf(personaId, session.token),
        })),
      }
    },
    importInto(personaId, value) {
      const parsed = parseArchive(value)
      if (!parsed.ok) return parsed
      let sessions = 0
      let turns = 0
      let skipped = 0
      let conflicts = 0
      // ONE transaction. Validation already refuses a malformed archive whole,
      // but a disk error partway through a good one would otherwise leave half
      // a history -- and half is worse than none, because there is no way to
      // tell which half is missing.
      try {
        atomically(() => {
          for (const session of parsed.archive.sessions) {
            // Already there? Only if it says the SAME thing. Matching on the
            // instant alone made re-importing idempotent and made importing a
            // different archive that happened to share an instant report
            // success while dropping the conversation -- two machines each
            // starting a conversation in the same millisecond is not exotic.
            // A collision that is not a repeat is counted and reported, never
            // silently discarded.
            const already = stmt.existing.get(personaId, session.startedAt)
            if (already !== undefined) {
              const here = stmt.turns.all(String(already['token']), personaId).map(toTurn)
              // Compared against the end this import WOULD store, not against
              // the raw `endedAt`.
              //
              // Importing the same archive twice was not idempotent when it
              // held an open conversation: the first import closes it at its
              // last turn -- it must, or the conversation goes on claiming to be
              // live on this machine -- and the second import
              // then compared that stored end against an incoming `null`,
              // decided they disagreed, and reported a conflict for a file it
              // had already stored perfectly.
              //
              // Normalising both sides is what makes the comparison mean "is
              // this the same conversation as the one that is here", which is
              // the question actually being asked.
              const hereEnd = already['ended_at'] === null ? null : Number(already['ended_at'])
              const endsAgree = hereEnd === endFor(session)
              if (sameConversation(here, session.turns, endsAgree)) skipped += 1
              else conflicts += 1
              continue
            }
            const id = Number(
              stmt.begin.run(personaId, session.startedAt, randomUUID()).lastInsertRowid,
            )
            stmt.end.run(endFor(session), id)
            sessions += 1
            for (const turn of session.turns) {
              if (recordTurn(id, turn.who, turn.text, turn.at, turn.cut)) turns += 1
            }
          }
        })
      } catch (error: unknown) {
        return { ok: false, problems: [`the archive could not be stored: ${String(error)}`] }
      }
      return { ok: true, sessions, turns, skipped, conflicts }
    },
    forgetSessions(personaId, tokens) {
      /*
        Collapsed and bounded BEFORE the transaction opens, through the SAME
        function the caller uses.

        The bound was always here; what was not was any way for `main/index.ts`
        to know which tokens it covered. That caller decides whether the live
        conversation was among the deleted, and it read its own unbounded list —
        so a request naming more than `MOST_AT_ONCE` released the live token
        while its rows were still on disk. The count returned here is honest
        about how many went; it was never the count that was wrong.
      */
      const wanted = boundedForgetSet(tokens)
      if (wanted.length === 0) return 0
      const gone = atomically(() => {
        let removed = 0
        for (const token of wanted) {
          // The index rows FIRST, while the turns they name still exist: the
          // cascade takes those with the session, and after that the subquery
          // selecting them finds nothing and the rows orphan.
          stmt.dropIndexFor.run(token, personaId)
          removed += Number(stmt.dropSession.run(token, personaId).changes)
        }
        return removed
      })
      scrubsLeft = SCRUB_TRIES
      scrub()
      return gone
    },
    forgetEverything() {
      atomically(() => {
        // The index first, as everywhere else here: `turn_fts` has no foreign
        // key, so a `DELETE FROM session` alone would leave every indexed row
        // behind and a later turn could surface a stranger's words as a hit.
        db.exec('DELETE FROM turn_fts')
        db.exec('DELETE FROM session')
      })
      scrubsLeft = SCRUB_TRIES
      scrub()
    },
    forget(personaId) {
      // The INDEX first, though the transaction is what makes that safe rather
      // than the ordering: a row in `turn_fts` whose turn is gone is a search
      // hit that cannot be read -- which looks like her remembering something
      // she was told to forget -- and the reverse leaves turns nothing can
      // find. Neither half is reachable from outside the transaction.
      atomically(() => {
        stmt.forgetIndex.run(personaId)
        stmt.forget.run(personaId)
      })
      scrubsLeft = SCRUB_TRIES
      scrub()
    },
    scrubPending: () => pendingScrub,
    close() {
      // BEFORE the last attempt, so the attempt cannot arm a replacement.
      closing = true
      if (scrubRetry !== null) {
        clearTimeout(scrubRetry)
        scrubRetry = null
      }
      // One LAST attempt at a truncation a reader held off, while there is
      // still a connection to do it with -- the retries above are the ones that
      // usually win. See `scrub`.
      if (pendingScrub) scrub()
      // Released AFTER a successful close, which is the only order that keeps
      // the registry's claim true. Releasing first meant a failing close let
      // another connection open the same file while this handle was still
      // live -- two writers, a `busy_timeout` of 0, and `SQLITE_BUSY` on the
      // first write of whichever lost.
      //
      // A close that throws therefore leaves the path registered, and that is
      // deliberate: the handle is still open, so the registry is still telling
      // the truth. The caller sees the error rather than a store that quietly
      // half-closed.
      db.close()
      open.delete(path)
    },
  }
}
