/**
 * How long ago, in words a companion would say.
 *
 * ## Elapsed, never a calendar date
 *
 * "on 14 August" needs a locale and a timezone, and a timezone makes the output
 * depend on where the machine is standing -- a dependency no test can pin and
 * no reader expects. Whole elapsed milliseconds are arithmetic: deterministic,
 * timezone-free, and just as useful to a model that rephrases it anyway.
 *
 * ## Its own module because there are two callers
 *
 * The wake brief says when the last conversation was; a recall hit says when
 * the thing was said. Two copies of this would drift, and the drift would be
 * invisible -- both would keep producing plausible English. Second occurrence
 * of the same need is a class, so it lives once.
 *
 * ## Deliberately vague at every scale
 *
 * A precise figure invites her to quote it, and "you last spoke to me 4.2 hours
 * ago" is a thing no companion says.
 */

const HOUR = 3_600_000
const DAY = 86_400_000

export function elapsedWords(ms: number): string {
  // Guard the impossible rather than render it: a clock correction can put a
  // past conversation in the future, and "in -3 days" is worse than vague.
  if (ms < 0) return 'a moment ago'
  if (ms < HOUR) return 'less than an hour ago'
  if (ms < DAY) {
    const hours = Math.round(ms / HOUR)
    return hours <= 1 ? 'about an hour ago' : `about ${String(hours)} hours ago`
  }
  const days = Math.floor(ms / DAY)
  if (days === 1) return 'about a day ago'
  if (days < 30) return `about ${String(days)} days ago`
  return 'more than a month ago'
}
