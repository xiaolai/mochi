import { DatabaseSync } from 'node:sqlite'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { BUSY_TIMEOUT_MS, openReadOnly, STATE_FILE } from './present'
import { openCodexSource } from './read'
import { temporaryHome, writeArchive } from '../../../test/codex-archive'

/**
 * The newest conversation is visible, and `immutable=1` never comes back.
 *
 * ## Why this is its own file with this name
 *
 * The failure it guards is silent, fast and green. `immutable=1` tells SQLite
 * the file cannot change, so SQLite skips the write-ahead log — and against a
 * running Codex that means the reader misses whatever has not been checkpointed
 * yet. Measured on the live archive: **9,322 rows against 9,323**, and the
 * missing one is the NEWEST thread, which is the one a person is most likely to
 * ask about. Nothing fails. The count simply comes back one short, for ever.
 *
 * The fix is one word. **The assertion is the deliverable**, because a comment
 * saying "do not use immutable" is worth nothing the day somebody optimises the
 * reader — and `immutable=1` is exactly what somebody optimising a read of
 * another application's live database would reach for. It is not a bad
 * instinct; it is a correct-sounding one with a wrong answer, which is the kind
 * a test has to catch rather than a review.
 *
 * ## Both directions, in one case
 *
 * It would be enough to assert that the reader sees the row. It is much better
 * to assert, in the same test, that the tempting alternative does NOT — so the
 * file demonstrates the contradiction rather than describing it, and a reader
 * who wonders whether the warning is still true can see it being false.
 */

const homes: string[] = []

function home(): string {
  const made = temporaryHome()
  homes.push(made)
  return made
}

afterEach(() => {
  while (homes.length > 0) {
    const path = homes.pop()
    if (path !== undefined) rmSync(path, { recursive: true, force: true })
  }
})

/**
 * A thread written into the write-ahead log and left there.
 *
 * The writer connection stays OPEN and is handed back, because closing it
 * checkpoints the log into the database file — which is exactly the state this
 * test must not be in. It is the caller's to close.
 */
function threadInTheWal(path: string, id: string): DatabaseSync {
  const writer = new DatabaseSync(join(path, STATE_FILE))
  writer.exec('PRAGMA journal_mode = WAL')
  writer
    .prepare(
      `INSERT INTO threads (id, title, first_user_message, preview, cwd, source,
                            thread_source, created_at_ms, updated_at_ms)
       VALUES (?, '', ?, '', '', 'cli', NULL, 1, 1)`,
    )
    .run(id, 'the newest thing anybody said')
  return writer
}

