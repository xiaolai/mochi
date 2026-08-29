/**
 * Whether an answer that has arrived is still the one somebody is looking at.
 *
 * ## The failure this exists for — contract A3
 *
 * Every read in this window is an IPC round trip into a store, and a slow one
 * for the conversation you closed used to land AFTER the fast one for the
 * conversation you opened — painting the wrong transcript over the right one.
 * Debouncing the search stops queued timers; it does nothing at all about a
 * query already in flight.
 *
 * ## Why this is not `freshness`, and must not become it
 *
 * They answer different questions and a counter can only answer one.
 *
 *   `freshness`  has a later read of THIS THING overtaken mine?
 *                bumped by every read, so the newest read wins.
 *
 *   `latest`     is this still what somebody is LOOKING AT?
 *                bumped only when they change their mind — a click, a search,
 *                a character switch.
 *
 * The difference is load-bearing. If this bumped on every read, a background
 * re-read would discard the transcript somebody is watching a spinner for. If
 * `freshness` did not, two overlapping reads of the shelf would both paint and
 * the slower one would win. Both modules exist because both failures happened.
 *
 * ## One per family of intent
 *
 * A transcript and a search do not replace each other — a search changes the
 * LIST and a transcript is the column beside it — so they take one each. Shared,
 * typing a query discarded a transcript that was still loading and left the
 * column blank for ever.
 */
export interface Latest {
  /**
   * Somebody changed what they are looking at.
   *
   * Called for the change of MIND — opening a conversation, typing a search,
   * switching character — and never for a read that is merely refreshing what
   * is already on screen.
   */
  moved(): void
  /**
   * Capture what is being looked at now; the answer is whether it still is.
   *
   * The token is the CLOSURE rather than a number the caller compares, so there
   * is no way to capture it late or to compare it against the wrong counter —
   * the two mistakes a hand-written `const mine = generation` makes, and this
   * module was extracted from six hand-written copies of exactly that.
   */
  request(): () => boolean
}

export function latest(): Latest {
  let looking = 0
  return {
    moved: () => {
      looking += 1
    },
    request: () => {
      const mine = looking
      return () => mine === looking
    },
  }
}
