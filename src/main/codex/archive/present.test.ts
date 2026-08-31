import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  archiveAt,
  codexArchiveHome,
  columnsOf,
  HISTORY_FILE,
  KNOWN_GENERATIONS,
  MEASURED_VERSIONS,
  REQUIRED_SHAPE,
  STATE_FILE,
} from './present'
import { HISTORY_DDL, STATE_DDL, temporaryHome, writeArchive } from '../../../test/codex-archive'

/**
 * The guard, tested against the two ways it was wrong before it was written.
 *
 * Both of the interesting cases are about a check that PASSES when it should
 * not: a hand-made database with the right migration number in it, and a
 * plausible-looking third-party file in the same directory. A guard is only
 * worth having if it refuses those, so they are the cases with the most
 * assertions on them.
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

describe('where Codex keeps its archive', () => {
  it('honours CODEX_HOME when it is set', () => {
    expect(codexArchiveHome({ CODEX_HOME: '/elsewhere/codex' }, '/home/them')).toBe(
      '/elsewhere/codex',
    )
  })

  it('falls back to ~/.codex when it is unset or empty', () => {
    expect(codexArchiveHome({}, '/home/them')).toBe(join('/home/them', '.codex'))
    expect(codexArchiveHome({ CODEX_HOME: '' }, '/home/them')).toBe(join('/home/them', '.codex'))
  })
})

describe('the required shape', () => {
  it('names every table and column, so the reader can build its queries from it', () => {
    // The list the reader composes its SELECTs out of. A table here with no
    // columns would produce `SELECT  FROM x`, which is a syntax error at the
    // first read rather than a failure anybody can see here.
    for (const required of REQUIRED_SHAPE) {
      expect(Object.keys(required.columns).length).toBeGreaterThan(0)
      expect(columnsOf(required.table)).toEqual(Object.keys(required.columns))
    }
  })

  it('covers the three things the amendments added', () => {
    /*
      The exact omission that made this list worth checking: the first draft
      validated the columns of the plan as first written, and the amendments
      then read three more things it never looked at — so the guard passed and
      the refresh failed, which is the worse of the two places to fail.
    */
    const columns = new Set(
      REQUIRED_SHAPE.flatMap((one) =>
        Object.keys(one.columns).map((name) => `${one.table}.${name}`),
      ),
    )
    expect(columns.has('threads.source')).toBe(true)
    expect(columns.has('thread_items.rollout_ordinal')).toBe(true)
    expect(REQUIRED_SHAPE.some((one) => one.table === 'thread_history_projection_state')).toBe(true)
  })

  it('refuses to answer for a table it does not describe', () => {
    expect(() => columnsOf('threads_but_wrong')).toThrow(/no required shape/)
  })
})

