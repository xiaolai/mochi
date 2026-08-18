/**
 * Everything that went wrong, kept where somebody can be shown it.
 *
 * There are eleven `console.error` sites in main and **a packaged app has no
 * console**. So a persona that failed to parse, an avatar rejected for a
 * missing field, a capability folder that is malformed — all of it happens,
 * falls back to a default, and looks from the outside exactly like the app
 * ignoring the file somebody just wrote.
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
  readonly at: number
}

/**
 * Bounded, and it drops the OLDEST.
 *
 * A session that reconnects hourly can generate the same voice problem all day.
 * Keeping the newest is what makes the list answer "what is wrong now" rather
 * than "what was wrong when this started".
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
    note(area: string, subject: string | null, detail: string) {
      kept.push({ area, subject, detail, at: now() })
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
