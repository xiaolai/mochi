import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Her note is rewritten when a presence ends, and only ever once at a time.
 *
 * ## What was wrong, and for how long
 *
 * `memory/summarise.ts` — the whole-note rewriter — was written, tested,
 * deadlined, schema-guarded and deliberately routed onto the Codex
 * subscription so that remembering somebody would not sit behind a second
 * paywall. **It had no production caller at all.** Her note only ever moved
 * when the model chose to call `remember_this`, and `usage.json` is the
 * measurement of how often a model chooses anything: four of this build's
 * then-seven tools were never called once.
 *
 * Nothing caught it because the gate that finds uncalled exports
 * (`store/wiring.test.ts`) scanned one directory and this was in the one next
 * door. That gate now scans both; this file asserts the other half — that the
 * call is on the path it is supposed to be on.
 *
 * ## Why the single-flight guard is asserted too
 *
 * `summarise` READS the note and the caller WRITES what comes back, so two
 * overlapping runs are not two summaries. Both read note N and the slower one
 * writes over the faster one's work, from a base that no longer exists. It
 * takes a person rather than a race: sleep, wake, speak, sleep again, while the
 * first run still has minutes left on its deadline.
 *
 * It also bounds the subprocesses. `ask-workspace/running.ts` exists because
 * nothing bounded the lookups; this path spawns the same binary.
 *
 * ## Why from source
 *
 * `index.ts` cannot be imported outside Electron. Comments are stripped first,
 * or the prose above each mechanism would satisfy every assertion below.
 */
