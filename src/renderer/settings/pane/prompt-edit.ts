/**
 * The two decisions a prompt editor makes, away from the box it draws.
 *
 * They were closures inside an eighty-line `render` — reachable only by
 * building the pane, in a suite that runs in node with no DOM. Both are about
 * what somebody is allowed to save and what they are told about it, which is
 * the part worth holding still.
 */

/**
 * What to say about the length, or null when there is nothing to say.
 *
 * The bound is named while somebody is TYPING rather than after they save.
 * `hearing.ts` refuses its own limit in the pane for this reason and states it:
 * a control somebody can see should name the limit before a write is attempted.
 *
 * A prompt with no limit has nothing to warn about — most of the catalogue is
 * unbounded, and inventing a number to compare against would be worse than
 * saying nothing.
 */
export function lengthNote(value: string, limit: number | undefined): string | null {
  if (limit === undefined || value.length <= limit) return null
  return (
    `That is ${String(value.length)} characters and the most this one may be is ` +
    `${String(limit)}. It is sent on every session and paid for as long as that session lasts.`
  )
}

/**
 * Whether Save should be live.
 *
 * A DIFFERENCE, not having typed: typing a character and deleting it is not a
 * change to save. And never while it is over the bound, which main would refuse
 * anyway — an enabled button whose only outcome is a refusal is a button that
 * teaches people to distrust it.
 */
export function canSave(value: string, stored: string, limit: number | undefined): boolean {
  return value !== stored && lengthNote(value, limit) === null
}
