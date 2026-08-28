/**
 * Whether an answer that has just arrived is still the one being waited for.
 *
 * ## The failure this exists for
 *
 * Every read in this window is an IPC round trip, and several of them can be in
 * flight at once — a character switch while a save is settling, a rapid pair of
 * writes, a tab entered twice. Nothing ordered them, so an OLDER answer could
 * land last and repaint the window with state that had already been replaced.
 *
 * The failure is silent by construction. A stale shelf and a fresh one are the
 * same shape, so the window looks like it loaded; it is simply describing a
 * moment that has passed. The one visible case is the worst of them: an older
 * FAILURE landing after a newer success replaces a list somebody can see with
 * an error about a read they are no longer waiting for.
 *
 * ## Why not the window's `generation`
 *
 * `main.ts` already has one, and it means something else: it is bumped by
 * "every click, every search and every character switch" — by a person changing
 * their mind. It cannot tell two overlapping reads of the SAME thing apart,
 * because nobody clicked between them.
 *
 * And it must not learn to: bumping it from a background re-read would discard
 * an in-flight `show()` that somebody is watching a spinner for. Intent and
 * freshness are different questions and a counter can only answer one.
 *
 * ## One per family
 *
 * A token belongs to a family of reads that replace each other — the shelf, the
 * conversations, the machine pane. A shared one would make a shelf read cancel
 * a machine read, which is not a relationship those two have.
 */
export interface Freshness {
  /**
   * Begin a read, and get back the question "is this still the newest?".
   *
   * The token is the CLOSURE rather than a number the caller compares, so there
   * is no way to capture it late or compare it against the wrong counter — the
   * two mistakes a hand-written `const mine = n` makes.
   */
  begin(): () => boolean
}

export function freshness(): Freshness {
  let latest = 0
  return {
    begin: () => {
      latest += 1
      const mine = latest
      return () => mine === latest
    },
  }
}
