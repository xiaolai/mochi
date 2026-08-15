/**
 * History, search, and the round trip through an export.
 *
 * Against a real database rather than a mock: the things most likely to be
 * wrong here are the cascade, the unique key that makes import idempotent, and
 * whether the FTS index and the readable rows stay in step — and a mock of
 * SQLite would be a mock of exactly those.
 */

import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ARCHIVE_FORMAT,
  createTranscripts,
  parseArchive,
  TRANSCRIPTS_FILE,
  type Transcripts,
} from './transcripts'

const open: Transcripts[] = []
const homes = new WeakMap<Transcripts, string>()

function store(): Transcripts {
  const home = mkdtempSync(join(tmpdir(), 'mochi-history-'))
  const made = createTranscripts(home)
  homes.set(made, home)
  open.push(made)
  return made
}

/**
 * Count rows in the table itself, going around the store's own queries.
 *
 * Necessary, not fastidious. `turns()` reads through a join on `session` and
 * `search()` joins the index to `turn`, so both HIDE the two failures most
 * worth testing here: a turn the cascade left behind, and an index row whose
 * turn is gone. Asserting through them proves the query filters — which it
 * does even when the row is still there.
 *
 * This is not hypothetical. Deleting `PRAGMA foreign_keys = ON` left all
 * thirty tests in this file green until these counts existed.
 */
function count(t: Transcripts, sql: string, ...args: readonly (string | number)[]): number {
  const probe = new DatabaseSync(join(homes.get(t) ?? '', TRANSCRIPTS_FILE))
  try {
    return Number(probe.prepare(sql).get(...args)?.['n'] ?? -1)
  } finally {
    probe.close()
  }
}

/** Close the file and open it again, which is what a restart does. */
function reopen(t: Transcripts): Transcripts {
  const home = homes.get(t) ?? ''
  t.close()
  open.splice(open.indexOf(t), 1)
  const made = createTranscripts(home)
  homes.set(made, home)
  open.push(made)
  return made
}

/** Reach into the database to arrange a failure the API cannot ask for. */
function exec(t: Transcripts, sql: string): void {
  const probe = new DatabaseSync(join(homes.get(t) ?? '', TRANSCRIPTS_FILE))
  try {
    probe.exec(sql)
  } finally {
    probe.close()
  }
}

afterEach(() => {
  for (const one of open) one.close()
  open.length = 0
})

/**
 * A short conversation, at fixed times so nothing depends on the clock.
 *
 * Returns the TOKEN it answers to, which is its identity everywhere outside
 * the store. The handle `begin` gives back is a rowid and stays in here.
 */
function conversation(t: Transcripts, personaId: string, startedAt = 1_000): string {
  const live = t.begin(personaId, startedAt)
  if (live === null) throw new Error('that instant was already taken')
  t.say(live, 'you', '今天我想吃苹果', startedAt + 10)
  t.say(live, 'her', 'That sounds good.', startedAt + 20)
  t.end(live, startedAt + 30)
  // `begin` hands back the token itself, which is the same name every read and
  // delete uses. There is nothing to look up.
  return live
}

/** The rowid behind a conversation, so a probe can count rows that hang off it. */
function rowidOf(t: Transcripts, token: string): number {
  return count(t, 'SELECT id AS n FROM session WHERE token = ?', token)
}

describe('one connection per file', () => {
  it('refuses a second store on a file this process already has open', () => {
    // The comment here used to say that taking a directory meant callers
    // "cannot accidentally point two of these at one file". It did not: two
    // calls with the same directory opened it twice. `busy_timeout` is 0, so
    // the second writer gets `SQLITE_BUSY` at once -- the claim is enforced
    // now rather than asserted.
    const t = store()
    const home = homes.get(t) ?? ''
    expect(() => createTranscripts(home)).toThrow(/already open/)
  })

  it('lets it be opened again once it is closed', () => {
    // Otherwise a restart within one process -- which `reopen` does, and which
    // the crash-recovery test depends on -- would be impossible.
    const t = store()
    const home = homes.get(t) ?? ''
    t.close()
    open.splice(open.indexOf(t), 1)
    const again = createTranscripts(home)
    open.push(again)
    expect(again.sessions('ada')).toEqual([])
  })
})

