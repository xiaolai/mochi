import { type Pane } from './pane'
import { ABOUT } from './pane/about'
import { HEARING } from './pane/hearing'
import { KEYS } from './pane/keys'
import { LOOKING } from './pane/looking'
import { MAY_DO } from './pane/may-do'
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

export const PANES: readonly Pane[] = [MAY_DO, LOOKING, HEARING, PROMPTS, ON_SCREEN, KEYS, ABOUT]
