import { describe, expect, it } from 'vitest'
import {
  countByDay,
  dayHeadingLabel,
  dayKey,
  monthDays,
  monthLabel,
  monthNames,
  monthsKept,
  openingDay,
  startOfDay,
  stepMonth,
  yearTyped,
} from './month'

describe('the day an instant belongs to', () => {
  it('is the LOCAL midnight, so late-night is still that night', () => {
    // 23:50 is something somebody had last night, not something on tomorrow's
    // date in another timezone.
    const late = new Date(2026, 7, 17, 23, 50).getTime()
    expect(startOfDay(late)).toBe(new Date(2026, 7, 17).getTime())
  })

  it('gives two instants on one day the same key, and two days different ones', () => {
    const morning = new Date(2026, 7, 18, 9, 5).getTime()
    const night = new Date(2026, 7, 18, 23, 59).getTime()
    expect(dayKey(morning)).toBe(dayKey(night))
    expect(dayKey(morning)).not.toBe(dayKey(new Date(2026, 7, 19, 0, 1).getTime()))
  })
})

describe('the grid', () => {
  it('is one row of days, with no leading blanks', () => {
    // A STRIP: the delivered design draws a whole month at a glance as a single
    // line. The blanks a week grid needs are the thing it removes.
    const days = monthDays(2026, 7)
    expect(days.length).toBe(31)
    expect(days[0]?.day).toBe(1)
    expect(days[days.length - 1]?.day).toBe(31)
    expect(days.every((one) => one !== null)).toBe(true)
  })

  it('knows how long every month is, including February', () => {
    expect(monthDays(2026, 1).length).toBe(28)
    // 2028 is a leap year, and the platform is what answers rather than a rule
    // written here.
    expect(monthDays(2028, 1).length).toBe(29)
    expect(monthDays(2026, 3).length).toBe(30)
  })

  it('gives each day the instant it starts at', () => {
    const days = monthDays(2026, 7)
    const third = days[2]
    expect(new Date(third!.at).getDate()).toBe(3)
    expect(new Date(third!.at).getMonth()).toBe(7)
  })
})

describe('stepping months', () => {
  it('carries the year in both directions', () => {
    expect(stepMonth(2026, 11, 1)).toEqual({ year: 2027, month: 0 })
    expect(stepMonth(2026, 0, -1)).toEqual({ year: 2025, month: 11 })
    expect(stepMonth(2026, 5, 1)).toEqual({ year: 2026, month: 6 })
  })
})

describe('what the labels say', () => {
  it('names the month and the year, abbreviated', () => {
    expect(monthLabel(2026, 7)).toBe(
      new Date(2026, 7, 1).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }),
    )
  })

  /*
    SHORTER THAN THE LONG FORM, said as a comparison rather than as a literal.

    The slot it goes in is a fixed 78px and the long form does not fit — that is
    the defect this abbreviation exists for. Asserting "Aug 2026" would only
    hold on a machine whose language is English, and the label is the platform's:
    what has to be true in every locale is that this is the short form and the
    short form is not the long one.
  */
  it('is not the long form', () => {
    const long = new Date(2026, 8, 1).toLocaleDateString(undefined, {
      month: 'long',
      year: 'numeric',
    })
    expect(monthLabel(2026, 8).length).toBeLessThanOrEqual(long.length)
  })

  it('names the weekday over a day of conversations', () => {
    const at = new Date(2026, 7, 14).getTime()
    expect(dayHeadingLabel(at)).toBe(
      new Date(at).toLocaleDateString(undefined, {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      }),
    )
  })
})

/**
 * Which days had conversations, and which one the window opens on.
 *
 * ## Why these had no test until now
 *
 * They lived in `history/main.ts`, which resolves the document at load and so
 * cannot be imported. `openingDay` decides what somebody sees when the window
 * opens; getting it wrong shows an empty day to a person with a full archive.
 */
