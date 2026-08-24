import { describe, expect, it } from 'vitest'
import {
  countByDay,
  dayHeadingLabel,
  dayKey,
  monthGrid,
  monthLabel,
  openingDay,
  startOfDay,
  stepMonth,
  weekdayInitials,
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
  it('starts the week on Monday', () => {
    // 1 August 2026 is a Saturday, so it lands in the sixth column with five
    // blanks before it. A Sunday-first grid would put it in the seventh.
    const weeks = monthGrid(2026, 7)
    expect(weeks[0]?.slice(0, 5).every((one) => one === null)).toBe(true)
    expect(weeks[0]?.[5]?.day).toBe(1)
  })

  it('holds every day of the month exactly once', () => {
    for (const [year, month, days] of [
      [2026, 7, 31],
      [2026, 3, 30],
      [2026, 1, 28],
      // A leap February, from the platform rather than from a rule written here.
      [2024, 1, 29],
    ] as const) {
      const flat = monthGrid(year, month)
        .flat()
        .filter((one) => one !== null)
      expect(
        flat.map((one) => one.day),
        `${year}-${month}`,
      ).toEqual(Array.from({ length: days }, (_, i) => i + 1))
    }
  })

  it('pads the last week so every row is seven cells', () => {
    for (const [year, month] of [
      [2026, 7],
      [2026, 1],
      [2024, 1],
    ] as const) {
      for (const week of monthGrid(year, month)) expect(week.length).toBe(7)
    }
  })

  it('gives each cell the local midnight of its own day', () => {
    const cell = monthGrid(2026, 7)
      .flat()
      .find((one) => one?.day === 14)
    expect(cell?.at).toBe(new Date(2026, 7, 14).getTime())
    expect(cell?.at).toBe(startOfDay(new Date(2026, 7, 14, 17, 26).getTime()))
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

  it('heads the columns Monday first, in the platform language', () => {
    const initials = weekdayInitials()
    expect(initials.length).toBe(7)
    // 1 January 2024 was a Monday. Derived rather than hard-coded, so a Chinese
    // or German interface gets its own letters and not English ones.
    expect(initials[0]).toBe(
      new Date(2024, 0, 1).toLocaleDateString(undefined, { weekday: 'narrow' }),
    )
    expect(initials[6]).toBe(
      new Date(2024, 0, 7).toLocaleDateString(undefined, { weekday: 'narrow' }),
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
