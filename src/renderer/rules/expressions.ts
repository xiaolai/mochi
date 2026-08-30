/**
 * Which face she is allowed to wear, and what she wears instead when she is not.
 *
 * ## This rule had no subject for a while, and that is why it is here
 *
 * `persona.faces` shipped as a validated, migrated, persisted field that nothing
 * ever read. The tool that once narrowed its enum went on 2026-08-26 after 275
 * sessions without a call; `repose.ts` drives motion and contains no expression
 * code; the two built-in reactions in `companion/face.ts` do not consult it. So
 * the switch that set it changed one sentence in her instructions and nothing
 * else, and then that sentence went too — `instructions.ts` records the section
 * as deleted outright: "NOTHING. Every character has every expression."
 *
 * Contract rules C2 and C5 were marked **moot** for exactly that reason.
 *
 * The v2 delivery draws the control again (A2c) and states the rule its copy
 * depends on: *seeing an expression and permitting it are two separate things.*
 * Drawn against the old code that switch would decide whether she is TOLD she
 * has a face she cannot be asked to make — a sentence about a capability with no
 * mechanism, which is rule A1 one layer up: a control that looks like it does
 * something and answers with nothing.
 *
 * So the set is load-bearing now. This module is the whole of what that means:
 * given what a character is permitted and the expression something wants, what
 * does she actually wear.
 *
 * ## The empty set is legal, and has to survive
 *
 * "switch all eight off and she is simply never told she has a face to change,
 * which is a state the application has to survive rather than prevent." So the
 * fallback cannot be "the first allowed one" — there may not be one. It is
 * `neutral`, always, and `neutral` is worn whether or not it is permitted:
 * withholding an expression withholds a CHANGE, and a character with no face at
 * all is not a state anything downstream can draw.
 */

/** What she falls back to. Worn even when it is withheld — see the header. */
export const RESTING = 'neutral' as const

/**
 * What she wears, given what she may.
 *
 * `allowed` is a list rather than a set because that is what the manifest holds
 * and converting at every call site is how two representations of one field
 * start disagreeing.
 */
export function wearing<T extends string>(allowed: readonly T[], wanted: T): T | typeof RESTING {
  if (wanted === RESTING) return RESTING
  return allowed.includes(wanted) ? wanted : RESTING
}

/**
 * Whether an expression may be shown as permitted.
 *
 * Separate from `wearing` on purpose, and this is C5: looking at a face and
 * permitting it are two questions, so the tile that DRAWS one and the switch
 * that decides it must not share an answer. A gallery that hid withheld faces
 * would make the two the same control — "you can always look" is the rule the
 * delivery states, and it is the reason the tile stays whatever the switch says.
 */
export function permitted<T extends string>(allowed: readonly T[], expression: T): boolean {
  return allowed.includes(expression)
}
