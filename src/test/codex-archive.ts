import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { HISTORY_FILE, STATE_FILE } from '../main/codex/archive/present'

/**
 * A stand-in for Codex's two databases, built from the real DDL.
 *
 * ## Why the schema here is copied rather than simplified
 *
 * Every test in `codex/archive` is a claim about somebody else's database, and
 * a fixture that omits an index or relaxes a primary key would let those claims
 * pass while being false of the thing they are about. Two of them cannot be
 * made at all against a simplified fixture:
 *
 * - **the query plan.** `idx_thread_items_page (thread_id, rollout_ordinal)` is
 *   the only usable index for the refresh, and the whole point of the test is
 *   that the plan uses it rather than scanning 515 MB. Without the index in the
 *   fixture the test would assert that SQLite scans a table, which is true and
 *   worthless.
 * - **the key triple.** `thread_items`' primary key is
 *   `(thread_id, turn_id, item_id)`, not the pair the plan first named. A
 *   fixture keyed on the pair cannot express the collision the triple exists to
 *   prevent.
 *
 * The columns are the ones `REQUIRED_SHAPE` names plus the keys and indexes
 * they sit in. The real `threads` has thirty-eight columns; the ones left out
 * are ones nothing here reads, and leaving them out is what makes the fixture
 * readable.
 *
 * Copied from `~/.codex` on 2026-08-31, Codex CLI 0.151.0.
 */

/**
 * The bookkeeping table sqlx writes into BOTH databases.
 *
 * One copy, interpolated into each. It is not a table this feature reads — it
 * is there because `present.ts` checks that a file is a Codex database rather
 * than any SQLite file that happens to have the right columns, and a fixture
 * missing it would be a fixture the real check would reject.
 *
 * It was written out twice, identically, which for a fixture is worse than for
 * production code: a fixture that drifts from what Codex actually creates makes
 * the tests agree with themselves about a database nobody has.
 */
const MIGRATIONS_DDL = `CREATE TABLE _sqlx_migrations (
    version BIGINT PRIMARY KEY,
    description TEXT NOT NULL DEFAULT '',
    installed_on TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    success BOOLEAN NOT NULL DEFAULT 1,
    checksum BLOB NOT NULL DEFAULT x'00',
    execution_time BIGINT NOT NULL DEFAULT 0
  );`

/** The subset of `state_5.sqlite` this feature reads. */
export const STATE_DDL = `
  CREATE TABLE threads (
    id TEXT PRIMARY KEY,
    rollout_path TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'cli',
    cwd TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL DEFAULT '',
    first_user_message TEXT NOT NULL DEFAULT '',
    preview TEXT NOT NULL DEFAULT '',
    thread_source TEXT,
    history_mode TEXT NOT NULL DEFAULT 'legacy',
    created_at_ms INTEGER,
    updated_at_ms INTEGER
  );
  ${MIGRATIONS_DDL}
`

/** The subset of `thread_history_1.sqlite` this feature reads. */
export const HISTORY_DDL = `
  CREATE TABLE thread_items (
    thread_id TEXT NOT NULL,
    turn_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    rollout_ordinal INTEGER NOT NULL,
    created_at_ms INTEGER NOT NULL,
    item_json TEXT NOT NULL,
    item_type TEXT NOT NULL DEFAULT '',
    updated_at_ordinal INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (thread_id, turn_id, item_id)
  );
  CREATE UNIQUE INDEX idx_thread_items_page ON thread_items(thread_id, rollout_ordinal);
  CREATE INDEX idx_thread_items_by_turn_page ON thread_items(thread_id, turn_id, rollout_ordinal);
  -- The index the refresh probe is answered from, and the reason it can be
  -- answered without opening the table at all. Omitting it from this fixture
  -- made the plan assertion pass against a database Codex does not have.
  CREATE INDEX idx_thread_items_updated_page ON thread_items(thread_id, updated_at_ordinal);
  CREATE INDEX idx_thread_items_by_turn_updated_page
    ON thread_items(thread_id, turn_id, updated_at_ordinal);
  CREATE INDEX idx_thread_items_user_messages
    ON thread_items(thread_id, rollout_ordinal) WHERE item_type = 'userMessage';
  CREATE TABLE thread_history_projection_state (
    thread_id TEXT PRIMARY KEY,
    next_rollout_byte_offset INTEGER NOT NULL,
    next_rollout_ordinal INTEGER NOT NULL
  );
  CREATE TABLE thread_realtime_items (
    thread_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    rollout_ordinal INTEGER NOT NULL,
    created_at_ms INTEGER NOT NULL,
    item_type TEXT NOT NULL,
    item_json TEXT NOT NULL,
    PRIMARY KEY (thread_id, item_id)
  );
  ${MIGRATIONS_DDL}
`

export interface ThreadRow {
  readonly id: string
  readonly title?: string
  readonly firstUserMessage?: string
  readonly preview?: string
  readonly cwd?: string
  readonly source?: string
  readonly threadSource?: string | null
  readonly createdAtMs?: number
  readonly updatedAtMs?: number
}

export interface ItemRow {
  readonly threadId: string
  readonly turnId?: string
  readonly itemId: string
  readonly ordinal: number
  readonly createdAtMs?: number
  readonly type: string
  readonly json: string
}

export interface CursorRow {
  readonly threadId: string
  readonly ordinal: number
  readonly byteOffset: number
}

export interface RealtimeRow {
  readonly threadId: string
  readonly itemId: string
  readonly ordinal: number
  readonly createdAtMs?: number
  readonly type: string
  readonly json: string
}

