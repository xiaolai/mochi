import { DatabaseSync } from 'node:sqlite'
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { HISTORY_FILE, STATE_FILE } from './present'
import { openCodexSource, type CodexSource } from './read'
import {
  CODEX_INDEX_DIR,
  CODEX_INDEX_FILE,
  openCodexIndex,
  removeCodexIndex,
  THREAD_SLICE,
  type CodexHit,
  type CodexIndex,
} from './index-store'
import {
  agentMessageJson,
  cursorsFor,
  temporaryHome,
  userMessageJson,
  writeArchive,
  type ItemRow,
} from '../../../test/codex-archive'

/**
 * The mirror, and the four things it must never do.
 *
 * It must not go on recalling something Codex no longer holds; it must not
 * enter a document twice; it must not report itself ready before it is; and it
 * must not return nothing for a Chinese query it plainly holds the answer to.
 * Each of those has a case here with its own name.
 */

const homes: string[] = []
const open: CodexIndex[] = []

function home(): string {
  const made = temporaryHome()
  homes.push(made)
  return made
}

function index(userData: string): CodexIndex {
  const made = openCodexIndex(userData)
  open.push(made)
  return made
}

afterEach(() => {
  while (open.length > 0) {
    const held = open.pop()
    try {
      held?.close()
    } catch {
      // Already closed by the case. Nothing to say about it.
    }
  }
  while (homes.length > 0) {
    const path = homes.pop()
    if (path !== undefined) rmSync(path, { recursive: true, force: true })
  }
})

/**
 * Hits that actually carry the phrase, rather than everything the search found.
 *
 * `search` widens to ANY of the words when ALL of them match nothing, which is
 * what makes her remembered phrases findable — and it means an empty result is
 * NOT how "this text is gone" shows up. A removal test that asserted `[]` would
 * be asserting that the widening does not work, and would pass or fail by
 * accident depending on which other documents happen to share a word.
 */
function carrying(store: CodexIndex, phrase: string): readonly CodexHit[] {
  return store.search(phrase, 20).filter((hit) => hit.text.includes(phrase))
}

/** Open the fixture archive, run the work, and always close the handles. */
function reading<T>(path: string, work: (source: CodexSource) => T): T {
  const opened = openCodexSource(path)
  if (opened.kind !== 'open')
    throw new Error(`the fixture archive would not open: ${opened.detail}`)
  try {
    return work(opened.source)
  } finally {
    opened.source.close()
  }
}

const SAID: readonly ItemRow[] = [
  {
    threadId: 'one',
    itemId: 'i1',
    ordinal: 1,
    type: 'userMessage',
    json: userMessageJson('why does the build keep re-running itself'),
  },
  {
    threadId: 'one',
    itemId: 'i2',
    ordinal: 2,
    type: 'agentMessage',
    json: agentMessageJson('the watcher is seeing the output directory it just wrote'),
  },
  {
    threadId: 'two',
    itemId: 'i1',
    ordinal: 1,
    type: 'userMessage',
    json: userMessageJson('what did we settle on for the typeface'),
  },
]

function anArchive(over: { readonly items?: readonly ItemRow[] } = {}): string {
  const items = over.items ?? SAID
  return writeArchive({
    home: home(),
    threads: [
      {
        id: 'one',
        cwd: '/work/smartcube-web-bluetooth',
        firstUserMessage: 'the build loops for ever',
      },
      { id: 'two', cwd: '/work/mochi', firstUserMessage: 'about the typeface' },
    ],
    items,
    cursors: cursorsFor(items),
  })
}

/** Refresh until it says it is level, so a case is not testing one slice. */
function refreshFully(store: CodexIndex, path: string, slice = THREAD_SLICE): void {
  for (let pass = 0; pass < 50; pass += 1) {
    const report = reading(path, (source) => store.refresh(source, { slice }))
    if (report.done) return
  }
  throw new Error('the refresh never reported itself done')
}

