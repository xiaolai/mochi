/**
 * The pure half of the conversations window: what a row says, and where a
 * search term falls inside a line.
 *
 * Separated from the DOM so it can be tested without one, and because both of
 * these are the kind of thing that is wrong in a way nobody notices — a date
 * that says "Yesterday" for something eleven days old still looks plausible.
 */

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * How long it ran. Null while she is still awake in it.
 *
 * Rounded to whole minutes above a minute, because a conversation is not a
 * stopwatch and "4 min 37 s" invites a precision the number does not have —
 * `ended_at` is the last turn's timestamp, not the moment she stopped talking.
 */
export function lengthLabel(startedAt: number, endedAt: number | null): string | null {
  if (endedAt === null) return null
  const span = endedAt - startedAt
  if (span < MINUTE) return 'under a minute'
  if (span < HOUR) return `${String(Math.round(span / MINUTE))} min`
  const hours = Math.floor(span / HOUR)
  const minutes = Math.round((span - hours * HOUR) / MINUTE)
  return minutes === 0 ? `${String(hours)} h` : `${String(hours)} h ${String(minutes)} min`
}

export interface Segment {
  readonly text: string
  readonly hit: boolean
}

/**
 * Split a line into the parts that match a query and the parts that do not.
 *
 * Returned as data rather than as markup, and that is the point: the text is a
 * person's own words, so building an HTML string here would be one missed
 * escape away from their transcript executing itself. The caller makes text
 * nodes out of these.
 *
 * Matching is case-insensitive and literal — the query goes nowhere near a
 * regular expression, so `.*` and `(` are searched for rather than compiled.
 */
export function highlight(text: string, query: string): readonly Segment[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return [{ text, hit: false }]

  const segments: Segment[] = []
  const hay = text.toLowerCase()
  let from = 0
  for (;;) {
    const found = hay.indexOf(needle, from)
    if (found === -1) break
    if (found > from) segments.push({ text: text.slice(from, found), hit: false })
    segments.push({ text: text.slice(found, found + needle.length), hit: true })
    from = found + needle.length
  }
  if (from < text.length) segments.push({ text: text.slice(from), hit: false })
  return segments.length === 0 ? [{ text, hit: false }] : segments
}

/**
 * Which day a conversation belongs to, as a heading over a group of them.
 *
 * Relative near the present and absolute past it, because "14 days ago" is a
 * subtraction the reader has to do and "Mon 3 Aug" is not. The boundary is
 * CALENDAR days, not multiples of 24 hours: something at 23:50 last night is
 * "Yesterday" at 00:10 even though it was twenty minutes ago.
 *
 * The day and the clock are two functions rather than one `whenLabel` that
 * returned "Today 09:41", which is what this window used to put on every row of
 * a list already in date order. The two answers are "which pile is this in" and
 * "when exactly", and one string doing both is how a heading ends up with a
 * time in it.
 */
export function dayLabel(at: number, now: number): string {
  const then = new Date(at)
  const today = new Date(now)
  const midnight = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()

  if (at >= midnight) return 'Today'
  if (at >= midnight - DAY) return 'Yesterday'
  if (at >= midnight - 6 * DAY) return then.toLocaleDateString(undefined, { weekday: 'long' })
  const sameYear = then.getFullYear() === today.getFullYear()
  return then.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
}

/** The time of day on its own, for a row under a day heading. */
export function clockLabel(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

/**
 * Split a time-ordered list into runs that share a day.
 *
 * Generic over the item so the ordinary list and the search results can use the
 * same grouping — the only thing it needs from either is when it happened.
 *
 * CONSECUTIVE runs, not a bucket per day. The list arrives newest-first and
 * stays in that order, so a day that somehow appears twice produces two
 * headings rather than being silently merged and reordered. A grouping that
 * quietly rearranges its input is one that hides the fact that the input was
 * not what it claimed.
 */
export function byDay<T>(
  items: readonly T[],
  now: number,
  when: (item: T) => number,
): readonly { readonly day: string; readonly items: readonly T[] }[] {
  const groups: { day: string; items: T[] }[] = []
  for (const item of items) {
    const day = dayLabel(when(item), now)
    const last = groups.at(-1)
    if (last !== undefined && last.day === day) last.items.push(item)
    else groups.push({ day, items: [item] })
  }
  return groups
}

/**
 * How many of her turns were cut off partway through.
 *
 * Counted rather than stored: `cut` is per turn, and the header states it for
 * the conversation. Her turns ONLY — `cut` on one of yours would mean something
 * different, and nothing sets it there today.
 */
export function interruptions(turns: readonly { who: 'her' | 'you'; cut: boolean }[]): number {
  return turns.filter((one) => one.who === 'her' && one.cut).length
}