export interface ArchiveFixture {
  readonly home: string
  readonly threads: readonly ThreadRow[]
  readonly items?: readonly ItemRow[]
  readonly cursors?: readonly CursorRow[]
  readonly realtime?: readonly RealtimeRow[]
  /** Recorded in `_sqlx_migrations`, which this feature reads as telemetry. */
  readonly versions?: { readonly state: number; readonly history: number }
}

/** A fresh directory nothing else in the suite is using. */
export function temporaryHome(): string {
  return mkdtempSync(join(tmpdir(), 'mochi-codex-'))
}

/** The text a `userMessage` item carries, in Codex's own encoding. */
export function userMessageJson(text: string): string {
  return JSON.stringify({ type: 'userMessage', id: 'x', content: [{ type: 'text', text }] })
}

/** The text an `agentMessage` item carries, in Codex's own encoding. */
export function agentMessageJson(text: string): string {
  return JSON.stringify({ type: 'agentMessage', id: 'x', text })
}

/**
 * Write a whole fake `$CODEX_HOME`, and hand back where it is.
 *
 * The directory is a real one on disk because the thing under test opens real
 * SQLite files: `readOnly` behaviour, the write-ahead log and the `-shm` are
 * all properties of the filesystem, and none of them can be faked.
 */
export function writeArchive(fixture: ArchiveFixture): string {
  mkdirSync(fixture.home, { recursive: true })
  const versions = fixture.versions ?? { state: 51, history: 6 }

  const state = new DatabaseSync(join(fixture.home, STATE_FILE))
  try {
    /*
      WAL, because half the assertions in this suite are about it.

      Codex's own databases run in WAL mode — that is what makes `immutable=1`
      return stale rows, and what makes a read CREATE a `-shm` beside the file.
      Without this the fixtures were in `delete` mode, so no read ever produced
      a `-shm`, and the test that infers "nothing opened this file" from the
      absence of one had no positive control: it would have passed just as well
      if the file HAD been opened.
    */
    state.exec('PRAGMA journal_mode = WAL')
    state.exec(STATE_DDL)
    /*
      ONE TRANSACTION, and it is not a tidiness point.

      Without it SQLite commits — and fsyncs — once per row. Measured: the
      budget fixture's 9,300 threads took **16.5 seconds** to write that way and
      **1.3 seconds** inside one transaction, so the file that exists to measure
      the warm path was spending twelve times its own runtime being built.
    */
    state.exec('BEGIN')
    const insert = state.prepare(
      `INSERT INTO threads
         (id, title, first_user_message, preview, cwd, source, thread_source,
          created_at_ms, updated_at_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    for (const thread of fixture.threads) {
      insert.run(
        thread.id,
        thread.title ?? '',
        thread.firstUserMessage ?? '',
        thread.preview ?? '',
        thread.cwd ?? '',
        thread.source ?? 'cli',
        thread.threadSource ?? null,
        thread.createdAtMs ?? 1_700_000_000_000,
        thread.updatedAtMs ?? 1_700_000_000_000,
      )
    }
    state.prepare('INSERT INTO _sqlx_migrations (version) VALUES (?)').run(versions.state)
    state.exec('COMMIT')
  } finally {
    state.close()
  }

  const history = new DatabaseSync(join(fixture.home, HISTORY_FILE))
  try {
    history.exec('PRAGMA journal_mode = WAL')
    history.exec(HISTORY_DDL)
    history.exec('BEGIN')
    const item = history.prepare(
      `INSERT INTO thread_items
         (thread_id, turn_id, item_id, rollout_ordinal, created_at_ms, item_json, item_type)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    for (const row of fixture.items ?? []) {
      item.run(
        row.threadId,
        row.turnId ?? 't1',
        row.itemId,
        row.ordinal,
        row.createdAtMs ?? 1_700_000_000_000,
        row.json,
        row.type,
      )
    }
    const cursor = history.prepare(
      `INSERT INTO thread_history_projection_state
         (thread_id, next_rollout_byte_offset, next_rollout_ordinal)
       VALUES (?, ?, ?)`,
    )
    for (const row of fixture.cursors ?? []) cursor.run(row.threadId, row.byteOffset, row.ordinal)
    const realtime = history.prepare(
      `INSERT INTO thread_realtime_items
         (thread_id, item_id, rollout_ordinal, created_at_ms, item_type, item_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    for (const row of fixture.realtime ?? []) {
      realtime.run(
        row.threadId,
        row.itemId,
        row.ordinal,
        row.createdAtMs ?? 1_700_000_000_000,
        row.type,
        row.json,
      )
    }
    history.prepare('INSERT INTO _sqlx_migrations (version) VALUES (?)').run(versions.history)
    history.exec('COMMIT')
  } finally {
    history.close()
  }

  return fixture.home
}

/**
 * Cursors that say every listed thread is fully projected.
 *
 * The ordinary case, and writing it out per test was three lines of noise
 * around the one thing a case was about. Ahead of the highest item ordinal,
 * because Codex's own cursor is strictly ahead in all 1,695 threads measured.
 */
export function cursorsFor(items: readonly ItemRow[]): readonly CursorRow[] {
  const byThread = new Map<string, { ordinal: number; bytes: number }>()
  for (const item of items) {
    const held = byThread.get(item.threadId) ?? { ordinal: 0, bytes: 0 }
    byThread.set(item.threadId, {
      ordinal: Math.max(held.ordinal, item.ordinal + 1),
      bytes: held.bytes + item.json.length,
    })
  }
  return [...byThread].map(([threadId, held]) => ({
    threadId,
    ordinal: held.ordinal,
    byteOffset: held.bytes,
  }))
}
