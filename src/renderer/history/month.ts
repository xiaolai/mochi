/**
 * The month grid behind the Archive's calendar.
 *
 * Separated from the DOM for the reason `format.ts` gives about dates: this is
 * the kind of thing that is wrong in a way nobody notices. A grid that starts
 * the week on the wrong day, or drops the 31st, or shifts by one across a
 * daylight-saving boundary, still looks exactly like a calendar.
 *
 * ## Local days, not UTC ones
 *
 * Every boundary here is the local midnight, because a conversation at 23:50 is
 * something the person had *last night* and not something that happened on
 * tomorrow's date in London. `startOfDay` is the one place that is decided, and
 * both the grid and the filter go through it — two spellings of the same
 * boundary is how a row lands under the wrong heading.
 *
 * ## Constructed from Date, not from arithmetic on milliseconds
 *
 * `at + 86_400_000` is a day only when no clock changed. `new Date(y, m, d + 1)`
 * is a day always, because the platform knows when the offset moved. The cost is
 * an object per cell, forty-two of them a month, which is nothing.
 */

/** Local midnight of whatever day this instant falls in. */
export function startOfDay(at: number): number {
  const then = new Date(at)
  return new Date(then.getFullYear(), then.getMonth(), then.getDate()).getTime()
}

/**
 * A stable name for a day, for grouping and comparing.
 *
 * The local midnight as a number rather than a formatted string: a string would
 * be a second spelling of the same fact, and the one thing this has to do is
 * compare equal for two instants on the same day.
 */
export function dayKey(at: number): number {
  return startOfDay(at)
}

/** One cell. `null` is a leading blank before the first of the month. */
export interface Cell {
  readonly at: number
  readonly day: number
}

/**
 * The weeks of a month, starting MONDAY.
 *
 * Monday because the calendar in the redesign is drawn `M T W T F S S`, and
 * because a week that starts on Sunday splits the weekend across two rows —
 * which is the one grouping people actually read a calendar for.
 *
 * Leading blanks rather than the previous month's tail. Greyed neighbours are
 * the commoner convention and they are also clickable-looking cells that belong
 * to a month the header does not name; blanks cannot be misread.
 */
export function monthGrid(year: number, month: number): readonly (readonly (Cell | null)[])[] {
  const first = new Date(year, month, 1)
  // `getDay()` is 0 for Sunday. Monday-first means Sunday is the seventh column.
  const lead = (first.getDay() + 6) % 7
  // Day 0 of the NEXT month is the last day of this one — the platform's own
  // answer, so February and leap years need no special case here.
  const days = new Date(year, month + 1, 0).getDate()

  const weeks: (Cell | null)[][] = []
  let week: (Cell | null)[] = Array.from({ length: lead }, () => null)
  for (let day = 1; day <= days; day += 1) {
    week.push({ at: new Date(year, month, day).getTime(), day })
    if (week.length === 7) {
      weeks.push(week)
      week = []
    }
  }
  if (week.length > 0) {
    while (week.length < 7) week.push(null)
    weeks.push(week)
  }
  return weeks
}

/** Step a month, carrying the year. */
export function stepMonth(
  year: number,
  month: number,
  by: number,
): { readonly year: number; readonly month: number } {
  const moved = new Date(year, month + by, 1)
  return { year: moved.getFullYear(), month: moved.getMonth() }
}

/** "August 2026", in whatever the platform calls it. */
export function monthLabel(year: number, month: number): string {
  return new Date(year, month, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

/** "Thursday, 14 August" — the heading over one day's conversations. */
export function dayHeadingLabel(at: number): string {
  return new Date(at).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
}

/**
 * The initials of the seven columns, Monday first, in the platform's language.
 *
 * Derived from a known Monday rather than hard-coded, so a Chinese or German
 * interface gets its own letters instead of English ones. 2024-01-01 was a
 * Monday; any Monday would do and a constant is cheaper than searching for one.
 */
export function weekdayInitials(): readonly string[] {
  return Array.from({ length: 7 }, (_, i) =>
    new Date(2024, 0, 1 + i).toLocaleDateString(undefined, { weekday: 'narrow' }),
  )
}

/** How many conversations fall on each local day. */
export function countByDay(
  conversations: readonly { readonly startedAt: number }[],
): ReadonlyMap<number, number> {
  const found = new Map<number, number>()
  for (const one of conversations) {
    const key = dayKey(one.startedAt)
    found.set(key, (found.get(key) ?? 0) + 1)
  }
  return found
}

/**
 * Which day to open on: today, or the last one there is anything on.
 *
 * Today FIRST, because that is what somebody opening the Archive means. The
 * fallback matters on every other day: an app used twice a week would otherwise
 * open on an empty column most of the time, which reads as "nothing was kept"
 * rather than as "nothing today".
 */
export function openingDay(
  conversations: readonly { readonly startedAt: number }[],
  now: number,
): number | null {
  const today = startOfDay(now)
  const counts = countByDay(conversations)
  if (counts.has(today)) return today
  const days = [...counts.keys()].sort((a, b) => b - a)
  return days[0] ?? null
}
