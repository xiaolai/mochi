import type { DatabaseSync } from 'node:sqlite'

import {
  archiveAt,
  columnsOf,
  openReadOnly,
  type AbsentReason,
  type ArchivePresent,
} from './present'

/**
 * The one module that reads Codex's two databases, and the only one that
 * knows they are SQLite.
 *
 * It answers two questions and nothing else: **which threads exist** and
 * **what was said in them**. Everything above it — segmentation, the index,
 * the payload — deals in the shapes declared here and never in a row.
 *
 * ## Every read is short, and that is a promise to Codex rather than to us
 *
 * A long read holds a WAL snapshot open, and a held snapshot can stop Codex
 * truncating its own write-ahead log — so a companion that sits open all day
 * would make somebody else's database grow. Nothing here opens a transaction
 * that outlives one statement: every query materialises its rows and returns,
 * the reconciliation runs per thread rather than as one pass over 9,349, and
 * `wal-visible.test.ts` proves a `wal_checkpoint(TRUNCATE)` still completes
 * while this reader is open and idle.
 *
 * ## What is NOT read, and why the exclusion is at the query
 *
 * `commandExecution` is 22,473 rows and **408 MB** — 95% of the file — and it
 * is where credential material lives: shell output, environment dumps, `.env`
 * reads, token echoes. It is excluded in the `WHERE`, not filtered afterwards,
 * so those pages are never read into this process at all. Measured, a key-shaped
 * string appears once in the corpus this does read and sixteen times in the
 * one it does not. `reasoning` is excluded too, as opaque blobs, and the rollout
 * JSONL (5.1 GB) is never opened: it is the ground truth `thread_items` is
 * projected from, and re-implementing that projection to obtain 9 MB Codex has
 * already extracted would be work in exchange for nothing.
 *
 * ## The columns come from `REQUIRED_SHAPE`
 *
 * Not typed out again here. The guard checks that list against
 * `pragma_table_info` before anything reaches this file, so a column added to a
 * query without being added to the shape is impossible: the query is BUILT from
 * the shape.
 */

/** The two item types that are speech. Everything else is excluded at the query. */
export const SPOKEN_ITEM_TYPES = ['userMessage', 'agentMessage'] as const

/**
 * Whose line it was, as this feature can honestly claim it.
 *
 * THREE, and the third is not a placeholder. `recall_conversations` has two —
 * her and the person — because both are present in every row of her own
 * archive. Here there are three parties and one of them is a tool:
 *
 * - `them` — the person. The same person she talks to.
 * - `codex` — Codex. Not her, and saying "you said" of it would put a tool's
 *   words in the person's mouth.
 * - `unknown` — genuinely not attributable. A `realtime_delegation` fragment
 *   with no speaker label, a sub-agent's opening message, a realtime item whose
 *   encoding we do not know. She attributes these as "somewhere in that
 *   conversation" rather than to a person, which is the whole reason the value
 *   exists rather than defaulting to `them`.
 */
export type CodexSpeaker = 'them' | 'codex' | 'unknown'

/**
 * The values of `threads.source` that name a human-started thread.
 *
 * Measured on this machine: `exec` 4,691 · `mcp` 3,319 · `cli` 189 ·
 * `vscode` 140, plus about sixty rows whose `source` is a **JSON blob**
 * describing a sub-agent spawn (`{"subagent":{"thread_spawn":{…}}}`).
 *
 * The blob is not parsed and this is not an enum check that can fail. It is the
 * one question worth asking of that column: **was there a person at the other
 * end of this?** A sub-agent's opening message was written by another agent, so
 * attributing it to the person would be exactly the misattribution the whole
 * `who` field exists to prevent. Anything not on this list is `unknown`.
 */
const HUMAN_SOURCES: ReadonlySet<string> = new Set(['exec', 'mcp', 'cli', 'vscode'])

/** One thread's identity, cheap enough to ask for all of them on every refresh. */
export interface HeaderFingerprint {
  readonly id: string
  readonly updatedAtMs: number
  /** `length(first_user_message) + length(preview) + length(title)`. */
  readonly textLength: number
}

