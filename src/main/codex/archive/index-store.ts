import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import { segment, toAnyQuery, toMatchQuery } from '../../store/segment'
import {
  headerFragments,
  itemFragment,
  placeOf,
  type Fragment,
  type FragmentKind,
} from './fragments'
import type { CodexSource, CodexSpeaker, HeaderFingerprint, ThreadState } from './read'

/**
 * Mochi's own searchable mirror of Codex's archive.
 *
 * ## Why a mirror rather than querying Codex directly
 *
 * Three reasons, in order. We must not write Codex's databases, so there is no
 * way to add an FTS table there. `segment.ts` is required for search to work in
 * this project's primary language at all, and it has to run on **both** sides of
 * the index — going in and coming out — which means the index has to be ours.
 * And a per-thread cursor lets a re-read be incremental instead of a 515 MB
 * scan.
 *
 * ## Why its own file and not a table in `transcripts.db`
 *
 * The plan named `store/schema.ts`. This is one file over instead, for a reason
 * that is about writers rather than tidiness:
 *
 * **SQLite serialises writers.** The cold build inserts tens of thousands of
 * rows and takes seconds; `transcripts.db` is on the path that records what
 * somebody is saying *right now*. Sharing a file would put a background mirror
 * of somebody else's archive in contention with the write that stores a live
 * turn, and the turn is the one that must not wait.
 *
 * Three more follow from it, and none of them would have been enough alone:
 * `transcripts.db` is filed per persona and this is app-level, so the rows
 * would be the only ones there with no `persona_id`; `forgetting.ts` governs
 * deletion in that file and this index has an entirely different lifetime —
 * it is derived data that is dropped whole when the grant goes; and
 * `buildTranscripts` is already a seven-hundred-line factory that its own
 * header complains about.
 *
 * The Decided table's requirement is met either way: this is **Mochi's own FTS5
 * table in Mochi's own `userData`**, and Codex's files stay a source.
 *
 * ## The index is RECONCILED, never appended
 *
 * `store/forgetting.ts` states the rule this inherits, in words that are exactly
 * as true across an application boundary:
 *
 * > an index row whose turn is gone is a search hit that cannot be opened,
 * > which reads as **her remembering something she was told to forget**.
 *
 * An append-only mirror reproduces that: delete a conversation in Codex, and
 * Mochi still recalls it — and can say it out loud. A timestamp high-water mark
 * cannot see a deletion at all, and could not be trusted anyway (536 timestamps
 * are shared by more than one row, and 16,355 rows are out of insertion-time
 * order). So every refresh compares what is held against what exists, and rows
 * with no source are removed in the same transaction that writes the new ones.
 */

export const CODEX_INDEX_DIR = 'codex-index'
export const CODEX_INDEX_FILE = 'index.db'

/** How many threads one refresh slice touches. See `refresh`. */
export const THREAD_SLICE = 200

export interface CodexHit {
  readonly threadId: string
  readonly at: number
  readonly who: CodexSpeaker
  readonly kind: FragmentKind
  /** The repository basename, or `''` when Codex recorded no directory. */
  readonly place: string
  readonly text: string
}

export interface RefreshOptions {
  /** How many stale threads this call may take. Default `THREAD_SLICE`. */
  readonly slice?: number
  /**
   * Whether the permission is STILL given, asked between every slice.
   *
   * Not a snapshot taken when the build was queued. Somebody who revokes the
   * grant while a cold build is running has said they do not want it, and a
   * builder that checked once would go on reading another application's archive
   * for several seconds after being told to stop.
   */
  readonly stillAllowed?: () => boolean
}

export interface RefreshReport {
  /** False when this call stopped early — more slices are owed. */
  readonly done: boolean
  /** True when the permission was withdrawn mid-refresh. */
  readonly halted: boolean
  readonly threadsRead: number
  readonly threadsRemoved: number
  readonly documents: number
}

