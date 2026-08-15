/**
 * A persona that does one thing: walk you through a word list.
 *
 * SPIKE. This exists to answer whether a single-purpose persona is buildable
 * on what the app already has, before any of the plugin format is settled.
 *
 * ## The part that matters: the app chooses, not the model
 *
 * Every rule here -- which word is next, which have been covered, when the
 * list is exhausted -- is decided by code and stored on disk. The model is
 * handed one word and asked to make a sentence with it. It is never asked to
 * remember anything, and it never picks.
 *
 * That is the same conclusion reached from the other end: a model
 * asked to track state will do it plausibly and wrongly, and the failure is
 * invisible because a wrong answer sounds exactly like a right one. Here it
 * would present as a word repeating three times in a row while she insists
 * she is working through the list.
 *
 * ## And "ignore everything else" is not a prompt
 *
 * The Realtime session sets `turn_detection.create_response = false`, so the
 * server never generates a reply on its own. Every utterance is one the app
 * asked for. Asking a model in prose to ignore you is a request it honours
 * most of the time; this is the same instruction as a protocol setting, and
 * it holds every time.
 */

/** What has been covered, and how many times the list has been walked. */
import { looksEmpty } from './text'

export interface Progress {
  /** Words already used, in this pass. */
  readonly seen: readonly string[]
  /** How many complete passes have finished. Starts at 0. */
  readonly round: number
}

export const NO_PROGRESS: Progress = { seen: [], round: 0 }

export interface Picked {
  readonly word: string
  readonly progress: Progress
  /** True when this word began a fresh pass through the list. */
  readonly restarted: boolean
}

/**
 * The next word, and the progress that follows from taking it.
 *
 * `pick` is given the randomness rather than reaching for it, so the whole
 * rule is testable: the same list, the same seen set and the same roll always
 * produce the same word. A `Math.random()` inside would make every assertion
 * here either trivial or flaky.
 *
 * Returns null only for an empty list -- which is a word file somebody wrote
 * with nothing in it, and is the caller's problem to report rather than
 * something to paper over with a placeholder word.
 */
export function pick(
  words: readonly string[],
  progress: Progress,
  roll: (upTo: number) => number,
): Picked | null {
  // `looksEmpty` rather than `trim`: a "word" of zero-width joiners is not one,
  // and picking it would put an invisible prompt in front of somebody.
  const usable = words.filter((word) => !looksEmpty(word))
  if (usable.length === 0) return null

  const seen = new Set(progress.seen)
  const left = usable.filter((word) => !seen.has(word))

  // Exhausted: start again rather than stopping. The list is a drill, not a
  // syllabus with an end, and "you have finished, goodbye" is the least useful
  // thing a practice tool can say.
  if (left.length === 0) {
    const restarted = { seen: [], round: progress.round + 1 }
    const chosen = usable[roll(usable.length)] ?? usable[0]!
    return { word: chosen, progress: { seen: [chosen], round: restarted.round }, restarted: true }
  }

  const chosen = left[roll(left.length)] ?? left[0]!
  return {
    word: chosen,
    // Appended rather than recomputed, so a word removed from the list later
    // does not resurrect every word that came after it.
    progress: { seen: [...progress.seen, chosen], round: progress.round },
    restarted: false,
  }
}