/** One thread's header, read only when its fingerprint has moved. */
export interface HeaderRow {
  readonly id: string
  readonly title: string
  readonly firstUserMessage: string
  readonly preview: string
  readonly cwd: string
  readonly source: string
  readonly threadSource: string | null
  readonly createdAtMs: number
  readonly updatedAtMs: number
}

/**
 * How far Codex has projected one thread, plus what that projection weighs.
 *
 * The first two are Codex's own cursor, maintained by the process that does the
 * projecting; the second two are an index-only aggregate over the projected
 * rows. Together they are what decides whether a thread is re-read.
 */
export interface ThreadState {
  readonly threadId: string
  /**
   * Null when the thread has projected rows but NO CURSOR ROW.
   *
   * That is Codex's deletion signal rather than a missing value: its own
   * trigger treats a row leaving `thread_history_projection_state` as the end
   * of the thread's projected life and cascades it to `thread_realtime_items`.
   * A mirror that read the leftover `thread_items` anyway would go on recalling
   * turns Codex has finished with, which is exactly the shape
   * `store/forgetting.ts` names.
   */
  readonly nextOrdinal: number | null
  readonly nextByteOffset: number | null
  /** Null when the thread has a cursor and nothing projected yet. */
  readonly items: number | null
  /** `sum(updated_at_ordinal)`, which moves when any row is re-projected. */
  readonly updatedSum: number | null
  /**
   * How many realtime rows the thread has, where they sit, and what they weigh.
   *
   * A SEPARATE fingerprint because `thread_realtime_items` is a separate table
   * with no cursor of its own: a row appended, edited or deleted there moves
   * neither Codex's projection cursor nor anything in `thread_items`, so
   * without this a realtime change would never make a thread stale and could
   * stay missing — or stay searchable after deletion — indefinitely.
   *
   * Cheap because the table is small: it is empty on the measured machine, and
   * its whole point is that it is a per-thread projection rather than a log.
   */
  readonly realtime: number | null
  readonly realtimeOrdinals: number | null
  readonly realtimeBytes: number | null
}

/** One projected message, with its text already out of the JSON. */
export interface SpokenRow {
  readonly threadId: string
  readonly turnId: string
  readonly itemId: string
  readonly ordinal: number
  readonly createdAtMs: number
  readonly who: CodexSpeaker
  readonly text: string
}

export interface CodexSource {
  /** Which files this is reading, and which Codex wrote them. Telemetry. */
  readonly presence: ArchivePresent
  /** `(id, updated_at_ms, text length)` for every thread. See `HEADER_PROBE_SQL`. */
  fingerprints(): readonly HeaderFingerprint[]
  /** The full header of the named threads, in one bounded slice. */
  headers(ids: readonly string[]): readonly HeaderRow[]
  /** Codex's cursor and the projected weight, per thread. */
  threadStates(): readonly ThreadState[]
  /** What was said in one thread, through `idx_thread_items_page`. */
  spokenIn(threadId: string): readonly SpokenRow[]
  /** The realtime projection for one thread, where the table exists. */
  realtimeIn(threadId: string): readonly SpokenRow[]
  close(): void
}

export type OpenedSource =
  | { readonly kind: 'open'; readonly source: CodexSource }
  | { readonly kind: 'unavailable'; readonly reason: AbsentReason; readonly detail: string }

/**
 * The fingerprint probe: one pass over a small table, one length per row.
 *
 * A refresh does NOT re-read 9,349 headers. That was the rule for one round of
 * review and it was evidenced by the wrong measurement — 139 ms against a
 * 150 ms budget, leaving nothing for the index write. Reading the fingerprint
 * instead and pulling text only for threads whose fingerprint moved is 29 ms,
 * which leaves real headroom.
 *
 * ## Why the extra two lengths are conditional rather than always
 *
 * The canonical text is `first_user_message`, falling back to `preview` and
 * then to `title` when it is empty — so a fingerprint over the first column
 * alone would not move when the text actually indexed changed. The obvious fix
 * is to add all three lengths unconditionally, and it was written that way and
 * measured: **three lengths cost three times one**, because `length()` on TEXT
 * walks the string and these columns hold up to 148,357 characters each.
 *
 * The `CASE` costs nothing and closes the same hole: `preview` and `title` are
 * measured only for the rows where `first_user_message` is empty, which is 266
 * of 9,374 on the measured machine. Timed side by side on the live archive:
 * 278 ms for three lengths against **72 ms** for this.
 */
