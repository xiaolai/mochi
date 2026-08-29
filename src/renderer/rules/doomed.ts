/**
 * What a confirmation is ABOUT, frozen at the moment it opened.
 *
 * ## The shape of the only irreversible action in the app
 *
 * There is no undo, deliberately: an undo buffer is a second copy of the thing
 * somebody just asked to destroy, which contradicts the claim the deletion
 * exists to make good. The confirmation IS the undo, so its properties are the
 * safety.
 *
 * ## Contract D1 — a snapshot, never live state
 *
 * Re-reading the selection and the worn character when the second control is
 * pressed means whatever changed in between is silently what gets deleted — and
 * both CAN change while the question is on screen, because the tray can switch
 * character and the list is live underneath. A confirmation that can target
 * moving state is not a confirmation.
 *
 * ## The WORDS are part of the snapshot
 *
 * `asks` and `because` are taken with the id, at the same instant, from the
 * same read. Worded later they are recomputed from whatever is live then — so a
 * character switch while the question waits makes the question describe one
 * character over a deletion aimed at another's id. That is worse than the
 * target moving, because the sentence is the whole of what the person answering
 * has to go on.
 *
 * ## Why this is a module and not three variables
 *
 * It was three variables in a 1,900-line file, and the rule was held by a test
 * that read that file's SOURCE and asserted the order of two assignments in it.
 * That test was right about the rule and could survive nothing. The rule is a
 * decision — take one, answer it once, drop it — so it is a decision here, where
 * it can be exercised rather than grepped.
 */
export type Doomed = { readonly asks: string; readonly because: string } & (
  | { readonly kind: 'some'; readonly id: string; readonly tokens: readonly string[] }
  | { readonly kind: 'hers'; readonly id: string; readonly who: string }
  | { readonly kind: 'everything' }
)

export interface Confirmation {
  /** What is being asked, or null when nothing is. */
  asking(): Doomed | null
  /** Open one. The snapshot is taken NOW. */
  ask(about: Doomed): void
  /**
   * Answer it, and get back what to act on.
   *
   * The snapshot is DROPPED as it is handed over, so a second press — a
   * double-click, a key repeat, a click landing before the surface closes —
   * answers `null` and deletes nothing. This is the property the arming pattern
   * cannot have, because arming re-reads live state on the second press.
   */
  answer(): Doomed | null
  /** Dismissed. Escape and cancelling both come through here. */
  drop(): void
}

export function confirmation(): Confirmation {
  let about: Doomed | null = null
  return {
    asking: () => about,
    ask: (next) => {
      about = next
    },
    answer: () => {
      const mine = about
      about = null
      return mine
    },
    drop: () => {
      about = null
    },
  }
}

/**
 * Say what happened, in the terms the store answered in.
 *
 * The count main really removed, which is not always the number chosen: a
 * conversation can have gone in another window since. Saying "3 deleted" when 2
 * went would be a small lie in the one place people check.
 *
 * And "deleted" and "not yet scrubbed from the file" are said as the different
 * things they are. A deletion still settling is not one that failed, and it is
 * not one that has finished either.
 */
export function saidOf(
  result: { readonly gone: number | null; readonly pending: boolean },
  about: Doomed,
): string {
  const scrubbing = result.pending
    ? ' They are still being cleared from the file, which finishes on its own.'
    : ''
  if (about.kind === 'some') {
    const gone = result.gone ?? about.tokens.length
    return `${gone === 1 ? 'One conversation' : `${String(gone)} conversations`} deleted.${scrubbing}`
  }
  if (about.kind === 'hers') return `${about.who}${scrubbing}`
  return `Every conversation deleted.${scrubbing}`
}

/**
 * What the question says, and the rule that it NAMES ITS SCOPE.
 *
 * Never a bare "are you sure": the three deletions this app offers differ by
 * two orders of magnitude in what they take, and a question that does not say
 * which one it is asking about is one somebody answers by habit.
 *
 * Called when the question is ASKED, and carried in the snapshot from then on.
 */
export function wordsFor(
  about: { readonly kind: Doomed['kind']; readonly tokens?: readonly string[] },
  said: { readonly hers: string; readonly hersWhy: string },
): { readonly asks: string; readonly because: string } {
  if (about.kind === 'some') {
    const many = about.tokens?.length ?? 0
    return {
      asks: many === 1 ? 'Delete this conversation?' : `Delete ${String(many)} conversations?`,
      because: 'What was said in them is removed from this machine. This cannot be undone.',
    }
  }
  if (about.kind === 'hers') return { asks: said.hers, because: said.hersWhy }
  return {
    asks: 'Delete every conversation, for every character?',
    because:
      'Every conversation this app has stored is removed from this machine, including any ' +
      'belonging to characters that are no longer here. Characters, voices and looks are ' +
      'untouched. This cannot be undone.',
  }
}
