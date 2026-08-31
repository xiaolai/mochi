import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import { capability, MAX_QUERY_CHARS } from './capability'
import { createCodexArchive, type CodexArchive } from '../../main/codex/archive/archive'
import { HISTORY_FILE, STATE_FILE } from '../../main/codex/archive/present'
import { REDACTED } from '../../main/codex/archive/mask'
import { stubDeps, TEST_NOW } from '../../test/capability-deps'
import {
  cursorsFor,
  temporaryHome,
  userMessageJson,
  writeArchive,
  type ItemRow,
} from '../../test/codex-archive'
import { promptsFor } from '@shared/prompts'

/**
 * The capability, end to end, through the same wiring main uses.
 *
 * ## Why one of these tests is deliberately not a unit test
 *
 * An earlier draft of this feature had every listed test passing with the index
 * permanently empty: nothing in the plan ever RAN the indexer, so every case was
 * about a builder invoked by hand from a test. That is the shape of a feature
 * that ships and does nothing.
 *
 * So the case named "finds something that was appended after the first call"
 * goes through `createCodexArchive` — the same object main puts behind
 * `deps.codexArchive` — calls the capability, appends a row to the source, and
 * requires the second call to see it. Nothing in it invokes the builder
 * directly. If the lifecycle is not wired, it fails.
 */

const homes: string[] = []
const open: CodexArchive[] = []

function home(): string {
  const made = temporaryHome()
  homes.push(made)
  return made
}

afterEach(() => {
  while (open.length > 0) open.pop()?.close()
  while (homes.length > 0) {
    const path = homes.pop()
    if (path !== undefined) rmSync(path, { recursive: true, force: true })
  }
})

const SAID: readonly ItemRow[] = [
  {
    threadId: 'one',
    itemId: 'i1',
    ordinal: 1,
    type: 'userMessage',
    json: userMessageJson('what did we settle on for the typeface'),
  },
]

/** A fixture archive, a fresh userData, and the holder main would build. */
function anArchive(over: { readonly allowed?: () => boolean } = {}): {
  readonly archive: CodexArchive
  readonly codexHome: string
} {
  const codexHome = writeArchive({
    home: home(),
    threads: [{ id: 'one', cwd: '/work/mochi', firstUserMessage: 'about the typeface' }],
    items: SAID,
    cursors: cursorsFor(SAID),
  })
  const userData = home()
  const archive = createCodexArchive({
    userData: () => userData,
    home: () => codexHome,
    allowed: over.allowed ?? ((): boolean => true),
  })
  open.push(archive)
  return { archive, codexHome }
}

/** The sentence the lifecycle case appends and then looks for. */
const PHRASE = 'the pnpm store was the culprit'

/**
 * Everything the payload quotes, as one string.
 *
 * Written as a helper because `status` alone cannot express "this sentence is
 * not in the index": the search widens to ANY of the words when ALL of them
 * match nothing, so a query sharing one common word with any document comes
 * back `found`.
 */
function saidIn(payload: Record<string, unknown>): string {
  const hits = (payload['hits'] ?? []) as readonly Record<string, unknown>[]
  return hits.map((hit) => String(hit['said'])).join('\n')
}

/** The real catalogue, so a test sees the wording that ships. */
const PROMPTS = (key: string): string => promptsFor([]).find((spec) => spec.key === key)?.text ?? ''

/**
 * One call, with the union narrowed once.
 *
 * `Capability` is a discriminated union and `handler` is typed differently on
 * each side of it, so a test calling it directly is handed
 * `CapabilityOutput | Promise<CapabilityOutput>` and cannot index the answer.
 * Narrowing here rather than at nine call sites is what
 * `recall-conversations/capability.test.ts` does, for the same reason.
 */
function call(
  args: Readonly<Record<string, string>>,
  archive: CodexArchive | null = null,
): Record<string, unknown> {
  if (capability.kind !== 'immediate') throw new Error('this one answers on the spot')
  return capability.handler(
    args,
    stubDeps({ prompt: PROMPTS, codexArchive: () => (archive === null ? null : archive.recall()) }),
  )
}

describe('the manifest', () => {
  it('is named for its provenance, which is the safety property', () => {
    // `recall_work` reads more naturally and hides where the answer came from.
    // The name is what the model selects on, so this is not cosmetic.
    expect(capability.manifest.name).toBe('recall_codex')
    expect(capability.manifest.description).toContain('Codex')
  })

  it('settles the call outright', () => {
    // The warm path is milliseconds. The cold build is not, which is why it is
    // a background job rather than a reason to defer this.
    expect(capability.kind).toBe('immediate')
  })
})