export const HEADER_PROBE_SQL = `
  SELECT id,
         coalesce(updated_at_ms, 0) AS updated_at_ms,
         length(first_user_message)
           + (CASE WHEN first_user_message = ''
                   THEN length(preview) + length(title) ELSE 0 END) AS text_length
    FROM threads
`

/**
 * Codex's own answer to "how far has this thread been projected".
 *
 * 1,695 rows against 66,602, maintained by the process that does the
 * projecting, and exactly one-to-one with the threads that have items. It is a
 * better cursor than anything this side could invent, and its DISAPPEARANCE is
 * the deletion signal: Codex's own trigger treats a dropped row here as the end
 * of that thread's projected life and cascades it to `thread_realtime_items`.
 */
const CURSOR_SQL = `
  SELECT thread_id, next_rollout_ordinal, next_rollout_byte_offset
    FROM thread_history_projection_state
`

/**
 * What the projected rows weigh, from an index and never from the table.
 *
 * ## Why this is not `sum(length(item_json))`
 *
 * The amendment that asked for a content fingerprint named that expression, on
 * the reasoning that it was "available from the same indexed scan". It is not:
 * `item_json` is in no index, so the aggregate has to visit every one of the
 * 66,602 rows and compute a length over 515 MB — including every
 * `commandExecution` page the whole design exists to avoid reading.
 *
 * **Measured on the live archive, warm cache:**
 *
 * | probe | time |
 * | --- | --- |
 * | `sum(length(item_json))` grouped by thread | **2,044 ms** |
 * | this, `count(*)` and `sum(updated_at_ordinal)` | **13 ms** |
 *
 * 2,044 ms is thirteen times the whole 150 ms warm budget, on a warm cache; on
 * a cold one it is the 5,202 ms full scan. So the amendment's INTENT — that a
 * same-cursor content replacement is still detected — is kept and its
 * expression is not.
 *
 * `updated_at_ordinal` is Codex's own marker for a row that has been
 * re-projected, and it carries two dedicated indexes because that is what Codex
 * uses it for. `count(*)` catches rows added or removed inside an unchanged
 * cursor range; `sum(...)` catches any individual row being re-projected. Both
 * come out of `idx_thread_items_updated_page` without the table being touched —
 * the plan is a COVERING INDEX scan, which reads none of the pages
 * `SCAN thread_items` was forbidden for.
 *
 * What it still cannot see is an in-place rewrite of `item_json` that changes
 * neither the row count nor any `updated_at_ordinal`. That is stated rather
 * than papered over: it would be Codex updating a row without marking it
 * updated, and paying five seconds of I/O on every refresh to insure against it
 * is not a trade this feature can make.
 */
export const ITEM_PROBE_SQL = `
  SELECT thread_id, count(*) AS items, sum(updated_at_ordinal) AS updated_sum
    FROM thread_items
   GROUP BY thread_id
`

/**
 * What the realtime projection holds, per thread.
 *
 * Guarded by `presence.realtimeItems` at the call site, because the table
 * arrived in a migration and an older Codex does not have it. Aggregated the
 * same way the item probe is, and for the same reason: comparing two numbers
 * per thread is what makes a refresh a comparison rather than a re-read.
 *
 * ## Why this one CAN afford `length(item_json)` and the other cannot
 *
 * The same expression was measured at **2,044 ms** over `thread_items` and
 * rejected, because that table is 66,602 rows and 515 MB of mostly command
 * output. This table is a per-thread projection of session markers — empty on
 * the measured machine, and small by construction wherever it is not. So the
 * content itself can go into the fingerprint here, which closes the case the
 * item probe has to leave open: a row rewritten in place, with the row count
 * and the ordinals unchanged.
 *
 * ## Three values, and they were briefly two
 *
 * The ordinals and the bytes were added together into one scalar, which is a way
 * of throwing information away: ordinal 1 with length 4 and ordinal 2 with
 * length 3 both come to 5, so a change that WAS visible could be cancelled by an
 * unrelated one. Dimensions that mean different things are compared separately.
 *
 * What it still cannot see is a rewrite that preserves the byte length exactly —
 * one character swapped for another. Stated rather than implied: this is a
 * fingerprint, not a hash, and the table it guards holds session markers rather
 * than prose.
 */