describe('a session and its turns', () => {
  it('keeps what was said, in order, with who said it', () => {
    const t = store()
    const one = conversation(t, 'ada')
    expect(t.turns('ada', one)).toEqual([
      { at: 1010, who: 'you', text: '今天我想吃苹果' },
      { at: 1020, who: 'her', text: 'That sounds good.' },
    ])
  })

  it('will not read a session that belongs to somebody else', () => {
    // A session id is a small integer that crosses IPC. Reading one without
    // saying who is asking is the scope widening this refuses: a settings
    // window holding one of ada's ids would show ada's conversation while
    // coach is worn.
    const t = store()
    const hers = conversation(t, 'ada')
    expect(t.turns('coach', hers)).toEqual([])
    // And the same answer for one that was never there, so the reply does not
    // disclose that it exists.
    expect(t.turns('coach', 'no-such-token')).toEqual([])
  })

  it('ignores silence', () => {
    // The wire emits an empty transcript for a breath. Stored, those fill a
    // conversation with blank rows nobody can search or read.
    const t = store()
    const live = t.begin('ada', 1000)
    t.say(live!, 'you', '   ', 1010)
    t.say(live!, 'her', '', 1020)
    expect(t.turns('ada', live!)).toEqual([])
  })

  it('lists sessions newest first, with a turn count', () => {
    const t = store()
    conversation(t, 'ada', 1000)
    conversation(t, 'ada', 9000)
    expect(t.sessions('ada').map((s) => s.startedAt)).toEqual([9000, 1000])
    expect(t.sessions('ada')[0]?.turns).toBe(2)
  })

  it('leaves a live session open until it ends', () => {
    const t = store()
    const id = t.begin('ada', 1000)
    expect(t.sessions('ada')[0]?.endedAt).toBeNull()
    t.end(id!, 2000)
    expect(t.sessions('ada')[0]?.endedAt).toBe(2000)
  })

  it('keeps two personas apart', () => {
    // The same boundary memory has. A work persona and a personal one sharing
    // history is a privacy fault, not an untidiness.
    const t = store()
    conversation(t, 'ada')
    conversation(t, 'coach')
    expect(t.sessions('ada')).toHaveLength(1)
    expect(t.sessions('coach')).toHaveLength(1)
  })

  it('never hands a deleted conversation’s name to a new one', () => {
    // The reason the token exists. SQLite reissues a rowid once the row
    // holding it is gone, so a settings window still holding a deleted
    // conversation's id would have named whatever took its place -- and the
    // dangerous version of that is a stale DELETE removing a conversation
    // nobody asked to remove.
    const t = store()
    const first = conversation(t, 'ada', 1000)
    const reusedRowid = rowidOf(t, first)
    t.forgetSession('ada', first)

    const second = conversation(t, 'ada', 2000)

    // The rowid IS handed out again -- asserted so nobody later concludes the
    // hazard was theoretical.
    expect(rowidOf(t, second)).toBe(reusedRowid)
    // The token is not. A stale one names nothing rather than the replacement.
    expect(second).not.toBe(first)
    expect(t.turns('ada', first)).toEqual([])
    expect(t.forgetSession('ada', first)).toBe(false)
    expect(t.sessions('ada')).toHaveLength(1)
  })

  it('refuses a second conversation at an instant already taken', () => {
    // A wake inside the same millisecond, or a clock corrected backwards over
    // a conversation that already happened. Shifting the stored time to dodge
    // the unique key would date a session AFTER the things said in it, and
    // throwing would fail her wake for a reason nobody in the room can act on.
    // Not storing that one conversation is the cheapest of the three.
    const t = store()
    const first = conversation(t, 'ada', 1000)

    expect(t.begin('ada', 1000)).toBeNull()

    expect(t.sessions('ada')).toHaveLength(1)
    expect(t.turns('ada', first)).toHaveLength(2)
  })

  it('never dates a conversation after the things said in it', () => {
    // The invariant the shifting version broke, asserted directly rather than
    // left to be noticed. Every stored session must begin no later than its
    // first turn and end no earlier than its last.
    const t = store()
    conversation(t, 'ada', 1000)
    conversation(t, 'ada', 2000)
    for (const one of t.sessions('ada')) {
      for (const turn of t.turns('ada', one.token)) {
        expect(turn.at).toBeGreaterThanOrEqual(one.startedAt)
        if (one.endedAt !== null) expect(turn.at).toBeLessThanOrEqual(one.endedAt)
      }
    }
  })
})

