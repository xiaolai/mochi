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

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { segment, toMatchQuery } from './segment'

export const TRANSCRIPTS_FILE = 'transcripts.db'

/** Who said it. Her audio, or yours. */
export type Speaker = 'her' | 'you'

export interface Turn {
  readonly at: number
  readonly who: Speaker
  readonly text: string
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
}

/** What an export contains. Versioned for the reason the persona format is. */
export const ARCHIVE_FORMAT = 1

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
  /** Record one turn. Empty text is ignored — silence is not a turn. */
  say(session: LiveSession, who: Speaker, text: string, at?: number): void
  end(session: LiveSession, at?: number): void
  sessions(personaId: string): readonly Session[]
  /**
   * What was said in one conversation of HERS, named by when it began.
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
  /** Everything she has, for export. */
  exportFor(personaId: string): Archive
  /** Read an archive INTO a persona the caller names. */
  importInto(personaId: string, value: unknown): ImportResult
  /**
   * Drop ONE conversation of hers. False if it is not hers, or not there.
   *
   * The finer of the two grains. With only "delete all of
   * hers", correcting one conversation costs the whole archive, so the safe
   * action is the expensive one -- and that is the shape that makes people
   * keep what they wanted gone.
   */
  forgetSession(personaId: string, token: SessionToken): boolean
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
   * Drop HER sessions that ended before this moment. Returns how many went.
   *
   * Scoped to one persona because the policy that drives it is: how
   * long to keep is a thing two characters must be able to disagree about. A
   * global cutoff driven by whoever happens to be worn would let a persona set
   * to keep a week quietly erase the archive of one set to keep everything --
   * and it would look like the data was never there.
   */
  pruneBefore(personaId: string, cutoff: number): number
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
  const path = join(userData, TRANSCRIPTS_FILE)
  if (open.has(path)) {
    throw new Error(`${path} is already open in this process`)
  }
  const db = new DatabaseSync(path)
  open.add(path)

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
      text       TEXT    NOT NULL
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

  // A session an unclean quit left open is never pruned: retention only
  // considers sessions that ENDED, so a persona set to keep a week keeps that
  // one forever while the pane reports it dropped. Anything still open when
  // the file is OPENED belongs to a previous run -- one session is live at a
  // time and this connection is the only writer -- so it is closed at the last
  // thing said in it, the last moment it is known to have existed.
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
    say: db.prepare('INSERT INTO turn (session_id, at, who, text) VALUES (?, ?, ?, ?)'),
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
      SELECT t.at, t.who, t.text
      FROM turn t JOIN session s ON s.id = t.session_id
      WHERE s.token = ? AND s.persona_id = ?
      ORDER BY t.at, t.id
    `),
    forget: db.prepare('DELETE FROM session WHERE persona_id = ?'),
    forgetIndex: db.prepare('DELETE FROM turn_fts WHERE persona_id = ?'),
    stale: db.prepare(
      'SELECT token FROM session WHERE persona_id = ? AND ended_at IS NOT NULL AND ended_at < ?',
    ),
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
   */
  function scrub(): void {
    try {
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    } catch (error: unknown) {
      // A reader can hold a checkpoint off. The rows are gone either way; what
      // survives is a copy in the log that the next checkpoint clears.
      console.warn('[transcripts] could not truncate the write-ahead log after a delete:', error)
    }
  }

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

  function recordTurn(sessionId: number, who: Speaker, text: string, at: number): boolean {
    const body = text.trim()
    // Silence is not a turn. The wire emits empty transcripts for a breath, and
    // storing them would fill a conversation with blank rows nobody can search.
    if (body === '') return false
    // The row was resolved by the caller, so this is a lookup rather than a
    // guard: `say` refuses a token whose conversation is gone, and `importInto`
    // passes a row it created a line earlier.
    const persona = stmt.personaOf.get(sessionId)?.['persona_id']
    if (persona === undefined) return false
    const inserted = stmt.say.run(sessionId, at, who, body)
    stmt.index.run(segment(body), Number(inserted.lastInsertRowid), String(persona))
    return true
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
    say(token, who, text, at = now()) {
      // Wrapped HERE rather than inside `recordTurn`, because `importInto`
      // calls that from inside a transaction of its own and SQLite has no
      // nested `BEGIN`.
      //
      // Writing is the same two-statement problem as deleting, in the other
      // direction: the readable row and its index row are separate inserts, so
      // a crash between them leaves a turn somebody can read and no search can
      // ever find. That is the failure this store's whole reason for existing
      // -- finding something she said -- fails at, silently, for one turn.
      const row = rowidOf(token)
      if (row === null) {
        // Loud. The conversation was deleted while something was still writing
        // into it, and every turn after that point disappears -- which is
        // indistinguishable from a quiet conversation, so nothing else would
        // ever say it happened.
        console.error(`[transcripts] conversation ${token} is gone; a turn was dropped`)
        return
      }
      atomically(() => recordTurn(row, who, text, at))
    },
    end(token, at = now()) {
      const row = rowidOf(token)
      if (row !== null) stmt.end.run(at, row)
    },
    sessions(personaId) {
      return stmt.sessions.all(personaId).map((row) => ({
        token: String(row['token']),
        startedAt: Number(row['started_at']),
        endedAt: row['ended_at'] === null ? null : Number(row['ended_at']),
        turns: Number(row['turns']),
      }))
    },
    turns(personaId, token) {
      return stmt.turns.all(token, personaId).map(toTurn)
    },
    search(personaId, query, limit = 50) {
      const match = toMatchQuery(query)
      // Nothing to search for is not an empty result from a query -- it is not
      // running one. An empty MATCH is a syntax error in FTS5.
      if (match === null) return []
      return db
        .prepare(
          // Joined through to `session` so a hit names its conversation the
          // way everything else does. The index stores a turn id, which is a
          // rowid and therefore not something to hand outwards.
          `SELECT s.token, s.started_at, t.at, t.who, t.text
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
          at: Number(row['at']),
          who: String(row['who']) === 'her' ? ('her' as const) : ('you' as const),
          text: String(row['text']),
        }))
    },
    exportFor(personaId) {
      return {
        version: ARCHIVE_FORMAT,
        personaId,
        exportedAt: now(),
        sessions: this.sessions(personaId).map((session) => ({
          startedAt: session.startedAt,
          endedAt: session.endedAt,
          turns: this.turns(personaId, session.token),
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
              // Compared as they are, not through a sentinel. `-1` is a
              // legitimate timestamp, so folding null into it made an open
              // conversation equal to one that ended a moment before 1970.
              const hereEnd = already['ended_at'] === null ? null : Number(already['ended_at'])
              const endsAgree = hereEnd === session.endedAt
              if (sameConversation(here, session.turns, endsAgree)) skipped += 1
              else conflicts += 1
              continue
            }
            const id = Number(
              stmt.begin.run(personaId, session.startedAt, randomUUID()).lastInsertRowid,
            )
            // CLOSED, always. An archive may legitimately hold a conversation
            // that was still running when it was exported, but importing it as
            // still running makes it live on THIS machine: retention only
            // prunes conversations that ended, so it would never expire, and
            // the app would hold two open conversations at once. Ended at the
            // last thing said in it, or at its start when it holds nothing --
            // the same rule an unclean quit gets.
            const last = session.turns.reduce((latest, one) => Math.max(latest, one.at), -1)
            stmt.end.run(session.endedAt ?? (last === -1 ? session.startedAt : last), id)
            sessions += 1
            for (const turn of session.turns) {
              if (recordTurn(id, turn.who, turn.text, turn.at)) turns += 1
            }
          }
        })
      } catch (error: unknown) {
        return { ok: false, problems: [`the archive could not be stored: ${String(error)}`] }
      }
      return { ok: true, sessions, turns, skipped, conflicts }
    },
    forgetSession(personaId, token) {
      const gone = atomically(() => {
        // The index rows FIRST, while the turns they name still exist: the
        // cascade takes those with the session, and after that the subquery
        // selecting them finds nothing and the rows orphan.
        stmt.dropIndexFor.run(token, personaId)
        // Not hers and not there are the same answer here, for the reason
        // they are the same answer in `turns`: telling them apart discloses
        // that somebody else's conversation exists.
        return Number(stmt.dropSession.run(token, personaId).changes) === 1
      })
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
      scrub()
    },
    pruneBefore(personaId, cutoff) {
      const stale = stmt.stale.all(personaId, cutoff).map((row) => String(row['token']))
      atomically(() => {
        for (const token of stale) {
          stmt.dropIndexFor.run(token, personaId)
          stmt.dropSession.run(token, personaId)
        }
      })
      // Retention deletes conversations like anything else here, so the log
      // holding their words is truncated like anywhere else here. This is the
      // path that runs unattended, on every wake -- the one where a copy left
      // behind survives longest.
      if (stale.length > 0) scrub()
      return stale.length
    },
    close() {
      // Released BEFORE the close, so a failing close cannot leave the path
      // permanently unopenable -- the store is unusable either way, and
      // refusing every later attempt to reopen it would turn one bad close
      // into a dead feature for the rest of the run.
      open.delete(path)
      db.close()
    },
  }
}