const REALTIME_PROBE_SQL = `
  SELECT thread_id,
         count(*) AS items,
         sum(rollout_ordinal) AS ordinal_sum,
         sum(length(item_json)) AS byte_sum
    FROM thread_realtime_items
   GROUP BY thread_id
`

/**
 * One thread's messages, driven by the index that exists.
 *
 * The obvious refresh — `WHERE item_type IN (…) AND created_at_ms > ?` — plans
 * as `SCAN thread_items` with a temporary B-tree for the ordering, because no
 * index begins with either column. That reads every command-output page the
 * exclusion was written to avoid, on every refresh.
 *
 * Keyed on `thread_id` instead, this plans as
 * `SEARCH thread_items USING INDEX idx_thread_items_page (thread_id=?)`, and
 * the item-type filter then applies to the handful of rows that index selects.
 * `read.test.ts` checks the plan rather than trusting this paragraph.
 */
export const ITEMS_SQL = `
  SELECT ${columnsOf('thread_items').join(', ')}
    FROM thread_items
   WHERE thread_id = ?
     AND item_type IN (${SPOKEN_ITEM_TYPES.map(() => '?').join(', ')})
   ORDER BY rollout_ordinal
`

/** The same read, for the newer realtime projection. See `realtimeIn`. */
const REALTIME_SQL = `
  SELECT ${columnsOf('thread_realtime_items').join(', ')}
    FROM thread_realtime_items
   WHERE thread_id = ?
   ORDER BY rollout_ordinal
`

/** The header read, for the threads a fingerprint says have moved. */
function headerSql(count: number): string {
  return `
    SELECT ${columnsOf('threads').join(', ')}
      FROM threads
     WHERE id IN (${Array.from({ length: count }, () => '?').join(', ')})
  `
}

/**
 * How many threads one header slice asks for.
 *
 * Bounded for the reason every read here is: a slice is one short statement
 * rather than one long one, so nothing holds a snapshot while 9,349 rows are
 * assembled. SQLite's own parameter limit is far higher; this is about the
 * duration of the read, not about what the parser will accept.
 */
const HEADER_SLICE = 200

/**
 * The text inside one `item_json`, whatever shape it is in.
 *
 * Two encodings, measured: `agentMessage` carries `text` directly, and
 * `userMessage` carries `content`, an array of `{type, text}` parts of which
 * only the `text` ones have anything to read — the others are local images.
 * Both are INLINE text rather than a reference to the rollout, which is what
 * makes indexing them possible at all.
 *
 * Anything else returns empty rather than throwing. The archive is somebody
 * else's, it is rebuilt from rollouts by design, and a row this does not
 * recognise is a row to skip rather than an exception to take personally.
 */
export function textOfItem(json: string): string {
  let held: unknown
  try {
    held = JSON.parse(json)
  } catch {
    return ''
  }
  if (typeof held !== 'object' || held === null) return ''
  const item = held as { text?: unknown; content?: unknown }
  if (typeof item.text === 'string') return item.text
  if (!Array.isArray(item.content)) return ''
  return item.content
    .map((part: unknown) => {
      if (typeof part !== 'object' || part === null) return ''
      const piece = part as { type?: unknown; text?: unknown }
      return piece.type === 'text' && typeof piece.text === 'string' ? piece.text : ''
    })
    .filter((text) => text !== '')
    .join('\n')
}