const MAIN = readFileSync(join(process.cwd(), 'src', 'main', 'index.ts'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[ \t]*\/\/.*$/gm, '')

/** The body of `rewriteNote`, and nothing after it. */
function theRewrite(): string {
  const from = MAIN.indexOf('async function rewriteNote(')
  expect(from, 'rewriteNote is gone').toBeGreaterThan(-1)
  const body = MAIN.slice(from)
  return body.slice(0, body.indexOf('\n}\n') + 2)
}

describe('the presence that just ended is summarised into her note', () => {
  it('is started from the one place that ends a presence', () => {
    const ends = MAIN.slice(MAIN.indexOf('function endPresence'))
    expect(ends.slice(0, ends.indexOf('async function rewriteNote'))).toContain('rewriteNote(')
  })

  it('is never awaited, and does not run on the sleep path at all', () => {
    /*
      The failure this must never have is keeping her awake.

      `void` alone was not enough, and that is the part worth asserting: an
      async function runs synchronously to its first `await`, and this one's
      prefix opens the transcript store, every persona file, her note and the
      prompt overrides before it reaches one. `setImmediate` is what actually
      moves that off the keystroke.
    */
    const ends = MAIN.slice(MAIN.indexOf('function endPresence'))
    const body = ends.slice(0, ends.indexOf('async function rewriteNote'))
    expect(body).toContain('setImmediate(')
    expect(body).toContain('void rewriteNote(')
  })

  it('ends the conversation BEFORE reading it back', () => {
    // The turns are read by token from the store. Reading before `end()` would
    // race the final turn into a summary that does not contain it.
    const ends = MAIN.slice(MAIN.indexOf('function endPresence'))
    const branch = ends.slice(0, ends.indexOf('async function rewriteNote'))
    expect(branch.indexOf('conversation().end()')).toBeLessThan(branch.indexOf('rewriteNote('))
  })

  it('covers every segment since her note was last brought up to date', () => {
    /*
      A reconnect is a NEW session every hour (§53) and `session-config` ends
      the previous conversation on each one, so an awake day is one transcript
      per hour. Summarising only the conversation that was live when somebody
      pressed rest means she remembers the evening and not the morning.
    */
    const rewrite = theRewrite()
    expect(rewrite).toContain('.sessions(personaId)')
    expect(rewrite).toContain('one.startedAt < since')
  })

  it('does not open the conversations it is going to throw away', () => {
    /*
      The prompt was bounded and the WORK was not: every qualifying session was
      read, flattened and sorted before all but the last sixty thousand
      characters were discarded. A day of talking is one SQLite read per hour.

      `sessions()` answers newest-first, so handing a generator to
      `fittingNewestFirst` lets it stop pulling once the budget is full.
    */
    const rewrite = theRewrite()
    expect(rewrite).toContain('function* ()')
    expect(rewrite).toContain('yield store.turns(personaId, one.token)')
    expect(rewrite).toContain('fittingNewestFirst(')
  })

  it('spawns nothing when nobody spoke', () => {
    // An idle machine produces one segment an hour holding her greeting and
    // nothing else. The empty check has to come before the subprocess.
    const rewrite = theRewrite()
    expect(rewrite.indexOf('if (turns.length === 0) return')).toBeLessThan(
      rewrite.indexOf('mkdtempSync('),
    )
  })

  it('advances the cursor to the SNAPSHOT boundary, not to when it finished', () => {
    /*
      The loss this prevents, in order: sleep A starts a summary · she wakes ·
      a conversation happens · sleep B is skipped because A is still running ·
      A finishes and advances the cursor past B's conversation.

      Committing `Date.now()` at the end skips it for ever. Committing the
      instant the snapshot was TAKEN leaves it uncovered, which is what makes
      the next sleep pick it up.
    */
    const rewrite = theRewrite()
    expect(rewrite).toContain('const upTo = Date.now()')
    expect(rewrite).toContain('markSummarised(userData, personaId, upTo)')
    expect(rewrite.indexOf('const upTo = Date.now()')).toBeLessThan(
      rewrite.indexOf('.sessions(personaId)'),
    )
  })

  it('reads the cursor from her memory file, so a quit does not lose a day', () => {
    /*
      It was a Map that started empty on every launch, so a conversation quit
      out of rather than slept was never summarised — its turns findable by
      `recall_conversations` and absent from her note, for ever.

      Per persona for free, because it lives in the file that is already hers,
      and it dies with her because `forgetMemory` takes that file.
    */
    const rewrite = theRewrite()
    expect(rewrite).toContain('summarisedThrough(userData, personaId)')
    expect(MAIN).not.toContain('new Map<string, number>()')
  })

  it('falls back to launch, not to the epoch, when she has no cursor', () => {
    // True of every persona on the launch this shipped in. Summarising a whole
    // history on the first sleep is not what "the presence that just ended"
    // means — 283 conversations, on the installation this was written against.
    const rewrite = theRewrite()
    expect(rewrite).toContain('stored === 0 ? launchedAt : stored')
    expect(MAIN).toContain('const launchedAt = Date.now()')
  })

  it('drops the rewrite if history was deleted while it ran', () => {
    // The summary was built from what was on disk when it started. Somebody who
    // deleted a conversation did not delete it so a summary of it could be kept
    // in a file that outlives the deletion.
    const rewrite = theRewrite()
    expect(rewrite).toContain('const forgottenBefore = historyForgotten')
    expect(rewrite).toContain('historyForgotten !== forgottenBefore')
    const forget = MAIN.slice(MAIN.indexOf("ipcMain.handle('history:forget'"))
    expect(forget.slice(0, forget.indexOf('\n})'))).toContain('historyForgotten += 1')
  })

  it('starts the watermark at launch, not at the epoch', () => {
    /*
      `>= since` with `since` at zero means every conversation ever — 283 of
      them on the installation this was written against. `fitting` would still
      have bounded the PROMPT, which is exactly why this is worth asserting:
      the run would have looked fine and rewritten her note from an arbitrary
      window of her whole history instead of from the presence that just ended,
      opening every one of those conversations on the way.
    */
    expect(MAIN).toContain('const launchedAt = Date.now()')
  })

  it('advances the cursor only after the note is actually written', () => {
    // A run skipped for another summary in flight, or for a missing Codex,
    // leaves it where it was — so the next sleep covers the presence the
    // skipped one would have. Advancing on the attempt makes a dropped run a
    // lost day.
    const rewrite = theRewrite()
    const wrote = rewrite.indexOf('remember(userData, personaId, result.note)')
    const advanced = rewrite.indexOf('markSummarised(userData, personaId, upTo)')
    expect(wrote).toBeGreaterThan(-1)
    expect(advanced).toBeGreaterThan(wrote)
  })

  it('writes through the memory store rather than touching the file', () => {
    expect(theRewrite()).toContain('remember(userData, personaId, result.note)')
  })

  it('leaves the note alone when the summariser could not answer', () => {
    // `summarise` returns `ok: false` for a deadline, a missing Codex,
    // malformed JSON or a rejected field, and the note must survive all four.
    // A note that fails to improve is a non-event; one replaced by something
    // half-parsed is a memory quietly corrupted.
    expect(theRewrite()).toContain('if (!result.ok)')
  })

  it('catches its own failures, because nothing is awaiting them', () => {
    // Started with `void` from the sleep path, so an unhandled rejection here
    // is an unhandled rejection in going to sleep.
    expect(theRewrite()).toContain('catch')
  })

  it('removes its scratch directory whatever happened', () => {
    const rewrite = theRewrite()
    expect(rewrite.slice(rewrite.indexOf('} finally {'))).toContain('rmSync(scratch')
  })

  it('holds its Codex child so quitting kills it', () => {
    /*
      `running.ts` was written because `will-quit` closed the archive and left
      every Codex child alive — the app leaves the Dock and a subprocess goes
      on running with nothing to say it is there. `stopLookups` is wired to
      `running.stopAll()`.

      This path spawns the same binary through a different door, and a child
      that is not held is not stopped. Asserted here rather than trusted,
      because the failure is invisible from inside the app: it happens after
      the app is gone.
    */
    expect(theRewrite()).toContain('running.hold(handle)')
  })

  it('does not write over a note somebody edited while it ran', () => {
    // Her note is editable by hand in the shelf and has a Clear. Four minutes
    // is long enough for somebody to use either, and a rewrite built from the
    // version before it would revert their change with nothing to explain it.
    expect(theRewrite()).toContain('recall(userData, personaId) !== before')
  })

  it('does not recreate the note of a persona that was deleted while it ran', () => {
    // `deletePersona` calls `forgetMemory`, and ids are derived name slugs
    // handed out again once free. A write landing after a deletion recreates
    // the file — and if the name has come round, it hands one person's
    // transcript-derived notes to a different character.
    expect(theRewrite()).toContain('catalogue(userData).personas.has(personaId)')
  })

  it('drops the rewrite if any character was deleted while it ran', () => {
    /*
      The hole the identity check alone leaves, found by a verification pass.

      Re-checking that the id is still in the catalogue and that the note is
      unchanged answers "same id, same note". It does not answer "same
      character": ids are derived name slugs handed out again once free, so a
      persona deleted and recreated under the same name holds the same id — and
      a fresh character's note is empty, so a byte-comparison against an empty
      starting note passes as well.

      A counter that any deletion bumps answers the question the other two
      cannot.
    */
    const rewrite = theRewrite()
    expect(rewrite).toContain('const incarnation = personasDeleted')
    expect(rewrite).toContain('personasDeleted !== incarnation')
  })

  it('counts a deletion where the deletion happens, not at the end of the handler', () => {
    /*
      A verification pass caught this one late. The increment first sat at the
      foot of the handler, below an unguarded `readWornPersonaId` and a
      `conversation().end()` — either of which can throw. A throw there leaves
      the counter reading as though nothing had been deleted while the persona
      is already gone from disk, and an in-flight summary then commits against
      a recycled id: exactly the case the counter exists for.

      So the assertion is about ORDER, not presence.
    */
    const handler = MAIN.slice(MAIN.indexOf("ipcMain.handle('shelf:persona'"))
    const body = handler.slice(0, handler.indexOf('\n})'))
    expect(body).toContain('personasDeleted += 1')
    expect(body.indexOf('personasDeleted += 1')).toBeLessThan(body.indexOf('readWornPersonaId('))
  })

  it('cannot wedge itself if the scratch directory cannot be made', () => {
    /*
      `mkdtempSync` can fail — a full disk, a `TMPDIR` that has gone away. It
      used to run between taking the flag and entering the block that clears
      it, so one failure disabled every later summary for the life of the
      process, silently. That is a worse fault than the one it reaches for.
    */
    const rewrite = theRewrite()
    // Nullable, so the `finally` can tell "never made" from "made and gone"
    // rather than calling `rmSync(undefined)`.
    expect(rewrite).toContain('let scratch: string | null = null')
    // And made after the flag is taken, so it sits inside the block whose
    // `finally` clears it rather than in the gap before it.
    const taken = rewrite.indexOf('rewritingNote = true')
    expect(taken).toBeLessThan(rewrite.indexOf('mkdtempSync('))
    expect(rewrite.slice(rewrite.indexOf('} finally {'))).toContain('if (scratch !== null)')
  })

  it('releases the hold when the child finishes', () => {
    // Otherwise the list grows one dead handle per sleep, for the life of the
    // process, and `stopAll` signals corpses at quit.
    expect(theRewrite()).toContain('handle.finished.finally(release)')
  })
})

describe('only one note is rewritten at a time', () => {
  it('refuses to start a second run while one is going', () => {
    expect(theRewrite()).toContain('if (rewritingNote)')
  })

  it('takes the flag before the work and clears it in the finally', () => {
    // In the `finally`, not on the success path: a run that threw with the flag
    // still set would refuse every later summary for the life of the process —
    // the exact shape `ask-workspace`'s slot comment warns about.
    const rewrite = theRewrite()
    const taken = rewrite.indexOf('rewritingNote = true')
    const finallyAt = rewrite.indexOf('} finally {')
    expect(taken).toBeGreaterThan(-1)
    expect(finallyAt).toBeGreaterThan(taken)
    expect(rewrite.slice(finallyAt)).toContain('rewritingNote = false')
  })

  it('does not hold the flag across the early returns', () => {
    // Nothing said, or no Codex on the machine. Taking the flag before those
    // would leave it set on a path that never reaches the `finally`.
    const rewrite = theRewrite()
    expect(rewrite.indexOf('if (turns.length === 0) return')).toBeLessThan(
      rewrite.indexOf('rewritingNote = true'),
    )
  })
})
