import { describe, expect, it } from 'vitest'
import { byDay, clockLabel, dayLabel, highlight, interruptions, lengthLabel } from './format'

/** A fixed instant so the labels are not a function of when the suite runs. */
const NOW = new Date(2026, 7, 18, 14, 30).getTime()
const DAY = 24 * 60 * 60 * 1000

describe('when it happened', () => {
  it('says Today for anything since midnight', () => {
    expect(dayLabel(new Date(2026, 7, 18, 9, 5).getTime(), NOW)).toBe('Today')
    // Including the first minute of it, which a 24-hour rule would call
    // "yesterday" for the whole of the following day.
    expect(dayLabel(new Date(2026, 7, 18, 0, 1).getTime(), NOW)).toBe('Today')
  })

  it('counts CALENDAR days, not multiples of twenty-four hours', () => {
    // 23:50 last night is twenty minutes before `NOW − 14h`, and it is
    // yesterday. A `now - at < DAY` rule calls it today, which reads as a bug
    // to anybody who was there.
    const lateLastNight = new Date(2026, 7, 17, 23, 50).getTime()
    expect(dayLabel(lateLastNight, new Date(2026, 7, 18, 0, 10).getTime())).toBe('Yesterday')
  })

  it('does not call a future instant Today', () => {
    /*
      `at >= midnight` with no upper bound labelled every later date "Today",
      so a clock-skewed row was filed under today and `byDay` merged it into
      today's group.
    */
    const tomorrow = new Date(2026, 7, 19, 9, 0).getTime()
    expect(dayLabel(tomorrow, NOW)).not.toBe('Today')
    expect(dayLabel(new Date(2026, 7, 18, 23, 59).getTime(), NOW)).toBe('Today')
  })

  it('crosses a daylight-saving boundary on calendar days, not on 24 hours', () => {
    /*
      Run in a zone that HAS daylight saving, because the machine this was
      written on does not (Asia/Shanghai) and the first version of this test
      passed against the broken code — which is no test at all.

      The case, measured rather than guessed: London, Monday 30 March 2026, the
      day after the 23-hour spring-forward day. `midnight(30th) − 86_400_000` is
      23:00 on the 28th, not midnight on the 29th, so the last hour of SATURDAY
      the 28th — two days back — was labelled "Yesterday". The first example I
      reached for (early on the 29th) was wrong and agreed under both rules;
      this one is the hour that actually moves.

      `process.env.TZ` is honoured by `Date` on the next construction in Node,
      and it is restored in `finally` so the rest of the file keeps the machine's
      own zone.
    */
    const was = process.env.TZ
    process.env.TZ = 'Europe/London'
    try {
      const monday = new Date(2026, 2, 30, 12, 0).getTime()
      const twoDaysBack = new Date(2026, 2, 28, 23, 30).getTime()
      expect(dayLabel(twoDaysBack, monday)).not.toBe('Yesterday')
      expect(dayLabel(new Date(2026, 2, 29, 23, 30).getTime(), monday)).toBe('Yesterday')
    } finally {
      process.env.TZ = was
    }
  })

  it('falls back to a date once a week has passed', () => {
    const old = dayLabel(NOW - 30 * DAY, NOW)
    expect(old).not.toMatch(/Today|Yesterday/)
    expect(old).toMatch(/\d/)
  })

  it('includes the year only when it is not this one', () => {
    expect(dayLabel(new Date(2024, 2, 3).getTime(), NOW)).toMatch(/2024/)
    expect(dayLabel(new Date(2026, 2, 3).getTime(), NOW)).not.toMatch(/2026/)
  })
})

