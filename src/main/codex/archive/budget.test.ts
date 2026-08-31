import { rmSync } from 'node:fs'
import { homedir } from 'node:os'

import { afterEach, describe, expect, it } from 'vitest'

import { archiveAt, codexArchiveHome } from './present'
import { openCodexSource, type CodexSource } from './read'
import { openCodexIndex, type CodexIndex } from './index-store'
import {
  cursorsFor,
  temporaryHome,
  userMessageJson,
  writeArchive,
  type ItemRow,
  type ThreadRow,
} from '../../../test/codex-archive'

/**
 * The budgets, as a gate rather than as a paragraph in a plan.
 *
 * ## Why there are two of them and not three
 *
 * The cold build was measured and **fails any budget that would let it sit on
 * the call path**: 6,141 ms on the live archive, reading alone, before any
 * indexing work at all — of which 5,202 ms is one scan of 515 MB to return
 * 10 MB. That number settled a design question rather than informing one: the
 * cold build is a background job that runs once, and the capability is not
 * offered until it has finished. There is no budget to check because nothing
 * waits for it.
 *
 * What a person actually feels is the WARM path, and that has two halves:
 *
 * | | budget |
 * | --- | --- |
 * | refresh — deciding what has changed | **150 ms** |
 * | query — answering from the index | **100 ms** |
 *
 * ## Why the strict gate runs against a fixture and not against the real archive
 *
 * It was written the other way round first, and it flaked: the same probe came
 * back at **105 ms** on an idle machine and **298 ms** while the rest of this
 * suite was running, against the same 150 ms budget. Nothing had regressed. The
 * live archive is a 100 MB file that **another running process is writing to**,
 * with its own write-ahead log growing and being checkpointed underneath the
 * read, and its page cache shared with whatever else the machine is doing.
 *
 * A gate that fails because the disk was busy is worse than no gate: the obvious
 * fix is to raise the budget, and a budget nobody believes gets raised until it
 * never fires. So the strict number is measured against a fixture of the
 * measured size, which this file creates and nothing else touches — that is the
 * half a code change can regress, and the half a build can act on.
 *
 * The live archive can still be measured, and is still bounded at ten times the
 * budget when it is — deliberately loose, to catch a **change of mechanism** on
 * the real thing (putting `sum(length(item_json))` back would be 2,044 ms and
 * would trip it) without failing because a laptop was busy.
 *
 * It is **opt-in**, behind `MOCHI_CODEX_BENCH=1`, and that is not a convenience.
 * It reads somebody's personal Codex history, and reading it creates a `-shm`
 * inside their `~/.codex`. A feature whose whole design is "no handle on those
 * files until somebody says yes" cannot have a test suite that does it on every
 * run, for a number nobody asked for.
 *
 * The load-independent half of the same guarantee is in `read.test.ts`, which
 * checks the query PLANS: a covering index for the probe, `idx_thread_items_page`
 * for the per-thread read, and no temporary B-tree. A plan cannot be slow
 * because the machine is busy.
 */

/** The refresh budget: deciding what has changed. */
export const WARM_REFRESH_MS = 150

/** The query budget: from her words to hits, against an index of real size. */
export const QUERY_MS = 100

/**
 * How far over budget the LIVE archive may go before it is a finding.
 *
 * Ten times, because that number is contended by another process and by the
 * disk. It is not a performance budget; it is a tripwire for a change of
 * mechanism — the 2,044 ms aggregate this design rejected would trip it, and a
 * busy afternoon would not.
 */
const LIVE_CEILING_MS = WARM_REFRESH_MS * 10

/** Threads in the fixture. The measured archive holds 9,349. */
const THREADS = 9_300

/** Threads with projected turns. The measured archive holds 1,695. */
const PROJECTED = 1_700

/**
 * Characters of header text per thread.
 *
 * The measured archive averages more than this — 4,411 of 9,093 headers are over
 * 2,000 characters and the longest is 148,357 — but the average is what decides
 * how much work `length()` does, and a fixture reproducing that tail would spend
 * most of this file's runtime being written. Two kilobytes puts about 19 MB
 * behind the probe, which is enough for the measurement to be about reading text
 * rather than about SQLite's per-row overhead.
 */
