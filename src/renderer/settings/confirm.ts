/**
 * A destructive action that has to be asked twice.
 *
 * Its own module for the reason `drafts.ts` and `redraw.ts` are: the pane that
 * uses it builds DOM, so a test cannot import that pane -- and this is a state
 * machine guarding the one action in this window with no undo.
 *
 * ## Three ways out, and the count is the point
 *
 * The first version had one: click the armed button again, which deletes.
 * Leaving the group also disarmed it, but nothing said so. That is an armed
 * destructive control whose only visible affordance is the destruction --
 * fine for something undoable, and a persona is prose somebody wrote.
 *
 * So: Cancel, Escape, and leaving the group. All three land here, which is
 * why this is a module rather than three assignments spread across a pane.
 *
 * ## One at a time
 *
 * Arming a second row disarms the first. Two rows both asking "delete for
 * good?" is a screen where the next click's meaning depends on which button
 * the pointer happens to be over.
 */

export interface Confirmation {
  /** Ask about this one, and stop asking about any other. */
  arm(id: string): void
  /** Which one is being asked about, or null. */
  readonly pending: string | null
  /** Is this the one being asked about? */
  isArmed(id: string): boolean
  /** Answer no. Safe to call when nothing is armed. */
  cancel(): void
  /**
   * Answer yes, and disarm.
   *
   * Returns what was armed so the caller acts on the same id the question was
   * about, rather than on whatever it happens to be holding -- the two can
   * differ if a repaint arrived between the question and the answer.
   */
  confirm(): string | null
}

export function createConfirmation(): Confirmation {
  let pending: string | null = null
  return {
    arm(id) {
      pending = id
    },
    get pending() {
      return pending
    },
    isArmed(id) {
      // A null `pending` must never match, or every row would read as armed
      // the moment nothing was.
      return pending !== null && pending === id
    },
    cancel() {
      pending = null
    },
    confirm() {
      const answered = pending
      pending = null
      return answered
    },
  }
}