describe('building the mirror', () => {
  it('is not ready until a whole pass has finished', () => {
    /*
      READINESS IS THE FOURTH STATUS THAT IS NOT NEEDED.

      A cold build takes seconds — six on the measured archive, reading alone —
      so it cannot sit on the call path. Rather than inventing a "still reading"
      answer, the capability is simply not offered until this is true: an index
      that is still building is indistinguishable, to every layer that matters,
      from a permission not yet given, and `grants.ts` already has a sentence
      for that.
    */
    const path = anArchive()
    const store = index(home())
    expect(store.built()).toBe(false)
    // One thread at a time, so the first pass CANNOT be the last.
    const first = reading(path, (source) => store.refresh(source, { slice: 1 }))
    expect(first.done).toBe(false)
    expect(store.built()).toBe(false)
    refreshFully(store, path, 1)
    expect(store.built()).toBe(true)
  })

  it('indexes the headers and the turns, and finds them again', () => {
    const path = anArchive()
    const store = index(home())
    refreshFully(store, path)

    const hits = carrying(store, 'the watcher is seeing the output directory')
    expect(hits).toHaveLength(1)
    expect(hits[0]?.who).toBe('codex')
    expect(hits[0]?.kind).toBe('said')
    expect(hits[0]?.place).toBe('smartcube-web-bluetooth')
  })

  it('carries the source of every hit, because the two claims differ', () => {
    /*
      "She said this in passing at the start of a thread" and "this is what was
      actually said" are different claims, and 82% of threads have no projected
      rows at all — so the header source is the primary one, not a fallback. A
      hit that did not say which it came from would let her make the stronger
      claim from the weaker evidence.
    */
    const path = anArchive()
    const store = index(home())
    refreshFully(store, path)
    expect(carrying(store, 'the build loops for ever')[0]?.kind).toBe('opening')
    expect(carrying(store, 'why does the build keep re-running')[0]?.kind).toBe('said')
  })

  it('does not enter one document twice', () => {
    // The `preview`/`title` duplication, checked at the index rather than at
    // the parser: three columns holding one sentence must produce one row.
    const same = 'we agreed to keep the smaller typeface'
    const path = writeArchive({
      home: home(),
      threads: [{ id: 'one', firstUserMessage: same, preview: same, title: same }],
    })
    const store = index(home())
    refreshFully(store, path)
    expect(carrying(store, same)).toHaveLength(1)
  })

  it('reads a thread once and leaves it alone on the next pass', () => {
    const path = anArchive()
    const store = index(home())
    refreshFully(store, path)
    const again = reading(path, (source) => store.refresh(source))
    expect(again.done).toBe(true)
    // NOTHING re-read. The cursor comparison is the whole warm path.
    expect(again.threadsRead).toBe(0)
    expect(again.documents).toBe(0)
  })
})

