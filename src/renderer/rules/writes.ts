/**
 * Writes run ONE AT A TIME, in the order they were asked for.
 *
 * ## The failure this exists for — contract M3
 *
 * Every control in this window dispatches into the void — `hearing`, `grant`,
 * `screen` and the rest are all `void writeMachine(...)` — so two changes in
 * quick succession were two independent chains racing to main. The second
 * selection could be written first and the first one last, leaving the setting
 * on the value somebody moved OFF, with a "Saved." for the one they moved to.
 *
 * `freshness` is the answer for READS, which replace each other and where the
 * newest wins. A write is not like that: every one has to happen, and the order
 * is the whole meaning. So they queue.
 *
 * ## What "the queue never rejects" means, exactly
 *
 * The CHAIN never rejects. If it did, one failed write would skip every later
 * one — the pane would go quietly dead after the first refusal, which is the
 * worst possible response to a refusal.
 *
 * The promise handed back to a caller is a different thing and DOES reject,
 * because the caller is the one that knows what to say about it: main's own
 * refusal sentence, or the sentence for a throw. Swallowing it here would
 * replace a reason with a shrug, and would make a failed write indistinguishable
 * from a successful one at the only place that can tell somebody.
 */
export interface Writes {
  /**
   * Queue one write. It starts when everything asked for before it has
   * finished, however that went.
   *
   * The returned promise settles with THIS write's own outcome — the queue
   * orders writes, it does not merge them.
   */
  add<T>(run: () => Promise<T>): Promise<T>
}

export function writes(): Writes {
  let chain: Promise<unknown> = Promise.resolve()
  return {
    add: (run) => {
      const mine = chain.then(run)
      /*
        The chain follows the SETTLED write, not the caller's promise.

        `chain = mine` would propagate a rejection into everything queued behind
        it. Resetting to `Promise.resolve()` on failure is the other tempting
        shape and is worse: it releases everything already queued at once, which
        loses the ordering exactly when a failure has made it matter most.
      */
      chain = mine.catch(() => undefined)
      return mine
    },
  }
}
