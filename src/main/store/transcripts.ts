/**
 * What was actually said, per session, per persona.
 *
 * ## Not memory, and the distinction decides the design
 *
 * Memory is a small curated string that goes into the system prompt on every
 * wake — so it is billed on every reconnect and bounded at 20,000 characters.
 * A transcript is a RECORD. It never enters a prompt: the live session already
 * holds its own context, and injecting a growing history would be an unbounded
 * billed request that gets worse the longer somebody uses the app.
 *
 * So this store exists for two readers, and neither is the model: the person
 * who wants to find something she said, and whatever eventually decides what
 * is worth remembering.
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

import { mkdirSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { segment, toAnyQuery, toMatchQuery } from './segment'

export const TRANSCRIPTS_FILE = 'transcripts.db'

/** Who said it. Her audio, or yours. */
export type Speaker = 'her' | 'you'

export interface Turn {
  readonly at: number
  readonly who: Speaker
  readonly text: string
  /**
   * She was cut off before finishing this.
   *
   * An empty `text` with `cut` true is not a blank row: it is a turn she began
   * and was interrupted in, whose surviving text could not be recovered. It is
   * kept because losing it silently is worse than recording that it happened.
   */
  readonly cut: boolean
}

/**
 * The name a conversation answers to, for the process writing into it.
 *
 * The same token everything else uses, deliberately. It was the rowid, which
 * SQLite hands out again after a delete -- so a handle held across one could
 * come to name a DIFFERENT conversation, and the only thing standing between
 * that and a conversation appended to a stranger's was the holder remembering
 * to let go at six call sites. A random token cannot be reissued, so the
 * mistake is not available to make.
 */
export type LiveSession = SessionToken

/**
 * The name a conversation answers to outside this module.
 *
 * Opaque and random, so it is never reused and cannot be guessed or ordered.
 * Holding one authorises nothing: every lookup still takes the persona, and
 * the token of somebody else's conversation reads exactly like one that was
 * never there.
 */
export type SessionToken = string

export interface Session {
  /** What it answers to. See `SessionToken`. */
  readonly token: SessionToken
  /** When it began. For showing, never for identifying. */
  readonly startedAt: number
  /** Null while she is still awake. */
  readonly endedAt: number | null
  readonly turns: number
}

export interface Hit {
  /** Which conversation it was in, so the window can open it. */
  readonly token: SessionToken
  readonly startedAt: number
  readonly at: number
  readonly who: Speaker
  readonly text: string
  /**
   * She was interrupted partway through saying this.
   *
   * On the type because the query already selects it: a consumer that quotes a
   * hit without knowing this presents a fragment as a finished sentence, which
   * is the failure the whole `cut` column exists to prevent.
   */
  readonly cut: boolean
}

/** What an export contains. Versioned for the reason the persona format is. */
/**
 * The most conversations one confirmed deletion may carry.
 *
 * Not a performance limit -- a sanity one. The list a person can select from is
 * their own archive, so a payload larger than this did not come from somebody
 * clicking, and the transaction should not be asked to find out.
 */
const MOST_AT_ONCE = 1000

export const ARCHIVE_FORMAT = 2

export interface Archive {
  readonly version: number
  /** Whose history this was. Informational — the IMPORTER chooses the target. */
  readonly personaId: string
  readonly exportedAt: number
  readonly sessions: ReadonlyArray<{
    readonly startedAt: number
    readonly endedAt: number | null
    readonly turns: readonly Turn[]
  }>
}

export interface Imported {
  readonly sessions: number
  readonly turns: number
  /** Sessions already present, byte for byte. Skipped rather than duplicated. */
  readonly skipped: number
  /**
   * Sessions that share an instant with one already here but say something
   * DIFFERENT, and were therefore not written.
   *
   * Its own count because collapsing it into `skipped` is how an import loses
   * a conversation while reporting success: two archives from two machines
   * can easily hold different conversations that began in the same
   * millisecond, and "already here" would be a lie about both.
   */
  readonly conflicts: number
}

