import { DatabaseSync } from 'node:sqlite'
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Whether the two files in `$CODEX_HOME` are ones this build knows how to read,
 * before a byte of them is read as conversation.
 *
 * ## What this proves, and what it does not
 *
 * It proves **compatibility**, not authorship. A hand-made database with the
 * right filenames, tables and column types passes — nothing here can establish
 * that OpenAI wrote a file, and an earlier version of this comment said it
 * could. The trust boundary is `$CODEX_HOME` itself: a directory only this user
 * can write. What the check adds on top of that boundary is the thing the
 * boundary cannot give — that a file which IS there is shaped the way this code
 * reads it.
 *
 * That distinction is not pedantry. `~/.codex` demonstrably holds third-party
 * databases (see below), so "it is in the directory" is not enough, and "it is
 * therefore Codex's" would be a claim this code cannot support.
 *
 * ## Why anything reads this rather than trusting the directory
 *
 * `~/.codex` is not exclusively OpenAI's. On the machine this was measured on
 * it also holds an 829 MB `.cccmemory.db`, a `.codex-conversations-memory.db`,
 * a watcher log and a dozen config backups — none of them Codex's — and there
 * is **no naming convention separating official artifacts from third-party
 * ones**. A reader that trusts the directory is a reader that will one day
 * parse somebody else's schema and report the result as your conversation
 * history.
 *
 * ## The pin is the SHAPE, not the version number
 *
 * The obvious guard is `select max(version) from _sqlx_migrations` against a
 * known-good number. It was written that way and it was wrong in both
 * directions at once:
 *
 * - **It refuses a compatible Codex.** Upstream already carries 52 migrations
 *   where this machine has 51, and number 52 is one additive index on a table
 *   this feature never reads. A version pin would have refused a current Codex
 *   on the day it shipped.
 * - **It accepts a fabricated file.** A hand-made database containing nothing
 *   but a `_sqlx_migrations` table with the right integer in it passes.
 *
 * So the guard asks the only question that is both necessary and sufficient:
 * **does every column this feature actually reads exist, with the type it is
 * read as.** That is immune to additive migrations, unfooled by fabricated
 * metadata, and it also catches a half-applied migration whatever wrote it.
 * The migration counter is still read — as TELEMETRY, so a log line can say
 * which Codex this was — and it never decides anything.
 *
 * ## The generation integer is a separate hazard
 *
 * `state_5` and `thread_history_1` are compile-time constants in Codex's
 * source and the trailing integer is a schema GENERATION, bumped by hand. The
 * first version of this accepted `state_5.sqlite` whenever it existed and
 * never looked beside it — so if Codex bumps to `state_6` and leaves the old
 * file behind, Mochi would serve stale history for ever and the tripwire this
 * module exists to be would never fire. Hence the glob: a higher generation
 * sitting next to the known one is `unavailable` with its own reason.
 */

/** The two filenames, which are compile-time constants in Codex's own source. */
export const STATE_FILE = 'state_5.sqlite'
export const HISTORY_FILE = 'thread_history_1.sqlite'

/**
 * The generation each filename's trailing integer is pinned to.
 *
 * ONE exported constant with the measurement date beside it, so bumping it is
 * a deliberate edit somebody can review rather than a number that drifts.
 * Measured 2026-08-31 against Codex CLI 0.151.0.
 */
export const KNOWN_GENERATIONS = { state: 5, history: 1 } as const

/** What a generation glob looks for. See `newerGeneration`. */
const GENERATION = {
  state: /^state_(\d+)\.sqlite$/,
  history: /^thread_history_(\d+)\.sqlite$/,
} as const

/**
 * The migration counters measured on 2026-08-31, kept as TELEMETRY.
 *
 * Recorded so a log line can say which Codex produced an answer. Deliberately
 * not a gate — see this module's header for the two ways gating on it failed.
 */
export const MEASURED_VERSIONS = { state: 51, history: 6 } as const

/** Which of the two files a table lives in. */
export type Source = 'state' | 'history'

export interface RequiredTable {
  readonly table: string
  readonly source: Source
  /**
   * Absent is acceptable, but present-and-wrong is not.
   *
   * `thread_realtime_items` arrived in a migration and a Codex older than it
   * simply has no such table — which is not a reason to refuse the archive,
   * because the older `realtime_delegation` encoding in `threads` is the live
   * path anyway. A table that IS there and has the wrong columns is a
   * different claim, and that one is refused.
   */
  readonly optional?: true
  /** Column name to the affinity `pragma_table_info` must report. */
  readonly columns: Readonly<Record<string, 'TEXT' | 'INTEGER'>>
}