describe('the statuses', () => {
  it('is unavailable when she may not look', () => {
    const payload = call({ query: 'typeface' })
    expect(payload['status']).toBe('unavailable')
    expect(payload['guidance']).toBe(PROMPTS('recallCodex.unavailable'))
  })

  it('is unavailable when Codex’s archive is not there', () => {
    const userData = home()
    const archive = createCodexArchive({
      userData: () => userData,
      home: () => join(home(), 'nowhere'),
      allowed: () => true,
    })
    open.push(archive)
    expect(call({ query: 'typeface' }, archive)['status']).toBe('unavailable')
  })

  it('is unavailable when Codex has moved its schema under us', async () => {
    /*
      A DISTINCT REASON in the log, and the SAME sentence to her.

      The guard refuses a database whose columns are not the ones it reads, so
      "Codex moved" is a first-class answer rather than an empty result. What
      she says is still "I could not look" — the alternative, going quiet or
      answering from a stale copy, is the failure the whole three-status shape
      exists to prevent.
    */
    const { archive, codexHome } = anArchive()
    await archive.build()
    expect(saidIn(call({ query: 'what did we settle on for the typeface' }, archive))).toContain(
      'typeface',
    )

    const { DatabaseSync } = await import('node:sqlite')
    const state = new DatabaseSync(join(codexHome, STATE_FILE))
    state.exec('ALTER TABLE threads RENAME COLUMN first_user_message TO opening_message')
    state.close()

    expect(call({ query: 'what did we settle on for the typeface' }, archive)['status']).toBe(
      'unavailable',
    )
  })

  it('is unavailable when there is nothing searchable in the query', async () => {
    /*
      NOT "nothing found". An empty MATCH is a syntax error in FTS5, so the
      index returns `[]` without running a query — and reporting that as
      `nothing` would have her say she searched and found nothing, about a
      search that never ran.
    */
    const { archive } = anArchive()
    await archive.build()
    expect(call({ query: '!!!' }, archive)['status']).toBe('unavailable')
    expect(call({ query: '' }, archive)['status']).toBe('unavailable')
  })

  it('refuses a query too long to segment on the main thread', async () => {
    /*
      `toMatchQuery` runs `Intl.Segmenter` over every character, synchronously,
      on the thread that draws her window and receives speech. The argument
      comes from a model through a renderer and nothing between here and there
      bounds it, so a megabyte of text is a way to stop this process answering.
    */
    const { archive } = anArchive()
    await archive.build()
    const payload = call({ query: 'x'.repeat(MAX_QUERY_CHARS + 1) }, archive)
    expect(payload['status']).toBe('unavailable')
    // And the bound is generous rather than tight: a remembered sentence passes.
    expect(call({ query: 'y'.repeat(MAX_QUERY_CHARS) }, archive)['status']).not.toBe('unavailable')
  })

  it('is nothing when the search ran and matched nothing', async () => {
    const { archive } = anArchive()
    await archive.build()
    const payload = call({ query: 'submarines' }, archive)
    expect(payload['status']).toBe('nothing')
    expect(payload['guidance']).toBe(PROMPTS('recallCodex.nothing'))
  })

  it('is found, with the hit attributed', async () => {
    const { archive } = anArchive()
    await archive.build()
    const payload = call({ query: 'what did we settle on for the typeface' }, archive)
    expect(payload['status']).toBe('found')
    expect(payload['guidance']).toBe(PROMPTS('recallCodex.guidance'))
    const hits = payload['hits'] as readonly Record<string, unknown>[]
    expect(hits.length).toBeGreaterThan(0)
    expect(String(hits[0]?.['said'])).toContain('typeface')
    expect(String(hits[0]?.['where'])).toContain('mochi')
    expect(hits[0]?.['who']).toBe('them')
  })
})