const HEADER_CHARS = 2_000

/** How many documents the query budget is measured against. */
const CORPUS = 4_000

const homes: string[] = []
const open: CodexIndex[] = []

afterEach(() => {
  while (open.length > 0) {
    const held = open.pop()
    try {
      held?.close()
    } catch {
      // Already closed.
    }
  }
  while (homes.length > 0) {
    const path = homes.pop()
    if (path !== undefined) rmSync(path, { recursive: true, force: true })
  }
})

function home(): string {
  const made = temporaryHome()
  homes.push(made)
  return made
}

/** Milliseconds for one call, to the tenth. */
function timed(work: () => void): number {
  const began = performance.now()
  work()
  return Math.round((performance.now() - began) * 10) / 10
}

/**
 * The best of five, with all five printed.
 *
 * The minimum rather than the mean, because the question a budget asks is
 * whether the warm path CAN meet it in steady state. A mean measures the other
 * processes on the machine; the spread is printed so nobody has to take the
 * winner on trust.
 */
function bestOfFive(what: string, work: () => void): number {
  const runs = Array.from({ length: 5 }, () => timed(work))
  const best = Math.min(...runs)
  console.log(
    `[budget] ${what}: ${runs.map((one) => String(one)).join(' / ')} ms (best ${String(best)})`,
  )
  return best
}

/** A source archive the size of the measured one, and nothing writing to it. */
function anArchiveOfMeasuredSize(): string {
  const filler = 'we were looking at the build again and it still loops. '.repeat(
    Math.ceil(HEADER_CHARS / 54),
  )
  const threads: ThreadRow[] = Array.from({ length: THREADS }, (_, at) => ({
    id: `t${String(at)}`,
    cwd: `/work/project-${String(at % 40)}`,
    firstUserMessage: `${String(at)} ${filler.slice(0, HEADER_CHARS)}`,
    updatedAtMs: 1_700_000_000_000 + at,
  }))
  const items: ItemRow[] = Array.from({ length: PROJECTED * 4 }, (_, at) => ({
    threadId: `t${String(at % PROJECTED)}`,
    itemId: `i${String(at)}`,
    ordinal: at,
    type: at % 2 === 0 ? 'userMessage' : 'agentMessage',
    json: userMessageJson(`turn ${String(at)}: what did we settle on for the typeface`),
  }))
  return writeArchive({ home: home(), threads, items, cursors: cursorsFor(items) })
}

describe('the warm refresh stays inside its budget', () => {
  it('decides what has changed in under 150 ms, on an archive of the measured size', () => {
    /*
      THE WHOLE REFRESH, not the probe it starts with.

      This timed `fingerprints()` and `threadStates()` only, which is the
      cheapest third of the operation it was named after: `store.refresh()` also
      reads the mirror's own thread table, builds the maps, compares every
      thread, and commits. Timing the probe and calling it "the warm refresh"
      would leave the two most likely places for a regression outside the gate.

      Measured against a mirror that is already LEVEL, because that is the warm
      case: nothing has changed, and the answer should cost a comparison.
    */
    const path = anArchiveOfMeasuredSize()
    const store = openCodexIndex(home())
    open.push(store)

    const built = timed(() => {
      for (let pass = 0; pass < 200; pass += 1) {
        const opened = openCodexSource(path)
        if (opened.kind !== 'open') throw new Error('the fixture archive would not open')
        try {
          if (store.refresh(opened.source, { slice: 2_000 }).done) return
        } finally {
          opened.source.close()
        }
      }
      throw new Error('the fixture index never finished building')
    })
    expect(store.built()).toBe(true)

    const opened = openCodexSource(path)
    expect(opened.kind).toBe('open')
    if (opened.kind !== 'open') return
    try {
      const source: CodexSource = opened.source
      let report = store.refresh(source)
      const best = bestOfFive(
        `warm refresh over ${String(THREADS)} threads (built in ${String(built)} ms)`,
        () => {
          report = store.refresh(source)
        },
      )
      // NOTHING re-read: a warm refresh that read threads would be measuring
      // the wrong thing, and the budget would be about indexing rather than
      // about deciding.
      expect(report.done).toBe(true)
      expect(report.threadsRead).toBe(0)
      expect(source.fingerprints()).toHaveLength(THREADS)
      expect(source.threadStates()).toHaveLength(PROJECTED)
      expect(best).toBeLessThanOrEqual(WARM_REFRESH_MS)
    } finally {
      opened.source.close()
    }
  }, 300_000)
})

