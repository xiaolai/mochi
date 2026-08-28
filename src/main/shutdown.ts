/**
 * Put everything down, once, in an order chosen for what survives a failure.
 *
 * ## Why the order is the whole content
 *
 * Four things end here and each can throw. Run in the wrong order, a failure
 * in one strands the others — and every one of them leaves something running
 * on a machine whose app has visibly quit.
 *
 *   1. **The children.** A Codex run may have three minutes left. On the
 *      paths that reach here through `app.exit()` there is no parent left to
 *      reap it, so a subprocess goes on reading somebody's workspace with the
 *      app gone from the Dock and nothing on screen to say it is there. First,
 *      because everything below it can fail and a child outliving the app is
 *      worse than an archive closed a few milliseconds later.
 *
 *   2. **What is still owed.** `ledger.ts` and `dispatch.ts` carry four
 *      comments describing `unanswered()` and `undelivered()` as the things
 *      that "would notice" a hang or a promise she never came back from —
 *      and until this existed, nothing called either. Shutdown is the honest
 *      moment to ask: anything outstanding now never will be answered, so this
 *      is the last instant at which "she was interrupted" and "a frame was
 *      silently dropped" can still be told apart.
 *
 *   3. **The conversation**, and then **4. the archive** — in that order and in
 *      a `finally`, because a conversation that cannot be ended must not leave
 *      the database open.
 *
 * ## Why it is a module
 *
 * It was 67 lines inside `index.ts` and it is not composition — it is a
 * sequence with an argument for its order, which is exactly the kind of thing
 * that should be readable without the two thousand lines around it. Taking it
 * out also made it testable: `index.ts` cannot be imported outside Electron,
 * so none of the ordering above could be asserted at all.
 */

export interface ShutdownDeps {
  /** Kill every live subprocess. Returns how many. */
  readonly stopLookups: () => number
  /** Tool calls that arrived and were never acknowledged. */
  readonly unanswered: () => readonly string[]
  /** Calls she deferred and never came back from. */
  readonly undelivered: () => readonly string[]
  /** End the live conversation, if there is one. */
  readonly endConversation: () => void
  /** Close the archive. */
  readonly closeArchive: () => void
  /**
   * Remove any scratch directory a summary is still using. Returns how many.
   *
   * Here rather than left to the job's own `finally`, which is a continuation
   * on a promise nobody awaits: `stopLookups` above kills the child
   * synchronously and the process can exit before that continuation ever runs,
   * leaving a `mochi-summary-*` directory holding a transcript in the system
   * temp folder. The OS reclaims it eventually; "eventually" is not a property
   * worth shipping for a directory that held somebody's conversation.
   */
  readonly removeScratch: () => number
  readonly note: (what: string, detail: string) => void
  readonly log: (line: string) => void
  readonly warn: (line: string, error?: unknown) => void
}

/**
 * Run the sequence.
 *
 * Every step is independently guarded: this is called from `will-quit` and
 * from both `app.exit()` paths, where a throw strands whatever has not run
 * yet. Returning normally is not a claim that everything succeeded — the
 * failures are reported, not raised, because there is nobody left to handle
 * one.
 */
/**
 * One step, guarded — including the reporting of its own failure.
 *
 * ## Two defects, and they are the same shape
 *
 * The sequence was five `try { … } catch { deps.warn(…) }` blocks. A `warn`
 * that throws inside one of those catches is not caught by anything: it leaves
 * `shutDown` entirely, so a failure in the REPORTER strands every step after
 * it — including closing the archive, which is what flushes deleted text out of
 * the write-ahead log. The one thing here that must always happen was behind
 * the one thing nobody guards, because reporting is not usually thought of as a
 * step that can fail. It is a `console.warn` in production and a callback in
 * every other caller, and either can be replaced.
 *
 * And the second: two INDEPENDENT obligations shared one block, so
 * `unanswered()` throwing meant `undelivered()` was never asked. "She was
 * interrupted" and "a frame was silently dropped" are the two facts this
 * sequence exists to tell apart, and one of them could take the other with it.
 *
 * A helper rather than five more nested `try`s: five copies of a defensive
 * pattern is five chances to write the fourth one differently, which is how the
 * shared block came to exist in the first place.
 */
function step(deps: ShutdownDeps, what: string, run: () => void): void {
  try {
    run()
  } catch (error: unknown) {
    try {
      deps.warn(what, error)
    } catch {
      /*
        Nothing left to tell, and that is genuinely the end of the line.

        This is the only empty catch in the module and it is the correct one:
        the reporter is what failed, so there is nowhere to report it to, and
        anything else here would be the same defect one level down. What matters
        is that the archive still closes.
      */
    }
  }
}

/**
 * Run the sequence.
 *
 * Every step is independently guarded: this is called from `will-quit` and
 * from both `app.exit()` paths, where a throw strands whatever has not run
 * yet. Returning normally is not a claim that everything succeeded — the
 * failures are reported, not raised, because there is nobody left to handle
 * one.
 */
export function shutDown(deps: ShutdownDeps): void {
  step(deps, '[main] a running Codex run could not be stopped:', () => {
    const stopped = deps.stopLookups()
    // "Codex run", not "lookup". The sleep summariser shares this registry
    // now, so a shutdown log naming every child a lookup misidentifies half of
    // what it stopped — and this log is the only record that they were.
    if (stopped > 0) deps.log(`[main] stopped ${String(stopped)} running Codex run(s)`)
  })

  step(deps, '[main] a summary scratch directory could not be removed:', () => {
    // Straight after the kill, and before anything slower: the child that was
    // reading this directory is gone as of the line above.
    const swept = deps.removeScratch()
    if (swept > 0) deps.log(`[main] removed ${String(swept)} summary scratch director(ies)`)
  })

  /*
    TWO STEPS, where there was one block holding both.

    They are independent obligations about different failures — a call that was
    never acknowledged, and one she promised to come back to and did not — and
    sharing a `try` meant the first one throwing silently answered the second.
    Shutdown is the last instant either can be recorded at all.
  */
  step(deps, '[capability] the unanswered calls could not be read:', () => {
    const hanging = deps.unanswered()
    if (hanging.length === 0) return
    deps.warn(`[capability] ${String(hanging.length)} call(s) were never answered`)
    deps.note(
      'capability',
      `${String(hanging.length)} tool call(s) were never answered before quitting`,
    )
  })

  step(deps, '[capability] the undelivered calls could not be read:', () => {
    const promised = deps.undelivered()
    if (promised.length === 0) return
    deps.warn(`[capability] ${String(promised.length)} deferred call(s) never came back`)
    deps.note(
      'capability',
      `she said she would come back to ${String(promised.length)} thing(s) and did not`,
    )
  })

  try {
    step(deps, '[main] the conversation could not be ended:', () => {
      deps.endConversation()
    })
  } finally {
    // In a `finally`, so a conversation that cannot be ended does not leave the
    // database open behind it. `step` already swallows the ordinary failure;
    // this is the belt for anything it cannot — a throw from `step` itself is
    // unreachable by construction, and the archive is too important to rest on
    // a proof rather than a `finally`.
    step(deps, '[main] the archive could not be closed:', () => {
      deps.closeArchive()
    })
  }
}