describe('search', () => {
  it('finds Chinese, which is the whole reason for the segmenter', () => {
    const t = store()
    conversation(t, 'ada')
    const hits = t.search('ada', '苹果')
    expect(hits).toHaveLength(1)
    // The READABLE text comes back, not the segmented copy. Showing somebody
    // their own words with a space between every character would be the
    // index leaking into the interface.
    expect(hits[0]?.text).toBe('今天我想吃苹果')
  })

  it('finds English', () => {
    const t = store()
    conversation(t, 'ada')
    expect(t.search('ada', 'good')[0]?.who).toBe('her')
  })

  it('never returns another persona’s turns', () => {
    const t = store()
    conversation(t, 'ada')
    conversation(t, 'coach')
    // Filtered in the query rather than after it: a search that fetched
    // everything and filtered in JS would leak through any code path that
    // forgot to.
    expect(t.search('ada', '苹果')).toHaveLength(1)
    expect(t.search('nobody', '苹果')).toHaveLength(0)
  })

  it('answers an empty search with nothing rather than throwing', () => {
    const t = store()
    conversation(t, 'ada')
    for (const empty of ['', '   ', '!!']) {
      expect(t.search('ada', empty), JSON.stringify(empty)).toEqual([])
    }
  })

  it('survives anything typed into a search box', () => {
    const t = store()
    conversation(t, 'ada')
    for (const hostile of ['"', 'NEAR', 'a OR b', '*', '(']) {
      expect(() => t.search('ada', hostile), hostile).not.toThrow()
    }
  })
})

describe('forgetting her takes the transcripts with her', () => {
  it('removes every session, turn and index row', () => {
    const t = store()
    conversation(t, 'ada')
    conversation(t, 'coach')

    t.forget('ada')

    expect(t.sessions('ada')).toEqual([])
    // The index too. A hit whose turn is gone reads as her remembering
    // something she was told to forget -- and ids are derived from names, so
    // `ada` comes round again.
    expect(t.search('ada', '苹果')).toEqual([])
    expect(t.sessions('coach')).toHaveLength(1)
  })

  it('takes the turns with the session, which needs foreign keys ON', () => {
    // SQLite disables them by default, which makes ON DELETE CASCADE silently
    // do nothing. That failure leaves every turn behind while the session list
    // looks empty.
    const t = store()
    const one = conversation(t, 'ada')
    const rowid = rowidOf(t, one)
    t.forget('ada')
    // Counted in the TABLE, by the rowid captured before the delete. Asking
    // `turns()` reads through a join on the session that is now gone, so it
    // answers empty whether the cascade ran or left every turn behind -- the
    // assertion this test exists to make is the one that query cannot make.
    expect(count(t, 'SELECT count(*) AS n FROM turn WHERE session_id = ?', rowid)).toBe(0)
  })

  it('takes the index rows too, which no search can prove', () => {
    // `search` joins the index to `turn`, so an orphaned index row is
    // invisible -- until a later turn reuses that row id and somebody else's
    // words surface as a hit under her name.
    const t = store()
    conversation(t, 'ada')
    t.forget('ada')
    expect(count(t, "SELECT count(*) AS n FROM turn_fts WHERE persona_id = 'ada'")).toBe(0)
  })
})

