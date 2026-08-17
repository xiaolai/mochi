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
 * When a conversation happened, as somebody would say it.
 *
 * Relative near the present and absolute past it, because "14 days ago" is a
 * subtraction the reader has to do and "3 August" is not. The boundary is
 * CALENDAR days, not multiples of 24 hours: something at 23:50 last night is
 * "yesterday" at 00:10 even though it was twenty minutes ago.
 */
export function whenLabel(at: number, now: number): string {
  const then = new Date(at)
  const today = new Date(now)
  const midnight = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  const clock = then.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

  if (at >= midnight) return `Today ${clock}`
  if (at >= midnight - DAY) return `Yesterday ${clock}`
  if (at >= midnight - 6 * DAY) {
    return `${then.toLocaleDateString(undefined, { weekday: 'long' })} ${clock}`
  }
  const sameYear = then.getFullYear() === today.getFullYear()
  return then.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
}

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
