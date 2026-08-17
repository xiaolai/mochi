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

/**
 * Bounded text, cut on a character rather than in the middle of one.
 *
 * ONE implementation of a rule three modules were writing out: `ipc.ts`
 * bounding a spoken turn, the working set bounding one it holds, and the
 * preload bounding a failure reason. Each did it slightly differently, and two
 * of the three could leave a lone surrogate -- half an emoji, which renders as
 * a replacement character and is not the text anybody said.
 *
 * The budget is UTF-16 UNITS, because that is what every caller's limit is
 * expressed in and what `.length` reports. Counting code points instead was the
 * previous attempt and it broke the bound: a limit checked in units and applied
 * in code points let 4,000 emoji produce 7,999 units.
 *
 * The ellipsis is INSIDE the limit. Appending it afterwards made every
 * truncated value one unit longer than the bound it was given, which is the one
 * thing these functions promise.
 */
function backOffHigh(text: string, end: number): number {
  // The last unit kept is at `end - 1`. A HIGH surrogate there has lost its
  // partner, so drop it.
  const last = text.charCodeAt(end - 1)
  return last >= 0xd800 && last <= 0xdbff ? end - 1 : end
}

/** The START of an over-long text, marked so a reader knows it was cut. */
export function boundedHead(text: string, limit: number): string {
  if (limit <= 0) return ''
  if (text.length <= limit) return text
  return `${text.slice(0, Math.max(0, backOffHigh(text, limit - 1)))}\u2026`
}

/**
 * The END of an over-long text, marked at the front.
 *
 * The other direction, and which one a caller wants is a real decision rather
 * than a detail. A transcript replayed into her next session wants the END --
 * keeping the oldest 2,000 characters of a long turn and discarding what was
 * said most recently is the opposite of continuing where the conversation left
 * off. A failure reason in a log wants the start.
 */
export function boundedTail(text: string, limit: number): string {
  if (limit <= 0) return ''
  if (text.length <= limit) return text
  const start = text.length - (limit - 1)
  // The first unit kept is at `start`. A LOW surrogate there has lost its
  // partner, so start one later.
  const first = text.charCodeAt(start)
  const from = first >= 0xdc00 && first <= 0xdfff ? start + 1 : start
  return `\u2026${text.slice(from)}`
}
