/**
 * Is this a number SQLite can give back?
 *
 * `node:sqlite` stores any JavaScript number an INTEGER column will take, but
 * it throws `RangeError` when MATERIALISING one outside ±2^53 — and it throws
 * for the whole result set, not the offending row. One such value therefore
 * takes out every read that touches it: the conversation list, the turns, and
 * the search. In this app the pane that lists conversations is also the pane
 * holding the delete buttons, so a poisoned row makes itself unreachable by
 * the only affordance that could remove it.
 *
 * Every instant reaching this store comes from the renderer — `at` travels on
 * `VoiceReport`, which crosses IPC as a cast — so this is a boundary check,
 * not an assertion about main's own arithmetic.
 *
 * A module of its own because three call sites ask it (`begin`, `say`, `end`)
 * and one of them, `end`, was missing the check the other two had. A rule kept
 * in three places is a rule that holds in two.
 */

/**
 * True when `at` is an epoch-milliseconds value this store can write AND read
 * back.
 *
 * Rejects NaN and both infinities as a side effect of `Number.isSafeInteger`,
 * which is the behaviour wanted: `NaN` reaches SQLite as NULL and a NOT NULL
 * column takes it as 0, dating a turn to 1970 rather than failing.
 *
 * Negative values are refused too. They are representable, so nothing would
 * throw — but an epoch before 1970 in this app means a sign error upstream,
 * and a turn dated 1969 sorts above everything the user has ever said.
 */
export function readableInstant(at: unknown): at is number {
  return typeof at === 'number' && Number.isSafeInteger(at) && at >= 0
}
