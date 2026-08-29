/**
 * Choosing conversations to delete: what a click means, and when the mode ends.
 *
 * A MODE, rather than a delete control on every row. The list is meant to be
 * read; a destructive affordance on each line while reading is noise and a
 * misclick surface at once.
 *
 * ## Contract A4 — a click selects and does not open
 *
 * The point of the mode is that a click means "this one". A click that also
 * navigated would make the two impossible to tell apart, and the one it would
 * be confused with is irreversible.
 *
 * ## Contract T3 — leaving the archive cancels
 *
 * A delete control whose scope the surrounding page contradicts is worse than
 * no control: leaving the strip visible on the character sheet would put
 * "Delete all" under a heading that says something else, which is how a
 * control's scope gets misread in the one direction that cannot be undone.
 *
 * And it CANCELS rather than hiding. A selection somebody can no longer see is
 * one they have stopped agreeing to, so coming back must not find a delete
 * control already primed with a count.
 */
export type ClickMeans =
  | { readonly kind: 'selected'; readonly chosen: readonly string[] }
  | { readonly kind: 'open'; readonly token: string }

export interface Picking {
  /** Whether the mode is on. */
  on(): boolean
  /** The conversations chosen so far, in the order they were chosen. */
  chosen(): readonly string[]
  start(): void
  /** Leave the mode, and forget the selection with it. */
  stop(): void
  /** A click on a conversation, and what it MEANS. */
  click(token: string): ClickMeans
  /** The window moved to `place`. Anywhere but the archive ends the mode. */
  wentTo(place: string): void
}

export function picking(): Picking {
  let mode = false
  // A Set, so a row cannot be chosen twice, and insertion-ordered so the count
  // on the control and the list handed to the confirmation agree with each other.
  const picked = new Set<string>()

  const stop = (): void => {
    mode = false
    picked.clear()
  }

  return {
    on: () => mode,
    chosen: () => [...picked],
    start: () => {
      mode = true
    },
    stop,
    click: (token) => {
      if (!mode) return { kind: 'open', token }
      // Choosing, not reading. The transcript is deliberately NOT opened.
      if (picked.has(token)) picked.delete(token)
      else picked.add(token)
      return { kind: 'selected', chosen: [...picked] }
    },
    wentTo: (place) => {
      if (place !== 'archive') stop()
    },
  }
}