describe('the mirror is reconciled, never appended', () => {
  it('stops recalling a thread Codex has deleted', () => {
    /*
      `forgetting.ts`, quoted across an application boundary: an index row whose
      turn is gone is a search hit that cannot be opened, which reads as her
      remembering something she was told to forget. An append-only mirror
      reproduces that defect exactly.
    */
    const path = anArchive()
    const store = index(home())
    refreshFully(store, path)
    expect(carrying(store, 'settle on for the typeface').length).toBeGreaterThan(0)

    const state = new DatabaseSync(join(path, STATE_FILE))
    state.exec("DELETE FROM threads WHERE id = 'two'")
    state.close()
    const history = new DatabaseSync(join(path, HISTORY_FILE))
    history.exec("DELETE FROM thread_items WHERE thread_id = 'two'")
    history.exec("DELETE FROM thread_history_projection_state WHERE thread_id = 'two'")
    history.close()

    const report = reading(path, (source) => store.refresh(source))
    expect(report.threadsRemoved).toBe(1)
    expect(carrying(store, 'settle on for the typeface')).toEqual([])
  })

  it('drops a thread’s turns when its projection is dropped, and keeps its header', () => {
    /*
      Codex's own trigger treats a row leaving `thread_history_projection_state`
      as the end of that thread's projected life and cascades it to
      `thread_realtime_items`. Watching the same signal is how this inherits a
      deletion story rather than inventing one — and the header is a different
      row in a different database, so it stays.
    */
    const path = anArchive()
    const store = index(home())
    refreshFully(store, path)
    expect(carrying(store, 'why does the build keep re-running')).toHaveLength(1)

    const history = new DatabaseSync(join(path, HISTORY_FILE))
    history.exec("DELETE FROM thread_items WHERE thread_id = 'one'")
    history.exec("DELETE FROM thread_history_projection_state WHERE thread_id = 'one'")
    history.close()

    reading(path, (source) => store.refresh(source))
    expect(carrying(store, 'why does the build keep re-running')).toEqual([])
    expect(carrying(store, 'the build loops for ever')).toHaveLength(1)
  })

  it('drops a thread’s turns when ONLY its cursor row is deleted', () => {
    /*
      THE CASE THE OTHER DELETION TEST DID NOT MAKE.

      That one deletes the cursor AND the rows, so it passed while the code was
      reading the leftover `thread_items` and re-inserting them. Codex's own
      trigger treats a row leaving `thread_history_projection_state` as the end
      of the thread's projected life; a mirror that ignored it went on recalling
      — and transmitting — turns Codex had finished with.

      Here the rows are deliberately LEFT BEHIND, so the only signal is the one
      that matters.
    */
    const path = anArchive()
    const store = index(home())
    refreshFully(store, path)
    expect(carrying(store, 'why does the build keep re-running')).toHaveLength(1)

    const history = new DatabaseSync(join(path, HISTORY_FILE))
    history.exec("DELETE FROM thread_history_projection_state WHERE thread_id = 'one'")
    history.close()

    reading(path, (source) => store.refresh(source))
    expect(carrying(store, 'why does the build keep re-running')).toEqual([])
    expect(carrying(store, 'the watcher is seeing the output directory')).toEqual([])
    // The header is a row in a different database and is untouched by this.
    expect(carrying(store, 'the build loops for ever')).toHaveLength(1)
  })

  it('sees a realtime row appear after the build, with no other change', () => {
    /*
      `thread_realtime_items` is a SEPARATE table with no cursor of its own, so
      a row appended there moves neither Codex's projection cursor nor anything
      in `thread_items`. Without a fingerprint of its own the thread would never
      go stale, and the row would stay unfindable for ever.
    */
    const path = anArchive()
    const store = index(home())
    refreshFully(store, path)
    expect(carrying(store, 'the voice note nobody indexed')).toEqual([])

    const history = new DatabaseSync(join(path, HISTORY_FILE))
    history
      .prepare(
        `INSERT INTO thread_realtime_items
           (thread_id, item_id, rollout_ordinal, created_at_ms, item_type, item_json)
         VALUES ('one', 'r1', 1, 1700000000000, 'transcript_segment', ?)`,
      )
      .run(
        JSON.stringify({
          type: 'transcript_segment',
          role: 'user',
          text: 'the voice note nobody indexed',
        }),
      )
    history.close()

    const report = reading(path, (source) => store.refresh(source))
    expect(report.threadsRead).toBe(1)
    const found = carrying(store, 'the voice note nobody indexed')
    expect(found).toHaveLength(1)
    // And its speaker comes from the row's own `role`, not from its type.
    expect(found[0]?.who).toBe('them')
  })

  it('drops a realtime row that has been deleted', () => {
    const path = anArchive()
    const store = index(home())
    const history = new DatabaseSync(join(path, HISTORY_FILE))
    history
      .prepare(
        `INSERT INTO thread_realtime_items
           (thread_id, item_id, rollout_ordinal, created_at_ms, item_type, item_json)
         VALUES ('one', 'r1', 1, 1700000000000, 'transcript_segment', ?)`,
      )
      .run(
        JSON.stringify({
          type: 'transcript_segment',
          role: 'assistant',
          text: 'a voice reply worth forgetting',
        }),
      )
    history.close()
    refreshFully(store, path)
    expect(carrying(store, 'a voice reply worth forgetting')).toHaveLength(1)

    const again = new DatabaseSync(join(path, HISTORY_FILE))
    again.exec("DELETE FROM thread_realtime_items WHERE item_id = 'r1'")
    again.close()

    reading(path, (source) => store.refresh(source))
    expect(carrying(store, 'a voice reply worth forgetting')).toEqual([])
  })

  it('sees a row replaced in place, which the cursor alone cannot', () => {
    /*
      A re-projection can rewrite `item_json` from the same rollout bytes, so
      the cursor stays where it is. `sum(updated_at_ordinal)` is Codex's own
      marker for exactly that, and it is why the comparison carries four values
      rather than two.
    */
    const path = anArchive()
    const store = index(home())
    refreshFully(store, path)

    const history = new DatabaseSync(join(path, HISTORY_FILE))
    history
      .prepare('UPDATE thread_items SET item_json = ?, updated_at_ordinal = 99 WHERE item_id = ?')
      .run(agentMessageJson('actually it was the pnpm store being rewritten'), 'i2')
    history.close()

    const report = reading(path, (source) => store.refresh(source))
    expect(report.threadsRead).toBe(1)
    expect(carrying(store, 'pnpm store being rewritten')).toHaveLength(1)
    expect(carrying(store, 'the watcher is seeing the output directory')).toEqual([])
  })

  it('sees a new turn appended to an existing thread', () => {
    const path = anArchive()
    const store = index(home())
    refreshFully(store, path)

    const history = new DatabaseSync(join(path, HISTORY_FILE))
    history
      .prepare(
        `INSERT INTO thread_items
           (thread_id, turn_id, item_id, rollout_ordinal, created_at_ms, item_json, item_type)
         VALUES ('one', 't1', 'i9', 9, 1700000000000, ?, 'userMessage')`,
      )
      .run(userMessageJson('so the fix is to ignore the output directory'))
    history.exec(
      "UPDATE thread_history_projection_state SET next_rollout_ordinal = 20 WHERE thread_id = 'one'",
    )
    history.close()

    const report = reading(path, (source) => store.refresh(source))
    expect(report.threadsRead).toBe(1)
    expect(carrying(store, 'ignore the output directory')).toHaveLength(1)
  })

  it('sees an edited header without re-reading every thread', () => {
    const path = anArchive()
    const store = index(home())
    refreshFully(store, path)

    const state = new DatabaseSync(join(path, STATE_FILE))
    state
      .prepare('UPDATE threads SET first_user_message = ?, updated_at_ms = 99 WHERE id = ?')
      .run('the build loops because of the watcher', 'one')
    state.close()

    const report = reading(path, (source) => store.refresh(source))
    expect(report.threadsRead).toBe(1)
    expect(carrying(store, 'loops because of the watcher')).toHaveLength(1)
    expect(carrying(store, 'the build loops for ever')).toEqual([])
  })

  it('re-reads a thread whose source has gone BACKWARDS', () => {
    /*
      Codex rebuilds this projection from rollouts, so the source can
      legitimately go backwards: a cursor that was at 20 can be at 5 tomorrow,
      with fewer rows behind it. A monotonic high-water mark would treat that as
      "nothing new" and stop updating for ever, silently.

      Nothing here is monotonic. The comparison is equality over four values, so
      a cursor moving in either direction is a thread to re-read.
    */
    const path = anArchive()
    const store = index(home())
    refreshFully(store, path)
    expect(carrying(store, 'why does the build keep re-running')).toHaveLength(1)

    const history = new DatabaseSync(join(path, HISTORY_FILE))
    history.exec("DELETE FROM thread_items WHERE thread_id = 'one' AND item_id = 'i1'")
    history.exec(
      'UPDATE thread_history_projection_state SET next_rollout_ordinal = 1, ' +
        "next_rollout_byte_offset = 1 WHERE thread_id = 'one'",
    )
    history.close()

    const report = reading(path, (source) => store.refresh(source))
    expect(report.threadsRead).toBe(1)
    expect(carrying(store, 'why does the build keep re-running')).toEqual([])
    // And what is still there is still there: this is a re-read, not a purge.
    expect(carrying(store, 'the watcher is seeing the output directory')).toHaveLength(1)
  })

  it('survives a realtime row whose id looks like a header fragment', () => {
    /*
      ONE ROW USED TO TURN THE WHOLE FEATURE OFF.

      Header fragments are keyed `header:0`, `header:1`… with an empty turn, and
      `thread_realtime_items` has no turn either — so a realtime row whose
      `item_id` happened to be `header:0` hit `UNIQUE constraint failed`. That
      aborts the per-thread write, which aborts the build, which leaves the
      index unbuilt — and an unbuilt index is never offered. Verified before the
      fix: the thread's opening was not indexed either, and `built()` stayed
      false for ever, with nothing user-visible but a tool that never appeared.

      The key carries `origin` now, so the two sources cannot collide.
    */
    const path = writeArchive({
      home: home(),
      threads: [{ id: 'one', firstUserMessage: 'the opening line of this thread' }],
      realtime: [
        {
          threadId: 'one',
          itemId: 'header:0',
          ordinal: 1,
          type: 'transcript_segment',
          json: JSON.stringify({
            type: 'transcript_segment',
            role: 'user',
            text: 'a colliding voice note',
          }),
        },
      ],
      cursors: [{ threadId: 'one', ordinal: 5, byteOffset: 10 }],
    })
    const store = index(home())
    refreshFully(store, path)

    expect(store.built()).toBe(true)
    expect(carrying(store, 'the opening line of this thread')).toHaveLength(1)
    expect(carrying(store, 'a colliding voice note')).toHaveLength(1)
  })

  it('does not collide two rows that share a thread and an item id', () => {
    /*
      `thread_items`' primary key is the TRIPLE `(thread_id, turn_id, item_id)`.
      Keyed on the pair — which the plan named first — these two valid rows
      would collide and one would be dropped.
    */
    const items: readonly ItemRow[] = [
      {
        threadId: 'one',
        turnId: 'turn-a',
        itemId: 'shared',
        ordinal: 1,
        type: 'userMessage',
        json: userMessageJson('the first turn said one thing'),
      },
      {
        threadId: 'one',
        turnId: 'turn-b',
        itemId: 'shared',
        ordinal: 2,
        type: 'userMessage',
        json: userMessageJson('the second turn said another'),
      },
    ]
    const path = anArchive({ items })
    const store = index(home())
    refreshFully(store, path)
    expect(carrying(store, 'the first turn said one thing')).toHaveLength(1)
    expect(carrying(store, 'the second turn said another')).toHaveLength(1)
  })
})