describe('the lifecycle actually runs', () => {
  it('finds something that was appended after the first call', async () => {
    /*
      THE TEST THAT WOULD HAVE CAUGHT A FEATURE THAT DOES NOTHING.

      Every other case here could pass with an indexer nothing ever invokes.
      This one goes through the object main puts behind `deps.codexArchive`,
      calls the capability, appends a row to the SOURCE, and requires the second
      call to see it. The builder is never invoked by hand.
    */
    const { archive, codexHome } = anArchive()
    await archive.build()

    /*
      NOT `status === 'nothing'`, and the difference is the widening.

      When every word together matches nothing, the search widens to ANY of them
      — which is what makes her remembered phrases findable, and which means a
      query sharing a single common word with an existing document comes back
      `found`. What "it is not there yet" actually looks like is: no hit carries
      the sentence.
    */
    expect(saidIn(call({ query: PHRASE }, archive))).not.toContain(PHRASE)

    const { DatabaseSync } = await import('node:sqlite')
    const history = new DatabaseSync(join(codexHome, HISTORY_FILE))
    history
      .prepare(
        `INSERT INTO thread_items
           (thread_id, turn_id, item_id, rollout_ordinal, created_at_ms, item_json, item_type)
         VALUES ('one', 't1', 'i2', 5, ?, ?, 'userMessage')`,
      )
      .run(TEST_NOW, userMessageJson(`${PHRASE} all along`))
    history.exec(
      "UPDATE thread_history_projection_state SET next_rollout_ordinal = 9 WHERE thread_id = 'one'",
    )
    history.close()

    const payload = call({ query: PHRASE }, archive)
    expect(payload['status']).toBe('found')
    expect(saidIn(payload)).toContain(PHRASE)
  })

  it('finishes a large change instead of refusing for ever', async () => {
    /*
      THE STALL A FIX INTRODUCED, and it is worth its own case.

      Refusing to serve a half-reconciled index is right — a pass that stopped
      early can leave turns of a dropped projection searchable. But the resume
      was guarded on `built()`, which is "a whole pass finished ONCE" and says
      nothing about whether the mirror is level NOW. So a change bigger than one
      slice made `recall()` refuse, ask for a resume that returned immediately,
      and refuse again on every later call. Permanently, on a switch reading
      "allowed".

      Here the mirror is built, then 500 threads change at once — more than one
      slice — and the capability has to come back rather than stay refused.
    */
    const codexHome = writeArchive({
      home: home(),
      threads: [{ id: 'one', firstUserMessage: 'about the typeface' }],
    })
    const userData = home()
    const archive = createCodexArchive({
      userData: () => userData,
      home: () => codexHome,
      allowed: () => true,
      log: (line) => {
        console.log('DBG', line)
      },
    })
    open.push(archive)
    await archive.build()
    expect(archive.ready()).toBe(true)

    const { DatabaseSync } = await import('node:sqlite')
    const state = new DatabaseSync(join(codexHome, STATE_FILE))
    state.exec('BEGIN')
    const insert = state.prepare(
      `INSERT INTO threads (id, title, first_user_message, preview, cwd, source,
                            thread_source, created_at_ms, updated_at_ms)
       VALUES (?, '', ?, '', '', 'cli', NULL, 1, 1)`,
    )
    for (let at = 0; at < 500; at += 1) {
      insert.run(`bulk${String(at)}`, `the bulk conversation number ${String(at)}`)
    }
    state.exec('COMMIT')
    state.close()

    // The first call refuses, honestly: the pass could not finish in one slice.
    expect(archive.recall()).toBeNull()

    /*
      AND THE RESUME IT SCHEDULED HAS TO DO THE REST.

      Deliberately NOT `await archive.build()` — that calls the builder directly
      and would pass against the very defect this is about. What is under test is
      whether `recall()` scheduled anything, so this waits for the event loop and
      then asks ONCE more.

      Without the fix the guard returns at the door, nothing is scheduled, and
      this second call advances one more slice and refuses again.
    */
    for (let turn = 0; turn < 20; turn += 1) await new Promise((wake) => setTimeout(wake, 0))
    expect(archive.recall()).not.toBeNull()
  })

  it('opens no handle on Codex’s files while the permission is withheld', async () => {
    /*
      A STATIC DEFAULT IS NOT THE LIFECYCLE.

      "The grant is false by default" says nothing about a build that was queued
      and then revoked. This asserts the observable consequence rather than the
      intention: reading a WAL database creates a `-shm` beside it, so if no
      `-shm` appears, nothing opened the file.
    */
    let mayLook = false
    const { archive, codexHome } = anArchive({ allowed: () => mayLook })
    const shm = join(codexHome, `${HISTORY_FILE}-shm`)
    expect(existsSync(shm)).toBe(false)

    await archive.build()
    expect(archive.ready()).toBe(false)
    expect(archive.recall()).toBeNull()
    expect(existsSync(shm)).toBe(false)

    /*
      THE POSITIVE CONTROL, without which the assertion above proves nothing.

      "No `-shm` appeared" only means "nothing opened the file" if opening the
      file WOULD have produced one. The fixtures run in WAL mode precisely so
      that is true — before they did, this test would have passed just as well
      against a reader that opened everything, which is the failure it exists to
      catch.
    */
    mayLook = true
    await archive.build()
    expect(archive.ready()).toBe(true)
    expect(existsSync(shm)).toBe(true)
  })

  it('stops a build that is already running when the permission is revoked', async () => {
    /*
      A STATIC DEFAULT IS NOT THE LIFECYCLE, and neither is a check at queue
      time. The build reads thousands of conversations over several seconds, and
      somebody who revokes the switch during it has said they do not want that —
      so the permission is re-read before every slice rather than once.

      Asserted by outcome rather than by intention: the index is left PART
      BUILT, and readiness stays false. A builder that checked once would have
      finished all 500 threads.
    */
    let mayLook = true
    let asked = 0
    const codexHome = writeArchive({
      home: home(),
      threads: Array.from({ length: 500 }, (_, at) => ({
        id: `t${String(at)}`,
        firstUserMessage: `conversation ${String(at)} about the build`,
      })),
    })
    const userData = home()
    const archive = createCodexArchive({
      userData: () => userData,
      home: () => codexHome,
      allowed: () => {
        asked += 1
        // Withdrawn part way through the first slice.
        if (asked > 40) mayLook = false
        return mayLook
      },
    })
    open.push(archive)

    await archive.build()
    expect(mayLook).toBe(false)
    // It stopped rather than running on: a completed build would be ready.
    expect(archive.ready()).toBe(false)
    expect(asked).toBeGreaterThan(40)

    /*
      AND IT RESUMES, which is the other half of the same property.

      A halt that left the index unusable would be a permission that costs
      somebody their history rather than pausing it. Giving the permission back
      finishes the build from where it stopped — the reconciliation is keyed on
      what each thread looks like now, so a half-built index is simply an index
      with more stale threads in it.
    */
    mayLook = true
    asked = -1_000_000
    await archive.build()
    expect(archive.ready()).toBe(true)
  })

  it('is not offered until the index is built, and says so if called anyway', () => {
    // "Granted but still building" keeps the tool off the wire. A model holding
    // an older tool list still gets a sentence rather than an error.
    const { archive } = anArchive()
    expect(archive.ready()).toBe(false)
    expect(call({ query: 'typeface' }, archive)['status']).toBe('unavailable')
  })

  it('throws away everything it borrowed when the permission goes', async () => {
    /*
      THROUGH `settle()`, which is the path main actually takes.

      Deleting used to be its own entry point, and that was the bug: revoking
      the WORN character's switch called it outright, deleting the mirror out
      from under a different character whose session was live and permitted.
      `settle()` asks whose permission governs before it removes anything, so
      the test goes through the same door the app does.
    */
    let mayLook = true
    const codexHome = writeArchive({
      home: home(),
      threads: [{ id: 'one', firstUserMessage: 'about the typeface' }],
    })
    const userData = home()
    const archive = createCodexArchive({
      userData: () => userData,
      home: () => codexHome,
      allowed: () => mayLook,
    })
    open.push(archive)
    await archive.build()
    expect(archive.ready()).toBe(true)

    mayLook = false
    archive.settle()
    expect(existsSync(join(userData, 'codex-index'))).toBe(false)

    // And giving it back rebuilds rather than leaving her without it.
    mayLook = true
    archive.settle()
    for (let turn = 0; turn < 20; turn += 1) await new Promise((wake) => setTimeout(wake, 0))
    expect(archive.ready()).toBe(true)
  })
})

