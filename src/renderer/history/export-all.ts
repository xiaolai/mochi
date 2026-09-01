/**
 * Ask for everything she has, and say what happened.
 *
 * ONE of these, because there were two. The export is offered from two places —
 * the button on the Archive, and the "keep a copy" step inside the deletion
 * confirmation — and each had written out the same promise chain: the same
 * three outcomes, the same two sentences, the same decision to say nothing at
 * all when the person cancelled.
 *
 * The wording is what makes that worth removing rather than tolerating. "Could
 * not export: …" is a sentence somebody reads at the moment a save they wanted
 * did not happen, and two copies of it are two chances for one to be improved
 * and the other left. The three outcomes are the same fact in both places, so
 * they are decided in one.
 *
 * ## Cancelling says nothing, deliberately
 *
 * `result.cancelled` is a person dismissing the system save panel. They have
 * not made a mistake and do not need telling, and an error line for it would
 * teach them to ignore the one that matters.
 *
 * ## What is NOT shared
 *
 * Which control is disabled while it runs, what its label becomes, and whether
 * that label is put back on a timer. Those belong to the button — the Archive's
 * resets itself after six seconds, the dialog's stays saying what it did until
 * the dialog closes — so the caller is handed the count and words its own.
 */

import { say } from './status'

export function exportAllSaying(saved: (conversations: number) => void): Promise<void> {
  return window.mochiHistory
    .exportAll()
    .then((result) => {
      if (result.ok) {
        saved(result.conversations)
        say(`Exported ${String(result.conversations)} to ${result.path}`)
      } else if (!result.cancelled) {
        say(`Could not export: ${result.why}`, true)
      }
    })
    .catch((error: unknown) => {
      say(`Could not export: ${String(error)}`, true)
    })
}