describe('searching', () => {
  it('round-trips a Chinese query, which the default tokenizer cannot', () => {
    /*
      FTS5 splits on whitespace and Chinese has none between words, so a whole
      sentence becomes one token and 苹果 matches nothing. The failure is silent:
      a valid index, a valid query, and an empty answer. `segment` runs on both
      sides of this index for that reason, and this is the assertion that says
      so.
    */
    const path = writeArchive({
      home: home(),
      threads: [{ id: 'one', firstUserMessage: '今天我想吃苹果,顺便把构建修好' }],
    })
    const store = index(home())
    refreshFully(store, path)
    expect(store.search('苹果', 5)).toHaveLength(1)
  })

  it('answers nothing rather than throwing for a query with no terms in it', () => {
    // An empty MATCH is a syntax error in FTS5. The capability turns this into
    // `unavailable`, which is deliberately not the same answer as "I looked and
    // there was nothing".
    const path = anArchive()
    const store = index(home())
    refreshFully(store, path)
    expect(store.search('!!!', 5)).toEqual([])
    expect(store.search('   ', 5)).toEqual([])
  })

  it('widens to any of the words when all of them match nothing', () => {
    // Her queries are remembered phrases, and an AND over six words needs one
    // document holding every one. Measured on a real archive, the same query
    // matched 0 as an AND and 18 as an OR.
    const path = anArchive()
    const store = index(home())
    refreshFully(store, path)
    expect(store.search('watcher directory sausages umbrella', 5).length).toBeGreaterThan(0)
  })

  it('honours the limit it is given', () => {
    const path = anArchive()
    const store = index(home())
    refreshFully(store, path)
    expect(store.search('the', 1).length).toBeLessThanOrEqual(1)
  })
})