/** Whose line a projected item was, from its type alone. See `CodexSpeaker`. */
export function speakerOfItem(itemType: string): CodexSpeaker {
  if (itemType === 'userMessage') return 'them'
  if (itemType === 'agentMessage') return 'codex'
  // A realtime item, or a type this build does not know. Not attributable from
  // the type — `roleOfItem` is asked next, and `unknown` is what survives when
  // that has nothing to say either.
  return 'unknown'
}

/**
 * Whose line it was according to the row itself, or null.
 *
 * The realtime tables carry an explicit `role` on the shapes that have one, and
 * reading it is strictly better than the alternative: a transcript segment
 * attributed as `unknown` makes her say "somewhere in that conversation" about
 * a line whose speaker is written down two fields away.
 *
 * Null rather than `unknown` on purpose, so the caller can tell "this row does
 * not say" from "this row says nobody". Only the two values Codex uses are
 * accepted; anything else is not a speaker this build can name.
 */
function roleOfItem(json: string): CodexSpeaker | null {
  let held: unknown
  try {
    held = JSON.parse(json)
  } catch {
    return null
  }
  if (typeof held !== 'object' || held === null) return null
  const role = (held as { role?: unknown }).role
  if (role === 'user') return 'them'
  if (role === 'assistant') return 'codex'
  return null
}

/** Whether there was a person at the other end of this thread. See `HUMAN_SOURCES`. */
export function startedByAPerson(source: string): boolean {
  return HUMAN_SOURCES.has(source)
}

function toSpoken(row: Record<string, unknown>): SpokenRow {
  const itemType = String(row['item_type'])
  const json = String(row['item_json'])
  // The TYPE first, then the row's own `role`. `userMessage`/`agentMessage`
  // are unambiguous; everything else gets to speak for itself before falling
  // back to "nobody in particular".
  const byType = speakerOfItem(itemType)
  return {
    threadId: String(row['thread_id']),
    // `thread_realtime_items` has no turn, and its key is the pair. An empty
    // turn is what distinguishes it in the index's own key triple.
    turnId: typeof row['turn_id'] === 'string' ? row['turn_id'] : '',
    itemId: String(row['item_id']),
    ordinal: Number(row['rollout_ordinal']),
    createdAtMs: Number(row['created_at_ms']),
    who: byType === 'unknown' ? (roleOfItem(json) ?? 'unknown') : byType,
    text: textOfItem(json),
  }
}

/**
 * Open both files, or say why not.
 *
 * The guard runs first and its answer is the answer: nothing here re-decides
 * whether these files are Codex's. `Result`-shaped throughout, so *could not
 * open* and *opened and empty* stay different answers — the distinction
 * `memory/answer.ts` exists to protect, one layer down.
 */
