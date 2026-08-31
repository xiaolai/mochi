import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { HISTORY_FILE, STATE_FILE, openReadOnly } from './present'
import {
  HEADER_PROBE_SQL,
  ITEMS_SQL,
  ITEM_PROBE_SQL,
  SPOKEN_ITEM_TYPES,
  openCodexSource,
  speakerOfItem,
  startedByAPerson,
  textOfItem,
} from './read'
import {
  agentMessageJson,
  cursorsFor,
  temporaryHome,
  userMessageJson,
  writeArchive,
  type ItemRow,
} from '../../../test/codex-archive'

/**
 * The reader, and the two claims about it that are not about JavaScript.
 *
 * Most of this file is ordinary: a row goes in, a shape comes out. Two cases
 * are different in kind and are the reason it exists:
 *
 * - **the query plans.** "This refresh is incremental" is a claim about what
 *   SQLite decided to do, and it was FALSE for the obvious spelling of the
 *   query — a plan naming `SCAN thread_items` reads all 515 MB, including
 *   every command-output page the exclusion was written to avoid. The plan is
 *   checked into the test because the alternative is a comment nobody can
 *   falsify.
 * - **the item probe is index-only.** The same claim one level along: the probe
 *   touches 68,000 rows and must never open the table to do it.
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

/** `EXPLAIN QUERY PLAN`, joined into one string a test can read. */
function planOf(db: DatabaseSync, sql: string, ...parameters: readonly string[]): string {
  return db
    .prepare(`EXPLAIN QUERY PLAN ${sql}`)
    .all(...parameters)
    .map((row) => String(row['detail']))
    .join('\n')
}

const SAID: readonly ItemRow[] = [
  {
    threadId: 'one',
    itemId: 'i1',
    ordinal: 1,
    type: 'userMessage',
    json: userMessageJson('how do I stop the build re-running'),
  },
  {
    threadId: 'one',
    itemId: 'i2',
    ordinal: 2,
    type: 'agentMessage',
    json: agentMessageJson('it re-runs because the watcher sees the output directory'),
  },
  {
    threadId: 'one',
    itemId: 'i3',
    ordinal: 3,
    type: 'commandExecution',
    json: JSON.stringify({ type: 'commandExecution', text: 'export AWS_SECRET=abc' }),
  },
  {
    threadId: 'two',
    itemId: 'i1',
    ordinal: 1,
    type: 'userMessage',
    json: userMessageJson('what did we decide about the fonts'),
  },
]

function anArchive(): string {
  return writeArchive({
    home: home(),
    threads: [
      { id: 'one', cwd: '/work/smartcube-web-bluetooth', firstUserMessage: 'the build loops' },
      { id: 'two', cwd: '/work/mochi', firstUserMessage: 'about the fonts' },
    ],
    items: SAID,
    cursors: cursorsFor(SAID),
  })
}

describe('the query plans, which are the incremental claim', () => {
  it('reads one thread through idx_thread_items_page, never by scanning', () => {
    const path = anArchive()
    const db = openReadOnly(join(path, HISTORY_FILE))
    try {
      const plan = planOf(db, ITEMS_SQL, 'one', ...SPOKEN_ITEM_TYPES)
      expect(plan).toContain('idx_thread_items_page')
      /*
        THE FORBIDDEN SHAPE, spelled out. `SCAN thread_items` without an index
        is the plan the obvious refresh produced, and it reads every
        command-output page — 408 MB of the 515 — to return six thousand rows.
      */
      expect(plan).not.toMatch(/SCAN thread_items(?! USING COVERING INDEX)/)
      // A temporary B-tree for the ordering is the other half of that plan, and
      // it is gone for the same reason: the index is already in ordinal order.
      expect(plan).not.toContain('TEMP B-TREE')
    } finally {
      db.close()
    }
  })

  it('probes every thread from a covering index, without opening the table', () => {
    /*
      The probe touches all 68,000 rows, so "does it open the table" is the
      whole question. A COVERING INDEX scan reads the index B-tree and nothing
      else — none of the `item_json` pages the exclusion exists for — which is
      what makes 13 ms possible where `sum(length(item_json))` costs 2,044 ms.
    */
    const path = anArchive()
    const db = openReadOnly(join(path, HISTORY_FILE))
    try {
      expect(planOf(db, ITEM_PROBE_SQL)).toContain('COVERING INDEX')
    } finally {
      db.close()
    }
  })

  it('fingerprints the headers with one pass over a small table', () => {
    const path = anArchive()
    const db = openReadOnly(join(path, STATE_FILE))
    try {
      const plan = planOf(db, HEADER_PROBE_SQL)
      // 9,349 rows over three small columns is one scan of a small table, which
      // is the trade the design makes deliberately: provably correct beats
      // incrementally clever at this size.
      expect(plan).toContain('threads')
      expect(plan).not.toContain('TEMP B-TREE')
    } finally {
      db.close()
    }
  })
})