describe('forgetting one conversation', () => {
  it('takes that session, its turns and its index rows, and nothing else', () => {
    const t = store()
    const first = conversation(t, 'ada', 1000)
    conversation(t, 'ada', 9000)
    const rowid = rowidOf(t, first)

    expect(t.forgetSession('ada', first)).toBe(true)

    expect(t.sessions('ada').map((s) => s.startedAt)).toEqual([9000])
    expect(t.turns('ada', first)).toEqual([])
    expect(count(t, 'SELECT count(*) AS n FROM turn WHERE session_id = ?', rowid)).toBe(0)
    // Two turns in the surviving conversation and two index rows, not four.
    // Counted rather than searched: `search` cannot see an orphan.
    expect(count(t, "SELECT count(*) AS n FROM turn_fts WHERE persona_id = 'ada'")).toBe(2)
    expect(t.search('ada', '苹果')).toHaveLength(1)
  })

  it('refuses a session that is not hers, and leaves it there', () => {
    // The delete somebody reaches for most often is also the one an id from
    // the wrong persona reaches most easily, because both windows deal in the
    // same small integers.
    const t = store()
    const hers = conversation(t, 'ada')

    expect(t.forgetSession('coach', hers)).toBe(false)

    expect(t.sessions('ada')).toHaveLength(1)
    expect(t.turns('ada', hers)).toHaveLength(2)
  })

  it('says no to a session that is not there rather than throwing', () => {
    const t = store()
    expect(t.forgetSession('ada', 'no-such-token')).toBe(false)
  })

  it('drops a conversation still in progress, because it is still hers', () => {
    // Unlike pruning, which must never touch one: this is somebody asking for
    // THIS conversation to go, and refusing would leave the one on screen as
    // the only one that cannot be deleted.
    const t = store()
    const live = t.begin('ada', 1000)
    t.say(live!, 'you', 'hello', 1010)

    expect(t.forgetSession('ada', live!)).toBe(true)
    expect(t.sessions('ada')).toEqual([])
  })
})

describe('deleted text is actually gone from the file', () => {
  it('leaves no readable trace of a deleted conversation', () => {
    // "Delete for good?" is a promise, and without `secure_delete` it was not
    // true: SQLite unlinks a row from its page and leaves the bytes. Measured
    // before this was turned on -- the canary was still in `transcripts.db`
    // after the delete -- and this app tells people that file is not
    // encrypted, so anything left in it is readable by whatever can open it.
    const t = store()
    const canary = 'MOCHI_CANARY_9931_do_not_keep_me'
    const live = t.begin('ada', 1000)
    if (live === null) throw new Error('that instant was already taken')
    t.say(live, 'you', canary, 1010)
    t.end(live, 1020)
    // Present while it is meant to be.
    expect(t.search('ada', canary)).toHaveLength(1)

    t.forget('ada')

    // NOT checkpointed here. The first version of this test ran
    // `wal_checkpoint(TRUNCATE)` itself before looking, which is precisely
    // what production does not do -- so it proved the main database was
    // scrubbed while the write-ahead log still held the words, and passed.
    // The store checkpoints after a delete for that reason; this only reads.
    const home = homes.get(t) ?? ''
    for (const suffix of ['', '-wal']) {
      const path = join(home, `${TRANSCRIPTS_FILE}${suffix}`)
      if (!existsSync(path)) continue
      expect(readFileSync(path).includes(Buffer.from(canary)), `${suffix || '.db'}`).toBe(false)
    }
  })

  it('leaves no trace of ONE deleted conversation while others remain', () => {
    // The whole-file delete above frees pages, and `PRAGMA secure_delete`
    // zeroes those -- so it passes with FTS5's own secure-delete switch turned
    // off, and proves nothing about it. Deleting one conversation out of many
    // is the case that needs it: the index stays alive, so its pages are not
    // freed, and without the switch FTS5 leaves the old postings sitting
    // inside them.
    const t = store()
    const canary = 'MOCHI_CANARY_ONLY_THIS_ONE_7742'
    const doomed = t.begin('ada', 1000)
    if (doomed === null) throw new Error('that instant was already taken')
    t.say(doomed, 'you', canary, 1010)
    t.end(doomed, 1020)
    // Enough other conversations that the index is not a single empty page.
    for (let i = 0; i < 40; i += 1) conversation(t, 'ada', 5_000 + i * 100)

    expect(t.forgetSession('ada', doomed)).toBe(true)

    const home = homes.get(t) ?? ''
    for (const suffix of ['', '-wal']) {
      const path = join(home, `${TRANSCRIPTS_FILE}${suffix}`)
      if (!existsSync(path)) continue
      expect(readFileSync(path).includes(Buffer.from(canary)), `${suffix || '.db'}`).toBe(false)
    }
    // And the rest of her history is still there and still searchable.
    expect(t.sessions('ada')).toHaveLength(40)
    expect(t.search('ada', '苹果')).toHaveLength(40)
  })
})