describe('how long it ran', () => {
  it('says nothing at all while she is still awake in it', () => {
    expect(lengthLabel(NOW, null)).toBeNull()
  })

  it('does not pretend to seconds, and never says none', () => {
    // A DURATION, like every other row in the column. It said "under a minute",
    // which was true and was the only entry in a list of numbers that had to be
    // read rather than compared. The floor is what that sentence was carrying:
    // ten seconds rounds to zero, and `0 min` for something that happened is a
    // worse answer than the words were.
    expect(lengthLabel(NOW, NOW + 20_000)).toBe('1 min')
    expect(lengthLabel(NOW, NOW + 1_000)).toBe('1 min')
    expect(lengthLabel(NOW, NOW)).toBe('1 min')
  })

  it('rounds to minutes, then to hours and minutes', () => {
    expect(lengthLabel(NOW, NOW + 4 * 60_000 + 37_000)).toBe('5 min')
    expect(lengthLabel(NOW, NOW + 2 * 3_600_000)).toBe('2 h')
    expect(lengthLabel(NOW, NOW + 3_600_000 + 20 * 60_000)).toBe('1 h 20 min')
  })

  it('never says sixty of anything', () => {
    /*
      Rounding the hour and the remainder independently gave `1 h 60 min` for
      1h59m30s and `60 min` for 59m30s — numbers nobody writes. One rounding to
      whole minutes, then division, cannot produce either.
    */
    expect(lengthLabel(NOW, NOW + 59 * 60_000 + 30_000)).toBe('1 h')
    expect(lengthLabel(NOW, NOW + 3_600_000 + 59 * 60_000 + 30_000)).toBe('2 h')
    expect(lengthLabel(NOW, NOW + 3_600_000 + 58 * 60_000 + 40_000)).toBe('1 h 59 min')
  })

  it('refuses a span that ran backwards', () => {
    // It said "under a minute" — a plausible sentence about a real
    // conversation, which is the worst answer available. Two writes and a clock
    // change are enough to reach this without anything being corrupt.
    expect(lengthLabel(NOW, NOW - 5_000)).toBeNull()
    expect(lengthLabel(NOW, Number.NaN)).toBeNull()
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

describe('the day a conversation is filed under', () => {
  it('uses the same calendar boundary as the row, without the clock', () => {
    expect(dayLabel(new Date(2026, 7, 18, 0, 1).getTime(), NOW)).toBe('Today')
    expect(dayLabel(new Date(2026, 7, 17, 23, 50).getTime(), NOW)).toBe('Yesterday')
    // A heading saying "Today 09:41" is what splitting these apart prevents.
    expect(dayLabel(new Date(2026, 7, 18, 9, 41).getTime(), NOW)).not.toMatch(/\d/)
  })

  it('names the weekday inside the week and the date beyond it', () => {
    // Six days back is still a weekday somebody can place; seven is not, and
    // "Tuesday" for something eight days old is the failure the row label was
    // written to avoid.
    expect(dayLabel(NOW - 3 * DAY, NOW)).toBe(
      new Date(NOW - 3 * DAY).toLocaleDateString(undefined, { weekday: 'long' }),
    )
    expect(dayLabel(NOW - 30 * DAY, NOW)).toMatch(/\d/)
  })

  it('carries the clock on its own for the rows underneath', () => {
    const at = new Date(2026, 7, 18, 9, 41).getTime()
    expect(clockLabel(at)).toBe(
      new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
    )
  })
})

describe('grouping the list by day', () => {
  const at = (day: number, hour: number): { at: number } => ({
    at: new Date(2026, 7, day, hour).getTime(),
  })

  it('makes one group per run of days, newest first', () => {
    const groups = byDay([at(18, 9), at(18, 8), at(17, 17), at(16, 21)], NOW, (one) => one.at)
    expect(groups.map((one) => one.day)).toEqual(['Today', 'Yesterday', 'Sunday'])
    expect(groups.map((one) => one.items.length)).toEqual([2, 1, 1])
  })

  it('does NOT merge a day that appears twice', () => {
    /*
      Consecutive runs, not a bucket per day. The list arrives newest-first; if
      a day shows up again after another one, the input was not ordered, and
      merging would silently rearrange somebody's archive to hide that.
    */
    const groups = byDay([at(18, 9), at(17, 17), at(18, 8)], NOW, (one) => one.at)
    expect(groups.map((one) => one.day)).toEqual(['Today', 'Yesterday', 'Today'])
  })

  it('has nothing to say about an empty list', () => {
    expect(byDay([], NOW, (one: { at: number }) => one.at)).toEqual([])
  })
})

describe('how many times she was cut off', () => {
  it('counts her cut turns and not yours', () => {
    const turns = [
      { who: 'her', cut: true },
      { who: 'her', cut: false },
      { who: 'you', cut: true },
      { who: 'her', cut: true },
    ] as const
    // Yours is excluded deliberately: nothing sets `cut` on a turn of yours,
    // and if something ever does it will mean something else.
    expect(interruptions(turns)).toBe(2)
  })

  it('is zero for a conversation nobody cut', () => {
    expect(interruptions([{ who: 'her', cut: false }])).toBe(0)
    expect(interruptions([])).toBe(0)
  })
})
