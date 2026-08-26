/**
 * Put everything down, once, in an order chosen for what survives a failure.
 *
 * ## Why the order is the whole content
 *
 * Four things end here and each can throw. Run in the wrong order, a failure
 * in one strands the others — and every one of them leaves something running
 * on a machine whose app has visibly quit.
 *
 *   1. **The children.** A Codex lookup may have three minutes left. On the
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
export function shutDown(deps: ShutdownDeps): void {
  try {
    const stopped = deps.stopLookups()
    if (stopped > 0) deps.log(`[main] stopped ${String(stopped)} running lookup(s)`)
  } catch (error: unknown) {
    deps.warn('[main] a running lookup could not be stopped:', error)
  }

  try {
    const hanging = deps.unanswered()
    const promised = deps.undelivered()
    if (hanging.length > 0) {
      deps.warn(`[capability] ${String(hanging.length)} call(s) were never answered`)
      deps.note(
        'capability',
        `${String(hanging.length)} tool call(s) were never answered before quitting`,
      )
    }
    if (promised.length > 0) {
      deps.warn(`[capability] ${String(promised.length)} deferred call(s) never came back`)
      deps.note(
        'capability',
        `she said she would come back to ${String(promised.length)} thing(s) and did not`,
      )
    }
  } catch (error: unknown) {
    deps.warn('[capability] the outstanding calls could not be read:', error)
  }

  try {
    deps.endConversation()
  } catch (error: unknown) {
    deps.warn('[main] the conversation could not be ended:', error)
  } finally {
    // In a `finally`, so a conversation that cannot be ended does not leave the
    // database open behind it.
    try {
      deps.closeArchive()
    } catch (error: unknown) {
      deps.warn('[main] the archive could not be closed:', error)
    }
  }
}
