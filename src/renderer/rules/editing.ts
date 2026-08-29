/**
 * A document being edited, and what is available while a write of it is out.
 *
 * ## The failure this exists for — contract C3
 *
 * Two controls act on one document: one commits, one takes the edit back. They
 * were left live on dispatch, so a second click — or Save followed straight by
 * Reset — started two writes whose completion order nothing guarantees. The
 * window re-reads after each, so the LAST ANSWER wins rather than the last
 * click, and the document could settle on the state somebody had just changed
 * their mind about.
 *
 * ## And the box goes with the buttons
 *
 * Only the buttons were disabled, so the field stayed live for the whole round
 * trip — and the write ends in a re-read that rebuilds the pane from what is
 * now stored. Anything typed in between was replaced without a word: the caret
 * jumped, the words went, and the only thing that had happened was a save
 * somebody asked for.
 *
 * Disabled rather than left alone and merged afterwards. There is one document
 * and two writers, and the honest resolution is that one of them waits — the
 * round trip is an IPC call, not a network one.
 *
 * ## Nothing re-enables locally
 *
 * `arrived` is the only way out of `sending`, and it is the re-read. A local
 * re-enable is a guess about what the store now holds, and the one guess that
 * is always wrong is the one made after a REFUSAL — which comes back as the
 * value that was already there, so a control watching only for the text to
 * change waits for ever.
 *
 * ## Two shapes of taking it back
 *
 * The wake panel's Cancel is local: the draft returns to what is stored and
 * nothing is written. The catalogued prompts' Reset is a WRITE — it restores
 * the shipped default, so the stored value itself changes. Both are the second
 * control, both share one availability, and only the second one locks the pane.
 * Keeping them as separate verbs is what stops a local revert from silently
 * acquiring the lock, or a remote one from silently not.
 *
 * ## Why it is not `acknowledged`
 *
 * That rule is for a control whose value IS the choice — a pronoun, a voice, a
 * set of expressions — where showing what was asked for is the point. This is
 * for a document somebody is part-way through writing, where the draft must
 * survive a revert and the commit is deliberate. The two look similar and
 * differ on the thing that matters: what an unacknowledged state should show.
 */
export interface Editing {
  /** What is in the box. */
  draft(): string
  /** What is stored. */
  stored(): string
  /** Whether a write of ours is out. */
  sending(): boolean
  /** Somebody typed. */
  typed(text: string): void
  /**
   * Whether committing is available.
   *
   * Enabled by there being a DIFFERENCE, not by having typed — typing a
   * character and deleting it is not a change to save.
   */
  canCommit(): boolean
  /**
   * Commit. Answers the text to write, or null when it is not available.
   *
   * Null rather than writing anyway, so a click that arrives after the control
   * should have gone — a double click, a key repeat — writes nothing.
   */
  commit(): string | null
  /** Whether the second control — the one that takes the edit back — is available. */
  canRevert(): boolean
  /** Take it back here. The draft returns to what is stored; nothing is written. */
  revert(): void
  /**
   * Take it back by writing: the STORED value goes back to a default.
   *
   * Answers whether it went, so a click landing after the control should have
   * gone writes nothing — the same guard `commit` has, for the same reason.
   */
  revertByWriting(): boolean
  /** The re-read landed. The only way out of `sending`. */
  arrived(stored: string): void
}

export interface Allowing {
  /**
   * Any further reason a difference may still not be committable.
   *
   * The catalogued prompts pass their length bound through here, so this module
   * does not restate a rule `prompt-edit.ts` already holds and tests.
   */
  readonly mayCommit?: (draft: string, stored: string) => boolean
  /**
   * When the second control is offered, ignoring the send lock.
   *
   * Defaults to there being a difference, which is the wake panel: Cancel
   * undoes an edit, so with nothing edited there is nothing to undo. The
   * catalogued prompts pass something else — their Reset restores the shipped
   * default, so it is offered whenever the stored text DIFFERS FROM SHIPPED,
   * whether or not anything has been typed.
   */
  readonly mayRevert?: (draft: string, stored: string) => boolean
}

export function editing(stored: string, allowing: Allowing = {}): Editing {
  const different = (draft: string, was: string): boolean => draft !== was
  const mayCommit = allowing.mayCommit ?? different
  const mayRevert = allowing.mayRevert ?? different
  let held = stored
  let text = stored
  let out = false
  return {
    draft: () => text,
    stored: () => held,
    sending: () => out,
    typed: (next) => {
      if (out) return
      text = next
    },
    canCommit: () => !out && text !== held && mayCommit(text, held),
    commit: () => {
      if (!(!out && text !== held && mayCommit(text, held))) return null
      out = true
      return text
    },
    canRevert: () => !out && mayRevert(text, held),
    revert: () => {
      if (!(!out && mayRevert(text, held))) return
      // Back to what is stored, not to empty. Reverting undoes the edit; there
      // is a separate and deliberate way to store nothing, which is to clear
      // the box and commit.
      text = held
    },
    revertByWriting: () => {
      if (!(!out && mayRevert(text, held))) return false
      out = true
      return true
    },
    arrived: (next) => {
      held = next
      text = next
      out = false
    },
  }
}
