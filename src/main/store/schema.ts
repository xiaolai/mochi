import type { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'

/**
 * The tables, the pragmas, and the migrations that carry an older file forward.
 *
 * Separated from the store so that opening a database and describing one are
 * not the same 130 lines. Everything here is idempotent -- it runs on every
 * launch against a file that may be new, current, or two versions old, and the
 * additive migrations are why `CREATE TABLE IF NOT EXISTS` alone is not enough:
 * it does not add a column to a table that already exists.
 */
export function applySchema(db: DatabaseSync): void {
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
}