describe('the wiring in main, which no test can run', () => {
  /*
    A SOURCE-TEXT CHECK, and it is an honest second best.

    Everything above builds the coordinator itself, so it proves the coordinator
    works and says nothing about whether `main/index.ts` calls it. That file
    imports Electron and cannot be executed by this suite at all — the same
    limitation `what-she-may-do.ts` was extracted to work around.

    Two instruments cover the gap between them, and neither pretends to be the
    third. `store/wiring.test.ts` now scans `src/main/codex` and fails when a
    surface has no production caller — which is how three genuinely unwired
    surfaces were found the day it was widened. This is the other half: the call
    sites that must exist by NAME, so deleting one is a failure here rather than
    a capability that silently stops working.

    It proves a call site is in shipped source. Not that it runs, not that a
    person can reach it. That is a floor, and the floor was missing.
  */
  const MAIN = readFileSync(
    join(fileURLToPath(new URL('../../main/', import.meta.url)), 'index.ts'),
    'utf8',
  )
    // Comments stripped, so a claim cannot be satisfied by the prose making it
    // — `claims.test.ts` was caught by exactly that. Whitespace collapsed after,
    // so a call the formatter wraps across two lines still reads as one.
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/\s+/g, ' ')

  it.each([
    ['the archive is handed to capabilities', 'codexArchive: () => codexHistory().recall()'],
    ['the mirror is reconciled at every wake', 'codexHistory().settle()'],
    ['a finished build re-tells the live session', 'becameReady: () => { tellTheSession() }'],
    ['granting one starts the build', 'if (asked.allowed) void codexHistory().build()'],
    ['revoking one reconciles, which throws the mirror away', 'else codexHistory().settle()'],
    ['readiness decides what is offered', 'unready: unreadyGrants'],
    ['the shelf shows what will be offered', 'offeredGrants(readGrants(userData, worn.id'],
    ['the handle is closed on the way out', 'codexArchive?.close()'],
  ])('%s', (_what, call) => {
    expect(MAIN).toContain(call)
  })

  it('reads the permission for the LIVE session, not merely for whoever is worn', () => {
    // The two diverge after a shelf switch, and the capability runs for the
    // live one. Asserted by name because the alternative is a comment.
    expect(MAIN).toContain('const who = sessionPersona ?? wornId()')
  })

  it('reaches the archive from four places and no more', () => {
    /*
      NOT "it never builds at startup", which was the first version of this and
      was not a check at all: `codexHistory` is DECLARED near the top of the
      file, so anything looking for the name before `app.whenReady` finds the
      declaration and fails whatever the code does.

      What can honestly be asserted is the SIZE of the surface. Four call sites
      — the capability accessor, the wake, and the two halves of a grant change
      — plus the shutdown close. A fifth appearing is somebody adding a trigger,
      which is the change that needs to be looked at: "never on startup" is a
      property of WHERE these are, and this is what makes a new one visible.
    */
    // The declaration itself is not a call site, hence the lookbehind.
    const reaches = MAIN.match(/(?<!function )codexHistory\(\)/g) ?? []
    expect(reaches).toHaveLength(5)
  })
})