export type ImportResult =
  ({ readonly ok: true } & Imported) | { readonly ok: false; readonly problems: readonly string[] }

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
  // WAL so a long read cannot block a write mid-conversation. Foreign keys are
  // OFF by default in SQLite, which makes `ON DELETE CASCADE` silently do
  // nothing -- and "deleting her left every turn behind" is exactly the
  // privacy failure this store is filed per-persona to avoid.
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  // Deleted text is OVERWRITTEN, not just unlinked from its page.
  //
  // Without this, "Delete for good?" is not true. Measured: write a unique
  // string, delete the row, and the bytes are still in `transcripts.db` --
  // anybody with the file can read a conversation the user was told was gone,
  // and this app makes a point of saying that file is not encrypted.
  //
  // The cost is writes, not reads: SQLite zeroes freed pages instead of
  // leaving them. For a store whose whole content is a few hundred kilobytes
  // of text that is not a trade worth thinking about twice.
  db.exec('PRAGMA secure_delete = ON')
  db.exec(`
    CREATE TABLE IF NOT EXISTS session (
      id         INTEGER PRIMARY KEY,
      persona_id TEXT    NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at   INTEGER,
      -- One session per persona per instant. This is what makes importing the
      -- same archive twice a no-op instead of doubling everything, the same
      -- way the persona migration recognises its own previous work.
      UNIQUE (persona_id, started_at)
    );
    CREATE INDEX IF NOT EXISTS session_by_persona ON session (persona_id, started_at DESC);

    CREATE TABLE IF NOT EXISTS turn (
      id         INTEGER PRIMARY KEY,
      session_id INTEGER NOT NULL REFERENCES session(id) ON DELETE CASCADE,
      at         INTEGER NOT NULL,
      who        TEXT    NOT NULL,
      text       TEXT    NOT NULL,
      -- She was interrupted before finishing this turn. With text, that text is
      -- what the SERVER says survived; with EMPTY text, nothing she said here
      -- is quotable and the row exists only so the interruption is recorded
      -- rather than the turn vanishing. Defaulted so the migration below can
      -- add it to an existing table without rewriting every row.
      cut        INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS turn_by_session ON turn (session_id, at);

    -- CONTENTLESS-adjacent: the searchable copy is segmented and the readable
    -- one lives in \`turn\`. Storing only the segmented form would mean showing
    -- somebody their own words with spaces between every character.
    CREATE VIRTUAL TABLE IF NOT EXISTS turn_fts USING fts5(
      body,
      turn_id UNINDEXED,
      persona_id UNINDEXED
    );
  `)

  // FTS5's own secure-delete, which is a SEPARATE switch and also off by
  // default. Set on every open rather than at creation, because it is a
  // property of the table that has to be re-asserted.
  //
  // Kept as defence in depth, and the honest note is that no measurement here
  // has shown it doing anything: `PRAGMA secure_delete` above already zeroes
  // the freed pages of the shadow tables, and a probe that deleted one row
  // from the middle of an 800-row index found the text gone with this switch
  // off (measured 2026-08-14). It addresses FTS5 leaving tombstones inside
  // LIVE pages, which that probe did not manage to expose. An earlier comment
  // here claimed the index kept its own copy without it -- that claim was not
  // measured and is not true of anything tested since.
  db.exec("INSERT INTO turn_fts (turn_fts, rank) VALUES ('secure-delete', 1)")

  // An opaque, never-reused name for each conversation, added to the table
  // rather than replacing the rowid.
  //
  // The rowid cannot be the identity that crosses IPC: SQLite hands it out
  // again once the row holding it is gone (probed -- `INTEGER PRIMARY KEY`
  // goes 1 -> delete -> 1), so a settings window holding one would eventually
  // name whatever took its place, and the dangerous version of that is a
  // delete removing a conversation nobody asked to remove.
  //
  // `started_at` cannot be it either, which is the less obvious half. Two
  // conversations can legitimately want the same instant, an import can
  // introduce one at a timestamp already used, and advancing the stored time
  // to dodge that produces a session that began after the things said in it.
  // A random token is beholden to none of those.
  //
  // ADD COLUMN and a UNIQUE INDEX are both additive: no table rebuild, so no
  // dropping `session` with foreign keys on and taking every turn with it.
  const columns = db.prepare('PRAGMA table_info(session)').all()
  if (!columns.some((column) => String(column['name']) === 'token')) {
    db.exec('ALTER TABLE session ADD COLUMN token TEXT')
  }
  // Backfilled before the index exists, because NULLs are distinct in a SQLite
  // unique index but a half-migrated table is still a table where two rows
  // answer to nothing.
  const unnamed = db.prepare('SELECT id FROM session WHERE token IS NULL').all()
  const name = db.prepare('UPDATE session SET token = ? WHERE id = ?')
  for (const row of unnamed) name.run(randomUUID(), Number(row['id']))
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS session_by_token ON session (token)')

  // `CREATE TABLE IF NOT EXISTS` above does NOT add a column to a table that
  // already exists, so a database written before this column existed keeps its
  // old shape and every read of `cut` returns undefined. Additive, like the
  // token migration above it: ADD COLUMN with a default rewrites no rows and
  // rebuilds no table, so the foreign key from `turn` to `session` is never in
  // play. Existing turns are correct at the default -- nothing recorded before
  // this column existed knew it had been interrupted.
  const turnColumns = db.prepare('PRAGMA table_info(turn)').all()
  if (!turnColumns.some((column) => String(column['name']) === 'cut')) {
    db.exec('ALTER TABLE turn ADD COLUMN cut INTEGER NOT NULL DEFAULT 0')
  }

  // A session an unclean quit left open has no end, and therefore no length to
  // show: the archive reports `null` while she is still awake in one, so an
  // abandoned conversation would sit in the list for ever claiming to be live.
  // Anything still open when the file is OPENED belongs to a previous run --
  // one session is live at a time and this connection is the only writer -- so
  // it is closed at the last thing said in it, the last moment it is known to
  // have existed.
  //
  // This used to reason about retention, which never ran: the prune it
  // described was implemented, tested, and called by nothing. See the note
  // where `pruneBefore` was declared.
  db.exec(`
    UPDATE session
    SET ended_at = coalesce((SELECT max(at) FROM turn WHERE session_id = session.id), started_at)
    WHERE ended_at IS NULL
  `)

  const stmt = {
    begin: db.prepare('INSERT INTO session (persona_id, started_at, token) VALUES (?, ?, ?)'),
    end: db.prepare('UPDATE session SET ended_at = ? WHERE id = ? AND ended_at IS NULL'),
    personaOf: db.prepare('SELECT persona_id FROM session WHERE id = ?'),
    rowidOf: db.prepare('SELECT id FROM session WHERE token = ?'),
    // `ended_at IS NULL` IN the statement, not behind a check that ran first.
    // A read-then-write pair decides the question at a different moment from
    // the one that acts on it; this is the same rule the scoped deletes follow.
    openSession: db.prepare(
      'SELECT id, started_at FROM session WHERE token = ? AND ended_at IS NULL',
    ),
    say: db.prepare('INSERT INTO turn (session_id, at, who, text, cut) VALUES (?, ?, ?, ?, ?)'),
    index: db.prepare('INSERT INTO turn_fts (body, turn_id, persona_id) VALUES (?, ?, ?)'),
    taken: db.prepare('SELECT 1 FROM session WHERE persona_id = ? AND started_at = ?'),
    sessions: db.prepare(`
      SELECT s.token, s.started_at, s.ended_at, count(t.id) AS turns
      FROM session s LEFT JOIN turn t ON t.session_id = s.id
      WHERE s.persona_id = ? GROUP BY s.id ORDER BY s.started_at DESC
    `),
    // Joined rather than filtered afterwards, for the reason `search` is: a
    // read that fetches everything and narrows it in JS leaks through the
    // first caller who forgets to narrow.
    turns: db.prepare(`
      SELECT t.at, t.who, t.text, t.cut
      FROM turn t JOIN session s ON s.id = t.session_id
      WHERE s.token = ? AND s.persona_id = ?
      ORDER BY t.at, t.id
    `),
    forget: db.prepare('DELETE FROM session WHERE persona_id = ?'),
    forgetIndex: db.prepare('DELETE FROM turn_fts WHERE persona_id = ?'),
    // Both scoped to the persona IN the statement rather than behind a check
    // that ran first. A read-then-write pair decides ownership at a different
    // moment from the one that acts on it, and `changes` is the only answer
    // that comes from the statement which actually ran. There is deliberately
    // no unscoped delete in this file for someone to reach for later.
    dropSession: db.prepare('DELETE FROM session WHERE token = ? AND persona_id = ?'),
    dropIndexFor: db.prepare(`
      DELETE FROM turn_fts WHERE turn_id IN (
        SELECT t.id FROM turn t JOIN session s ON s.id = t.session_id
        WHERE s.token = ? AND s.persona_id = ?
      )
    `),
    existing: db.prepare(
      'SELECT token, ended_at FROM session WHERE persona_id = ? AND started_at = ?',
    ),
  }

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
  function retryScrubSoon(): void {
    if (scrubRetry !== null || scrubsLeft <= 0) return
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
      db.exec('ROLLBACK')
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
    return stmt.sessions.all(personaId).map((row) => ({
      token: String(row['token']),
      startedAt: Number(row['started_at']),
      endedAt: row['ended_at'] === null ? null : Number(row['ended_at']),
      turns: Number(row['turns']),
    }))
  }

  /** What was said in one of hers. Closed over for the reason `sessionsOf` is. */
  function turnsOf(personaId: string, token: SessionToken): readonly Turn[] {
    return stmt.turns.all(token, personaId).map(toTurn)
  }

  /** One MATCH expression, run and shaped into hits. See `search`. */
  function matching(match: string, personaId: string, limit: number): Hit[] {
    return db
      .prepare(
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
      .all(match, personaId, limit)
      .map((row) => ({
        token: String(row['token']),
        startedAt: Number(row['started_at']),
        // Through the SAME decoders the turn reader uses. The two copies of
        // this had already coerced unexpected database values differently, and
        // a hit that disagrees with the turn it points at is the store quietly
        // contradicting itself.
        ...toTurn(row),
      }))
  }

  return {
    begin(personaId, at = now()) {
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
      // Nothing can be said before the conversation began. The archive parser
      // in this file refuses that shape, so accepting it here produces an
      // export this store cannot read back -- and the value arrives from the
      // renderer, which is the least trusted process in the app.
      if (at < row.startedAt) {
        console.error(`[transcripts] a turn dated before conversation ${token} began was dropped`)
        return
      }
      atomically(() => recordTurn(row.id, who, text, at, cut))
    },
    end(token, at = now()) {
      const row = rowidOf(token)
      if (row !== null) stmt.end.run(at, row)
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
      // Collapsed and bounded BEFORE the transaction opens. A payload arrives
      // from the renderer, which is the least trusted process here, and a
      // hundred thousand tokens is not a request anybody made by hand.
      const wanted = [...new Set(tokens)].slice(0, MOST_AT_ONCE)
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

/**
 * When an imported conversation is recorded as having ended.
 *
 * CLOSED, always. An archive may legitimately hold a conversation that was
 * still running when it was exported, but importing it as still running makes
 * it live on THIS machine: it would sit in the archive claiming to be
 * happening now, and the app would hold two open conversations at once.
 * Ended at the last thing said in it, or at its start when it holds nothing --
 * the same rule an unclean quit gets.
 *
 * No `-1` sentinel. It was `reduce(max, -1)` with `-1` meaning "no turns", in a
 * file that elsewhere goes out of its way to point out that `-1` is a
 * legitimate timestamp -- so a conversation beginning before the epoch with its
 * last turn at exactly `-1` was closed at its own start, leaving that turn
 * dated after the end of the conversation holding it. The parser refuses that
 * shape on the way back in, so the store would have produced an archive it
 * could not read.
 *
 * `at(-1)` rather than a maximum, because the parser has already refused any
 * session whose turns run backwards.
 */
function endFor(session: Archive['sessions'][number]): number {
  return session.endedAt ?? session.turns.at(-1)?.at ?? session.startedAt
}

/**
 * Whether two conversations are the same one, said the same way.
 *
 * Compared by content because that is the only thing an archive carries that
 * can answer it: a v1 archive has no portable identifier for a session, so
 * "the same conversation" has to mean "the same words in the same order at the
 * same moments". Format 2 added `cut` and still carries no source id, so this
 * is still the only answer available; a FUTURE format could carry one and this can
 * become an equality rather than a comparison.
 */
function sameConversation(
  here: readonly Turn[],
  incoming: readonly Turn[],
  sameEnd: boolean,
): boolean {
  // An open conversation and a finished one holding the same words are not the
  // same conversation: importing the completed export of a session that was
  // still running would otherwise report "already here" and drop the ending.
  if (!sameEnd) return false
  // The incoming side is filtered the way `recordTurn` would have filtered it,
  // or a repeat import of an archive containing a blank turn never matches
  // what that archive originally produced.
  //
  // A blank CUT marker is kept, because `recordTurn` keeps it: filtering it
  // here made a second import of the same archive look different from the
  // first, so an archive containing an interrupted turn could be imported
  // twice over.
  const theirs = incoming.filter((one) => one.text.trim() !== '' || one.cut)
  if (here.length !== theirs.length) return false
  return here.every((one, index) => {
    const other = theirs[index]
    return (
      other !== undefined &&
      one.at === other.at &&
      one.who === other.who &&
      // Compared, because a cut turn and a whole turn carrying the same words
      // are not the same turn -- one of them is a fragment.
      one.cut === other.cut &&
      one.text === other.text.trim()
    )
  })
}

/**
 * Who said it, from a stored value.
 *
 * Its own function because the rule was written twice -- once for a turn and
 * once for a search hit -- and two copies of a coercion drift the day either is
 * touched. Anything that is not `her` reads as `you`, which is the safe
 * direction: attributing her words to the user under-claims, and the reverse
 * would put words in her mouth.
 */
function decodeSpeaker(value: unknown): Speaker {
  return String(value) === 'her' ? 'her' : 'you'
}

/** Whether she was interrupted, from a stored value. See `decodeSpeaker`. */
function decodeCut(value: unknown): boolean {
  return Number(value ?? 0) === 1
}

function toTurn(row: Record<string, unknown>): Turn {
  return {
    at: Number(row['at']),
    who: decodeSpeaker(row['who']),
    text: String(row['text']),
    cut: decodeCut(row['cut']),
  }
}

export type ArchiveParse =
  | { readonly ok: true; readonly archive: Archive }
  | { readonly ok: false; readonly problems: readonly string[] }

/**
 * Turn a file somebody chose into an archive, or say what is wrong with it.
 *
 * A boundary, and treated like every other one here: every problem at once
 * rather than the first, a version checked before anything is read on its
 * terms, and a newer one refused rather than half-read.
 */
/**
 * One turn of an archive, or the problems with it.
 *
 * Extracted because `parseArchive` had grown past a hundred lines with session
 * parsing, turn parsing, validation and normalisation nested inside each other
 * -- and the `cut` rule is exactly the kind of thing that gets lost in there.
 */
function parseTurn(raw: unknown, version: number, where: string): Turn | readonly string[] {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return [`${where} must be an object`]
  }
  const turn = raw as Record<string, unknown>
  const who = turn['who']
  if (who !== 'her' && who !== 'you') return [`${where}.who must be "her" or "you"`]
  if (typeof turn['text'] !== 'string') return [`${where}.text must be text`]
  if (typeof turn['at'] !== 'number' || !Number.isFinite(turn['at'])) {
    return [`${where}.at must be a timestamp`]
  }
  // VERSION-AWARE, because the two formats make different promises about this
  // field and `cut === true` treated them identically. Absent in a format-1
  // archive is FALSE and not an error -- nothing written before the field
  // existed knew whether a turn had been interrupted, and refusing those files
  // would make every archive anybody already exported unimportable.
  //
  // In a format-2 archive it is REQUIRED and must be a boolean. Coercing
  // `cut: "true"` or a missing field to `false` there turns an interrupted
  // fragment into an apparently complete statement, which is the one thing the
  // whole column exists to keep straight.
  const cut = turn['cut']
  if (version >= 2) {
    if (typeof cut !== 'boolean') return [`${where}.cut must be true or false`]
    return { at: turn['at'], who, text: turn['text'], cut }
  }
  if (cut !== undefined && typeof cut !== 'boolean') {
    return [`${where}.cut must be true or false`]
  }
  return { at: turn['at'], who, text: turn['text'], cut: cut === true }
}

/** One conversation of an archive, or the problems with it. */
function parseSession(
  raw: unknown,
  version: number,
  where: string,
): Archive['sessions'][number] | readonly string[] {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return [`${where} must be an object`]
  }
  const session = raw as Record<string, unknown>
  const startedAt = session['startedAt']
  if (typeof startedAt !== 'number' || !Number.isFinite(startedAt)) {
    return [`${where}.startedAt must be a timestamp`]
  }
  const endedAt = session['endedAt']
  if (endedAt !== null && (typeof endedAt !== 'number' || !Number.isFinite(endedAt))) {
    return [`${where}.endedAt must be a timestamp or null`]
  }
  const rawTurns = session['turns']
  if (!Array.isArray(rawTurns)) return [`${where}.turns must be a list`]

  const problems: string[] = []
  const turns: Turn[] = []
  for (const [index, rawTurn] of rawTurns.entries()) {
    const parsed = parseTurn(rawTurn, version, `${where}.turns[${String(index)}]`)
    if (Array.isArray(parsed)) problems.push(...parsed)
    else turns.push(parsed as Turn)
  }
  if (problems.length > 0) return problems

  // A conversation that disagrees with itself is refused rather than stored
  // and shown. None of these are hypothetical for a file somebody can write
  // by hand or generate, and each produces a transcript the reader cannot
  // make sense of: an end before its beginning, a line spoken outside the
  // conversation it is in, or lines that jump backwards.
  const ends = endedAt ?? null
  if (ends !== null && ends < startedAt) return [`${where}.endedAt is before it began`]
  if (turns.some((one) => one.at < startedAt || (ends !== null && one.at > ends))) {
    return [`${where} holds something said outside the conversation`]
  }
  if (turns.some((one, index) => index > 0 && one.at < (turns[index - 1]?.at ?? 0))) {
    return [`${where} is not in the order it was said`]
  }
  return { startedAt, endedAt: ends, turns }
}

export function parseArchive(value: unknown): ArchiveParse {
  const problems: string[] = []
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, problems: ['a transcript archive must be a JSON object'] }
  }
  const source = value as Record<string, unknown>

  const version = source['version']
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1) {
    problems.push('version must be a whole number')
  } else if (version > ARCHIVE_FORMAT) {
    problems.push(`this archive was written by a newer mochi (format ${String(version)})`)
  }
  // A version that did not parse cannot decide the version-aware rules below,
  // and reading the rest of the file on a guess is how a format-2 archive gets
  // format-1 leniency applied to it. Refused here, with the problem already
  // collected above.
  if (problems.length > 0) return { ok: false, problems }
  const format = version as number

  const rawSessions = source['sessions']
  if (!Array.isArray(rawSessions)) {
    problems.push('sessions must be a list')
    return { ok: false, problems }
  }

  const sessions: Archive['sessions'][number][] = []
  for (const [index, raw] of rawSessions.entries()) {
    const parsed = parseSession(raw, format, `sessions[${String(index)}]`)
    if (Array.isArray(parsed)) problems.push(...parsed)
    else sessions.push(parsed as Archive['sessions'][number])
  }

  if (problems.length > 0) return { ok: false, problems }
  return {
    ok: true,
    archive: {
      version: format,
      personaId: typeof source['personaId'] === 'string' ? source['personaId'] : '',
      exportedAt: typeof source['exportedAt'] === 'number' ? source['exportedAt'] : 0,
      sessions,
    },
  }
}
