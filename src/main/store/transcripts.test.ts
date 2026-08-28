/**
 * History, search, and the round trip through an export.
 *
 * Against a real database rather than a mock: the things most likely to be
 * wrong here are the cascade, the unique key that makes import idempotent, and
 * whether the FTS index and the readable rows stay in step — and a mock of
 * SQLite would be a mock of exactly those.
 */

import { existsSync, mkdtempSync, readFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  boundedForgetSet,
  createTranscripts,
  MOST_AT_ONCE,
  TRANSCRIPTS_FILE,
  type Transcripts,
} from './transcripts'
import { ARCHIVE_FORMAT, parseArchive } from './archive'

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
      { at: 1010, who: 'you', text: '今天我想吃苹果', cut: false },
      { at: 1020, who: 'her', text: 'That sounds good.', cut: false },
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
    t.forgetSessions('ada', [first])

    const second = conversation(t, 'ada', 2000)

    // The rowid IS handed out again -- asserted so nobody later concludes the
    // hazard was theoretical.
    expect(rowidOf(t, second)).toBe(reusedRowid)
    // The token is not. A stale one names nothing rather than the replacement.
    expect(second).not.toBe(first)
    expect(t.turns('ada', first)).toEqual([])
    expect(t.forgetSessions('ada', [first])).toBe(0)
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

  /**
   * CJK touching Latin or digits, against real FTS5.
   *
   * Found by audit 2026-08-17 and confirmed both ways: `segment` split the
   * inside of a CJK run and left its EDGES glued, so `2026年` indexed as one
   * token and `abc中文def` as `abc中 文def` — while the query side produced
   * separate terms for each. Nothing typed that way could be found again.
   *
   * Pure CJK was unaffected, which is exactly why the test above passed and
   * §29 read as fixed. This is the case that discriminates, and it is run
   * against the real tokenizer because the bug lives in the boundary between
   * our segmenting and FTS5's, which no fake reproduces.
   */
  it.each([
    ['深圳2026年的天气', '2026'],
    ['深圳2026年的天气', '年'],
    ['abc中文def', '中文'],
    ['abc中文def', 'abc'],
    ['深圳weather今天', 'weather'],
    ['深圳weather今天', '深圳'],
  ])('finds %s by %s, with CJK against letters and digits', (said, query) => {
    const t = store()
    const session = t.begin('ada')
    // `begin` returns null when the store is closed. Asserted rather than
    // asserted-away with `!`: a null here would make `say` a silent no-op and
    // the search below would fail for the wrong reason.
    expect(session, 'the store would not open a session').not.toBeNull()
    t.say(session ?? '', 'you', said, Date.now(), false)
    expect(t.search('ada', query), `${said} not findable by ${query}`).toHaveLength(1)
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

    expect(t.forgetSessions('ada', [first])).toBe(1)

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

    expect(t.forgetSessions('coach', [hers])).toBe(0)

    expect(t.sessions('ada')).toHaveLength(1)
    expect(t.turns('ada', hers)).toHaveLength(2)
  })

  it('says no to a session that is not there rather than throwing', () => {
    const t = store()
    expect(t.forgetSessions('ada', ['no-such-token'])).toBe(0)
  })

  it('drops a conversation still in progress, because it is still hers', () => {
    // Unlike pruning, which must never touch one: this is somebody asking for
    // THIS conversation to go, and refusing would leave the one on screen as
    // the only one that cannot be deleted.
    const t = store()
    const live = t.begin('ada', 1000)
    t.say(live!, 'you', 'hello', 1010)

    expect(t.forgetSessions('ada', [live!])).toBe(1)
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

    expect(t.forgetSessions('ada', [doomed])).toBe(1)

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

/*
  The `retention` suite lived here — six cases over `pruneBefore`. It went with
  the method, and with `Policy.keepDays`, which was its other half and was read
  by nothing either. Conversations are kept until somebody deletes them now.

  One case did NOT go: its own comment said it was "the reason all three delete
  paths run inside one transaction", and two of those three survive. Deleting
  the only test of a property that still holds is how a guarantee quietly stops
  being one, so it is retargeted below rather than dropped.
*/
describe('a delete that fails partway', () => {
  it('leaves everything exactly as it was', () => {
    // Without one transaction, the index rows go, the drop then fails, and
    // the conversation is left listed with nothing findable inside it — a
    // delete that reports failure and half happened, with no way to tell
    // which half.
    const t = store()
    conversation(t, 'ada', 1000)
    conversation(t, 'ada', 9000)
    const [newer] = t.sessions('ada')
    if (!newer) throw new Error('the conversation to delete should be there')
    exec(
      t,
      // On the SECOND step. `forgetSessions` clears the index rows first and
      // drops the session after, so refusing the drop is a failure with the
      // index already gone — the exact partway state one transaction exists to
      // undo. (`turn_fts` cannot carry a trigger; it is a virtual table.)
      `CREATE TRIGGER refuse BEFORE DELETE ON session WHEN old.started_at = 9000
       BEGIN SELECT raise(ABORT, 'refused'); END`,
    )

    expect(() => t.forgetSessions('ada', [newer.token])).toThrow()

    exec(t, 'DROP TRIGGER refuse')
    expect(t.sessions('ada').map((one) => one.startedAt)).toEqual([9000, 1000])
    expect(t.search('ada', '苹果')).toHaveLength(2)
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
          turns: [{ at: 1010, who: 'you', text: 'a different archive entirely', cut: false }],
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
    // Storing it open makes it live on THIS machine: the archive reports a
    // conversation with no end as one she is still awake in, so an imported
    // one would sit in the list claiming to be live and the app would appear
    // to hold two at once.
    const t = store()
    const result = t.importInto('ada', {
      version: ARCHIVE_FORMAT,
      personaId: 'ada',
      exportedAt: 3000,
      sessions: [
        {
          startedAt: 1000,
          endedAt: null,
          turns: [{ at: 1010, who: 'you', text: 'still talking', cut: false }],
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
    // Which means both have a length to show, and neither reads as live.
    expect(t.sessions('ada').every((one) => one.endedAt !== null)).toBe(true)
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
        {
          startedAt: 1000,
          endedAt: 2000,
          turns: [{ at: 1010, who: 'you', text: 'hello', cut: false }],
        },
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
    sessions: [
      { startedAt: 1000, endedAt: 2000, turns: [{ at: 1010, who: 'you', text: 'hi', cut: false }] },
    ],
  }

  it('accepts a well-formed one', () => {
    expect(parseArchive(good).ok).toBe(true)
  })

  it('refuses one from a newer build rather than half-reading it', () => {
    const result = parseArchive({ ...good, version: ARCHIVE_FORMAT + 1 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.problems.join(' ')).toContain('newer mochi')
  })

  it('refuses one from an older build rather than half-reading it', () => {
    // The same answer as a newer build gets, for the same reason. An older
    // format is not a malformed file: it made different promises, and this
    // parser can only judge it by the promises of this one.
    const result = parseArchive({ ...good, version: ARCHIVE_FORMAT - 1 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.problems.join(' ')).toContain('older mochi')
  })

  it('says the version is wrong, and ONLY that, about a real format-1 file', () => {
    // The whole reason the version returns early, checked against a file of
    // the shape it actually protects against: format 1 had no `cut`, so
    // reading these sessions on format-2 terms would add "cut must be true or
    // false" for every turn -- a list of complaints about a file that is not
    // malformed at all, burying the one problem that is true.
    const result = parseArchive({
      version: 1,
      personaId: 'ada',
      exportedAt: 1_500,
      sessions: [
        {
          startedAt: 1_000,
          endedAt: 1_100,
          turns: [
            { at: 1_010, who: 'you', text: 'from an older mochi' },
            { at: 1_020, who: 'her', text: 'that no longer exists' },
          ],
        },
      ],
    })
    expect(result.ok).toBe(false)
    if (!result.ok)
      expect(result.problems).toEqual(['this archive was written by an older mochi (format 1)'])
  })

  it('names every problem at once', () => {
    const result = parseArchive({
      version: ARCHIVE_FORMAT,
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
      // Whole in every other respect, so the speaker is the only thing left to
      // refuse it for.
      sessions: [
        { startedAt: 1, endedAt: null, turns: [{ at: 1, who: 'someone', text: 'x', cut: false }] },
      ],
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
          turns: times.map((t) => ({ at: t, who: 'you' as const, text: 'x', cut: false })),
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
    const result = t.importInto('ada', {
      version: ARCHIVE_FORMAT,
      sessions: [{ startedAt: 'no', turns: [] }],
    })
    expect(result.ok).toBe(false)
    // Nothing landed. A half-imported history is worse than a refused one:
    // there is no way to tell which half is missing.
    expect(t.sessions('ada')).toEqual([])
  })
})

describe('turns she was cut off in', () => {
  it('keeps a cut marker that has no text at all', () => {
    // The one row an "empty is silence" rule would throw away, and the one that
    // must survive: she began answering, was interrupted, and what survived
    // could not be recovered. Losing it makes the archive claim she never
    // spoke.
    const t = store()
    const live = t.begin('ada', 1_000)!
    t.say(live, 'her', '', 1_010, true)
    const turns = t.turns('ada', live)
    expect(turns).toEqual([{ at: 1_010, who: 'her', text: '', cut: true }])
  })

  it('still refuses an ordinary blank turn', () => {
    // The exception is for cut markers only. Break this and every breath the
    // wire transcribes as empty becomes a row.
    const t = store()
    const live = t.begin('ada', 1_000)!
    t.say(live, 'her', '   ', 1_010, false)
    expect(t.turns('ada', live)).toEqual([])
  })

  it('a cut marker matches no search, because it has nothing to match', () => {
    const t = store()
    const live = t.begin('ada', 1_000)!
    t.say(live, 'her', '', 1_010, true)
    t.say(live, 'you', 'apples', 1_020)
    expect(t.search('ada', 'apples')).toHaveLength(1)
  })

  it('remembers a cut turn that DOES have text', () => {
    const t = store()
    const live = t.begin('ada', 1_000)!
    t.say(live, 'her', 'I was explaining', 1_010, true)
    expect(t.turns('ada', live)[0]).toEqual({
      at: 1_010,
      who: 'her',
      text: 'I was explaining',
      cut: true,
    })
  })
})

describe('the cut column and databases written before it existed', () => {
  it('migrates a database created by the previous schema', () => {
    // `CREATE TABLE IF NOT EXISTS` does NOT add a column to a table that is
    // already there, so without the additive migration this file would open an
    // old database and read `undefined` for every `cut`. Built by hand at the
    // OLD shape rather than by an old build, because the old build is gone.
    const home = mkdtempSync(join(tmpdir(), 'mochi-history-old-'))
    const path = join(home, TRANSCRIPTS_FILE)
    const old = new DatabaseSync(path)
    old.exec(`
      CREATE TABLE session (
        id INTEGER PRIMARY KEY, persona_id TEXT NOT NULL, started_at INTEGER NOT NULL,
        ended_at INTEGER, UNIQUE (persona_id, started_at)
      );
      CREATE TABLE turn (
        id INTEGER PRIMARY KEY,
        session_id INTEGER NOT NULL REFERENCES session(id) ON DELETE CASCADE,
        at INTEGER NOT NULL, who TEXT NOT NULL, text TEXT NOT NULL
      );
      CREATE VIRTUAL TABLE turn_fts USING fts5(body, turn_id UNINDEXED, persona_id UNINDEXED);
      INSERT INTO session (persona_id, started_at, ended_at) VALUES ('ada', 1000, 1100);
      INSERT INTO turn (session_id, at, who, text) VALUES (1, 1010, 'you', 'said before the column existed');
    `)
    old.close()

    const t = createTranscripts(home)
    open.push(t)
    // Opening it must not throw, and the old row must read as not-cut rather
    // than as undefined — nothing written before the column existed knew it had
    // been interrupted.
    const sessions = t.sessions('ada')
    expect(sessions).toHaveLength(1)
    const turns = t.turns('ada', sessions[0]!.token)
    expect(turns).toEqual([
      { at: 1_010, who: 'you', text: 'said before the column existed', cut: false },
    ])
    // And the migrated database accepts a cut turn afterwards.
    const live = t.begin('ada', 2_000)!
    t.say(live, 'her', '', 2_010, true)
    expect(t.turns('ada', live)).toEqual([{ at: 2_010, who: 'her', text: '', cut: true }])
  })
})

describe('a cut turn through export and import', () => {
  it('does not come back looking whole', () => {
    const source = store()
    const live = source.begin('ada', 1_000)!
    source.say(live, 'her', 'I was expl', 1_010, true)
    source.say(live, 'you', 'never mind', 1_020)
    source.end(live, 1_030)

    const archive = source.exportFor('ada')
    expect(archive.version).toBe(ARCHIVE_FORMAT)

    const parsed = parseArchive(archive)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    const target = store()
    target.importInto('bo', parsed.archive)
    const sessions = target.sessions('bo')
    expect(sessions).toHaveLength(1)
    const turns = target.turns('bo', sessions[0]!.token)
    // The cut survived the round trip. Without it the importer would present a
    // partial sentence as something she finished saying.
    expect(turns).toEqual([
      { at: 1_010, who: 'her', text: 'I was expl', cut: true },
      { at: 1_020, who: 'you', text: 'never mind', cut: false },
    ])
  })
})

describe('a turn written down after the one that interrupted it', () => {
  it('still reads back in the order it was SPOKEN', () => {
    // Her text is released when her audio ends, so an interrupted answer is
    // written AFTER the user turn that cut it off. Reading by insertion order
    // would show the interruption before the answer it interrupted.
    const t = store()
    const live = t.begin('ada', 1_000)!
    t.say(live, 'you', 'what do you think?', 1_050)
    t.say(live, 'you', 'wait, stop', 1_500)
    // Written last, spoken second.
    t.say(live, 'her', 'I was saying that', 1_100, true)
    expect(t.turns('ada', live).map((turn) => turn.text)).toEqual([
      'what do you think?',
      'I was saying that',
      'wait, stop',
    ])
  })
})

describe('importing an archive that contains an interrupted turn', () => {
  it('is idempotent — the same archive twice does not double the conversation', () => {
    // `sameConversation` used to filter blank turns out of the incoming side,
    // so an archive holding a blank cut marker never matched what it had
    // itself produced, and a second import made a duplicate conversation.
    const source = store()
    const live = source.begin('ada', 1_000)!
    source.say(live, 'her', '', 1_010, true)
    source.say(live, 'you', 'never mind', 1_020)
    source.end(live, 1_030)
    const archive = source.exportFor('ada')

    const target = store()
    const parsed = parseArchive(archive)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    target.importInto('bo', parsed.archive)
    const again = target.importInto('bo', parsed.archive)
    // SKIPPED, not conflicted — and that distinction is the whole test. A
    // session count of 1 is true either way, because a conflict is refused
    // rather than added; only the counts say whether the archive recognised
    // its own previous work.
    expect(again).toMatchObject({ skipped: 1, conflicts: 0 })
    expect(target.sessions('bo')).toHaveLength(1)
  })

  it('does not treat a cut turn and a whole turn with the same words as one', () => {
    // One of them is a fragment. Matching them would let an import silently
    // decide an interrupted answer had already been stored as a finished one.
    const source = store()
    const a = source.begin('ada', 1_000)!
    source.say(a, 'her', 'I was expl', 1_010, true)
    source.end(a, 1_030)
    const archive = source.exportFor('ada')

    const target = store()
    const whole = target.begin('bo', 1_000)!
    target.say(whole, 'her', 'I was expl', 1_010, false)
    target.end(whole, 1_030)

    const parsed = parseArchive(archive)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    // `(persona_id, started_at)` is unique, so a differing conversation at the
    // same instant cannot simply be added — it is COUNTED as a conflict and
    // reported, never silently folded into the one already here.
    const result = target.importInto('bo', parsed.archive)
    expect(result).toMatchObject({ conflicts: 1 })
    expect(target.sessions('bo')).toHaveLength(1)
  })
})

describe('searching the way SHE searches', () => {
  it('finds the conversation from a remembered PHRASE, not just one word', () => {
    // The failure, from a real session: she was asked "do you remember what we
    // chatted about last time?", searched `audio voice transcript hear full
    // transcript`, and reported that she had no record — while the database
    // held the conversation. Space-separated terms are an AND in FTS5, so one
    // turn had to contain every one of those six words.
    const t = store()
    const live = t.begin('ada', 1_000)!
    t.say(live, 'you', 'I cannot hear your voice', 1_010)
    t.say(live, 'her', 'you may need to check your audio setup', 1_020)
    t.say(live, 'you', 'why can I not hear your full transcript', 1_030)
    t.end(live, 1_040)

    const hits = t.search('ada', 'audio voice transcript hear full transcript')
    expect(hits.length, 'a remembered phrase found nothing').toBeGreaterThan(0)
  })

  it('still prefers the turn that matches ALL the words', () => {
    // Widening must not cost precision. The exact form runs first, and only an
    // empty result widens it.
    const t = store()
    const live = t.begin('ada', 1_000)!
    t.say(live, 'you', 'the camino walk across spain', 1_010)
    t.say(live, 'her', 'walk', 1_020)
    t.say(live, 'her', 'spain', 1_030)
    t.end(live, 1_040)

    const hits = t.search('ada', 'camino walk spain')
    // Exactly the one turn holding all three — the AND matched, so nothing widened.
    expect(hits.map((hit) => hit.text)).toEqual(['the camino walk across spain'])
  })

  it('finds nothing when nothing is related, rather than everything', () => {
    // The risk of widening: an OR over common words returning the whole
    // archive. Words that appear nowhere must still return nothing.
    const t = store()
    const live = t.begin('ada', 1_000)!
    t.say(live, 'you', 'the camino walk across spain', 1_010)
    t.end(live, 1_020)
    expect(t.search('ada', 'quantum tungsten bicycle')).toEqual([])
  })

  it('widens a Chinese query too', () => {
    const t = store()
    const live = t.begin('ada', 1_000)!
    t.say(live, 'you', '今天我想吃苹果', 1_010)
    t.say(live, 'her', '老师说苹果很好', 1_020)
    t.end(live, 1_030)
    // Two CJK runs that share no single turn holding both.
    expect(t.search('ada', '苹果 老师').length).toBeGreaterThan(0)
  })
})

/**
 * A stale token must not be able to append to a conversation that is over.
 *
 * `say` used to check only that the token still RESOLVED, which is a weaker
 * claim than it needs: a handle held past `end()` — a late transcript arriving
 * during teardown, a caller that kept the value — appended turns to a finished
 * conversation, including turns dated after its own end. The archive parser in
 * this same file refuses exactly that shape on the way back in, so the store
 * was producing files it would not accept.
 */
describe('writing into a conversation that has already ended', () => {
  it('is refused rather than appended', () => {
    const t = store()
    const live = t.begin('ada', 1_000)
    if (live === null) throw new Error('that instant was already taken')
    t.say(live, 'you', 'hello', 1_010)
    t.end(live, 1_020)

    t.say(live, 'her', 'and one more thing', 1_030)

    expect(t.turns('ada', live)).toHaveLength(1)
    // The export it would otherwise have produced is one this file's own
    // parser refuses.
    expect(parseArchive(JSON.parse(JSON.stringify(t.exportFor('ada'))) as unknown).ok).toBe(true)
  })

  it('keeps a turn dated before the conversation began, at the start', () => {
    /*
      CHANGED FROM "refuses" ON 2026-08-26, and the reason it guarded is kept.

      This asserted that such a turn is DROPPED. The concern behind it was that
      the archive parser in this file refuses `at < started_at`, so storing one
      produces an export this store cannot read back -- and that concern is
      real, which is why the round-trip below is asserted rather than removed.

      Dropping was the wrong way to satisfy it. The value arrives from the
      renderer via `Date.now()`, and the ordinary way it goes backwards is an
      NTP correction: after one, EVERY remaining turn is dated before the
      start, so the conversation records nothing for as long as the offset
      lasts and nothing surfaces it. Clamping keeps the words and still exports
      cleanly, which is what this now checks.
    */
    const t = store()
    const live = t.begin('ada', 1_000)
    if (live === null) throw new Error('that instant was already taken')
    t.say(live, 'you', 'from before', 500)

    const turns = t.turns('ada', live)
    expect(turns).toHaveLength(1)
    expect(turns[0]?.text).toBe('from before')
    expect(turns[0]?.at).toBe(1_000)
    // The original concern, still guarded.
    expect(parseArchive(JSON.parse(JSON.stringify(t.exportFor('ada'))) as unknown).ok).toBe(true)
  })

  it('keeps an end dated before the beginning readable, at the start', () => {
    // `say` argued this case at length and `end` did not apply its own
    // argument. One session with `ended_at < started_at` makes the user's
    // WHOLE export unimportable, not just that conversation.
    const t = store()
    const live = t.begin('ada', 10_000)
    if (live === null) throw new Error('that instant was already taken')
    t.say(live, 'you', 'hello', 10_010)
    t.end(live, 5_000)
    expect(parseArchive(JSON.parse(JSON.stringify(t.exportFor('ada'))) as unknown).ok).toBe(true)
  })
})

/**
 * Importing the same archive twice was not idempotent when it held an OPEN
 * conversation: the first import closes it at its last turn — it must, or the
 * conversation lives on forever and retention never reaches it — and the second
 * import then compared that stored end against an incoming `null`, decided they
 * disagreed, and reported a conflict for a file it had already stored perfectly.
 */
describe('importing the same archive twice', () => {
  const openArchive = {
    version: ARCHIVE_FORMAT,
    personaId: 'ada',
    exportedAt: 3_000,
    sessions: [
      {
        startedAt: 1_000,
        endedAt: null,
        turns: [{ at: 1_010, who: 'you' as const, text: 'still talking', cut: false }],
      },
    ],
  }

  it('is a no-op the second time, even for a conversation that was still open', () => {
    const t = store()
    const first = t.importInto('ada', openArchive)
    expect(first.ok).toBe(true)
    if (first.ok) expect(first).toMatchObject({ sessions: 1, skipped: 0, conflicts: 0 })

    const second = t.importInto('ada', openArchive)
    expect(second.ok).toBe(true)
    if (second.ok)
      expect(second, 'a re-import was reported as a conflict').toMatchObject({
        sessions: 0,
        skipped: 1,
        conflicts: 0,
      })
    expect(t.sessions('ada')).toHaveLength(1)
  })

  it('still reports a real disagreement about the ending', () => {
    const t = store()
    t.importInto('ada', openArchive)
    const later = t.importInto('ada', {
      ...openArchive,
      sessions: [{ ...openArchive.sessions[0]!, endedAt: 9_000 }],
    })
    expect(later.ok).toBe(true)
    if (later.ok) expect(later).toMatchObject({ skipped: 0, conflicts: 1 })
  })
})

/**
 * `-1` was the "no turns" sentinel in a file that elsewhere points out that
 * `-1` is a legitimate timestamp.
 */
describe('a conversation whose last turn is at -1', () => {
  it('is not closed before the thing said in it', () => {
    const t = store()
    const result = t.importInto('ada', {
      version: ARCHIVE_FORMAT,
      personaId: 'ada',
      exportedAt: 0,
      sessions: [
        {
          startedAt: -5_000,
          endedAt: null,
          turns: [{ at: -1, who: 'you' as const, text: 'before the epoch', cut: false }],
        },
      ],
    })
    expect(result.ok).toBe(true)
    expect(t.sessions('ada')[0]?.endedAt, 'closed at its own start, before its last turn').toBe(-1)
    // Which is what makes the export readable again.
    expect(parseArchive(JSON.parse(JSON.stringify(t.exportFor('ada'))) as unknown).ok).toBe(true)
  })
})

/**
 * When two formats made different promises about `cut`, `cut === true` treated
 * them identically — so a malformed archive turned an interrupted fragment
 * into an apparently complete statement. One format, one promise, is the
 * shape that cannot do that.
 */
describe('the cut field', () => {
  const withCut = (cut: unknown): unknown => ({
    version: ARCHIVE_FORMAT,
    personaId: 'ada',
    exportedAt: 1,
    sessions: [
      {
        startedAt: 1_000,
        endedAt: 2_000,
        turns: [{ at: 1_010, who: 'you', text: 'hi', ...(cut === undefined ? {} : { cut }) }],
      },
    ],
  })

  it('is required, and must be a boolean', () => {
    // ABSENT is a refusal, not a false. It was a false while format 1 was
    // readable, and defaulting it is the one way a fragment reaches the store
    // dressed as a finished sentence.
    const missing = parseArchive(withCut(undefined))
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.problems.join(' ')).toContain('cut must be true or false')
    expect(parseArchive(withCut('true')).ok).toBe(false)
    expect(parseArchive(withCut(1)).ok).toBe(false)
    expect(parseArchive(withCut(null)).ok).toBe(false)
    expect(parseArchive(withCut(true)).ok).toBe(true)
    expect(parseArchive(withCut(false)).ok).toBe(true)
  })
})

describe('the one-connection registry', () => {
  it('refuses a second connection reached through a symlinked alias', () => {
    const home = mkdtempSync(join(tmpdir(), 'mochi-history-'))
    const alias = join(mkdtempSync(join(tmpdir(), 'mochi-alias-')), 'link')
    symlinkSync(home, alias)
    const first = createTranscripts(home)
    open.push(first)
    // Lexically these are two different strings for one file. `busy_timeout` is
    // 0, so the second connection would meet SQLITE_BUSY on its first write —
    // which is the failure the registry exists to make impossible.
    expect(() => createTranscripts(alias)).toThrow(/already open/)
  })

  it('keeps the path registered when a close fails, so nothing can open it twice', () => {
    // Releasing first meant a failing close let another connection open the
    // same file while this handle was still live.
    const t = store()
    const home = homes.get(t) ?? ''
    t.close()
    open.splice(open.indexOf(t), 1)
    // A clean close DOES release it, which is the other half of the claim.
    const again = createTranscripts(home)
    open.push(again)
    expect(again.sessions('ada')).toEqual([])
  })
})

describe('the store as a bag of functions', () => {
  it('exports without depending on how it was called', () => {
    // `exportFor` was the one method that read `this`, so destructuring it off
    // the object — which nothing in the interface forbids — threw.
    const t = store()
    const live = t.begin('ada', 1_000)
    if (live === null) throw new Error('that instant was already taken')
    t.say(live, 'you', 'hello', 1_010)
    t.end(live, 1_020)
    const { exportFor } = t
    expect(exportFor('ada').sessions[0]?.turns).toHaveLength(1)
  })
})

/**
 * Deleted words do not linger in the write-ahead log.
 *
 * `secure_delete` scrubs a freed page in the FILE. In WAL mode the delete lands
 * in the log first, and the log still holds the frames that carried the text.
 * So the checkpoint is the deletion, as far as the bytes on disk are concerned
 * -- and until this work item, the only retry for a checkpoint a reader held
 * off was `close()`, which nothing called.
 */
describe('a scrub a reader held off comes back on its own', () => {
  it('clears the log without waiting for the app to quit', async () => {
    /*
      The defect this fixes. A failed checkpoint used to be retried only by the
      next destructive call, or by `close()` -- which nothing called. So a
      conversation deleted this morning could still be readable from
      `transcripts.db-wal` at midnight, while the app reported it gone.

      Timers are faked, and the store is NOT closed: closing folds the log
      anyway, which is what makes the close-path version of this test unable to
      tell the fix from its absence.
    */
    vi.useFakeTimers()
    try {
      const t = store()
      const home = homes.get(t) ?? ''
      const token = t.begin('ada', 1_000)
      if (token === null) throw new Error('that instant was already taken')
      t.say(token, 'you', 'CANARY-retried-away', 1_010)
      t.end(token, 2_000)

      const inTheLog = (): boolean => {
        try {
          return readFileSync(join(home, 'transcripts.db-wal'), 'latin1').includes(
            'CANARY-retried-away',
          )
        } catch {
          return false
        }
      }

      const reader = new DatabaseSync(join(home, 'transcripts.db'))
      reader.exec('BEGIN')
      reader.prepare('SELECT count(*) FROM session').get()

      expect(t.forgetSessions('ada', [token])).toBe(1)
      expect(inTheLog(), 'the reader should have held the checkpoint off').toBe(true)

      // The reader lets go, and nothing else destructive happens.
      reader.exec('COMMIT')
      reader.close()
      expect(inTheLog()).toBe(true)

      vi.advanceTimersByTime(5_000)
      expect(inTheLog(), 'nothing came back for it').toBe(false)

      t.close()
      open.splice(open.indexOf(t), 1)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('deleted text leaves the write-ahead log', () => {
  it('is gone from the files once the store is closed', () => {
    const t = store()
    const home = homes.get(t) ?? ''
    // `begin` directly, not the helper: the helper ENDS the conversation, and a
    // turn filed after that is refused -- correctly, and loudly.
    const token = t.begin('ada', 1_000)
    if (token === null) throw new Error('that instant was already taken')
    t.say(token, 'you', 'CANARY-must-not-survive-deletion', 1_010)
    t.end(token, 2_000)

    // Present somewhere before the delete, or the test proves nothing.
    const anywhere = (): string =>
      ['transcripts.db', 'transcripts.db-wal', 'transcripts.db-shm']
        .map((name) => {
          try {
            return readFileSync(join(home, name), 'latin1')
          } catch {
            return ''
          }
        })
        .join('')
    expect(anywhere()).toContain('CANARY-must-not-survive-deletion')

    /*
      With a reader HOLDING the log, which is the case the retry exists for.
      Without one the delete's own checkpoint succeeds immediately and the
      close path is never exercised -- the test would pass with `close()`
      gutted, which is exactly the defect being fixed.
    */
    const reader = new DatabaseSync(join(home, 'transcripts.db'))
    reader.exec('BEGIN')
    reader.prepare('SELECT count(*) FROM session').get()

    expect(t.forgetSessions('ada', [token])).toBe(1)
    // Held off, so the words are still in the log.
    expect(anywhere()).toContain('CANARY-must-not-survive-deletion')

    reader.exec('COMMIT')
    reader.close()

    t.close()
    open.splice(open.indexOf(t), 1)

    expect(anywhere()).not.toContain('CANARY-must-not-survive-deletion')
  })
})

/**
 * A confirmed batch is one transaction.
 *
 * Deleting several by calling the single-conversation delete in a loop gives one
 * transaction and one scrub EACH: a failure at the second leaves the first
 * permanently gone, after a single confirmation that named three. The unit the
 * user agreed to is the batch, so the batch is the unit that commits.
 */
describe('deleting several of hers', () => {
  it('leaves every one of them when any one of them fails', () => {
    const t = store()
    const a = conversation(t, 'ada', 1_000)
    const b = conversation(t, 'ada', 9_000)
    const c = conversation(t, 'ada', 20_000)

    // Refuse the SECOND, so the first is already deleted when it happens.
    exec(
      t,
      `CREATE TRIGGER refuse BEFORE DELETE ON session WHEN old.started_at = 9000
       BEGIN SELECT raise(ABORT, 'refused'); END`,
    )

    expect(() => t.forgetSessions('ada', [a, b, c])).toThrow()

    exec(t, 'DROP TRIGGER refuse')
    // All three, including the one deleted before the failure -- which a loop
    // over a single-conversation delete would have committed and lost.
    expect(
      t
        .sessions('ada')
        .map((one) => one.token)
        .sort(),
    ).toEqual([a, b, c].sort())
    // And their words are still findable, so no index row was orphaned.
    expect(t.search('ada', '苹果')).toHaveLength(3)
  })

  it('collapses duplicates and counts only what was really there', () => {
    const t = store()
    const a = conversation(t, 'ada', 1_000)
    // Twice over, plus one that does not exist. Already-gone is the outcome
    // being asked for, not an error -- failing the batch over one would make
    // "delete them one at a time" the safe answer, which is what this avoids.
    expect(t.forgetSessions('ada', [a, a, 'no-such-token'])).toBe(1)
    expect(t.sessions('ada')).toHaveLength(0)
  })

  it('refuses to be handed an unreasonable pile', () => {
    const t = store()
    const a = conversation(t, 'ada', 1_000)
    const flood = Array.from({ length: 100_000 }, (_, i) => `token-${String(i)}`)
    // Bounded before the transaction opens: a payload this size did not come
    // from somebody clicking, and the transaction should not find out the hard
    // way. The real one is still in the first thousand, so it goes.
    expect(t.forgetSessions('ada', [a, ...flood])).toBe(1)
  })

  it('never reaches another character', () => {
    const t = store()
    const hers = conversation(t, 'ada', 1_000)
    const his = conversation(t, 'coach', 2_000)
    expect(t.forgetSessions('coach', [hers, his])).toBe(1)
    expect(t.sessions('ada')).toHaveLength(1)
  })
})

describe('what a forget request actually acts on', () => {
  it('is the same answer for the store and for its caller', () => {
    /*
      The bound was applied in `forgetSessions` and NOT where the caller decides
      whether the live conversation was among the deleted — `main/index.ts` read
      its own unbounded list. So a request naming more than `MOST_AT_ONCE`
      released the live token while its rows were still on disk: recording
      restarted into a fresh conversation and the old one stayed.

      Asserted as the property rather than as a number, so the two cannot drift
      apart again if the limit moves.
    */
    const flood = Array.from({ length: MOST_AT_ONCE + 50 }, (_, i) => `t${String(i)}`)
    const live = 'the-live-one'
    const bounded = boundedForgetSet([...flood, live])
    // The live token fell off the end, so the caller must NOT release it.
    expect(bounded).not.toContain(live)
    expect(bounded).toHaveLength(MOST_AT_ONCE)
  })

  it('keeps a genuine token that sits among a flood', () => {
    // The original decision this bound exists for, restated: a real token in
    // the first thousand still goes.
    const flood = Array.from({ length: MOST_AT_ONCE + 50 }, (_, i) => `t${String(i)}`)
    expect(boundedForgetSet(['real', ...flood])).toContain('real')
  })

  it('collapses duplicates before counting against the limit', () => {
    expect(boundedForgetSet(['a', 'a', 'b'])).toEqual(['a', 'b'])
  })
})

describe('her old kept store is removed, not merely stopped being made', () => {
  /*
    `keep`, `look_up` and `forget_kept` went on 2026-08-26 because `usage.json`
    recorded no call to any of them, ever. Dropping the `CREATE TABLE` from
    `schema.ts` does nothing to a database that already HAS the table, so
    without this the rows would sit on disk indefinitely: no reader, no export,
    no way for anybody to remove them. That is the opposite of what every other
    deletion path in this store promises.
  */
  function withOldStore(): string {
    const home = mkdtempSync(join(tmpdir(), 'mochi-history-kept-'))
    const path = join(home, TRANSCRIPTS_FILE)
    const old = new DatabaseSync(path)
    old.exec(`
      CREATE TABLE session (
        id INTEGER PRIMARY KEY, persona_id TEXT NOT NULL, started_at INTEGER NOT NULL,
        ended_at INTEGER, token TEXT, UNIQUE (persona_id, started_at)
      );
      CREATE TABLE turn (
        id INTEGER PRIMARY KEY,
        session_id INTEGER NOT NULL REFERENCES session(id) ON DELETE CASCADE,
        at INTEGER NOT NULL, who TEXT NOT NULL, text TEXT NOT NULL,
        cut INTEGER NOT NULL DEFAULT 0
      );
      CREATE VIRTUAL TABLE turn_fts USING fts5(body, turn_id UNINDEXED, persona_id UNINDEXED);
      CREATE TABLE kept (
        persona_id TEXT NOT NULL, collection TEXT NOT NULL, key TEXT NOT NULL,
        value TEXT NOT NULL, previous TEXT, updated_at INTEGER NOT NULL,
        PRIMARY KEY (persona_id, collection, key)
      );
      CREATE INDEX kept_by_collection ON kept (persona_id, collection, updated_at DESC);
      INSERT INTO kept (persona_id, collection, key, value, updated_at)
        VALUES ('ada', 'projects', 'one', 'something she was asked to keep', 1000);
    `)
    old.close()
    return home
  }

  it('opens a database that still has it, and takes it away', () => {
    const home = withOldStore()
    const t = createTranscripts(home)
    open.push(t)

    const probe = new DatabaseSync(join(home, TRANSCRIPTS_FILE))
    try {
      const table = probe
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'kept'")
        .get()
      expect(table, 'the table is still there').toBeUndefined()
      const index = probe
        .prepare("SELECT name FROM sqlite_master WHERE name = 'kept_by_collection'")
        .get()
      expect(index, 'its index outlived it').toBeUndefined()
    } finally {
      probe.close()
    }
  })

  it('does not leave the words legible in a freed page', () => {
    /*
      The OUTCOME, not a mechanism, and that distinction was earned.

      This test first carried a comment claiming the schema had to `DELETE`
      before it could `DROP`, because `secure_delete` was said to zero pages
      only as rows are deleted. Running the test against a schema with the
      `DELETE` removed passed — so the comment was describing a mechanism that
      was not the one working.

      Measured instead (2026-08-27, 200 rows, journal mode `delete`): with
      `PRAGMA secure_delete = ON` a bare `DROP TABLE` leaves nothing readable,
      and with it OFF the text survives even a `DELETE` first. The pragma is
      the guarantee; the statement is not.

      So what this asserts is the property somebody actually has — her words are
      not recoverable from the file — and it fails if the pragma is ever lost,
      which is the failure worth catching.
    */
    const home = withOldStore()
    const t = createTranscripts(home)
    open.push(t)
    t.close()
    open.pop()

    const bytes = readFileSync(join(home, TRANSCRIPTS_FILE))
    expect(bytes.includes(Buffer.from('something she was asked to keep'))).toBe(false)
  })

  it('costs an ordinary database nothing but one lookup', () => {
    // A fresh store has never had the table, so the guard must not write.
    const t = store()
    expect(() => t.begin('ada')).not.toThrow()
  })
})

/**
 * What she reached for, filed against the conversation she reached in.
 *
 * The archive header has drawn `ask_workspace ×2` since it was designed and
 * nothing stored it, so the chips were left out rather than faked. These are
 * the assertions that let them be drawn.
 */
describe('capabilities she called', () => {
  it('is empty for a conversation where she called nothing', () => {
    // The ordinary case. A caller that had to tell "none" from "not loaded"
    // would get it wrong once.
    const t = store()
    const live = t.begin('ada', 1_000)
    if (live === null) throw new Error('no conversation')
    t.say(live, 'you', 'hello', 1_001)
    expect(t.sessions('ada')[0]?.tools).toEqual([])
  })

  it('counts each capability separately, by name', () => {
    const t = store()
    const live = t.begin('ada', 1_000)
    if (live === null) throw new Error('no conversation')
    t.say(live, 'you', 'look something up', 1_001)
    t.tooled(live, 'ask_workspace', 1_002)
    t.tooled(live, 'ask_workspace', 1_003)
    t.tooled(live, 'remember_this', 1_004)
    expect(t.sessions('ada')[0]?.tools).toEqual([
      { name: 'ask_workspace', uses: 2 },
      { name: 'remember_this', uses: 1 },
    ])
  })

  it('keeps one row per call rather than a tally', () => {
    // A count is derivable from rows and rows are not derivable from a count.
    // What is lost by storing a tally is WHEN in the conversation she reached.
    const t = store()
    const live = t.begin('ada', 1_000)
    if (live === null) throw new Error('no conversation')
    t.say(live, 'you', 'twice', 1_001)
    t.tooled(live, 'ask_workspace', 1_002)
    t.tooled(live, 'ask_workspace', 1_009)
    expect(count(t, 'SELECT count(*) AS n FROM session_tool')).toBe(2)
    expect(count(t, 'SELECT count(DISTINCT at) AS n FROM session_tool')).toBe(2)
  })

  it('does not leak one conversation calls into another', () => {
    const t = store()
    const first = t.begin('ada', 1_000)
    const second = t.begin('ada', 2_000)
    if (first === null || second === null) throw new Error('no conversation')
    t.say(first, 'you', 'one', 1_001)
    t.say(second, 'you', 'two', 2_001)
    t.tooled(first, 'ask_workspace', 1_002)
    const sessions = t.sessions('ada')
    expect(sessions.find((one) => one.token === first)?.tools).toEqual([
      { name: 'ask_workspace', uses: 1 },
    ])
    expect(sessions.find((one) => one.token === second)?.tools).toEqual([])
  })

  it('does not leak across characters', () => {
    // Every read in this store takes the persona. A query that fetched every
    // session's tools and narrowed afterwards leaks through the first caller
    // who forgets to narrow.
    const t = store()
    const hers = t.begin('ada', 1_000)
    const theirs = t.begin('bob', 1_000)
    if (hers === null || theirs === null) throw new Error('no conversation')
    t.say(hers, 'you', 'mine', 1_001)
    t.say(theirs, 'you', 'yours', 1_001)
    t.tooled(hers, 'ask_workspace', 1_002)
    t.tooled(theirs, 'remember_this', 1_002)
    expect(t.sessions('ada')[0]?.tools).toEqual([{ name: 'ask_workspace', uses: 1 }])
    expect(t.sessions('bob')[0]?.tools).toEqual([{ name: 'remember_this', uses: 1 }])
  })

  it('counts turns correctly when a conversation also has tool calls', () => {
    /*
      The join this table was NOT allowed to be. `sessions` already groups to
      count turns; joining a second one-to-many through it multiplies the rows
      before the count runs, so three turns and two calls would report six
      turns. Asserted because it is invisible until somebody uses both.
    */
    const t = store()
    const live = t.begin('ada', 1_000)
    if (live === null) throw new Error('no conversation')
    t.say(live, 'you', 'one', 1_001)
    t.say(live, 'her', 'two', 1_002)
    t.say(live, 'you', 'three', 1_003)
    t.tooled(live, 'ask_workspace', 1_004)
    t.tooled(live, 'remember_this', 1_005)
    expect(t.sessions('ada')[0]?.turns).toBe(3)
  })

  it('forgets them with the conversation they belong to', () => {
    /*
      The privacy half, and the reason it is asserted against the TABLE rather
      than through `sessions()`. A row the cascade left behind is invisible to
      every query that joins through `session` — which is how deleting
      `PRAGMA foreign_keys = ON` left thirty tests in this file green.
    */
    const t = store()
    const live = t.begin('ada', 1_000)
    if (live === null) throw new Error('no conversation')
    t.say(live, 'you', 'hello', 1_001)
    t.tooled(live, 'ask_workspace', 1_002)
    expect(count(t, 'SELECT count(*) AS n FROM session_tool')).toBe(1)
    expect(t.forgetSessions('ada', [live])).toBe(1)
    expect(count(t, 'SELECT count(*) AS n FROM session_tool')).toBe(0)
  })

  it('files nothing when the token names no open conversation', () => {
    // Ordinary rather than an error: she can call a capability in a session
    // where nobody has spoken, and `begin` does not open one until the first
    // turn — so there is genuinely nowhere to put it.
    const t = store()
    expect(() => {
      t.tooled('a-token-that-is-not-hers', 'ask_workspace', 1_000)
    }).not.toThrow()
    expect(count(t, 'SELECT count(*) AS n FROM session_tool')).toBe(0)
  })

  it('refuses an instant the store could not read back', () => {
    // `instant.ts` exists because one of three write paths was missing the
    // check the other two had. This is the fourth.
    const t = store()
    const live = t.begin('ada', 1_000)
    if (live === null) throw new Error('no conversation')
    t.say(live, 'you', 'hello', 1_001)
    t.tooled(live, 'ask_workspace', 1e17)
    expect(count(t, 'SELECT count(*) AS n FROM session_tool')).toBe(0)
  })
})

/**
 * What a conversation was about, stored beside it.
 *
 * The archive drew a subject line in the artifact and had nothing to put there,
 * so it was left out rather than filled with the first line of the transcript.
 * `plan-v2.md` W5 says why that alternative is worse than nothing.
 */
describe('what a conversation was about', () => {
  it('is null until something titles it', () => {
    const t = store()
    const live = t.begin('ada', 1_000)
    if (live === null) throw new Error('no conversation')
    t.say(live, 'you', 'hello', 1_001)
    expect(t.sessions('ada')[0]?.subject).toBeNull()
  })

  it('keeps a subject once one is written', () => {
    const t = store()
    const live = t.begin('ada', 1_000)
    if (live === null) throw new Error('no conversation')
    t.say(live, 'you', 'the parser', 1_001)
    t.end(live, 1_002)
    expect(t.retitle('ada', live, 'the parser and its comma')).toBe(true)
    expect(t.sessions('ada')[0]?.subject).toBe('the parser and its comma')
  })

  it('refuses to title a conversation that has not ended', () => {
    // One still being had is not finished being about anything, and titling it
    // mid-sentence would pin a subject to its first half.
    const t = store()
    const live = t.begin('ada', 1_000)
    if (live === null) throw new Error('no conversation')
    t.say(live, 'you', 'still talking', 1_001)
    expect(t.retitle('ada', live, 'too early')).toBe(false)
    expect(t.sessions('ada')[0]?.subject).toBeNull()
  })

  it('refuses to title another character conversation', () => {
    // Scoped in the statement, like every write here: ownership is settled by
    // the write that actually ran, not by a read a moment earlier.
    const t = store()
    const theirs = t.begin('bob', 1_000)
    if (theirs === null) throw new Error('no conversation')
    t.say(theirs, 'you', 'theirs', 1_001)
    t.end(theirs, 1_002)
    expect(t.retitle('ada', theirs, 'not mine to name')).toBe(false)
    expect(t.sessions('bob')[0]?.subject).toBeNull()
  })

  it('clears a subject when handed null, so a re-title is not additive', () => {
    const t = store()
    const live = t.begin('ada', 1_000)
    if (live === null) throw new Error('no conversation')
    t.say(live, 'you', 'x', 1_001)
    t.end(live, 1_002)
    t.retitle('ada', live, 'first answer')
    expect(t.retitle('ada', live, null)).toBe(true)
    expect(t.sessions('ada')[0]?.subject).toBeNull()
  })

  it('refuses one that is empty or over the bound', () => {
    // The store is the last thing before disk. `subjectFrom` checks what a
    // model said; this checks what any caller passes.
    const t = store()
    const live = t.begin('ada', 1_000)
    if (live === null) throw new Error('no conversation')
    t.say(live, 'you', 'x', 1_001)
    t.end(live, 1_002)
    expect(t.retitle('ada', live, '   ')).toBe(false)
    expect(t.retitle('ada', live, 'x'.repeat(81))).toBe(false)
    expect(t.sessions('ada')[0]?.subject).toBeNull()
  })
})

describe('which conversations still need a subject', () => {
  it('answers the ended, spoken-in, untitled ones, newest first', () => {
    const t = store()
    const older = t.begin('ada', 1_000)
    const newer = t.begin('ada', 2_000)
    if (older === null || newer === null) throw new Error('no conversation')
    t.say(older, 'you', 'one', 1_001)
    t.say(newer, 'you', 'two', 2_001)
    t.end(older, 1_002)
    t.end(newer, 2_002)
    expect(t.untitled('ada', 10)).toEqual([newer, older])
  })

  it('leaves out one that is still being had', () => {
    const t = store()
    const live = t.begin('ada', 1_000)
    if (live === null) throw new Error('no conversation')
    t.say(live, 'you', 'talking', 1_001)
    expect(t.untitled('ada', 10)).toEqual([])
  })

  it('leaves out one nobody spoke in', () => {
    // Asking a model about an empty transcript is a subprocess spent to be
    // told so.
    const t = store()
    const live = t.begin('ada', 1_000)
    if (live === null) throw new Error('no conversation')
    t.end(live, 1_002)
    expect(t.untitled('ada', 10)).toEqual([])
  })

  it('leaves out one that already has a subject', () => {
    const t = store()
    const live = t.begin('ada', 1_000)
    if (live === null) throw new Error('no conversation')
    t.say(live, 'you', 'x', 1_001)
    t.end(live, 1_002)
    t.retitle('ada', live, 'already named')
    expect(t.untitled('ada', 10)).toEqual([])
  })

  it('does not offer another character conversations', () => {
    const t = store()
    const theirs = t.begin('bob', 1_000)
    if (theirs === null) throw new Error('no conversation')
    t.say(theirs, 'you', 'theirs', 1_001)
    t.end(theirs, 1_002)
    expect(t.untitled('ada', 10)).toEqual([])
  })

  it('honours the bound, which is what keeps one sleep finite', () => {
    const t = store()
    for (let i = 0; i < 5; i += 1) {
      const live = t.begin('ada', 1_000 + i * 10)
      if (live === null) throw new Error('no conversation')
      t.say(live, 'you', `talk ${String(i)}`, 1_001 + i * 10)
      t.end(live, 1_002 + i * 10)
    }
    expect(t.untitled('ada', 2)).toHaveLength(2)
    expect(t.untitled('ada', 5)).toHaveLength(5)
  })

  it('treats a non-positive bound as none, never as all', () => {
    /*
      `LIMIT -1` in SQLite means NO limit. Passing a caller's mistake straight
      through would turn it into every conversation she has — which is the one
      answer this bound exists to prevent.
    */
    const t = store()
    const live = t.begin('ada', 1_000)
    if (live === null) throw new Error('no conversation')
    t.say(live, 'you', 'x', 1_001)
    t.end(live, 1_002)
    expect(t.untitled('ada', 0)).toEqual([])
    expect(t.untitled('ada', -1)).toEqual([])
    expect(t.untitled('ada', 1.5)).toEqual([])
  })
})
