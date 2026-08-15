/**
 * Making untrusted text safe to put somewhere line-oriented.
 *
 * Two places needed this and each grew its own copy: `ipc.ts` cleaning a
 * failure reason before it reaches a log, and `persona.ts` flattening a name
 * before it reaches the system prompt. The threat is the same in both — a
 * newline ends the line the value was meant to be part of and begins one the
 * reader will attribute to somebody else.
 *
 * A log line becomes a forged log entry. A prompt line becomes an instruction.
 * Same character, same fix, and no reason for two of them.
 */

// C0 controls, DEL, and the C1 block, written as escapes rather than as
// themselves: the class is here once, and so is the linter suppression that
// comes with it.
//
// C1 (`\u0080`–`\u009f`) was missing, which mattered wherever this is what
// decides a field is empty: a name or an instruction made only of those
// passed the required-text check and then reached the prompt as nothing.
// U+2028 and U+2029 are here for the same reason as C1, and were missed for
// the same reason: they are not "control characters" by the C0/C1 definition,
// but every log viewer, terminal and JavaScript source parser treats them as
// LINE BREAKS. So a name or a failure reason carrying one still produced what
// looks like an extra log line, which is precisely what this exists to stop.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g

/** Every control character replaced by a space. Length unchanged. */
export function stripControl(value: string): string {
  return value.replace(CONTROL, ' ')
}

/**
 * One line, no runs of whitespace, trimmed.
 *
 * For values meant to be a fragment of a sentence — a name, a form of address —
 * rather than a body of text.
 */
export function oneLine(value: string): string {
  return stripControl(value).replace(/\s+/g, ' ').trim()
}

/**
 * Whether a value has nothing a reader could see.
 *
 * Not the same question as `stripControl`, which is about what may reach a
 * prompt or a log line. This is about whether a REQUIRED field was filled in,
 * and the answer has to include characters that are neither whitespace nor
 * controls but still render as nothing: zero-width joiners, bidi marks, the
 * rest of the default-ignorable set.
 *
 * `raw.trim()` said a name of two zero-width joiners was filled. Every
 * consumer then renders it as nothing, so what the user saw was an empty name
 * that validation had already promised was not one.
 */
export function looksEmpty(value: string): boolean {
  return (
    stripControl(value)
      .replace(/\p{Cf}|\p{Zs}/gu, '')
      .trim() === ''
  )
}