/**
 * Whether two conversations are the same one, said the same way.
 *
 * Compared by content because that is the only thing an archive carries that
 * can answer it: a v1 archive has no portable identifier for a session, so
 * "the same conversation" has to mean "the same words in the same order at the
 * same moments". A v2 format should carry a source id instead, and this can
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
  const theirs = incoming.filter((one) => one.text.trim() !== '')
  if (here.length !== theirs.length) return false
  return here.every((one, index) => {
    const other = theirs[index]
    return (
      other !== undefined &&
      one.at === other.at &&
      one.who === other.who &&
      one.text === other.text.trim()
    )
  })
}

function toTurn(row: Record<string, unknown>): Turn {
  return {
    at: Number(row['at']),
    who: String(row['who']) === 'her' ? 'her' : 'you',
    text: String(row['text']),
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

  const rawSessions = source['sessions']
  if (!Array.isArray(rawSessions)) {
    problems.push('sessions must be a list')
    return { ok: false, problems }
  }

  const sessions: Archive['sessions'][number][] = []
  for (const [index, raw] of rawSessions.entries()) {
    const where = `sessions[${String(index)}]`
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      problems.push(`${where} must be an object`)
      continue
    }
    const session = raw as Record<string, unknown>
    const startedAt = session['startedAt']
    if (typeof startedAt !== 'number' || !Number.isFinite(startedAt)) {
      problems.push(`${where}.startedAt must be a timestamp`)
      continue
    }
    const endedAt = session['endedAt']
    if (endedAt !== null && (typeof endedAt !== 'number' || !Number.isFinite(endedAt))) {
      problems.push(`${where}.endedAt must be a timestamp or null`)
      continue
    }
    const rawTurns = session['turns']
    if (!Array.isArray(rawTurns)) {
      problems.push(`${where}.turns must be a list`)
      continue
    }
    const turns: Turn[] = []
    for (const [turnIndex, rawTurn] of rawTurns.entries()) {
      const turnWhere = `${where}.turns[${String(turnIndex)}]`
      if (typeof rawTurn !== 'object' || rawTurn === null || Array.isArray(rawTurn)) {
        problems.push(`${turnWhere} must be an object`)
        continue
      }
      const turn = rawTurn as Record<string, unknown>
      const who = turn['who']
      if (who !== 'her' && who !== 'you') {
        problems.push(`${turnWhere}.who must be "her" or "you"`)
        continue
      }
      if (typeof turn['text'] !== 'string') {
        problems.push(`${turnWhere}.text must be text`)
        continue
      }
      if (typeof turn['at'] !== 'number' || !Number.isFinite(turn['at'])) {
        problems.push(`${turnWhere}.at must be a timestamp`)
        continue
      }
      turns.push({ at: turn['at'], who, text: turn['text'] })
    }
    // A conversation that disagrees with itself is refused rather than stored
    // and shown. None of these are hypothetical for a file somebody can write
    // by hand or generate, and each produces a transcript the reader cannot
    // make sense of: an end before its beginning, a line spoken outside the
    // conversation it is in, or lines that jump backwards.
    const ends = endedAt ?? null
    if (ends !== null && ends < startedAt) {
      problems.push(`${where}.endedAt is before it began`)
      continue
    }
    const outside = turns.some((one) => one.at < startedAt || (ends !== null && one.at > ends))
    if (outside) {
      problems.push(`${where} holds something said outside the conversation`)
      continue
    }
    const backwards = turns.some((one, index) => index > 0 && one.at < (turns[index - 1]?.at ?? 0))
    if (backwards) {
      problems.push(`${where} is not in the order it was said`)
      continue
    }
    sessions.push({ startedAt, endedAt: ends, turns })
  }

  if (problems.length > 0) return { ok: false, problems }
  return {
    ok: true,
    archive: {
      version: version as number,
      personaId: typeof source['personaId'] === 'string' ? source['personaId'] : '',
      exportedAt: typeof source['exportedAt'] === 'number' ? source['exportedAt'] : 0,
      sessions,
    },
  }
}
