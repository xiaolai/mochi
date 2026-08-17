import { describe, expect, it } from 'vitest'
import { highlight, lengthLabel, whenLabel } from './format'

/** A fixed instant so the labels are not a function of when the suite runs. */
const NOW = new Date(2026, 7, 18, 14, 30).getTime()
const DAY = 24 * 60 * 60 * 1000

describe('when it happened', () => {
  it('says Today for anything since midnight', () => {
    expect(whenLabel(new Date(2026, 7, 18, 9, 5).getTime(), NOW)).toMatch(/^Today /)
    // Including the first minute of it, which a 24-hour rule would call
    // "yesterday" for the whole of the following day.
    expect(whenLabel(new Date(2026, 7, 18, 0, 1).getTime(), NOW)).toMatch(/^Today /)
  })

  it('counts CALENDAR days, not multiples of twenty-four hours', () => {
    // 23:50 last night is twenty minutes before `NOW − 14h`, and it is
    // yesterday. A `now - at < DAY` rule calls it today, which reads as a bug
    // to anybody who was there.
    const lateLastNight = new Date(2026, 7, 17, 23, 50).getTime()
    expect(whenLabel(lateLastNight, new Date(2026, 7, 18, 0, 10).getTime())).toMatch(/^Yesterday /)
  })

  it('names the weekday within the last week', () => {
    expect(whenLabel(NOW - 3 * DAY, NOW)).toMatch(/^(Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day /)
  })

  it('falls back to a date once a week has passed', () => {
    const old = whenLabel(NOW - 30 * DAY, NOW)
    expect(old).not.toMatch(/Today|Yesterday/)
    expect(old).toMatch(/\d/)
  })

  it('includes the year only when it is not this one', () => {
    expect(whenLabel(new Date(2024, 2, 3).getTime(), NOW)).toMatch(/2024/)
    expect(whenLabel(new Date(2026, 2, 3).getTime(), NOW)).not.toMatch(/2026/)
  })
})

describe('how long it ran', () => {
  it('says nothing at all while she is still awake in it', () => {
    expect(lengthLabel(NOW, null)).toBeNull()
  })

  it('does not pretend to seconds', () => {
    expect(lengthLabel(NOW, NOW + 20_000)).toBe('under a minute')
  })

  it('rounds to minutes, then to hours and minutes', () => {
    expect(lengthLabel(NOW, NOW + 4 * 60_000 + 37_000)).toBe('5 min')
    expect(lengthLabel(NOW, NOW + 2 * 3_600_000)).toBe('2 h')
    expect(lengthLabel(NOW, NOW + 3_600_000 + 20 * 60_000)).toBe('1 h 20 min')
  })
})

describe('marking the search term', () => {
  it('returns the line whole when nothing is being searched for', () => {
    expect(highlight('the whole line', '')).toEqual([{ text: 'the whole line', hit: false }])
  })

  it('splits around every occurrence', () => {
    expect(highlight('owl and owl', 'owl')).toEqual([
      { text: 'owl', hit: true },
      { text: ' and ', hit: false },
      { text: 'owl', hit: true },
    ])
  })

  it('matches regardless of case, and keeps the ORIGINAL casing', () => {
    expect(highlight('The Owl', 'owl')).toEqual([
      { text: 'The ', hit: false },
      { text: 'Owl', hit: true },
    ])
  })

  it('treats the query as text, not as a pattern', () => {
    // The query is somebody typing in a box. Compiled as a regular expression,
    // `.*` matches everything and `(` throws — and neither is a thing a person
    // typing into a search field has asked for.
    expect(highlight('a.b', '.')).toEqual([
      { text: 'a', hit: false },
      { text: '.', hit: true },
      { text: 'b', hit: false },
    ])
    expect(() => highlight('a(b', '(')).not.toThrow()
    expect(highlight('literally anything', '.*')).toEqual([
      { text: 'literally anything', hit: false },
    ])
  })

  it('never loses or duplicates a character of the line', () => {
    // The property that matters: this drives what the reader sees, so a bug
    // here silently edits somebody's words.
    for (const [line, term] of [
      ['owl and owl', 'owl'],
      ['owlowl', 'owl'],
      ['nothing here', 'zzz'],
      ['', 'owl'],
      ['她说 hello 然后笑了', 'hello'],
    ] as const) {
      expect(
        highlight(line, term)
          .map((one) => one.text)
          .join(''),
      ).toBe(line)
    }
  })
})