/**
 * Every table and column any read path touches, in one place.
 *
 * ## Why the reader builds its SELECTs from this
 *
 * The first draft listed the columns of the plan as first written, and the
 * amendments then added three more reads — `threads.source`,
 * `thread_items.rollout_ordinal` and the whole
 * `thread_history_projection_state` table — that it never validated. A guard
 * that passes and then fails on the first refresh is worse than one that
 * refuses up front, because the failure has moved to the path nobody is
 * watching.
 *
 * `read.ts` composes its column lists out of this object rather than typing
 * them a second time, so the guard and the queries cannot disagree. Adding a
 * column to a query means adding it here, which means it is checked.
 */
export const REQUIRED_SHAPE: readonly RequiredTable[] = [
  {
    table: 'threads',
    source: 'state',
    columns: {
      id: 'TEXT',
      title: 'TEXT',
      first_user_message: 'TEXT',
      preview: 'TEXT',
      cwd: 'TEXT',
      source: 'TEXT',
      thread_source: 'TEXT',
      created_at_ms: 'INTEGER',
      updated_at_ms: 'INTEGER',
    },
  },
  {
    table: 'thread_items',
    source: 'history',
    columns: {
      thread_id: 'TEXT',
      turn_id: 'TEXT',
      item_id: 'TEXT',
      item_type: 'TEXT',
      rollout_ordinal: 'INTEGER',
      /*
        READ BY THE PROBE, and it was missing from this list.

        `ITEM_PROBE_SQL` aggregates it on every refresh. A database without the
        column passed this guard and then failed on the first refresh — which is
        the worse of the two places to fail, because the guard's whole promise is
        that it fails up front.
      */
      updated_at_ordinal: 'INTEGER',
      created_at_ms: 'INTEGER',
      item_json: 'TEXT',
    },
  },
  {
    table: 'thread_history_projection_state',
    source: 'history',
    columns: {
      thread_id: 'TEXT',
      next_rollout_byte_offset: 'INTEGER',
      next_rollout_ordinal: 'INTEGER',
    },
  },
  {
    table: 'thread_realtime_items',
    source: 'history',
    optional: true,
    columns: {
      thread_id: 'TEXT',
      item_id: 'TEXT',
      item_type: 'TEXT',
      rollout_ordinal: 'INTEGER',
      created_at_ms: 'INTEGER',
      item_json: 'TEXT',
    },
  },
]

/** The columns of one required table, in declaration order. For `read.ts`. */
export function columnsOf(table: string): readonly string[] {
  const found = REQUIRED_SHAPE.find((one) => one.table === table)
  if (found === undefined) throw new Error(`no required shape is declared for ${table}`)
  return Object.keys(found.columns)
}

/**
 * Why the archive is not available, as a word rather than a sentence.
 *
 * FIVE, and the distinctions are the point: "Codex moved" and "no results" are
 * different things for a log to say, and only one of them is somebody's cue to
 * come and look. `memory/answer.ts` draws the same line one layer up.
 */
export type AbsentReason =
  /** `$CODEX_HOME` is not a directory, so there is nothing to look in. */
  | 'home'
  /** One of the two files is not there. Never "nothing found". */
  | 'absent'
  /** A higher generation sits beside the known one. Codex moved. */
  | 'generation'
  /** A column this feature reads is missing or has changed type. */
  | 'schema'
  /** Corrupt, locked, or otherwise refused. Codex treats these as disposable. */
  | 'unreadable'

export interface ArchivePresent {
  readonly kind: 'present'
  readonly statePath: string
  readonly historyPath: string
  /** Whether `thread_realtime_items` exists here. See `RequiredTable.optional`. */
  readonly realtimeItems: boolean
  /** Telemetry, never a gate. Null when `_sqlx_migrations` could not be read. */
  readonly versions: { readonly state: number | null; readonly history: number | null }
}

export interface ArchiveAbsent {
  readonly kind: 'unavailable'
  readonly reason: AbsentReason
  /** For a log line, never for her. Names the file or column that decided it. */
  readonly detail: string
}

export type ArchivePresence = ArchivePresent | ArchiveAbsent