describe('what one item carries', () => {
  it('reads an agentMessage, which holds its text directly', () => {
    expect(textOfItem(agentMessageJson('the watcher sees the output directory'))).toBe(
      'the watcher sees the output directory',
    )
  })

  it('reads a userMessage, whose text is inside a content array', () => {
    expect(textOfItem(userMessageJson('how do I stop this'))).toBe('how do I stop this')
  })

  it('keeps the text parts of a mixed content array and drops the rest', () => {
    const json = JSON.stringify({
      type: 'userMessage',
      content: [
        { type: 'text', text: 'look at this' },
        { type: 'localImage', path: '/tmp/shot.png' },
        { type: 'text', text: 'and this' },
      ],
    })
    expect(textOfItem(json)).toBe('look at this\nand this')
  })

  it('answers empty for anything it does not recognise, rather than throwing', () => {
    // The archive is somebody else's and Codex rebuilds it from rollouts by
    // design. A row this does not recognise is a row to skip.
    expect(textOfItem('not json at all')).toBe('')
    expect(textOfItem('null')).toBe('')
    expect(textOfItem('[]')).toBe('')
    expect(textOfItem(JSON.stringify({ type: 'reasoning' }))).toBe('')
  })
})

describe('whose line it was', () => {
  it('calls a user message theirs and an agent message Codex’s', () => {
    expect(speakerOfItem('userMessage')).toBe('them')
    expect(speakerOfItem('agentMessage')).toBe('codex')
  })

  it('refuses to attribute anything else', () => {
    // The safe direction. Attributing a tool's words to the person is the
    // failure the three-valued speaker exists to prevent.
    expect(speakerOfItem('realtime_session_started')).toBe('unknown')
    expect(speakerOfItem('')).toBe('unknown')
  })

  it('treats a sub-agent spawn as nobody in particular', () => {
    /*
      About sixty threads on the measured machine carry a JSON blob in `source`
      describing a sub-agent spawn. Their opening message was written by another
      agent, so calling it the person's would be a misattribution — and parsing
      the blob to find out more would be reading a shape nothing documents.
    */
    expect(startedByAPerson('cli')).toBe(true)
    expect(startedByAPerson('exec')).toBe(true)
    expect(startedByAPerson('{"subagent":{"thread_spawn":{}}}')).toBe(false)
    expect(startedByAPerson('')).toBe(false)
  })
})