describe('when the permission is withdrawn', () => {
  it('stops the build before it opens anything, and says it halted', () => {
    /*
      Not a snapshot taken when the build was queued. Somebody who revokes the
      grant while a cold build is running has said they do not want it, and a
      builder that checked once would go on reading another application's
      archive for several seconds after being told to stop.
    */
    const path = anArchive()
    const store = index(home())
    const report = reading(path, (source) => store.refresh(source, { stillAllowed: () => false }))
    expect(report.halted).toBe(true)
    expect(report.done).toBe(false)
    expect(report.threadsRead).toBe(0)
    expect(store.built()).toBe(false)
  })

  it('forgets everything it borrowed, and is not ready afterwards', () => {
    const path = anArchive()
    const userData = home()
    const store = index(userData)
    refreshFully(store, path)
    expect(store.built()).toBe(true)

    expect(store.forget()).toBe(true)
    expect(store.built()).toBe(false)
    expect(store.search('typeface', 5)).toEqual([])
  })

  it('takes the words off the disk, not only out of the tables', () => {
    /*
      "SEARCH RETURNS NOTHING" IS NOT "THE TEXT IS GONE".

      Deleting rows moves them into the write-ahead log, where they sit across
      launches until a checkpoint moves them — and a checkpoint blocked by a
      reader does not throw, it reports `busy`. So the old assertion here would
      have passed over a log still holding every word. This reads the FILES.
    */
    const canary = 'kumquat-marmalade-sentinel'
    const path = writeArchive({
      home: home(),
      threads: [{ id: 'one', firstUserMessage: `we talked about ${canary} at length` }],
    })
    const userData = home()
    const store = index(userData)
    refreshFully(store, path)
    expect(carrying(store, canary)).toHaveLength(1)

    expect(store.forget()).toBe(true)
    store.close()

    const directory = join(userData, CODEX_INDEX_DIR)
    for (const name of readdirSync(directory)) {
      expect(readFileSync(join(directory, name), 'latin1')).not.toContain(canary)
    }
  })

  it('removes the file itself when nothing holds it open', () => {
    const userData = home()
    const store = index(userData)
    store.close()
    const path = join(userData, CODEX_INDEX_DIR, CODEX_INDEX_FILE)
    expect(existsSync(path)).toBe(true)
    removeCodexIndex(userData)
    expect(existsSync(path)).toBe(false)
  })
})