export function openCodexSource(
  home: string,
  /** How long a contended read may wait. See `CALL_PATH_TIMEOUT_MS`. */
  timeoutMs?: number,
): OpenedSource {
  const presence = archiveAt(home)
  if (presence.kind === 'unavailable') {
    return { kind: 'unavailable', reason: presence.reason, detail: presence.detail }
  }

  let state: DatabaseSync | null = null
  let history: DatabaseSync | null = null
  try {
    state = openReadOnly(presence.statePath, timeoutMs)
    history = openReadOnly(presence.historyPath, timeoutMs)
  } catch (error: unknown) {
    closeQuietly(state)
    closeQuietly(history)
    return { kind: 'unavailable', reason: 'unreadable', detail: String(error) }
  }

  const openState = state
  const openHistory = history
  let closed = false

  const source: CodexSource = {
    presence,
    fingerprints() {
      return openState
        .prepare(HEADER_PROBE_SQL)
        .all()
        .map((row) => ({
          id: String(row['id']),
          updatedAtMs: Number(row['updated_at_ms']),
          textLength: Number(row['text_length']),
        }))
    },
    headers(ids) {
      const found: HeaderRow[] = []
      for (let at = 0; at < ids.length; at += HEADER_SLICE) {
        const slice = ids.slice(at, at + HEADER_SLICE)
        if (slice.length === 0) continue
        const rows = openState.prepare(headerSql(slice.length)).all(...slice)
        for (const row of rows) {
          found.push({
            id: String(row['id']),
            title: String(row['title'] ?? ''),
            firstUserMessage: String(row['first_user_message'] ?? ''),
            preview: String(row['preview'] ?? ''),
            cwd: String(row['cwd'] ?? ''),
            // A STRING, never parsed as an enum. About sixty rows on the
            // measured machine hold a JSON blob here, and a reader that
            // destructured it would throw on the ordinary case.
            source: String(row['source'] ?? ''),
            threadSource: typeof row['thread_source'] === 'string' ? row['thread_source'] : null,
            // NULLABLE in Codex's schema, and filled by a trigger. Zero rather
            // than NaN, so `elapsedWords` is handed a number either way.
            createdAtMs: Number(row['created_at_ms'] ?? 0),
            updatedAtMs: Number(row['updated_at_ms'] ?? 0),
          })
        }
      }
      return found
    },
    threadStates() {
      interface Held {
        ordinal: number | null
        bytes: number | null
        items: number | null
        updated: number | null
        realtime: number | null
        realtimeOrdinals: number | null
        realtimeBytes: number | null
      }
      const nothing: Held = {
        ordinal: null,
        bytes: null,
        items: null,
        updated: null,
        realtime: null,
        realtimeOrdinals: null,
        realtimeBytes: null,
      }
      const byThread = new Map<string, Held>()
      for (const row of openHistory.prepare(CURSOR_SQL).all()) {
        byThread.set(String(row['thread_id']), {
          ...nothing,
          ordinal: Number(row['next_rollout_ordinal']),
          bytes: Number(row['next_rollout_byte_offset']),
        })
      }
      for (const row of openHistory.prepare(ITEM_PROBE_SQL).all()) {
        const id = String(row['thread_id'])
        byThread.set(id, {
          ...(byThread.get(id) ?? nothing),
          items: Number(row['items']),
          updated: Number(row['updated_sum'] ?? 0),
        })
      }
      if (presence.realtimeItems) {
        for (const row of openHistory.prepare(REALTIME_PROBE_SQL).all()) {
          const id = String(row['thread_id'])
          byThread.set(id, {
            ...(byThread.get(id) ?? nothing),
            realtime: Number(row['items']),
            realtimeOrdinals: Number(row['ordinal_sum'] ?? 0),
            realtimeBytes: Number(row['byte_sum'] ?? 0),
          })
        }
      }
      return [...byThread].map(([threadId, held]) => ({
        threadId,
        nextOrdinal: held.ordinal,
        nextByteOffset: held.bytes,
        items: held.items,
        updatedSum: held.updated,
        realtime: held.realtime,
        realtimeOrdinals: held.realtimeOrdinals,
        realtimeBytes: held.realtimeBytes,
      }))
    },
    spokenIn(threadId) {
      return openHistory
        .prepare(ITEMS_SQL)
        .all(threadId, ...SPOKEN_ITEM_TYPES)
        .map(toSpoken)
    },
    realtimeIn(threadId) {
      // ABSENT is not "no voice history", which is the whole reason this is
      // asked separately. The older `realtime_delegation` encoding in
      // `threads.first_user_message` is the live path on the measured machine,
      // and this table is empty there — so a reader that concluded anything
      // from its emptiness would be wrong about the one conversation this
      // feature was built to find.
      if (!presence.realtimeItems) return []
      return openHistory.prepare(REALTIME_SQL).all(threadId).map(toSpoken)
    },
    close() {
      // IDEMPOTENT. A refresh closes its source in a `finally`, and a caller
      // that also closes on the way out would otherwise throw from the cleanup
      // path rather than from the thing that actually failed.
      if (closed) return
      closed = true
      closeQuietly(openState)
      closeQuietly(openHistory)
    },
  }
  return { kind: 'open', source }
}

function closeQuietly(db: DatabaseSync | null): void {
  if (db === null) return
  try {
    db.close()
  } catch {
    // Already gone. Nothing useful can be said about failing to close a handle
    // whose database is the thing that failed.
  }
}