describe('the provenance guard', () => {
  it('accepts an archive with the right names and the right shape', () => {
    const path = writeArchive({ home: home(), threads: [{ id: 'a' }] })
    const found = archiveAt(path)
    expect(found.kind).toBe('present')
    if (found.kind !== 'present') return
    expect(found.statePath).toBe(join(path, STATE_FILE))
    expect(found.historyPath).toBe(join(path, HISTORY_FILE))
    expect(found.realtimeItems).toBe(true)
  })

  it('records the migration version as telemetry rather than gating on it', () => {
    /*
      THE FINDING THAT DELETED THE VERSION PIN.

      Upstream already carries 52 migrations where this machine has 51, and the
      extra one is a single additive index on a table this feature never reads.
      A guard pinned to a known-good range would have refused a current,
      compatible Codex on the day it shipped — so the number is recorded and
      decides nothing.
    */
    const ahead = writeArchive({
      home: home(),
      threads: [{ id: 'a' }],
      versions: { state: MEASURED_VERSIONS.state + 1, history: MEASURED_VERSIONS.history + 1 },
    })
    const found = archiveAt(ahead)
    expect(found.kind).toBe('present')
    if (found.kind !== 'present') return
    expect(found.versions.state).toBe(MEASURED_VERSIONS.state + 1)

    // And an older one is not refused either. An old Codex is not a dangerous
    // Codex; a differently-shaped one is, and the shape is what is checked.
    const behind = writeArchive({
      home: home(),
      threads: [{ id: 'a' }],
      versions: { state: 1, history: 1 },
    })
    expect(archiveAt(behind).kind).toBe('present')
  })

  it('refuses a database that carries the version number and nothing else', () => {
    /*
      The other direction of the same finding, and the reason shape-checking is
      SUFFICIENT rather than merely necessary. This file would pass any pin on
      `max(version)` and holds not one conversation.
    */
    const path = home()
    mkdirSync(path, { recursive: true })
    for (const name of [STATE_FILE, HISTORY_FILE]) {
      const db = new DatabaseSync(join(path, name))
      db.exec(
        `CREATE TABLE _sqlx_migrations (version BIGINT PRIMARY KEY);
         INSERT INTO _sqlx_migrations (version) VALUES (51);`,
      )
      db.close()
    }
    const found = archiveAt(path)
    expect(found.kind).toBe('unavailable')
    if (found.kind !== 'unavailable') return
    expect(found.reason).toBe('schema')
  })

  it('refuses a renamed column inside the same generation', () => {
    const path = home()
    mkdirSync(path, { recursive: true })
    const state = new DatabaseSync(join(path, STATE_FILE))
    // The same table, one column renamed — the migration hazard the risk table
    // names. The filename is unchanged, so only the shape can catch it.
    state.exec(STATE_DDL.replace('first_user_message TEXT', 'opening_message TEXT'))
    state.close()
    const history = new DatabaseSync(join(path, HISTORY_FILE))
    history.exec(HISTORY_DDL)
    history.close()

    const found = archiveAt(path)
    expect(found.kind).toBe('unavailable')
    if (found.kind !== 'unavailable') return
    expect(found.reason).toBe('schema')
    expect(found.detail).toContain('threads.first_user_message')
  })

  it('refuses a database missing a column only the probe reads', () => {
    /*
      `updated_at_ordinal` is read by `ITEM_PROBE_SQL` on every refresh and was
      missing from the required shape — so a database without it passed this
      guard and failed on the first refresh instead, which is the worse of the
      two places to fail.
    */
    const path = home()
    mkdirSync(path, { recursive: true })
    const state = new DatabaseSync(join(path, STATE_FILE))
    state.exec(STATE_DDL)
    state.close()
    const history = new DatabaseSync(join(path, HISTORY_FILE))
    // The column and the two indexes over it go together: a Codex without the
    // column would not carry indexes on it either.
    history.exec(
      HISTORY_DDL.replace('updated_at_ordinal INTEGER NOT NULL DEFAULT 0,', '').replace(
        /CREATE INDEX idx_thread_items(_by_turn)?_updated_page[\s\S]*?;/g,
        '',
      ),
    )
    history.close()

    const found = archiveAt(path)
    expect(found.kind).toBe('unavailable')
    if (found.kind !== 'unavailable') return
    expect(found.reason).toBe('schema')
    expect(found.detail).toContain('updated_at_ordinal')
  })

  it('refuses a column whose type has changed under it', () => {
    const path = home()
    mkdirSync(path, { recursive: true })
    const state = new DatabaseSync(join(path, STATE_FILE))
    state.exec(STATE_DDL.replace('created_at_ms INTEGER', 'created_at_ms TEXT'))
    state.close()
    const history = new DatabaseSync(join(path, HISTORY_FILE))
    history.exec(HISTORY_DDL)
    history.close()

    const found = archiveAt(path)
    expect(found.kind).toBe('unavailable')
    if (found.kind !== 'unavailable') return
    expect(found.reason).toBe('schema')
    expect(found.detail).toContain('created_at_ms')
  })

  it('accepts a declared type that is a different spelling of the same affinity', () => {
    // `BIGINT` has INTEGER affinity by SQLite's own rules, and refusing it would
    // be this guard inventing an incompatibility rather than finding one.
    const path = home()
    mkdirSync(path, { recursive: true })
    const state = new DatabaseSync(join(path, STATE_FILE))
    state.exec(STATE_DDL.replace('created_at_ms INTEGER', 'created_at_ms BIGINT'))
    state.close()
    const history = new DatabaseSync(join(path, HISTORY_FILE))
    history.exec(HISTORY_DDL)
    history.close()

    expect(archiveAt(path).kind).toBe('present')
  })

  it('refuses when thread_history_1.sqlite is missing, and says so', () => {
    const path = home()
    mkdirSync(path, { recursive: true })
    const state = new DatabaseSync(join(path, STATE_FILE))
    state.exec(STATE_DDL)
    state.close()

    const found = archiveAt(path)
    expect(found.kind).toBe('unavailable')
    if (found.kind !== 'unavailable') return
    // ABSENT, never "nothing found". Half an archive answers half the questions
    // and says nothing about the other half.
    expect(found.reason).toBe('absent')
    expect(found.detail).toContain(HISTORY_FILE)
  })

  it('refuses a directory holding a plausible-looking database and nothing else', () => {
    /*
      `~/.codex` is not exclusively OpenAI's: on the measured machine it also
      holds an 829 MB `.cccmemory.db` and a `.codex-conversations-memory.db`,
      and there is no naming convention separating them from Codex's own files.
    */
    const path = home()
    mkdirSync(path, { recursive: true })
    const foreign = new DatabaseSync(join(path, '.cccmemory.db'))
    foreign.exec('CREATE TABLE memories (id INTEGER PRIMARY KEY, body TEXT)')
    foreign.close()

    const found = archiveAt(path)
    expect(found.kind).toBe('unavailable')
    if (found.kind !== 'unavailable') return
    expect(found.reason).toBe('absent')
  })

  it('refuses a newer sibling generation rather than serving the old one for ever', () => {
    /*
      THE TRIPWIRE, and the case that made it necessary.

      The first version accepted `state_5.sqlite` whenever it existed and never
      looked beside it. If Codex bumps a generation and leaves the old file,
      that reader serves history that stopped growing — silently, for ever —
      and the tripwire the plan promised would fire never fires.
    */
    const path = writeArchive({ home: home(), threads: [{ id: 'a' }] })
    writeFileSync(join(path, `state_${String(KNOWN_GENERATIONS.state + 1)}.sqlite`), '')

    const found = archiveAt(path)
    expect(found.kind).toBe('unavailable')
    if (found.kind !== 'unavailable') return
    expect(found.reason).toBe('generation')
    expect(found.detail).toContain('state_6.sqlite')
  })

  it('ignores an older sibling generation, which is only a leftover', () => {
    const path = writeArchive({ home: home(), threads: [{ id: 'a' }] })
    writeFileSync(join(path, 'state_4.sqlite'), '')
    writeFileSync(join(path, 'thread_history_0.sqlite'), '')
    expect(archiveAt(path).kind).toBe('present')
  })

  it('accepts an archive with no thread_realtime_items, and says it has none', () => {
    // The table arrived in a migration, so an older Codex simply has no such
    // table — and the older `realtime_delegation` encoding in `threads` is the
    // live path anyway. Absent is not a refusal; present-and-wrong is.
    const path = home()
    mkdirSync(path, { recursive: true })
    const state = new DatabaseSync(join(path, STATE_FILE))
    state.exec(STATE_DDL)
    state.close()
    const history = new DatabaseSync(join(path, HISTORY_FILE))
    history.exec(HISTORY_DDL.replace(/CREATE TABLE thread_realtime_items[\s\S]*?\);/, ''))
    history.close()

    const found = archiveAt(path)
    expect(found.kind).toBe('present')
    if (found.kind !== 'present') return
    expect(found.realtimeItems).toBe(false)
  })

  it('refuses a corrupt database rather than throwing', () => {
    // F8: Codex exports `is_sqlite_corruption_error` and rebuilds this
    // projection from rollouts, so a corrupt archive is an ordinary state of
    // the world. "I could not look" is an answer, not an exception.
    const path = home()
    mkdirSync(path, { recursive: true })
    writeFileSync(join(path, STATE_FILE), 'this is not a database')
    writeFileSync(join(path, HISTORY_FILE), 'nor is this')

    const found = archiveAt(path)
    expect(found.kind).toBe('unavailable')
    if (found.kind !== 'unavailable') return
    expect(found.reason).toBe('unreadable')
  })

  it('refuses a CODEX_HOME that is not a directory', () => {
    const path = home()
    const file = join(path, 'not-a-directory')
    writeFileSync(file, '')
    const found = archiveAt(file)
    expect(found.kind).toBe('unavailable')
    if (found.kind !== 'unavailable') return
    expect(found.reason).toBe('home')
  })

  it('refuses a CODEX_HOME that is not there at all', () => {
    const found = archiveAt(join(home(), 'nothing', 'here'))
    expect(found.kind).toBe('unavailable')
    if (found.kind !== 'unavailable') return
    expect(found.reason).toBe('home')
  })
})