/**
 * The read half, which is all a capability handler is given.
 *
 * Separated from `CodexIndex` so `CapabilityDeps` can name it without the
 * handler being handed `forget()` and `close()`. A capability that could empty
 * the index or close the connection is a capability with reach it has no reason
 * to have, and the narrow type is what says so.
 */
export interface CodexRecall {
  search(query: string, limit: number): readonly CodexHit[]
}

export interface CodexIndex extends CodexRecall {
  /**
   * Whether a complete pass has ever finished here.
   *
   * The readiness A-15 turns on. An index that is still building is
   * indistinguishable, to every layer that matters, from a grant not yet given
   * — so the capability is simply not offered until this is true, and no fourth
   * status is needed.
   */
  built(): boolean
  refresh(source: CodexSource, options?: RefreshOptions): RefreshReport
  /**
   * Everything borrowed, removed — and whether the bytes are actually gone.
   *
   * FALSE means the rows were deleted and the write-ahead log could not be
   * truncated, which is not the same as failure and is not the same as success:
   * the text is unreachable through this store and still recoverable from
   * `index.db-wal`. The caller decides what to do about it; what it may not do
   * is report a deletion that did not finish.
   */
  forget(): boolean
  close(): void
}

/**
 * The schema, which is three tables and one of them is virtual.
 *
 * `codex_thread` is the reconciliation state: the header fingerprint and the
 * item cursor, one row per thread, and the `place` every one of that thread's
 * documents is attributed with. Storing `place` here rather than on each
 * document is what stops a repository rename leaving half the index saying the
 * old name.
 *
 * `codex_doc` is keyed on `(thread_id, origin, turn_id, item_id)`.
 *
 * The last three are `thread_items`' own primary key rather than the pair the
 * plan first named: two valid rows sharing a `(thread_id, item_id)` with
 * different turns would collide, and one would be silently dropped.
 *
 * `origin` is in front of them because the documents come from **two sources**
 * and only one of them is `thread_items`. Header fragments are keyed
 * `header:0`, `header:1`… with an empty turn, and `thread_realtime_items` also
 * has no turn — so a realtime row whose `item_id` happened to be `header:0`
 * collided with a header fragment. Verified: it raises `UNIQUE constraint
 * failed`, which aborts the whole per-thread write, which aborts the build,
 * which leaves `built_at` NULL — so **one row in somebody's archive turned the
 * capability permanently off**, silently, with the tool simply never appearing.
 * Namespacing by source makes that unrepresentable rather than unlikely.
 *
 * `codex_doc_fts` holds the SEGMENTED copy and `codex_doc.text` the readable
 * one, the same split `turn_fts` makes: storing only the segmented form would
 * mean quoting somebody's words back with a space between every character.
 */
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS codex_thread (
    thread_id     TEXT PRIMARY KEY,
    place         TEXT    NOT NULL DEFAULT '',
    updated_at_ms INTEGER NOT NULL DEFAULT 0,
    text_length   INTEGER NOT NULL DEFAULT 0,
    next_ordinal  INTEGER,
    next_bytes    INTEGER,
    items         INTEGER,
    updated_sum   INTEGER,
    realtime           INTEGER,
    realtime_ordinals  INTEGER,
    realtime_bytes     INTEGER
  );

  CREATE TABLE IF NOT EXISTS codex_doc (
    id        INTEGER PRIMARY KEY,
    thread_id TEXT    NOT NULL REFERENCES codex_thread(thread_id) ON DELETE CASCADE,
    turn_id   TEXT    NOT NULL,
    item_id   TEXT    NOT NULL,
    origin    TEXT    NOT NULL,
    kind      TEXT    NOT NULL,
    who       TEXT    NOT NULL,
    at        INTEGER NOT NULL,
    text      TEXT    NOT NULL,
    UNIQUE (thread_id, origin, turn_id, item_id)
  );
  CREATE INDEX IF NOT EXISTS codex_doc_by_thread ON codex_doc (thread_id, origin);

  CREATE VIRTUAL TABLE IF NOT EXISTS codex_doc_fts USING fts5(body);

  CREATE TABLE IF NOT EXISTS codex_index_state (
    id       INTEGER PRIMARY KEY CHECK (id = 1),
    built_at INTEGER
  );
