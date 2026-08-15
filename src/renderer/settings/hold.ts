/**
 * Whether one field's new value can be stored, and if not, which sentence.
 *
 * With no Save button a field commits when it is left, and the
 * question "is this legal yet" arrives once per box instead of once per sheet.
 * The obvious answer -- restate the rules for `name`, for the two instructions,
 * for the two verbatim lines -- is a second copy of `parsePersona`, in the
 * process that is explicitly not trusted to hold one.
 *
 * So the candidate persona is put through the REAL parser and the answer is
 * filtered to the field being edited. There is exactly one rule set, and a
 * limit changed in `@shared/persona` changes what this window refuses without
 * anybody remembering to come here.
 *
 * Its own module because `settings/main.ts` touches `document` and the bridge
 * at load, so nothing in it can be reached by a test.
 */

import { parsePersona, type Persona } from '@shared/persona'
import type { SaveProblem } from '@shared/ipc'

/**
 * What this problem is about, or null when it is not about a field.
 *
 * `save-failed` and `not-permitted` carry no field; every other member does.
 * A property test rather than a list of kinds, so a new member with a `field`
 * is matched here without an edit -- and one without simply is not.
 */
function fieldOf(problem: SaveProblem): string | null {
  return 'field' in problem ? problem.field : null
}

/**
 * Why this edit cannot be stored, or null when it can.
 *
 * The candidate is built from a persona main already accepted plus ONE change,
 * so the only field that can be newly wrong is the one being edited. When that
 * holds, the returned problem is that field's own.
 *
 * It does not always hold — a persona can reach this window from a build that
 * validated it differently, or through a bug — and the fallback is deliberate:
 * report the first problem rather than none. Returning null because the
 * refusal belonged to another field would send main a persona it is about to
 * refuse, and report nothing at all when it does.
 */
export function refusalFor(candidate: Persona, path: string): SaveProblem | null {
  const parsed = parsePersona(candidate)
  if (parsed.ok) return null
  return parsed.problems.find((problem) => fieldOf(problem) === path) ?? parsed.problems[0] ?? null
}