/**
 * Whether this run may touch the developer's own Codex archive.
 *
 * OPT-IN, and it was not. Merely running `pnpm test` opened the real
 * `~/.codex` databases — somebody's personal history, read with no permission
 * switch, no consent and no mention — and reading them creates a `-shm` inside
 * that directory. A feature whose entire design is "no handle on Codex's files
 * until somebody says yes" cannot have a test suite that ignores the rule on
 * every run.
 *
 * So the live measurement is behind a flag, and it says so when it skips. The
 * strict gate is the fixture above, which needs nobody's data.
 */
const LIVE = process.env['MOCHI_CODEX_BENCH'] === '1'

describe('the live archive, measured and loosely bounded', () => {
  it('does not change mechanism under this machine’s real archive', () => {
    if (!LIVE) {
      console.log(
        '[budget] the live probe is opt-in: set MOCHI_CODEX_BENCH=1 to measure the real archive',
      )
      expect(LIVE).toBe(false)
      return
    }
    const there = codexArchiveHome(process.env, homedir())
    const found = archiveAt(there)
    if (found.kind !== 'present') {
      // SAID OUT LOUD rather than passing quietly. A measurement that skips
      // without saying so is a green tick nobody took.
      console.log(
        `[budget] no Codex archive at ${there} (${found.reason}); the live probe was not measured`,
      )
      expect(found.kind).toBe('unavailable')
      return
    }
    const opened = openCodexSource(there)
    expect(opened.kind).toBe('open')
    if (opened.kind !== 'open') return
    try {
      const source: CodexSource = opened.source
      source.fingerprints()
      source.threadStates()
      const best = bestOfFive('live warm probe', () => {
        source.fingerprints()
        source.threadStates()
      })
      // TEN TIMES the budget. See `LIVE_CEILING_MS`: a tripwire for a change of
      // mechanism, not a performance budget.
      expect(best).toBeLessThanOrEqual(LIVE_CEILING_MS)
    } finally {
      opened.source.close()
    }
  }, 120_000)
})

describe('a query stays inside its budget', () => {
  it('answers from an index of realistic size in under 100 ms', () => {
    const threads: ThreadRow[] = Array.from({ length: CORPUS }, (_, at) => ({
      id: `t${String(at)}`,
      cwd: `/work/project-${String(at % 40)}`,
      // Long enough to be a real document and varied enough that the terms are
      // not all in every row, which would make the index unrepresentatively
      // cheap to search.
      firstUserMessage:
        `thread ${String(at)}: we were looking at why the build for module ` +
        `${String(at % 97)} keeps re-running itself and whether the watcher is ` +
        `seeing the output directory it wrote a moment earlier`,
    }))
    const path = writeArchive({ home: home(), threads })
    const store = openCodexIndex(home())
    open.push(store)

    const built = timed(() => {
      for (let pass = 0; pass < 100; pass += 1) {
        const opened = openCodexSource(path)
        if (opened.kind !== 'open') throw new Error('the fixture archive would not open')
        try {
          if (store.refresh(opened.source, { slice: 500 }).done) return
        } finally {
          opened.source.close()
        }
      }
      throw new Error('the fixture index never finished building')
    })
    expect(store.built()).toBe(true)

    let hits = 0
    const query = timed(() => {
      hits = store.search('watcher seeing the output directory', 5).length
    })
    console.log(
      `[budget] built ${String(CORPUS)} documents in ${String(built)} ms; ` +
        `query ${String(query)} ms for ${String(hits)} hits`,
    )
    expect(hits).toBeGreaterThan(0)
    expect(query).toBeLessThanOrEqual(QUERY_MS)
  }, 180_000)
})