describe('counting the days conversations fall on', () => {
  const at = (iso: string): { readonly startedAt: number } => ({ startedAt: Date.parse(iso) })

  it('groups by local day, not by timestamp', () => {
    const counts = countByDay([at('2026-03-04T01:00:00'), at('2026-03-04T23:30:00')])
    expect([...counts.values()]).toEqual([2])
  })

  it('keeps separate days separate', () => {
    const counts = countByDay([at('2026-03-04T12:00:00'), at('2026-03-05T12:00:00')])
    expect(counts.size).toBe(2)
  })

  it('has nothing to say about an empty archive', () => {
    expect(countByDay([]).size).toBe(0)
  })
})

describe('choosing the day the window opens on', () => {
  const at = (iso: string): { readonly startedAt: number } => ({ startedAt: Date.parse(iso) })
  const now = Date.parse('2026-03-10T09:00:00')

  it('opens on today when today has conversations', () => {
    const day = openingDay([at('2026-03-10T08:00:00'), at('2026-03-01T08:00:00')], now)
    expect(day).toBe(startOfDay(now))
  })

  it('falls back to the most recent day, not the oldest', () => {
    // The archive is read newest-first everywhere else; opening on the oldest
    // day would show somebody their first conversation and nothing since.
    const day = openingDay([at('2026-03-01T08:00:00'), at('2026-03-08T08:00:00')], now)
    expect(day).toBe(startOfDay(Date.parse('2026-03-08T08:00:00')))
  })

  it('answers null when there is nothing to open', () => {
    expect(openingDay([], now)).toBeNull()
  })
})

describe('the twelve months', () => {
  it('is twelve of them, in order, and none is empty', () => {
    const names = monthNames()
    expect(names).toHaveLength(12)
    expect(new Set(names).size).toBe(12)
    for (const name of names) expect(name.length).toBeGreaterThan(0)
  })
})

describe('a year somebody typed', () => {
  it('takes a plain four-digit year', () => {
    expect(yearTyped('2026')).toBe(2026)
    expect(yearTyped('  2026  ')).toBe(2026)
  })

  it('refuses what is not a number, rather than guessing at it', () => {
    // `Number('')` is 0 and `Number('12abc')` is NaN; a picker that accepted
    // either would jump somewhere nobody asked for.
    for (const text of ['', '   ', '20x6', '2026-05', '-2026', '2 026', '20.26']) {
      expect(yearTyped(text), text).toBeNull()
    }
  })

  it('refuses a year the archive cannot hold', () => {
    // Before this application existed, and far enough ahead to cover a clock
    // set wrongly without becoming a way to get lost.
    const now = new Date(2026, 0, 1)
    expect(yearTyped('1999', now)).toBeNull()
    expect(yearTyped('2000', now)).toBe(2000)
    expect(yearTyped('2126', now)).toBe(2126)
    expect(yearTyped('2127', now)).toBeNull()
  })

  it('REFUSES rather than clamping', () => {
    /*
      A field that silently rounds 20 up to 2000 has answered a question nobody
      asked, and whoever typed it cannot tell which of their keystrokes landed.
      Null leaves the picker where it was, which is a state they can see.
    */
    expect(yearTyped('20')).toBeNull()
    expect(yearTyped('99999')).toBeNull()
  })
})

describe('which months have anything in them', () => {
  const at = (year: number, month: number, day: number): { startedAt: number } => ({
    startedAt: new Date(year, month, day, 12).getTime(),
  })

  it('names the months that were talked in, and counts the years', () => {
    const kept = monthsKept([at(2026, 4, 14), at(2026, 4, 2), at(2026, 2, 9), at(2025, 11, 31)])
    expect([...kept.months].sort()).toEqual(['2025-11', '2026-2', '2026-4'])
    expect(kept.years).toBe(2)
  })

  it('is empty on a fresh archive rather than guessing', () => {
    // The picker greys every month in this state, which is correct: there is
    // nowhere in it that is not empty.
    expect(monthsKept([]).months.size).toBe(0)
    expect(monthsKept([]).years).toBe(0)
  })

  it('separates the same month in two different years', () => {
    // May 2025 having something says nothing about May 2026, and a key that
    // dropped the year would grey the wrong one.
    const kept = monthsKept([at(2025, 4, 3)])
    expect(kept.months.has('2025-4')).toBe(true)
    expect(kept.months.has('2026-4')).toBe(false)
  })
})