`

/** Whether a thread's header text has moved since it was indexed. */
function headerMoved(held: StoredThread | undefined, now: HeaderFingerprint): boolean {
  if (held === undefined) return true
  return held.updatedAtMs !== now.updatedAtMs || held.textLength !== now.textLength
}

/**
 * Whether a thread's projected rows have moved since they were indexed.
 *
 * SIX values, and each closes a case the others cannot see. The cursor pair is
 * Codex's own progress marker; `items` catches a row added or removed inside an
 * unchanged cursor range; `updatedSum` catches a row re-projected in place; and
 * the realtime pair exists because `thread_realtime_items` is a separate table
 * with no cursor at all — a row appended or deleted there moves nothing else,
 * so without it a realtime change would never make a thread stale.
 */
function itemsMoved(held: StoredThread | undefined, now: ThreadState | undefined): boolean {
  if (held === undefined) return now !== undefined
  return (
    held.nextOrdinal !== (now?.nextOrdinal ?? null) ||
    held.nextBytes !== (now?.nextByteOffset ?? null) ||
    held.items !== (now?.items ?? null) ||
    held.updatedSum !== (now?.updatedSum ?? null) ||
    held.realtime !== (now?.realtime ?? null) ||
    held.realtimeOrdinals !== (now?.realtimeOrdinals ?? null) ||
    held.realtimeBytes !== (now?.realtimeBytes ?? null)
  )
}

interface StoredThread {
  readonly updatedAtMs: number
  readonly textLength: number
  readonly nextOrdinal: number | null
  readonly nextBytes: number | null
  readonly items: number | null
  readonly updatedSum: number | null
  readonly realtime: number | null
  readonly realtimeOrdinals: number | null
  readonly realtimeBytes: number | null
}

function toNullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value)
}

export function openCodexIndex(userData: string): CodexIndex {
  const directory = join(userData, CODEX_INDEX_DIR)
  mkdirSync(directory, { recursive: true })
  const path = join(directory, CODEX_INDEX_FILE)
  const db = new DatabaseSync(path)
  /*
    EXCEPTION-SAFE FROM HERE, which `createTranscripts` learned the hard way.

    Everything below can throw — a pragma this filesystem refuses, an FTS5 build
    without the extension, a prepared statement against a schema that did not
    apply. Unguarded, the handle leaks and the file stays locked, so every later
    attempt fails too and the only symptom is a feature that never comes back.
  */
  try {
    return build(db)
  } catch (error: unknown) {
    try {
      db.close()
    } catch {
      // Already unusable. The original error is the one worth reporting.
    }
    throw error
  }
}

function build(db: DatabaseSync): CodexIndex {
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  /*
    The same promise `transcripts.db` makes, for text that is not even ours.

    This file holds a copy of somebody's Codex history. When the permission is
    withdrawn it is deleted, and "deleted" has to mean the bytes are gone rather
    than unlinked from a page — otherwise the switch in the settings window is
    not telling the truth, which is the one thing that panel exists to do.
  */
  db.exec('PRAGMA secure_delete = ON')
  /*
    NORMAL rather than FULL, and this is the one place the trade is free.

    Everything in this file is DERIVED: if a crash loses the last transaction,
    the next refresh finds the thread stale and reads it again. There is no
    original here to lose, so paying a full fsync per slice would buy durability
    for data whose source of truth is another application's database.
  */
  db.exec('PRAGMA synchronous = NORMAL')
  db.exec(SCHEMA)
  db.exec("INSERT INTO codex_doc_fts (codex_doc_fts, rank) VALUES ('secure-delete', 1)")
  db.exec('INSERT OR IGNORE INTO codex_index_state (id, built_at) VALUES (1, NULL)')

  const stmt = {
    threads: db.prepare('SELECT * FROM codex_thread'),
    upsertThread: db.prepare(
      `INSERT INTO codex_thread
         (thread_id, place, updated_at_ms, text_length, next_ordinal, next_bytes,
          items, updated_sum, realtime, realtime_ordinals, realtime_bytes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (thread_id) DO UPDATE SET
         place = excluded.place,
         updated_at_ms = excluded.updated_at_ms,
         text_length = excluded.text_length,
         next_ordinal = excluded.next_ordinal,
         next_bytes = excluded.next_bytes,
         items = excluded.items,
         updated_sum = excluded.updated_sum,
         realtime = excluded.realtime,
         realtime_ordinals = excluded.realtime_ordinals,
         realtime_bytes = excluded.realtime_bytes`,
    ),
    dropThread: db.prepare('DELETE FROM codex_thread WHERE thread_id = ?'),
    docIdsOf: db.prepare('SELECT id FROM codex_doc WHERE thread_id = ? AND origin = ?'),
    allDocIdsOf: db.prepare('SELECT id FROM codex_doc WHERE thread_id = ?'),
    dropDocsOf: db.prepare('DELETE FROM codex_doc WHERE thread_id = ? AND origin = ?'),
    dropAllDocsOf: db.prepare('DELETE FROM codex_doc WHERE thread_id = ?'),
    dropIndexed: db.prepare('DELETE FROM codex_doc_fts WHERE rowid = ?'),
    insertDoc: db.prepare(
      `INSERT INTO codex_doc (thread_id, turn_id, item_id, origin, kind, who, at, text)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    indexDoc: db.prepare('INSERT INTO codex_doc_fts (rowid, body) VALUES (?, ?)'),
    builtAt: db.prepare('SELECT built_at FROM codex_index_state WHERE id = 1'),
    markBuilt: db.prepare('UPDATE codex_index_state SET built_at = ? WHERE id = 1'),
    clearBuilt: db.prepare('UPDATE codex_index_state SET built_at = NULL WHERE id = 1'),
    match: db.prepare(
      `SELECT d.thread_id, d.at, d.who, d.kind, d.text, t.place
         FROM codex_doc_fts f
           JOIN codex_doc d ON d.id = f.rowid
           JOIN codex_thread t ON t.thread_id = d.thread_id
        WHERE codex_doc_fts MATCH ?
        ORDER BY rank LIMIT ?`,
    ),
  }

  function atomically<T>(work: () => T): T {
    db.exec('BEGIN')
    try {
      const answer = work()
      db.exec('COMMIT')
      return answer
    } catch (error: unknown) {
      try {
        db.exec('ROLLBACK')
      } catch {
        // Already rolled back, or the connection is gone. The original error is
        // the one worth reporting.
      }
      throw error
    }
  }

  /**
   * Remove a thread's documents, index first.
   *
   * INDEX FIRST, for `forgetting.ts`' reason. `codex_doc_fts` has no foreign
   * key, so `ON DELETE CASCADE` does not carry it: dropping the document row
   * first would leave an index entry pointing at nothing, which surfaces as a
   * hit with no text. The reverse order leaves text nothing can find, which is
   * merely useless. The order chosen is the one whose failure is quiet.
   */
  function removeDocs(threadId: string, origin: 'header' | 'item' | 'all'): void {
    const ids =
      origin === 'all' ? stmt.allDocIdsOf.all(threadId) : stmt.docIdsOf.all(threadId, origin)
    for (const row of ids) stmt.dropIndexed.run(Number(row['id']))
    if (origin === 'all') stmt.dropAllDocsOf.run(threadId)
    else stmt.dropDocsOf.run(threadId, origin)
  }

  function writeDocs(
    threadId: string,
    origin: 'header' | 'item',
    fragments: readonly Fragment[],
  ): number {
    let written = 0
    for (const fragment of fragments) {
      const inserted = stmt.insertDoc.run(
        threadId,
        fragment.turnId,
        fragment.itemId,
        origin,
        fragment.kind,
        fragment.who,
        fragment.at,
        fragment.text,
      )
      /*
        SEGMENTED going in, and `toMatchQuery` segments coming out.

        Without this, search in this project's primary language returns nothing:
        FTS5's default tokenizer splits on whitespace, Chinese has none between
        words, and a whole sentence becomes one token that no two-character word
        can match. The failure is silent — a valid index, a valid query, and an
        empty answer with nothing failing anywhere — which is why both halves
        live in one module and are used as a pair here.
      */
      stmt.indexDoc.run(Number(inserted.lastInsertRowid), segment(fragment.text))
      written += 1
    }
    return written
  }

  function storedThreads(): Map<string, StoredThread> {
    const held = new Map<string, StoredThread>()
    for (const row of stmt.threads.all()) {
      held.set(String(row['thread_id']), {
        updatedAtMs: Number(row['updated_at_ms']),
        textLength: Number(row['text_length']),
        nextOrdinal: toNullableNumber(row['next_ordinal']),
        nextBytes: toNullableNumber(row['next_bytes']),
        items: toNullableNumber(row['items']),
        updatedSum: toNullableNumber(row['updated_sum']),
        realtime: toNullableNumber(row['realtime']),
        realtimeOrdinals: toNullableNumber(row['realtime_ordinals']),
        realtimeBytes: toNullableNumber(row['realtime_bytes']),
      })
    }
    return held
  }

  function matching(match: string, limit: number): CodexHit[] {
    return stmt.match.all(match, limit).map((row) => ({
      threadId: String(row['thread_id']),
      at: Number(row['at']),
      who: String(row['who']) as CodexSpeaker,
      kind: String(row['kind']) as FragmentKind,
      place: String(row['place'] ?? ''),
      text: String(row['text']),
    }))
  }

  return {
    built() {
      const row = stmt.builtAt.get() as { built_at?: unknown } | undefined
      return typeof row?.built_at === 'number'
    },

    /**
     * Bring the mirror level with the source, one bounded slice at a time.
     *
     * ## What decides that a thread needs re-reading
     *
     * Four values, none of them a timestamp. Codex keeps its own per-thread
     * projection cursor — `next_rollout_ordinal` and `next_rollout_byte_offset`
     * — maintained by the process that does the projecting, exactly one-to-one
     * with the threads that have items and strictly ahead of them in all 1,695
     * measured. Beside it, an index-only aggregate over the projected rows
     * (`count(*)`, `sum(updated_at_ordinal)`) catches a re-projection that
     * leaves the cursor where it was. Comparing four numbers for 1,700 threads
     * costs milliseconds; the alternative was a group-by over 66,602 rows.
     *
     * Headers are not re-read in full either. A fingerprint —
     * `(id, updated_at_ms, text length)` — is 29 ms against 139 ms for the
     * whole read, and 139 ms of a 150 ms budget leaves nothing for the write.
     *
     * ## And what decides that a thread is gone
     *
     * Two different disappearances, and they mean different things. A thread
     * absent from `threads` has gone entirely, so everything of it goes. A
     * thread that has left `thread_history_projection_state` has had its
     * projection dropped — Codex's own trigger treats that as the end of its
     * projected life and cascades it to `thread_realtime_items` — so its turns
     * go and its header stays. Watching the same signals Codex watches is how
     * this inherits a deletion story instead of inventing one.
     */
    refresh(source, options = {}) {
      const slice = options.slice ?? THREAD_SLICE
      const stillAllowed = options.stillAllowed ?? (() => true)
      if (!stillAllowed()) {
        return { done: false, halted: true, threadsRead: 0, threadsRemoved: 0, documents: 0 }
      }

      const fingerprints = source.fingerprints()
      const states = new Map(source.threadStates().map((one) => [one.threadId, one]))
      const held = storedThreads()

      /*
        GONE FROM `threads` — the whole thread, header and turns.

        Done first and in its own transaction, so a build that is interrupted
        has still stopped recalling what Codex no longer holds. Removing is the
        half that must not wait for the half that adds.
      */
      const live = new Set(fingerprints.map((one) => one.id))
      const gone = [...held.keys()].filter((id) => !live.has(id))
      if (gone.length > 0) {
        atomically(() => {
          for (const id of gone) {
            removeDocs(id, 'all')
            stmt.dropThread.run(id)
            held.delete(id)
          }
        })
      }

      const stale = fingerprints.filter(
        (one) =>
          headerMoved(held.get(one.id), one) || itemsMoved(held.get(one.id), states.get(one.id)),
      )
      const taking = stale.slice(0, slice)
      if (taking.length === 0) {
        // Level with the source. This is the only place readiness is granted,
        // so a build that stopped halfway never presents as finished.
        stmt.markBuilt.run(Date.now())
        return {
          done: true,
          halted: false,
          threadsRead: 0,
          threadsRemoved: gone.length,
          documents: 0,
        }
      }

      const headers = new Map(
        source.headers(taking.map((one) => one.id)).map((one) => [one.id, one]),
      )
      let documents = 0
      let read = 0
      let halted = false

      /*
        ONE TRANSACTION PER THREAD, not one per build.

        A single transaction over 9,349 threads would hold a write lock for the
        whole cold build and, on the read side, a snapshot of somebody else's
        database for just as long — which is the thing that stops Codex
        truncating its own log. Per thread, every lock is milliseconds old.
      */
      for (const fingerprint of taking) {
        if (!stillAllowed()) {
          halted = true
          break
        }
        const header = headers.get(fingerprint.id)
        // Vanished between the fingerprint and the read. Left for the next
        // refresh, which will see it missing from `threads` and remove it.
        if (header === undefined) continue
        const state = states.get(fingerprint.id)
        const stored = held.get(fingerprint.id)
        const doHeader = headerMoved(stored, fingerprint)
        const doItems = itemsMoved(stored, state)

        /*
          THE CURSOR, not the probe row, decides whether the turns are re-read.

          This was `state !== undefined`, and that is a different question: the
          probe produces a row whenever `thread_items` still HAS rows, so a
          thread whose `thread_history_projection_state` entry had been deleted
          was re-read from the leftovers and its turns re-inserted. Codex's own
          trigger treats that deletion as the end of the thread's projected life
          and cascades it to `thread_realtime_items`; a mirror that ignored it
          went on recalling — and transmitting — turns Codex had finished with.

          The test that was supposed to catch this deleted the cursor AND the
          rows, so it passed for the wrong reason.
        */
        const projected = state !== undefined && state.nextOrdinal !== null
        const items: Fragment[] = []
        if (doItems && projected) {
          for (const row of source.spokenIn(fingerprint.id)) {
            const fragment = itemFragment(row)
            if (fragment !== null) items.push(fragment)
          }
          for (const row of source.realtimeIn(fingerprint.id)) {
            const fragment = itemFragment(row)
            if (fragment !== null) items.push(fragment)
          }
        }

        atomically(() => {
          // The thread row FIRST: `codex_doc` has a foreign key onto it, and a
          // document written before its thread would be refused rather than
          // orphaned — which is the right failure and not one to rely on.
          stmt.upsertThread.run(
            fingerprint.id,
            placeOf(header.cwd),
            fingerprint.updatedAtMs,
            fingerprint.textLength,
            state?.nextOrdinal ?? null,
            state?.nextByteOffset ?? null,
            state?.items ?? null,
            state?.updatedSum ?? null,
            state?.realtime ?? null,
            state?.realtimeOrdinals ?? null,
            state?.realtimeBytes ?? null,
          )
          if (doHeader) {
            removeDocs(fingerprint.id, 'header')
            documents += writeDocs(fingerprint.id, 'header', headerFragments(header))
          }
          if (doItems) {
            // REPLACED, not appended, and this covers the deletion case too:
            // a thread whose projection was dropped has `state === undefined`,
            // so `items` is empty and its turns are simply removed.
            removeDocs(fingerprint.id, 'item')
            documents += writeDocs(fingerprint.id, 'item', items)
          }
        })
        held.set(fingerprint.id, {
          updatedAtMs: fingerprint.updatedAtMs,
          textLength: fingerprint.textLength,
          nextOrdinal: state?.nextOrdinal ?? null,
          nextBytes: state?.nextByteOffset ?? null,
          items: state?.items ?? null,
          updatedSum: state?.updatedSum ?? null,
          realtime: state?.realtime ?? null,
          realtimeOrdinals: state?.realtimeOrdinals ?? null,
          realtimeBytes: state?.realtimeBytes ?? null,
        })
        read += 1
      }

      const done = !halted && read === stale.length
      if (done) stmt.markBuilt.run(Date.now())
      return { done, halted, threadsRead: read, threadsRemoved: gone.length, documents }
    },

    search(query, limit) {
      const match = toMatchQuery(query)
      // An empty MATCH is a syntax error in FTS5, so a query with nothing
      // searchable in it is not a search that found nothing — it is a search
      // that never ran. The caller reports that as `unavailable`.
      if (match === null) return []
      const hits = matching(match, limit)
      if (hits.length > 0) return hits
      /*
        PRECISE FIRST, THEN WIDER — `transcripts.search`'s rule, and it applies
        harder here.

        Space-separated terms are an AND in FTS5. She is told to search with the
        words they are likely to have actually said, so her queries are
        remembered phrases, and an AND over six words demands one document
        holding every one of them. Widened only when the precise form found
        NOTHING, so a query that already works is never made noisier; `ORDER BY
        rank` does the rest.
      */
      const any = toAnyQuery(query)
      return any === null || any === match ? hits : matching(any, limit)
    },

    forget() {
      /*
        EVERYTHING, and the readiness with it.

        Called when the permission is withdrawn. Leaving 73 MB of somebody's
        Codex history in `userData` after they switched the switch off would
        make the panel's promise false, and this app's whole argument about
        permissions is that they are decisions somebody made rather than
        decorations.

        The rows go through the same index-first order as a partial removal, so
        a failure part-way leaves nothing pointing at nothing.
      */
      atomically(() => {
        db.exec('DELETE FROM codex_doc_fts')
        db.exec('DELETE FROM codex_doc')
        db.exec('DELETE FROM codex_thread')
        stmt.clearBuilt.run()
      })
      /*
        THE CHECKPOINT IS A VALUE, and it was being thrown away.

        Deleting the rows moves them out of the tables and into the write-ahead
        log, where they sit across launches until a checkpoint moves them. This
        ran `db.exec(...)`, which discards the result — and a checkpoint blocked
        by a reader does not throw, it comes back `busy = 1`. So "we deleted
        their Codex history" could be reported over a log that still held every
        word of it.

        Answered rather than asserted, for the same reason `applySchema` reads
        its pragmas back: accepting a statement is a different question from it
        having done anything.
      */
      const checkpoint = db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get() as
        { busy?: unknown } | undefined
      return Number(checkpoint?.busy ?? 1) === 0
    },

    close() {
      db.close()
    },
  }
}

/**
 * Remove the index from disk entirely.
 *
 * For the case `forget()` cannot serve: nothing has this index open, and it
 * should not be opened just to empty it. Used when the permission is withdrawn
 * while no session is holding a handle.
 */
export function removeCodexIndex(userData: string): void {
  rmSync(join(userData, CODEX_INDEX_DIR), { recursive: true, force: true })
}
