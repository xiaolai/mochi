/**
 * Everything that went wrong, kept where somebody can be shown it.
 *
 * There are eleven `console.error` sites in main and **a packaged app has no
 * console**. So a persona that failed to parse, an avatar rejected for a
 * missing field, a key another application already owns — all of it happens,
 * falls back to something that works, and looks from the outside exactly like
 * the app ignoring the file somebody just wrote.
 *
 * Capabilities are NOT in that list any more. They are compiled in, and a
 * malformed one fails at module evaluation rather than falling back — there is
 * no running app for it to be reported to. What capabilities still use this for
 * is a handler that threw mid-conversation, and the old user-installed folder
 * if somebody still has one.
 *
 * That cost real time twice in one session, and both times the only reason it
 * was found is that the app happened to be running from a terminal. The people
 * this is being built for will not be.
 *
 * ## Kept, not thrown
 *
 * A problem here is never a reason to refuse to start: every one of these paths
 * already has a working fallback, and taking the app down instead would be a
 * strictly worse answer than a green mochi with a note attached. This records;
 * the caller still falls back exactly as it did.
 */

export interface Problem {
  /** Which subsystem — `avatar`, `persona`, `capability`, `voice`. */
  readonly area: string
  /** The file, folder or name it is about, when there is one. */
  readonly subject: string | null
  /** What is wrong, in the words somebody could act on. */
  readonly detail: string
  /** When it last happened, not when it first did. See `note`. */
  readonly at: number
  /**
   * How many times this exact fact has been noted, at least 1.
   *
   * Drawn as a count beside the entry rather than as repeated entries. See
   * `note` for why the repetition is collapsed at all.
   */
  readonly seen: number
}

/**
 * Bounded, and it drops the OLDEST.
 *
 * A session that reconnects hourly can generate the same voice problem all day.
 * Keeping the newest is what makes the list answer "what is wrong now" rather
 * than "what was wrong when this started".
 *
 * That reasoning is right about which end to drop and was NOT enough on its
 * own: see `note`, where the repeat that motivates it is the very thing that
 * used to fill all fifty slots.
 */
const KEEP = 50

export interface Problems {
  note(area: string, subject: string | null, detail: string): void
  /** Newest first, because that is the order somebody reads them in. */
  all(): readonly Problem[]
  /** How many, for a badge that has no room for more than a number. */
  count(): number
  /** Everything from one launch is stale once the thing is fixed and reloaded. */
  clear(): void
  /**
   * Be told when the count changes.
   *
   * Here rather than at the call sites because half of these happen AFTER the
   * session config was answered — a capability that threw, a reconnect that
   * could not be scheduled — and the badge has to stay true for those too.
   * Remembering to notify at each new site is the kind of discipline that holds
   * until the fourth site.
   */
  watch(listener: (count: number) => void): void
}

export function createProblems(now: () => number = Date.now): Problems {
  const kept: Problem[] = []
  const watchers: ((count: number) => void)[] = []

  return {
    /*
      THE SAME FACT TWICE IS ONE ENTRY WITH A COUNT, not two entries.

      Measured on 2026-08-28, running the app against a `.deleting` mark naming
      an unusable folder: the mark is deliberately LEFT in place so nothing acts
      on a record it cannot read, `unfinishedDeletions` runs on every catalogue
      load, and one bad file produced TWELVE identical entries in a session
      barely a minute long. Fifty is not far away, and the eviction rule above
      means the repeater is what survives: the voice failure, the refused key
      and the unparsed avatar are pushed out by one fact restating itself.

      So the bound alone was the wrong shape of answer. It decides WHICH to drop
      when the list is full, and the list filling with one thing is the problem.

      Collapsed here rather than at the call sites, because it is not that
      caller's defect — the header already names an hourly voice reconnect as
      the same shape, and `sweepDeletions` reports on every launch by design.
      Any fact that recurs crowds the list out, so the fix belongs where every
      fact arrives.

      `at` is the LATEST occurrence and the entry moves to the front, so the
      list still answers "what is wrong now" rather than filing a recurring
      failure under the first time anyone saw it.
    */
    note(area: string, subject: string | null, detail: string) {
      const already = kept.findIndex(
        (one) => one.area === area && one.subject === subject && one.detail === detail,
      )
      const seen = already === -1 ? 1 : (kept.splice(already, 1)[0]?.seen ?? 1) + 1
      kept.push({ area, subject, detail, at: now(), seen })
      // Oldest out, so the list is what is wrong now.
      if (kept.length > KEEP) kept.splice(0, kept.length - KEEP)
      for (const watcher of watchers) watcher(kept.length)
    },
    all: () => [...kept].reverse(),
    count: () => kept.length,
    clear: () => {
      kept.length = 0
      for (const watcher of watchers) watcher(0)
    },
    watch: (listener: (count: number) => void) => {
      watchers.push(listener)
    },
  }
}

/**
 * The one collector this process reports into.
 *
 * A singleton here rather than a `const` in `index.ts` because reporting a
 * problem is not the composition root's business -- any module that can fail
 * in a way a person should hear about needs to reach this, and routing every
 * one of them back through `index.ts` is what kept failures silent in modules
 * that had no reason to import it.
 */
export const problems = createProblems()
