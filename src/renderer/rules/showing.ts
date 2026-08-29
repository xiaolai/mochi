/**
 * Which of two answers the conversation column is showing.
 *
 * ## The failure this exists for — contract A5
 *
 * The column is either showing a SEARCH or showing a DAY, and every reload
 * assumed the second. So a reload triggered while something was typed — wearing
 * a character, saving a field, a background refresh — replaced the results with
 * a day's conversations underneath a populated search field. The field said one
 * thing and the column showed another, with nothing on screen to say which was
 * in force.
 *
 * ## Why a function and not an `if`
 *
 * It was an `if`, in one place, and the defect was that a second place did not
 * have it. The question "what is the column showing" is asked by the reload, by
 * the character switch, by the search input and by the first paint, and each of
 * those got its own answer. One function is one answer.
 *
 * ## Trimmed, deliberately
 *
 * A field holding only spaces is a field nobody has searched with. Treating it
 * as a live query means a stray space silently hides the calendar and shows
 * "nothing matched" for a search nobody made.
 */
export type Showing = 'a search' | 'a day'

export function showing(query: string): Showing {
  return query.trim() === '' ? 'a day' : 'a search'
}
