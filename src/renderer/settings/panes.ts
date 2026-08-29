import { type Pane } from './pane'
import { ABOUT } from './pane/about'
import { STORAGE } from './pane/storage'
import { HEARING } from './pane/hearing'
import { KEYS } from './pane/keys'
import { LOOKING } from './pane/looking'
import { ON_SCREEN } from './pane/on-screen'
import { PROMPTS } from './pane/prompts'

/**
 * The six groups, one at a time.
 *
 * ## Why these six and not the handoff's
 *
 * The handoff lists Voice, Sound, On screen, Keys, What is kept, About. Three
 * of those do not survive contact with this repository's model, and
 * `plan-shell.md`'s split is where that was settled rather than guessed:
 *
 * - **Voice** is a `Persona` field. `Persona.voice`'s own comment says it is
 *   part of the character, and §21 locks it after her first audio — so changing
 *   it is a reconnect, exactly like changing who she is. It is on the shelf.
 * - **What is kept** is `policies/<id>.json`, filed under her id beside her
 *   memory. `@shared/policy`'s header argues at length that it must survive her
 *   package being updated and must die with her. Per character, so it is not
 *   here either — the group survives with different membership, holding where
 *   the app's own files are.
 * - **Sound** would be empty. Nothing app-level exists to put in it — no output
 *   device, no level — and an empty pane is a pane people learn to skip.
 *
 * What replaces them is what this build actually grew: the four standing grants
 * (5b) and how a lookup runs, neither of which existed when the six were
 * written.
 *
 * ## A dot means somebody should look, not that something is off
 *
 * A withheld grant is not a problem — it is a decision. The two things that are
 * problems are a key another application took, and a Codex CLI that is not
 * installed; both are silent failures that otherwise present as her declining
 * to help. Everything else has no dot, ever, which is what keeps the dot worth
 * looking at.
 */

/*
  `MAY_DO` is NOT here, and that is the delivered design's central move.

  The grants are per-character: each is stored against the worn character and
  reads differently for one worn as `he`. On this page they sat beside the
  keyboard shortcuts, which are true whoever is worn — so the one page that
  mixed the two was the one page that could not say which it was about. It is
  view III of her page now. See `renderPermits` and Rule 6 of the delivery:
  "The machine is not her."

  ## Seven, and the seventh came from the code

  The delivery names "Storage" in its navigation and draws no content for it
  anywhere in the document. What is in it was therefore read out of this
  repository rather than off the page: `About` was already answering two
  questions — what this build IS, and where it keeps things — and the second
  half is a group. It ended with the deletion that forgets every conversation of
  every character, under a version number, which is the strongest argument the
  code makes for the split the design asked for.

  `storage.ts` records what was deliberately NOT moved into it: export, which is
  per character; retention, which is per character; and any measure of size,
  which nothing in the store can answer.
*/
export const PANES: readonly Pane[] = [LOOKING, HEARING, PROMPTS, ON_SCREEN, KEYS, STORAGE, ABOUT]
