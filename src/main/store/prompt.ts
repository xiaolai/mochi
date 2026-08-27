import { join } from 'node:path'
import { logBoundedRead, readBounded } from './read-bounded'
import { writeTextAtomically } from './json-file'
import { problems } from '../problems'

/**
 * The system prompt, as a document on disk.
 *
 * ## Why it is not a constant any more
 *
 * It was `CORE_PROMPT` in `@shared/persona` — two sentences compiled in, with a
 * long comment defending them as *"the part of the prompt no persona can remove,
 * and no edit can freeze"*. That argument was about a real failure: `style` is
 * an overlay, so editing it pins your text forever and every later improvement
 * the app makes is masked with nothing saying so.
 *
 * **Shipping nothing removes that failure rather than guarding against it.**
 * There is no improvement to mask if the file starts empty, so the floor is not
 * needed and the freeze cannot happen. What the constant was protecting turns
 * out not to need protecting, which is the same shape as the length rule that
 * was deleted from the style seed for the same reason.
 *
 * The two sentences themselves cost less than they look. The naming one is
 * argued against by this repository's own measurement — 17% of 149 turns spent
 * on self-description, against a user who used her name three times in 148 and
 * never asked what it was — and the honesty one is nearly a restatement of
 * `DEFAULT_PERSONA.style`'s *"Answer only what you heard clearly"*, which has
 * the better evidence behind it.
 *
 * ## Empty is a real answer, and it is the default
 *
 * A fresh install writes an EMPTY file. Not a commented one: markdown has no
 * comment a model cannot read, so anything put here to explain the file would
 * be text she is handed. The explanation belongs in the window that edits it.
 *
 * With this empty she still gets her style, her notes, the brief and her tool
 * list — see `instructionsFor`, where every one of those is a piece with a
 * default position. Empty means "the app adds no prose of its own", not "she is
 * told nothing".
 *
 * ## It is the USER'S, never a persona's
 *
 * In `userData`, and deliberately not in a persona package. A character you
 * downloaded that could ship a system prompt would be prompt injection carrying
 * the application's own authority — a different and much worse thing than the
 * `<notes>` block, which is at least fenced and announced as data.
 */
const PROMPT_FILE = 'prompt.md'

/**
 * How much of it is read.
 *
 * Generous, because a system prompt somebody has worked on is allowed to be
 * long, and far under `MAX_FILE_BYTES` because this is text that goes on the
 * wire on every wake — a megabyte of it would be a session configuration the
 * service refuses, discovered at the worst moment.
 */
export const MAX_PROMPT_CHARS = 20_000

export function promptFile(userData: string): string {
  return join(userData, PROMPT_FILE)
}

/**
 * Put an empty one there, once, so the path exists and can be found.
 *
 * The same argument `seedAvatars` and `seedProfile` make: a format nobody can
 * see the shape of is not one, and a folder with nothing in it does not tell
 * anybody they may put something there. NEVER overwritten — once it is on disk
 * it is the user's, including when what they wrote is nothing.
 */
export function seedPrompt(userData: string): void {
  const path = promptFile(userData)
  const read = readBounded(path)
  if (read.ok) return
  // Only when it is genuinely absent. An unreadable file is somebody's work
  // that this process cannot see, and replacing it with an empty one would be
  // deleting it — the failure `writeMerged` refuses for `preferences.json`.
  if (read.reason.kind !== 'absent') {
    console.warn(`[prompt] ${logBoundedRead(read.reason)}; leaving it alone`)
    return
  }
  try {
    writeTextAtomically(path, '')
    console.log(`[prompt] seeded empty at ${path}`)
  } catch (error: unknown) {
    // Not fatal. An empty prompt is what an unwritable file produces anyway, so
    // she still wakes — but the window that edits it would offer a Save that
    // cannot land, and this is the line that says why.
    console.error(`[prompt] could not seed ${path}:`, error)
  }
}

/**
 * What she is told, before her character is added to it. Empty on any failure.
 *
 * Empty rather than throwing, because there is a correct answer for every way
 * this can go wrong: the file is absent on a fresh install, and an unreadable
 * one is a prompt this build cannot use. In both cases she should still wake
 * and still be herself — `style` is where her character lives — so the failure
 * costs prose rather than a session.
 *
 * It is LOUD in the log for anything but absence, because "the app ignored my
 * file" is the least debuggable outcome this kind of feature has.
 */
export function readPrompt(userData: string): string {
  const read = readBounded(promptFile(userData))
  if (!read.ok) {
    if (read.reason.kind !== 'absent') {
      console.error(`[prompt] ${logBoundedRead(read.reason)}; nothing extra is sent`)
      /*
        This one changes WHO SHE IS, which is the failure this project is least
        able to notice from the outside.

        She goes on talking, fluently, without the instructions somebody wrote
        for her -- and the only symptom is that she behaves like a different
        character. Nobody debugs that by opening a console.
      */
      problems.note(
        'prompt',
        null,
        // Pronoun-free: a store module reading a file has no character in hand,
        // and loading the persona catalogue to word an error would couple this
        // to the thing it is a dependency of. `says.ts` states the rule.
        'the system prompt could not be read, so it is not being used',
      )
    }
    return ''
  }
  // Trimmed at the boundary rather than at each use. A file that is one
  // trailing newline is empty for every purpose this has.
  return read.text.slice(0, MAX_PROMPT_CHARS).trim()
}

/** Whether a page's text is one this will store, and why not when it is not. */
export function checkPrompt(
  text: unknown,
): { ok: true; text: string } | { ok: false; why: string } {
  if (typeof text !== 'string') return { ok: false, why: 'That is not a prompt.' }
  if (text.length > MAX_PROMPT_CHARS) {
    return {
      ok: false,
      why: `That is ${String(text.length)} characters; the limit is ${String(MAX_PROMPT_CHARS)}.`,
    }
  }
  return { ok: true, text }
}

/**
 * Write it, atomically, because it is read on every wake.
 *
 * A half-written prompt is a session configured with half a sentence, and the
 * damage lands on the next thing she says rather than here — which is exactly
 * the case `writeWornPersonaId` gives the same treatment for.
 */
export function writePrompt(userData: string, text: string): void {
  const checked = checkPrompt(text)
  if (!checked.ok) throw new Error(checked.why)
  writeTextAtomically(promptFile(userData), checked.text)
}