describe('forgetting everything on this machine', () => {
  it('empties the file, including personas nothing can name any more', () => {
    // The escape hatch used to be a loop over the loaded catalog, so rows
    // filed under a persona deleted by hand, one whose package stopped
    // parsing, or one refused as a duplicate id all survived a button reading
    // "delete everything, every persona" -- exactly the situations somebody
    // presses it for.
    const t = store()
    conversation(t, 'ada')
    conversation(t, 'coach')
    conversation(t, 'nobody-can-name-me')

    t.forgetEverything()

    for (const who of ['ada', 'coach', 'nobody-can-name-me']) {
      expect(t.sessions(who), who).toEqual([])
      expect(t.search(who, '苹果'), who).toEqual([])
    }
    // Counted in the tables, because `sessions` and `search` both read through
    // joins that would answer empty even if the rows were still there.
    expect(count(t, 'SELECT count(*) AS n FROM session')).toBe(0)
    expect(count(t, 'SELECT count(*) AS n FROM turn')).toBe(0)
    expect(count(t, 'SELECT count(*) AS n FROM turn_fts')).toBe(0)
  })
})

describe('retention', () => {
  it('drops sessions that ended before the cutoff', () => {
    const t = store()
    conversation(t, 'ada', 1000)
    conversation(t, 'ada', 90_000)

    expect(t.pruneBefore('ada', 50_000)).toBe(1)
    expect(t.sessions('ada').map((s) => s.startedAt)).toEqual([90_000])
    expect(t.search('ada', '苹果')).toHaveLength(1)
  })

  it('closes a session an unclean quit left open, so retention can reach it', () => {
    // Pruning only considers sessions that ENDED. A crash or a kill leaves one
    // open forever, so a persona set to keep a week keeps that conversation
    // permanently while the pane reports it dropped -- the retention promise
    // failing in the direction nobody checks.
    const before = store()
    const id = before.begin('ada', 1000)
    before.say(id!, 'you', '今天我想吃苹果', 1010)

    const t = reopen(before)

    // At the last thing said in it, not at the moment of reopening: the file
    // may be opened months later, and dating the session then would make it
    // outlive the retention window it was already past.
    expect(t.sessions('ada')[0]?.endedAt).toBe(1010)
    expect(t.pruneBefore('ada', 50_000)).toBe(1)
  })

  it('never drops a session still in progress', () => {
    // Pruning by START time would delete the conversation somebody is having
    // if the app had been open long enough.
    const t = store()
    t.begin('ada', 1000)
    expect(t.pruneBefore('ada', 50_000)).toBe(0)
    expect(t.sessions('ada')).toHaveLength(1)
  })

  it('leaves everything exactly as it was when a delete fails partway', () => {
    // The reason all three delete paths run inside one transaction. Without
    // it, the loop deletes the first session, hits the failure on the second,
    // and stops -- a prune that reports failure and half happened, with no
    // way to tell which half.
    const t = store()
    conversation(t, 'ada', 1000)
    conversation(t, 'ada', 9000)
    exec(
      t,
      `CREATE TRIGGER refuse BEFORE DELETE ON session WHEN old.started_at = 9000
       BEGIN SELECT raise(ABORT, 'refused'); END`,
    )

    expect(() => t.pruneBefore('ada', 50_000)).toThrow()

    exec(t, 'DROP TRIGGER refuse')
    expect(t.sessions('ada').map((s) => s.startedAt)).toEqual([9000, 1000])
    expect(count(t, "SELECT count(*) AS n FROM turn_fts WHERE persona_id = 'ada'")).toBe(4)
    expect(t.search('ada', '苹果')).toHaveLength(2)
  })

  it("leaves another persona's history alone", () => {
    // How long to keep is HERS, so pruning must be too. A cutoff
    // driven by whoever happens to be worn, applied to the whole file, would
    // let a persona set to keep a week erase the archive of one set to keep
    // everything -- and it would present as the data never having been there.
    const t = store()
    conversation(t, 'ada', 1000)
    conversation(t, 'coach', 1000)

    expect(t.pruneBefore('ada', 50_000)).toBe(1)
    expect(t.sessions('ada')).toHaveLength(0)
    expect(t.sessions('coach')).toHaveLength(1)
  })
})