/**
 * Open one of Codex's files for reading, and nothing else.
 *
 * ## Two options, and both of them are load-bearing
 *
 * **`readOnly: true`** maps to `SQLITE_OPEN_READONLY`, which is what stops this
 * process writing another application's database. It does NOT stop SQLite
 * creating the WAL shared-memory index beside it — a `-shm` appears where none
 * was, which the README says out loud rather than claiming we touch nothing.
 *
 * **`timeout`** because `node:sqlite` defaults `busy_timeout` to **zero**:
 * measured, `{readOnly:true}` reports `{"timeout":0}`. Zero means the first
 * contended read against a live Codex fails instantly, and a running Codex is
 * the ordinary case. The archive would report itself unavailable at random.
 *
 * ## And `immutable` is never passed, which is the whole of `wal-visible.test.ts`
 *
 * The natural instinct for reading somebody else's live database is
 * `immutable=1`, which tells SQLite the file cannot change — so it skips the
 * write-ahead log entirely and returns a stale snapshot. Measured: 9,322 rows
 * against 9,323, and the missing one is the NEWEST conversation, which is the
 * one a person is most likely to ask about. Fast, green and wrong.
 *
 * The fix is one word; the assertion is the artifact. A comment saying "do not
 * use immutable" is worth nothing the day somebody optimises this file.
 */
export const BUSY_TIMEOUT_MS = 5_000

/**
 * What the CALL PATH waits, which is not what the background builder waits.
 *
 * The timeout above is right for a build: Codex holding a write lock for a
 * second is ordinary, and a background job can afford to wait it out. It is
 * wrong for a capability call, because `node:sqlite` is synchronous and that
 * call is on Electron's main thread — five seconds of waiting is five seconds
 * in which her window does not redraw and nothing she says is processed.
 *
 * A quarter of a second is long enough to ride out the contention that actually
 * happens and short enough that the worst case is a pause rather than a freeze.
 * Past it she says she could not look, which is true and is already one of the
 * three answers she has.
 */
export const CALL_PATH_TIMEOUT_MS = 250

export function openReadOnly(path: string, timeoutMs: number = BUSY_TIMEOUT_MS): DatabaseSync {
  return new DatabaseSync(path, { readOnly: true, timeout: timeoutMs })
}

/** `CODEX_HOME` if set, else `~/.codex`. The same rule Codex itself follows. */
export function codexArchiveHome(env: NodeJS.ProcessEnv, home: string): string {
  const configured = env['CODEX_HOME']
  return configured !== undefined && configured !== '' ? configured : join(home, '.codex')
}

/**
 * A sibling file whose generation is higher than the one we know, or null.
 *
 * The tripwire the plan promised. Without it, a Codex that bumps to `state_6`
 * and leaves `state_5` behind would leave Mochi serving history that stopped
 * growing, silently, for ever — and "silently for ever" is the failure this
 * whole module is arranged against.
 *
 * Only HIGHER counts. A lower one is an old file Codex has already migrated
 * off and is not evidence of anything.
 */
function newerGeneration(entries: readonly string[], which: Source): string | null {
  const pattern = GENERATION[which]
  const known = KNOWN_GENERATIONS[which]
  for (const name of entries) {
    const match = pattern.exec(name)
    if (match === null) continue
    const generation = Number(match[1])
    if (Number.isFinite(generation) && generation > known) return name
  }
  return null
}

/** Whether a table exists at all, asked before its columns are. */
function hasTable(db: DatabaseSync, table: string): boolean {
  const found = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table)
  return found !== undefined
}

/**
 * The declared affinity of every column of one table.
 *
 * `pragma_table_info` rather than parsing the DDL: the DDL of `threads` on a
 * real machine is one `CREATE TABLE` with twenty `ALTER TABLE ... ADD COLUMN`
 * results glued onto the end of it, and a reader that tried to parse that
 * would be checking its own regular expression rather than the database.
 */
function affinities(db: DatabaseSync, table: string): ReadonlyMap<string, string> {
  const found = new Map<string, string>()
  for (const row of db.prepare(`SELECT name, type FROM pragma_table_info(?)`).all(table)) {
    found.set(String(row['name']), String(row['type']).toUpperCase())
  }
  return found
}

/**
 * Whether a declared type is the one we read the column as.
 *
 * SQLite's declared types are advisory and its own rules for turning one into
 * an affinity are the thing to follow rather than a string comparison: a column
 * declared `BIGINT` has INTEGER affinity, and refusing it would be this guard
 * inventing an incompatibility. So the test is the documented rule — "INT"
 * anywhere means integer; "CHAR", "CLOB" or "TEXT" means text — narrowed to the
 * two kinds this feature actually reads.
 */
function affinityMatches(declared: string, wanted: 'TEXT' | 'INTEGER'): boolean {
  if (wanted === 'INTEGER') return declared.includes('INT')
  return declared.includes('CHAR') || declared.includes('CLOB') || declared.includes('TEXT')
}

