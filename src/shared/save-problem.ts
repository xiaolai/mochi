/**
 * What is wrong with a persona file, field by field.
 *
 * ## Why this is not in `ipc.ts`
 *
 * In v1 it was, and the persona parser imported the whole IPC contract to reach
 * it. That contract is 1500 lines describing every message the two processes
 * exchange, and none of it has anything to do with reading a JSON file off
 * disk — so `shared/persona.ts`, which is otherwise pure and has no opinion
 * about processes at all, could not be understood or tested without it.
 *
 * The split is not merely tidier, it is along a real seam. These problems are
 * about **a file somebody wrote**. The ones deliberately left behind —
 * `not-permitted`, `save-failed`, `shortcut-unusable`, `shortcut-clash` — are
 * about **a message the settings window sent**, which is a different subject
 * with a different remedy: one is "fix your file", the other is "this did not
 * come from where it claimed to". Merging them meant every consumer of either
 * had to handle both.
 *
 * When the settings layer returns it should declare its own union over this
 * one rather than reopening this file.
 *
 * ## Reported, never ignored
 *
 * `unknown-field` exists because silence is the worse failure. A typo like
 * `styel` dropped quietly shows its author an edit that had no effect, with
 * nothing anywhere saying why. The avatar format has refused unknown keys since
 * it was written; this is the persona format holding the same line.
 */

/**
 * What was wrong with one field's value.
 *
 * `malformed` is separate from `not-text` and `empty` because it is the only
 * one a person can reach with a perfectly reasonable-looking string: an `id` of
 * `My Mochi` is text and is not empty, and it is still refused. Folding it into
 * `not-text` would put "must be text" under a field plainly containing text.
 */
export type FieldProblem = 'not-text' | 'empty' | 'not-object' | 'malformed' | 'not-a-version'

export type SaveProblem =
  /** A value this build does not recognise — only reachable from a crafted file. */
  | { readonly kind: 'unknown-value'; readonly field: string; readonly allowed: string }
  /** One field did not parse. */
  | { readonly kind: 'field'; readonly field: string; readonly reason: FieldProblem }
  /** A field with a length limit, which the sentence shown has to quote. */
  | { readonly kind: 'field-length'; readonly field: string; readonly limit: number }
  /** A key that is not part of a persona at all. */
  | { readonly kind: 'unknown-field'; readonly field: string }
  /**
   * Written by a build newer than this one.
   *
   * Its own kind rather than a value or length problem, because the remedy is
   * completely different: nothing is wrong with the file, and editing it is the
   * wrong advice. The only fix is a newer mochi.
   */
  | { readonly kind: 'from-the-future'; readonly field: string; readonly found: number }