describe('export and import', () => {
  it('round-trips a persona’s whole history', () => {
    const from = store()
    conversation(from, 'ada', 1000)
    conversation(from, 'ada', 9000)

    const archive = from.exportFor('ada')
    const to = store()
    const result = to.importInto('ada', JSON.parse(JSON.stringify(archive)))

    expect(result.ok).toBe(true)
    if (result.ok) expect(result).toMatchObject({ sessions: 2, turns: 4, skipped: 0 })
    expect(to.sessions('ada').map((s) => s.startedAt)).toEqual([9000, 1000])
    expect(to.turns('ada', to.sessions('ada')[1]!.token)).toEqual(
      from.turns('ada', from.sessions('ada')[1]!.token),
    )
  })

  it('rebuilds the search index on the way in', () => {
    // An import that restored rows without indexing them would give somebody
    // their history back and no way to find anything in it.
    const from = store()
    conversation(from, 'ada')
    const to = store()
    to.importInto('ada', JSON.parse(JSON.stringify(from.exportFor('ada'))))
    expect(to.search('ada', '苹果')).toHaveLength(1)
  })

  it('imports the same file twice without doubling anything', () => {
    // The unique key makes this structural rather than a check somebody has to
    // remember -- the same lesson the persona migration learned.
    const t = store()
    conversation(t, 'ada')
    const archive = JSON.parse(JSON.stringify(t.exportFor('ada'))) as unknown

    const second = t.importInto('ada', archive)
    expect(second.ok).toBe(true)
    if (second.ok) expect(second).toMatchObject({ sessions: 0, skipped: 1 })
    expect(t.sessions('ada')).toHaveLength(1)
  })

  it('reports a colliding conversation rather than losing it', () => {
    // Skipping on the instant ALONE reported success and dropped the
    // conversation: two machines each starting one in the same millisecond is
    // not exotic, and "already here" was a lie about both. A repeat is still a
    // repeat; a different conversation at the same instant is a conflict, and
    // the caller is told so.
    const t = store()
    conversation(t, 'coach', 1000)

    const result = t.importInto('coach', {
      version: ARCHIVE_FORMAT,
      personaId: 'elsewhere',
      exportedAt: 3000,
      sessions: [
        {
          startedAt: 1000,
          endedAt: 2000,
          turns: [{ at: 1010, who: 'you', text: 'a different archive entirely' }],
        },
      ],
    })

    expect(result.ok).toBe(true)
    if (result.ok) expect(result).toMatchObject({ sessions: 0, skipped: 0, conflicts: 1 })
  })

  it('still counts an identical conversation as already here', () => {
    // The other half of the same rule: replaying an export must stay a no-op,
    // or every backup restore doubles somebody's history.
    const t = store()
    conversation(t, 'ada')
    const archive = JSON.parse(JSON.stringify(t.exportFor('ada'))) as unknown

    const again = t.importInto('ada', archive)

    expect(again.ok).toBe(true)
    if (again.ok) expect(again).toMatchObject({ skipped: 1, conflicts: 0 })
  })

  it('never imports a conversation as still running', () => {
    // An archive can legitimately hold one that was open when it was exported.
    // Storing it open makes it live on THIS machine: retention only prunes
    // what ended, so it would never expire, and the app would be holding two
    // open conversations at once.
    const t = store()
    const result = t.importInto('ada', {
      version: ARCHIVE_FORMAT,
      personaId: 'ada',
      exportedAt: 3000,
      sessions: [
        {
          startedAt: 1000,
          endedAt: null,
          turns: [{ at: 1010, who: 'you', text: 'still talking' }],
        },
        // And one holding nothing at all, which has no last turn to end at.
        { startedAt: 4000, endedAt: null, turns: [] },
      ],
    })

    expect(result.ok).toBe(true)
    expect(t.sessions('ada').every((one) => one.endedAt !== null)).toBe(true)
    // Ended at the last thing said, and at its start when nothing was said.
    expect(
      t
        .sessions('ada')
        .map((one) => one.endedAt)
        .sort((a, b) => (a ?? 0) - (b ?? 0)),
    ).toEqual([1010, 4000])
    // Which means retention can reach them.
    expect(t.pruneBefore('ada', 50_000)).toBe(2)
  })

  it('does not call an open conversation the same as a finished one', () => {
    // Equality ignoring `endedAt` meant importing the completed export of a
    // conversation that was running when it was first exported reported
    // "already here" and dropped the ending.
    const t = store()
    const live = t.begin('ada', 1000)
    if (live === null) throw new Error('that instant was already taken')
    t.say(live, 'you', 'hello', 1010)

    const finished = t.importInto('ada', {
      version: ARCHIVE_FORMAT,
      personaId: 'ada',
      exportedAt: 3000,
      sessions: [
        { startedAt: 1000, endedAt: 2000, turns: [{ at: 1010, who: 'you', text: 'hello' }] },
      ],
    })

    // Same words, different ending: a conflict to report, not a repeat to skip.
    expect(finished.ok).toBe(true)
    if (finished.ok) expect(finished).toMatchObject({ skipped: 0, conflicts: 1 })
  })

  it('lets the CALLER choose which persona receives it', () => {
    // The archive names where it came from, and that is informational. A file
    // deciding which persona it writes into would mean opening someone else's
    // export silently rewrites a character you did not pick.
    const t = store()
    conversation(t, 'ada')
    const archive = JSON.parse(JSON.stringify(t.exportFor('ada'))) as unknown

    t.importInto('coach', archive)

    expect(t.sessions('coach')).toHaveLength(1)
    expect(t.search('coach', '苹果')).toHaveLength(1)
  })
})

