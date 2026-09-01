import { type ByPronoun } from '@shared/pronoun'

/**
 * One thing in this window somebody could go looking for, named once.
 *
 * ## Why it is here rather than in `settings/pane.ts`
 *
 * It was there, because the machine's groups were the first things to need it.
 * Her sheet needs it too — "Voice", "Appearance", the three doors to her
 * drill-downs — and importing `settings/pane` from `sheet/who.ts` puts her page
 * downstream of the machine's, which is the one arrangement this window has a
 * standing rule against: *"The machine is not her. It gets its own page, its own
 * mark, and none of her colour."*
 *
 * So it sits beside `element.ts`, which was moved out for the same reason and
 * records it: a helper two surfaces need belongs to neither of them.
 *
 * ## The name lives HERE, not in the middle of `render`
 *
 * Every setting's name used to be a string literal inside the builder that drew
 * it — `field('Workspace', …)`. That is fine while the only way to reach a
 * setting is to read the pane it is on. The moment anything else needs the list
 * — a search across the window, an index, a test that asks what this pane holds
 * — that second reader has to be handed a second copy of every name, and the two
 * drift. This repository has the scar: `panes-says.ts` exists because a group's
 * name was written twice, and `pronoun-copy.test.ts` exists because one of the
 * copies kept saying "her" after the other was fixed.
 *
 * So a pane DECLARES its fields and `render` draws FROM the declaration. There
 * is one string, read twice, which is the same rule `about.ts` states about
 * `data-opens`: *"one value, read twice"*.
 *
 * `panes.test.ts` holds it — it renders every pane and asserts the anchors in
 * the DOM are exactly the fields declared, both directions. A field declared and
 * not drawn is a search result that scrolls nowhere; a field drawn and not
 * declared is a setting search cannot find. Neither is visible by looking.
 */
export interface Field {
  /**
   * Stable, and unique across the whole window.
   *
   * It becomes `data-field` in the DOM and the thing search scrolls to, so it
   * outlives wording: renaming "Rest" to "Sleep" must not break a link to it.
   */
  readonly id: string
  /** What it is called. A table only when the name is about HER. */
  readonly label: string | ByPronoun
  /**
   * Words somebody would type that the label does not contain.
   *
   * The label is what the setting is CALLED; these are what it is ABOUT. Nobody
   * hunting for the microphone ring types "halo", and nobody looking for how
   * long she waits before sleeping types "rest" — they type "sleep", "idle",
   * "timeout". A label that were also a keyword list would be a bad label.
   *
   * NEVER GENDERED, and this is the one rule that is not a matter of taste.
   * A `label` may be a `ByPronoun` table because it is DRAWN, and drawing reads
   * the worn character's pronoun. A keyword is matched against what somebody
   * TYPES, so a keyword saying "what she is told" would be findable by that
   * phrase on a machine wearing `she` and by nothing at all on one wearing `he`
   * — a search index that quietly holds different entries per character.
   * `pronoun-copy.test.ts` enforces it and caught two of these being written.
   */
  readonly keywords?: readonly string[]
}

/**
 * Mark an element as the place a field lives, so search can scroll to it.
 *
 * Returns what it was given, so it wraps a builder rather than needing a
 * statement of its own — `anchor(FIELDS.rest, section(…))`.
 *
 * Used directly only where a target is not `field()`-shaped: a prompt editor, a
 * key row, a folder row, a grant. `field()` calls it for everything else, which
 * is why most panes never name it.
 */
export function anchor<T extends HTMLElement>(spec: Field, made: T): T {
  made.setAttribute('data-field', spec.id)
  return made
}
