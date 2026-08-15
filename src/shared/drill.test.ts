/**
 * The drill's rules, which are all in code rather than in a prompt.
 *
 * Every one of these is a thing a model asked to "remember which items you
 * have covered" would get almost right — and almost right is invisible here,
 * because a repeated item sounds exactly like a new one.
 *
 * The trigger phrase and the wording moved to `artifact.ts` and are tested
 * there: they belong to the package, not to the rule.
 */

import { describe, expect, it } from 'vitest'
import { NO_PROGRESS, pick, type Progress } from './drill'

/** A roll that always takes the first candidate, so the choice is readable. */
const first = (): number => 0
/** A roll that always takes the last, for checking the other edge. */
const last = (upTo: number): number => upTo - 1

const WORDS = ['ephemeral', 'ubiquitous', 'candid']

describe('choosing the next word', () => {
  it('never repeats one inside a pass', () => {
    let progress: Progress = NO_PROGRESS
    const said: string[] = []
    for (let n = 0; n < WORDS.length; n += 1) {
      const next = pick(WORDS, progress, first)!
      said.push(next.word)
      progress = next.progress
    }
    expect([...said].sort()).toEqual([...WORDS].sort())
    expect(new Set(said).size).toBe(WORDS.length)
  })

  it('starts again once the list is used up, and says so', () => {
    // A drill is not a syllabus. "You have finished, goodbye" is the least
    // useful thing a practice tool can say.
    const done: Progress = { seen: [...WORDS], round: 0 }
    const next = pick(WORDS, done, first)!
    expect(next.restarted).toBe(true)
    expect(next.progress.round).toBe(1)
    // The new pass counts the word it just used, or the first word of every
    // round would be offered twice.
    expect(next.progress.seen).toEqual([next.word])
  })

  it('does not resurrect words when the list is edited', () => {
    // Somebody removes a word from the file mid-pass. Progress is a list of
    // what was said, so the rest of the pass is unaffected -- recomputing it
    // as "everything before index N" would replay whatever followed.
    const progress: Progress = { seen: ['ephemeral'], round: 0 }
    const shorter = ['ephemeral', 'candid']
    expect(pick(shorter, progress, first)!.word).toBe('candid')
  })

  it('ignores blank lines in the file', () => {
    expect(pick(['', '   ', 'candid'], NO_PROGRESS, first)!.word).toBe('candid')
  })

  it('reports an empty list rather than inventing a word', () => {
    // A word file with nothing in it is somebody's mistake, and a placeholder
    // word would hide it behind a drill that appears to work.
    expect(pick([], NO_PROGRESS, first)).toBeNull()
    expect(pick(['', '  '], NO_PROGRESS, first)).toBeNull()
  })

  it('takes whichever the roll names, not always the first', () => {
    expect(pick(WORDS, NO_PROGRESS, last)!.word).toBe('candid')
    expect(pick(WORDS, NO_PROGRESS, first)!.word).toBe('ephemeral')
  })
})