describe('an archive is checked, not trusted', () => {
  const good = {
    version: ARCHIVE_FORMAT,
    personaId: 'ada',
    exportedAt: 1,
    sessions: [{ startedAt: 1000, endedAt: 2000, turns: [{ at: 1010, who: 'you', text: 'hi' }] }],
  }

  it('accepts a well-formed one', () => {
    expect(parseArchive(good).ok).toBe(true)
  })

  it('refuses one from a newer build rather than half-reading it', () => {
    const result = parseArchive({ ...good, version: ARCHIVE_FORMAT + 1 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.problems.join(' ')).toContain('newer mochi')
  })

  it('names every problem at once', () => {
    const result = parseArchive({
      version: 1,
      sessions: [
        { startedAt: 'soon', turns: [] },
        { startedAt: 2, turns: 'no' },
      ],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.problems.length).toBeGreaterThan(1)
  })

  it('refuses a speaker it does not know', () => {
    const result = parseArchive({
      ...good,
      sessions: [{ startedAt: 1, endedAt: null, turns: [{ at: 1, who: 'someone', text: 'x' }] }],
    })
    expect(result.ok).toBe(false)
  })

  it('refuses a conversation that disagrees with itself', () => {
    // A hand-written or generated file can hold any of these, and each makes a
    // transcript the reader cannot make sense of. Refused whole, like every
    // other malformed archive, rather than stored and shown.
    const at = (startedAt: number, endedAt: number | null, times: number[]) => ({
      ...good,
      sessions: [
        {
          startedAt,
          endedAt,
          turns: times.map((t) => ({ at: t, who: 'you' as const, text: 'x' })),
        },
      ],
    })
    // Ends before it begins.
    expect(parseArchive(at(2000, 1000, [])).ok).toBe(false)
    // Something said before the conversation started, and after it ended.
    expect(parseArchive(at(1000, 2000, [500])).ok).toBe(false)
    expect(parseArchive(at(1000, 2000, [2500])).ok).toBe(false)
    // Lines that jump backwards.
    expect(parseArchive(at(1000, 2000, [1500, 1200])).ok).toBe(false)
    // And the well-formed one still passes.
    expect(parseArchive(at(1000, 2000, [1200, 1500])).ok).toBe(true)
  })

  it('refuses a file that is not an archive at all', () => {
    for (const value of [null, 42, [], 'text', {}]) {
      expect(parseArchive(value).ok, JSON.stringify(value)).toBe(false)
    }
  })

  it('reports problems rather than importing a partial archive', () => {
    const t = store()
    const result = t.importInto('ada', { version: 1, sessions: [{ startedAt: 'no', turns: [] }] })
    expect(result.ok).toBe(false)
    // Nothing landed. A half-imported history is worse than a refused one:
    // there is no way to tell which half is missing.
    expect(t.sessions('ada')).toEqual([])
  })
})