/** `max(version)` from `_sqlx_migrations`, or null. Telemetry. See the header. */
function migrationVersion(db: DatabaseSync): number | null {
  try {
    const row = db.prepare('SELECT max(version) AS version FROM _sqlx_migrations').get() as
      { version?: unknown } | undefined
    const version = row?.version
    return typeof version === 'number' ? version : null
  } catch {
    // A missing or unreadable migration table is not a refusal. The shape check
    // above is what decides whether this file can be read, and it has already
    // run against the tables that matter.
    return null
  }
}

interface Checked {
  readonly problem: ArchiveAbsent | null
  readonly realtimeItems: boolean
}

/** Every required table in one database, checked against `REQUIRED_SHAPE`. */
function checkShape(db: DatabaseSync, source: Source): Checked {
  let realtimeItems = false
  for (const required of REQUIRED_SHAPE) {
    if (required.source !== source) continue
    if (!hasTable(db, required.table)) {
      if (required.optional === true) continue
      return {
        problem: {
          kind: 'unavailable',
          reason: 'schema',
          detail: `${required.table} is not in this database`,
        },
        realtimeItems,
      }
    }
    if (required.table === 'thread_realtime_items') realtimeItems = true
    const declared = affinities(db, required.table)
    for (const [column, wanted] of Object.entries(required.columns)) {
      const held = declared.get(column)
      if (held === undefined) {
        return {
          problem: {
            kind: 'unavailable',
            reason: 'schema',
            detail: `${required.table}.${column} is missing`,
          },
          realtimeItems,
        }
      }
      if (!affinityMatches(held, wanted)) {
        return {
          problem: {
            kind: 'unavailable',
            reason: 'schema',
            detail: `${required.table}.${column} is declared ${held}, not ${wanted}`,
          },
          realtimeItems,
        }
      }
    }
  }
  return { problem: null, realtimeItems }
}

/**
 * Is Codex's archive here, and is it the one we know how to read?
 *
 * Opens both files, because a shape check that did not open them would be a
 * check on filenames. They are closed again before this returns: nothing holds
 * a handle on somebody else's database for longer than the question takes.
 *
 * Every path out is a value. A corrupt database is an ANSWER here — Codex
 * exports `is_sqlite_corruption_error` and rebuilds this projection from
 * rollouts, so an unreadable archive is an ordinary state of the world rather
 * than an exception for this process to take personally.
 */
export function archiveAt(home: string): ArchivePresence {
  let entries: readonly string[]
  try {
    if (!statSync(home).isDirectory()) {
      return { kind: 'unavailable', reason: 'home', detail: `${home} is not a directory` }
    }
    entries = readdirSync(home)
  } catch (error: unknown) {
    return {
      kind: 'unavailable',
      reason: 'home',
      detail: `${home} could not be read: ${String(error)}`,
    }
  }

  for (const which of ['state', 'history'] as const) {
    const newer = newerGeneration(entries, which)
    if (newer !== null) {
      return {
        kind: 'unavailable',
        reason: 'generation',
        detail: `${newer} is a newer generation than this build knows how to read`,
      }
    }
  }

  const statePath = join(home, STATE_FILE)
  const historyPath = join(home, HISTORY_FILE)
  for (const [name, path] of [
    [STATE_FILE, statePath],
    [HISTORY_FILE, historyPath],
  ] as const) {
    // BOTH files, by exact name. A missing one is `unavailable` and never
    // "nothing found": half an archive answers half the questions and says
    // nothing about the other half.
    try {
      if (!statSync(path).isFile()) {
        return { kind: 'unavailable', reason: 'absent', detail: `${name} is not a regular file` }
      }
    } catch {
      return { kind: 'unavailable', reason: 'absent', detail: `${name} is not in ${home}` }
    }
  }

  let state: DatabaseSync | null = null
  let history: DatabaseSync | null = null
  try {
    state = openReadOnly(statePath)
    history = openReadOnly(historyPath)
    const inState = checkShape(state, 'state')
    if (inState.problem !== null) return inState.problem
    const inHistory = checkShape(history, 'history')
    if (inHistory.problem !== null) return inHistory.problem
    return {
      kind: 'present',
      statePath,
      historyPath,
      realtimeItems: inHistory.realtimeItems,
      versions: { state: migrationVersion(state), history: migrationVersion(history) },
    }
  } catch (error: unknown) {
    return { kind: 'unavailable', reason: 'unreadable', detail: String(error) }
  } finally {
    // `node:sqlite` is a file handle. Both are closed on every path, including
    // the one where the second open is what threw.
    closeQuietly(state)
    closeQuietly(history)
  }
}

/** Close a handle that may already be unusable, without hiding the real error. */
function closeQuietly(db: DatabaseSync | null): void {
  if (db === null) return
  try {
    db.close()
  } catch {
    // Already gone. There is nothing useful to say about failing to close a
    // handle whose database is the thing that failed.
  }
}
