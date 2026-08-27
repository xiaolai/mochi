import { describe, expect, it } from 'vitest'

import { MOST_TRANSCRIPT_CHARS, fittingNewestFirst, somebodySpoke } from './presence'
import type { Turn } from '../store/turn-row'

/**
 * What counts as a conversation worth remembering, and what is an empty room.
 *
 * The filter exists because covering a whole awake day only helps if most of
 * that day is thrown away first. A reconnect is a new session every hour, and
 * `speak_first` lets her greet on waking — so a machine left running in an
 * empty room produces one segment per hour holding her greeting and nothing
 * else. Handing those to the summariser spends a subprocess on silence, and
 * asks a model to find something worth remembering in a transcript where
 * nobody said anything.
 */
function her(text: string, at = 1): Turn {
  return { at, who: 'her', text, cut: false }
}

function you(text: string, at = 1): Turn {
  return { at, who: 'you', text, cut: false }
}

describe('whether the person said anything', () => {
  it('counts a segment where they did', () => {
    expect(somebodySpoke([her('Hello.'), you('Morning.')])).toBe(true)
  })

  it('rejects an empty segment', () => {
    expect(somebodySpoke([])).toBe(false)
  })

  it('rejects a greeting into an empty room', () => {
    // The shape an idle machine produces once an hour, all day: `speak_first`
    // greets, a reconnect makes a new session, and it greets again.
    expect(somebodySpoke([her('Hello again.')])).toBe(false)
    expect(somebodySpoke([her('Hello.'), her('Goodbye.')])).toBe(false)
  })

  it('rejects user turns that survived with no words', () => {
    // An interrupted turn is stored with `cut` and no text on purpose, and a
    // cough transcribed to nothing lands the same way.
    expect(somebodySpoke([her('Yes?'), { at: 2, who: 'you', text: '', cut: true }])).toBe(false)
    expect(somebodySpoke([you('   ')])).toBe(false)
  })

  it('keeps a short reply, because a threshold is not a measurement', () => {
    // "yes" is something a person said. The two mistakes are not equal: a
    // wasted call costs a subprocess, a dropped conversation costs a memory.
    expect(somebodySpoke([her('Shall I?'), you('yes')])).toBe(true)
  })
})

describe('assembling a presence without reading all of it', () => {
  /**
   * Segments handed over one at a time, counting how many were actually pulled.
   *
   * That count IS the property. The eager version this replaced read every
   * qualifying conversation and then discarded all but the newest sixty
   * thousand characters, so the prompt was bounded and the work was not — a day
   * of talking is one SQLite read per hour.
   */
  function lazily(segments: readonly (readonly Turn[])[]): {
    readonly turns: readonly Turn[]
    readonly pulled: () => number
  } {
    let pulled = 0
    function* feed(): Generator<readonly Turn[]> {
      for (const one of segments) {
        pulled += 1
        yield one
      }
    }
    return { turns: fittingNewestFirst(feed(), 200), pulled: () => pulled }
  }

  it('keeps only the segments somebody spoke in', () => {
    const out = fittingNewestFirst([
      [her('Hello again.', 40)],
      [her('Hello.', 20), you('I am back.', 30)],
      [],
      [her('Hello.', 10)],
    ])
    expect(out.map((one) => one.text)).toEqual(['Hello.', 'I am back.'])
  })

  it('answers empty for a day nobody spoke in, so nothing is spawned', () => {
    expect(fittingNewestFirst([[her('Hello.')], [her('Hello.')], []])).toEqual([])
  })

  it('puts what it kept in the order it happened, newest segment first in', () => {
    // Segments arrive newest-first — that is what `sessions()` answers — and
    // the result has to read forwards, because a transcript does.
    const out = fittingNewestFirst([
      [you('Fourth.', 40), her('Third.', 30)],
      [you('Second.', 20), her('First.', 10)],
    ])
    expect(out.map((one) => one.text)).toEqual(['First.', 'Second.', 'Third.', 'Fourth.'])
  })

  it('STOPS PULLING once the budget is full', () => {
    // The whole point. Each of these is a conversation that would otherwise be
    // opened and then thrown away.
    const fat = Array.from({ length: 10 }, (_, s) =>
      Array.from({ length: 5 }, (_, i) => you('x'.repeat(40), s * 10 + i)),
    )
    const run = lazily(fat)
    expect(run.turns.length).toBeGreaterThan(0)
    expect(run.pulled(), 'it read the whole archive').toBeLessThan(fat.length)
  })

  it('pulls everything when everything fits', () => {
    const small = [[you('a', 2)], [you('b', 1)]]
    const run = lazily(small)
    expect(run.pulled()).toBe(small.length)
    expect(run.turns.map((one) => one.text)).toEqual(['b', 'a'])
  })

  it('does not spend budget on the hours nobody spoke in', () => {
    // A greeting into an empty room must not push a real conversation out of
    // the window.
    const out = fittingNewestFirst([[her('Hello.', 30)], [you('the real one', 10)]], 200)
    expect(out.map((one) => one.text)).toEqual(['the real one'])
  })

  it('cuts on a turn boundary, never inside one', () => {
    // Half a sentence attributed to somebody is worse than its absence: the
    // model is asked what a person is like, and a truncated turn reads as a
    // complete thought they did not finish.
    const kept = fittingNewestFirst([[you('a'.repeat(80), 1), you('b'.repeat(80), 2)]], 100)
    for (const turn of kept) expect(turn.text.length).toBe(80)
  })

  it('answers empty rather than half a turn when nothing fits', () => {
    expect(fittingNewestFirst([[you('a'.repeat(500), 1)]], 10)).toEqual([])
  })

  it('is bounded against the note it maintains', () => {
    // The ceiling has to come from somewhere, and the document being rewritten
    // is the only thing here with a measured one.
    expect(MOST_TRANSCRIPT_CHARS).toBe(60_000)
  })
})
