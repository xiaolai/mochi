/**
 * The strings for one render, with the pronoun already chosen.
 *
 * Passed to each section builder rather than each one reaching for module
 * state: the pronoun comes from the DRAFT, so choosing `he` rewords the sheet
 * on the spot rather than at the next save, and a builder that read `loaded`
 * instead would silently be one edit behind.
 *
 * Its own module so a pane can be imported by a test without dragging
 * `settings/main.ts` — and the `document` it touches at load — in with it.
 */

import type { LocaleTag, Messages } from '@shared/i18n'
import type { ByPronoun, Pronoun } from '@shared/pronoun'

export interface Copy {
  readonly t: Messages['settings']
  readonly say: (table: ByPronoun) => string
  /**
   * The pronoun `say` was built from.
   *
   * Exposed because a few labels are MIXED -- most navigation titles are the
   * same words whoever she is, and one or two are sentences about her -- so
   * they are `string | ByPronoun` and `say` cannot take them. See `label`.
   */
  readonly pronoun: Pronoun
  /** Which language these strings came from. Panes that build their own need it. */
  readonly locale: LocaleTag
}
