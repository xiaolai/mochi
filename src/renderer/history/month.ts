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
 * The days of a month, in one row.
 *
 * A STRIP, not a grid of weeks. The delivered design draws "a whole month at a
 * glance" as a single line of numerals with a dot under the days that have
 * something on them, which is a different question from the one a week grid
 * answers: this one is "when did we talk", and a week grid is for "what day of
 * the week is the 14th". Nothing in this window ever needed the second.
 *
 * It also removes the leading blanks, and with them the argument about what to
 * put in them — greyed neighbours from a month the header does not name, or
 * empty cells that are not offering anything. A strip has neither.
 *
 * Day 0 of the NEXT month is the last day of this one, which is the platform's
 * own answer, so February and leap years need no special case here.
 */
export function monthDays(year: number, month: number): readonly Cell[] {
  const days = new Date(year, month + 1, 0).getDate()
  return Array.from({ length: days }, (_unused, index) => ({
    at: new Date(year, month, index + 1).getTime(),
    day: index + 1,
  }))
}

export function stepMonth(
  year: number,
  month: number,
  by: number,
): { readonly year: number; readonly month: number } {
  const moved = new Date(year, month + by, 1)
  return { year: moved.getFullYear(), month: moved.getMonth() }
}

/**
 * "Aug 2026", in whatever the platform calls it.
 *
 * SHORT, and the reason is the slot it goes in. `.daystrip .month` is a fixed
 * 78px so that paging a month does not slide the forward arrow and all
 * thirty-one day cells sideways under the pointer pressing them — and the long
 * form does not fit it. "September 2026" measured about 105px at 14.5/500, so
 * it ran out of its own button and painted over the `›` beside it.
 *
 * The abbreviation is the picker's own vocabulary: `monthNames` below is
 * already `month: 'short'`, so the grid says "Sep" on the pill you press and
 * the slot said "September" about the same month.
 *
 * The button's `aria-label` is built from this too, deliberately. WCAG 2.5.3
 * asks that the accessible name CONTAIN the visible label, and "Sep 2026" is
 * not a substring of "September 2026" — so a long accessible name over a short
 * visible one would be a control a voice-control user cannot say the name of.
 * One string, both places.
 */
export function monthLabel(year: number, month: number): string {
  return new Date(year, month, 1).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
}

/** "Thursday, 14 August" — the heading over one day's conversations. */
export function dayHeadingLabel(at: number): string {
  return new Date(at).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
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
 * Which months of one year have anything in them, and how many years do.
 *
 * C2's picker greys the months with nothing in them and says why: "The rest are
 * not buttons — choosing one would open an empty column." That is the same rule
 * the day strip already keeps — "a day with nothing on it is not a button",
 * which `check-rendered.mjs` enforces as A1 — applied one level up, where it was
 * not kept at all: every one of the twelve was pressable, so the picker offered
 * eleven ways to arrive somewhere empty.
 *
 * Both answers come from one pass, because they are read together and a second
 * walk over the same list is a second place for the two to disagree about what
 * is in it.
 */
export function monthsKept(conversations: readonly { readonly startedAt: number }[]): {
  /** Every `year-month` that has at least one conversation in it. */
  readonly months: ReadonlySet<string>
  /** How many distinct years do. */
  readonly years: number
} {
  const months = new Set<string>()
  const years = new Set<number>()
  for (const one of conversations) {
    const when = new Date(one.startedAt)
    months.add(`${String(when.getFullYear())}-${String(when.getMonth())}`)
    years.add(when.getFullYear())
  }
  return { months, years: years.size }
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

/** The twelve month names, in this machine's own language. */
export function monthNames(): readonly string[] {
  return Array.from({ length: 12 }, (_unused, month) =>
    new Date(2000, month, 1).toLocaleDateString(undefined, { month: 'short' }),
  )
}

/**
 * A year somebody typed, or null when it is not one.
 *
 * ## Why it refuses rather than clamps
 *
 * A field that silently rounds 20 up to 1970 has answered a question nobody
 * asked, and the person who typed it is left wondering which of their
 * keystrokes landed. Refusing leaves the picker where it was, which is a state
 * they can see.
 *
 * The bounds are the archive's, not the calendar's: `2000` because this
 * application did not exist before it and a conversation cannot predate it, and
 * a century ahead because a clock set wrongly is a real thing and a window that
 * cannot be navigated back from it is worse than one that goes too far.
 */
export function yearTyped(text: string, now = new Date()): number | null {
  const trimmed = text.trim()
  // `Number` on '' is 0 and on '12abc' is NaN; both have to fail, and only the
  // second does without this.
  if (trimmed === '' || !/^\d{1,4}$/.test(trimmed)) return null
  const year = Number(trimmed)
  if (year < 2000 || year > now.getFullYear() + 100) return null
  return year
}