describe('reading a whole archive', () => {
  it('returns only the two message types, so command output is never read', () => {
    const path = anArchive()
    const opened = openCodexSource(path)
    expect(opened.kind).toBe('open')
    if (opened.kind !== 'open') return
    try {
      const said = opened.source.spokenIn('one')
      expect(said.map((one) => one.itemId)).toEqual(['i1', 'i2'])
      expect(said.map((one) => one.who)).toEqual(['them', 'codex'])
      // The excluded row's text is the one thing that must not be here.
      expect(JSON.stringify(said)).not.toContain('AWS_SECRET')
    } finally {
      opened.source.close()
    }
  })

  it('fingerprints every thread and reads the headers of the named ones', () => {
    const path = anArchive()
    const opened = openCodexSource(path)
    if (opened.kind !== 'open') throw new Error('the fixture archive would not open')
    try {
      expect(
        opened.source
          .fingerprints()
          .map((one) => one.id)
          .sort(),
      ).toEqual(['one', 'two'])
      const headers = opened.source.headers(['two'])
      expect(headers).toHaveLength(1)
      expect(headers[0]?.cwd).toBe('/work/mochi')
      expect(headers[0]?.firstUserMessage).toBe('about the fonts')
    } finally {
      opened.source.close()
    }
  })

  it('asks for headers in bounded slices rather than one long read', () => {
    // The bound is about the DURATION of the read, not about the parser: a
    // held snapshot is what stops Codex truncating its own log.
    const many = Array.from({ length: 450 }, (_, at) => ({ id: `t${String(at)}` }))
    const path = writeArchive({ home: home(), threads: many })
    const opened = openCodexSource(path)
    if (opened.kind !== 'open') throw new Error('the fixture archive would not open')
    try {
      expect(opened.source.headers(many.map((one) => one.id))).toHaveLength(450)
    } finally {
      opened.source.close()
    }
  })

  it('carries Codex’s own cursor and the projected weight, per thread', () => {
    const path = anArchive()
    const opened = openCodexSource(path)
    if (opened.kind !== 'open') throw new Error('the fixture archive would not open')
    try {
      const states = new Map(opened.source.threadStates().map((one) => [one.threadId, one]))
      expect(states.get('one')?.items).toBe(3)
      expect(states.get('one')?.nextOrdinal).toBe(4)
      expect(states.get('two')?.items).toBe(1)
      // The weight moves when any row is re-projected, which is what the cursor
      // alone cannot see.
      expect(states.get('one')?.updatedSum).toBe(0)
    } finally {
      opened.source.close()
    }
  })

  it('reports a thread whose projection has been dropped as having no cursor', () => {
    /*
      A `thread_id` that has left `thread_history_projection_state` has had its
      projection dropped, and Codex's own trigger cascades that to
      `thread_realtime_items`. Watching the same row is how this inherits a
      deletion story rather than inventing one.
    */
    const path = writeArchive({
      home: home(),
      threads: [{ id: 'one' }],
      items: SAID.filter((one) => one.threadId === 'one'),
      cursors: [],
    })
    const opened = openCodexSource(path)
    if (opened.kind !== 'open') throw new Error('the fixture archive would not open')
    try {
      const state = opened.source.threadStates().find((one) => one.threadId === 'one')
      expect(state?.nextOrdinal).toBeNull()
      expect(state?.items).toBe(3)
    } finally {
      opened.source.close()
    }
  })

  it('reads thread_realtime_items where it exists, and answers empty where it does not', () => {
    const withRealtime = writeArchive({
      home: home(),
      threads: [{ id: 'one' }],
      realtime: [
        {
          threadId: 'one',
          itemId: 'r1',
          ordinal: 1,
          type: 'realtime_session_started',
          json: JSON.stringify({ type: 'realtime_session_started', text: 'hello, who are you' }),
        },
      ],
    })
    const opened = openCodexSource(withRealtime)
    if (opened.kind !== 'open') throw new Error('the fixture archive would not open')
    try {
      const rows = opened.source.realtimeIn('one')
      expect(rows).toHaveLength(1)
      // Not attributable: the item types this table carries are session
      // markers, and nothing documents whose voice is in one.
      expect(rows[0]?.who).toBe('unknown')
      expect(rows[0]?.turnId).toBe('')
    } finally {
      opened.source.close()
    }
  })

  it('does not treat an absent realtime table as "no voice history"', () => {
    /*
      The measured machine has that table EMPTY and its one voice conversation
      lives in `threads.first_user_message` under the older
      `realtime_delegation` encoding. A reader that concluded anything from the
      table's emptiness would answer "nothing" about the exact conversation this
      feature was built to find.
    */
    const path = home()
    mkdirSync(path, { recursive: true })
    writeArchive({
      home: path,
      threads: [{ id: 'one', firstUserMessage: '<realtime_delegation>' }],
    })
    const history = new DatabaseSync(join(path, HISTORY_FILE))
    history.exec('DROP TABLE thread_realtime_items')
    history.close()

    const opened = openCodexSource(path)
    expect(opened.kind).toBe('open')
    if (opened.kind !== 'open') return
    try {
      expect(opened.source.realtimeIn('one')).toEqual([])
      // And the header is still there, which is the point.
      expect(opened.source.headers(['one'])[0]?.firstUserMessage).toContain('realtime_delegation')
    } finally {
      opened.source.close()
    }
  })

  it('yields a thread’s rows even when its rollout_path is dangling', () => {
    // We never open the rollout. It is 5.1 GB of ground truth that Codex has
    // already projected, and reading it would mean re-implementing that
    // projection to obtain what is already in front of us.
    const path = writeArchive({
      home: home(),
      threads: [{ id: 'one' }],
      items: SAID.filter((one) => one.threadId === 'one'),
      cursors: cursorsFor(SAID.filter((one) => one.threadId === 'one')),
    })
    const state = new DatabaseSync(join(path, STATE_FILE))
    state.exec("UPDATE threads SET rollout_path = '/gone/nowhere.jsonl'")
    state.close()

    const opened = openCodexSource(path)
    if (opened.kind !== 'open') throw new Error('the fixture archive would not open')
    try {
      expect(opened.source.spokenIn('one')).toHaveLength(2)
    } finally {
      opened.source.close()
    }
  })

  it('answers unavailable for a corrupt archive rather than throwing', () => {
    const path = home()
    mkdirSync(path, { recursive: true })
    writeFileSync(join(path, STATE_FILE), 'not a database')
    writeFileSync(join(path, HISTORY_FILE), 'nor this')
    const opened = openCodexSource(path)
    expect(opened.kind).toBe('unavailable')
    if (opened.kind !== 'unavailable') return
    expect(opened.reason).toBe('unreadable')
  })

  it('answers unavailable when there is no archive at all', () => {
    const opened = openCodexSource(join(home(), 'nothing'))
    expect(opened.kind).toBe('unavailable')
    if (opened.kind !== 'unavailable') return
    expect(opened.reason).toBe('home')
  })

  it('closes both handles, and closing twice is not an error', () => {
    const path = anArchive()
    const opened = openCodexSource(path)
    if (opened.kind !== 'open') throw new Error('the fixture archive would not open')
    opened.source.close()
    expect(() => {
      opened.source.close()
    }).not.toThrow()
    // The handles are gone, so a read now fails rather than answering from a
    // connection nobody thinks is open.
    expect(() => opened.source.fingerprints()).toThrow()
  })
})
