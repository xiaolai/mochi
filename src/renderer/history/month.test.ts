import { describe, expect, it } from 'vitest'
import {
  countByDay,
  dayHeadingLabel,
  dayKey,
  monthDays,
  monthLabel,
  openingDay,
  startOfDay,
  stepMonth,
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
  it('names the month and the year', () => {
    expect(monthLabel(2026, 7)).toBe(
      new Date(2026, 7, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
    )
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