describe('the write-ahead log is visible to this reader', () => {
  it('counts a row that is only in the WAL, and immutable=1 does not', () => {
    const path = writeArchive({ home: home(), threads: [{ id: 'old' }] })
    const writer = threadInTheWal(path, 'newest')
    try {
      expect(existsSync(join(path, `${STATE_FILE}-wal`))).toBe(true)

      const reader = openReadOnly(join(path, STATE_FILE))
      const seen = reader.prepare('SELECT count(*) AS c FROM threads').get() as { c: number }
      reader.close()
      // TWO: the checkpointed one and the one still in the log.
      expect(seen.c).toBe(2)

      /*
        THE SAME FILE, THE TEMPTING WAY, AND IT IS WRONG.

        `immutable=1` is a promise to SQLite that nothing else is writing, so it
        skips the log entirely. Against a live Codex that promise is false and
        the reader silently answers from a stale snapshot.
      */
      const stale = new DatabaseSync(`file:${join(path, STATE_FILE)}?immutable=1`, {
        readOnly: true,
      })
      const missed = stale.prepare('SELECT count(*) AS c FROM threads').get() as { c: number }
      stale.close()
      expect(missed.c).toBe(1)
      expect(missed.c).toBeLessThan(seen.c)
    } finally {
      writer.close()
    }
  })

  it('sees a WAL-only thread through the reader, not only through a raw handle', () => {
    // The assertion above is about the open mode. This one is about the module
    // anybody actually calls: a reader that opened correctly and then queried
    // through a second, differently-opened handle would pass the first test and
    // still be wrong.
    const path = writeArchive({ home: home(), threads: [{ id: 'old' }] })
    const writer = threadInTheWal(path, 'newest')
    try {
      const opened = openCodexSource(path)
      expect(opened.kind).toBe('open')
      if (opened.kind !== 'open') return
      try {
        expect(
          opened.source
            .fingerprints()
            .map((one) => one.id)
            .sort(),
        ).toEqual(['newest', 'old'])
      } finally {
        opened.source.close()
      }
    } finally {
      writer.close()
    }
  })

  it('reads a database with no -shm and no running Codex', () => {
    /*
      THE CASE THAT ACTUALLY MATTERS, and the one the obvious worry was about.

      A desktop companion is used mostly when Codex is CLOSED, so the question
      "does a read-only connection to a WAL database work with no pre-existing
      shared-memory index" decides whether this feature works at all in its
      ordinary condition. It does — and reading is what CREATES the `-shm`,
      which is the fact the README states rather than claiming we touch nothing.
    */
    const path = writeArchive({ home: home(), threads: [{ id: 'a' }, { id: 'b' }] })
    expect(existsSync(join(path, `${STATE_FILE}-shm`))).toBe(false)

    const opened = openCodexSource(path)
    expect(opened.kind).toBe('open')
    if (opened.kind !== 'open') return
    try {
      expect(opened.source.fingerprints()).toHaveLength(2)
    } finally {
      opened.source.close()
    }
  })

  it('never passes immutable, anywhere in the reader', () => {
    /*
      THE SOURCE, not the behaviour. The two cases above prove the reader is
      right today; this one is what survives a refactor that moves the open into
      a helper, a wrapper or a options object built somewhere else. The word is
      the hazard, and the word is what is checked.
    */
    const here = fileURLToPath(new URL('.', import.meta.url))
    for (const name of ['present.ts', 'read.ts', 'index-store.ts']) {
      const path = join(here, name)
      if (!existsSync(path)) continue
      const code = readFileSync(path, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^[ \t]*\/\/.*$/gm, '')
      expect(code).not.toContain('immutable')
    }
  })

  it('sets a busy timeout, because the default is zero', () => {
    /*
      MEASURED: `{readOnly:true}` reports `{"timeout":0}`. Zero means the first
      contended read against a running Codex fails instantly — and a running
      Codex is the ordinary case, so the archive would report itself unavailable
      at random with nothing in the log saying why.
    */
    const path = writeArchive({ home: home(), threads: [{ id: 'a' }] })
    const reader = openReadOnly(join(path, STATE_FILE))
    try {
      const held = reader.prepare('SELECT * FROM pragma_busy_timeout()').get() as
        Record<string, unknown> | undefined
      expect(held).toBeDefined()
      expect(Number(Object.values(held ?? {})[0])).toBe(BUSY_TIMEOUT_MS)
    } finally {
      reader.close()
    }
  })
})

describe('Codex can still truncate its own write-ahead log', () => {
  it('checkpoints while this reader is open and idle', () => {
    /*
      THE PROMISE THIS READER MAKES TO SOMEBODY ELSE'S PROCESS.

      A long read holds a WAL snapshot, and a held snapshot stops the owner
      truncating its log — so a companion left open all day would make Codex's
      database grow and never shrink. Nothing here opens a transaction that
      outlives one statement, and this is what says so: a `wal_checkpoint(TRUNCATE)`
      from the writing side completes, with a reader open, after that reader has
      done real work.
    */
    const path = writeArchive({ home: home(), threads: [{ id: 'a' }, { id: 'b' }] })
    const writer = new DatabaseSync(join(path, STATE_FILE))
    writer.exec('PRAGMA journal_mode = WAL')
    writer.exec("INSERT INTO threads (id) VALUES ('c')")

    const opened = openCodexSource(path)
    expect(opened.kind).toBe('open')
    if (opened.kind !== 'open') {
      writer.close()
      return
    }
    try {
      // Real work first, so this is not a checkpoint against a reader that has
      // never touched a page.
      expect(opened.source.fingerprints().length).toBe(3)
      const checkpoint = writer.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get() as {
        busy?: unknown
      }
      // `busy` is 1 when a reader blocked the truncation, which is precisely
      // the failure this asserts against.
      expect(Number(checkpoint['busy'])).toBe(0)
    } finally {
      opened.source.close()
      writer.close()
    }
  })
})