describe('what reaches the wire', () => {
  it('never sends a credential, even one sitting in the indexed corpus', async () => {
    /*
      THE CANARY, asserted at the boundary that matters.

      `ledger.ts` sends every capability result as a `function_call_output` and
      the renderer forwards every non-private frame onto the data channel — so
      this payload leaves the machine. The canary is planted in a `userMessage`,
      which IS indexed, rather than in command output, which is not.
    */
    const canary = `sk-${'a1B2c3D4e5F6g7H8i9J0'}`
    const items: readonly ItemRow[] = [
      {
        threadId: 'one',
        itemId: 'i1',
        ordinal: 1,
        type: 'userMessage',
        json: userMessageJson(`the token I pasted was ${canary} and it stopped working`),
      },
    ]
    const codexHome = writeArchive({
      home: home(),
      threads: [{ id: 'one', cwd: '/work/mochi', firstUserMessage: 'about the token' }],
      items,
      cursors: cursorsFor(items),
    })
    const userData = home()
    const archive = createCodexArchive({
      userData: () => userData,
      home: () => codexHome,
      allowed: () => true,
    })
    open.push(archive)
    await archive.build()

    const payload = call({ query: 'the token I pasted stopped working' }, archive)
    expect(payload['status']).toBe('found')
    // What `ledger.ts` would put on the wire, checked as one string.
    const wire = JSON.stringify(payload)
    expect(wire).not.toContain(canary)
    expect(wire).toContain(REDACTED)
  })

  it('never sends what was in command output at all', async () => {
    /*
      The boundary that DOES exist, as distinct from the mask that is only a
      conservative one. Excluding `commandExecution` at the query removes the
      bulk source of credential material — measured, sixteen key-shaped strings
      in the excluded corpus against one in the indexed one — and those pages
      are never read into this process.
    */
    const items: readonly ItemRow[] = [
      {
        threadId: 'one',
        itemId: 'i1',
        ordinal: 1,
        type: 'commandExecution',
        json: JSON.stringify({ type: 'commandExecution', text: 'export DEPLOY_TOKEN=canary-42' }),
      },
    ]
    const codexHome = writeArchive({
      home: home(),
      threads: [{ id: 'one', firstUserMessage: 'about the deploy' }],
      items,
      cursors: cursorsFor(items),
    })
    const userData = home()
    const archive = createCodexArchive({
      userData: () => userData,
      home: () => codexHome,
      allowed: () => true,
    })
    open.push(archive)
    await archive.build()

    const payload = call({ query: 'DEPLOY_TOKEN canary' }, archive)
    expect(JSON.stringify(payload)).not.toContain('canary-42')
  })
})
