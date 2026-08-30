/**
 * Taking back the last thing she wrote about you.
 *
 * ## One step, and it is a version rather than a history
 *
 * She keeps the previous note, not a log of them. So exactly one write can be
 * taken back, and taking it back spends the step: undo twice and the second
 * press has nothing to act on. Once she writes again the line before the last
 * one is gone for good, and the window has to say that out loud rather than
 * offering a control that will quietly stop working.
 *
 * ## `null` and `''` are different answers
 *
 * `SettingsNote.previous` is `null` when nothing has ever been rewritten, and
 * `''` when the note was empty before the first rewrite. Collapsing them makes
 * the FIRST rewrite the one that cannot be undone — which is exactly the
 * rewrite somebody most wants back, because it is the one that arrived without
 * being asked for. The check here is `=== null`, never falsiness.
 *
 * ## Why it is a rule rather than three lines in the pane
 *
 * The pane has to answer three questions at once — whether to offer the
 * control, what to say it will do, and what the note becomes if it is pressed —
 * and getting the third one from the first two is where a view starts keeping
 * its own copy of the state. Contract C1's shape: a control tracks what it has
 * asked for, not what it was drawn with.
 */

export interface Note {
  readonly text: string
  /** `null` means nothing has ever been rewritten. `''` is a real previous note. */
  readonly previous: string | null
}

export interface Undoing {
  /** Whether the control is offered at all. */
  readonly offered: boolean
  /**
   * What the note becomes if it is pressed, or `null` when it is not offered.
   *
   * The VALUE rather than a signal to go and look it up, so the caller cannot
   * arrive at a different answer than the one that decided to offer the
   * control. Those two coming apart is how a control comes to do something
   * other than what it said.
   */
  readonly becomes: string | null
  /**
   * How many lines the note loses, for the sentence beside the control.
   *
   * Negative when the undo would ADD lines back — she can shorten a note as
   * well as lengthen one, and a sentence that only ever says "removes N lines"
   * is wrong exactly when somebody is trying to recover something she deleted.
   */
  readonly lines: number
}

/** Lines in a note. An empty note is nought lines, not one blank one. */
function linesIn(text: string): number {
  return text === '' ? 0 : text.split('\n').length
}

export function undoing(note: Note): Undoing {
  if (note.previous === null) return { offered: false, becomes: null, lines: 0 }
  return {
    offered: true,
    becomes: note.previous,
    lines: linesIn(note.text) - linesIn(note.previous),
  }
}
