/**
 * Becoming somebody else, as one step that either happens or does not.
 *
 * Extracted from `index.ts` because that file cannot be imported by a test --
 * it touches Electron at module load -- and this is the most consequential
 * function in the feature. Every defect an audit found in it was an ORDERING
 * defect, and none of them was reachable by any test that existed: a failed
 * preference write ignored so the switch reversed at the next launch; an early
 * return that skipped a broadcast and left the settings window on the previous
 * character; a session attempt retired only after delivery, so a throw let the
 * new persona inherit the old one's session.
 *
 * A list of the intended steps would have caught none of those. The thing that
 * has to be tested is the code that interprets the failures, so the effects
 * are injected and the interpretation lives here.
 *
 * ## Four phases, and only the first two can be undone
 *
 * 1. **Prepare** -- resolve the target. Changes nothing.
 * 2. **Durable commit** -- write the remembered id. Failing here leaves
 *    everything on the persona we started from, which is why it goes first.
 * 3. **In-process commit** -- adopt the persona and her face.
 * 4. **Projections** -- end the session, resize, tell both renderers, redraw
 *    the tray.
 *
 * Phase 4 is deliberately NOT transactional and saying so is the honest part:
 * a message delivered to a renderer cannot be recalled, and a retired session
 * attempt cannot be un-retired. What is guaranteed is that the durable state
 * and this process agree, and that each projection is attempted independently
 * -- one surface being absent or throwing must not silently deprive another.
 */

import type { Persona } from '@shared/persona'

export interface SwitchDeps {
  /** The persona for this id, or null when the catalog does not have one. */
  readonly find: (id: string) => Persona | null
  /** Who she is right now. */
  readonly current: () => Persona
  /**
   * Remember the new id durably. False when the disk refused.
   *
   * Returns rather than throws, because "the disk said no" is an expected
   * outcome here and the caller has a specific answer for it.
   */
  readonly remember: (id: string) => boolean
  /** Adopt the persona in this process, and resolve the face she names. */
  readonly adopt: (persona: Persona) => void
  /** End any live session. Must retire the attempt even if delivery fails. */
  readonly endSession: () => void
  /** Resize the companion window and push her new appearance. */
  readonly showCompanion: () => void
  /** Send the settings window a fresh snapshot. */
  readonly tellSettings: () => void
  readonly refreshTray: () => void
  /** Where a projection failure goes. Never thrown at the caller. */
  readonly warn: (what: string, error: unknown) => void
}

export type SwitchOutcome =
  /** Done. */
  | { readonly kind: 'switched'; readonly persona: Persona }
  /** Already wearing her. Nothing happened, and that is not a failure. */
  | { readonly kind: 'already' }
  /** No such persona. */
  | { readonly kind: 'unknown' }
  /** The remembered id could not be written, so nothing was changed. */
  | { readonly kind: 'not-remembered' }
  /**
   * The id was written and this process could not take her on.
   *
   * The two halves genuinely disagree at this point and neither is safe to
   * undo: rewriting the old id could fail the same way, and the surfaces have
   * not been told anything yet. A restart resolves it, which is why the
   * outcome is named rather than folded into a boolean.
   */
  | { readonly kind: 'not-adopted'; readonly persona: Persona }

export function switchPersona(deps: SwitchDeps, id: string): SwitchOutcome {
  // PREPARE. Nothing has changed yet, so both of these exits are free.
  const target = deps.find(id)
  if (target === null) return { kind: 'unknown' }
  if (target.id === deps.current().id) return { kind: 'already' }

  // DURABLE COMMIT, before anything visible moves. Adopting first and writing
  // second is what let a refused write leave persona B on screen and persona A
  // on disk -- a switch that silently undid itself at the next launch.
  if (!deps.remember(target.id)) return { kind: 'not-remembered' }

  // IN-PROCESS COMMIT. Guarded, because the durable write already happened:
  // a throw here would otherwise leave disk saying B while this process still
  // held A -- or held B's persona with A's face, which is the mixed identity
  // the whole transaction exists to prevent. It is reported as its own
  // outcome so the caller can say something true rather than "switched".
  try {
    deps.adopt(target)
  } catch (error: unknown) {
    deps.warn('adopting the persona', error)
    return { kind: 'not-adopted', persona: target }
  }

  // PROJECTIONS. Each is attempted whatever the others did.
  //
  // `endSession` comes first: she should be asleep before the new face and the
  // new name appear, so the transition reads as her going and somebody else
  // arriving rather than as one character changing mid-sentence.
  for (const [what, run] of [
    ['ending the session', deps.endSession],
    ['showing the companion', deps.showCompanion],
    ['telling the settings window', deps.tellSettings],
    ['refreshing the tray', deps.refreshTray],
  ] as const) {
    try {
      run()
    } catch (error: unknown) {
      // Reported and stepped over. A window that has gone, or a send that
      // threw, is not a reason to leave the tray showing somebody she is no
      // longer -- the durable state already says the switch happened, so the
      // surfaces have to be brought along as far as they can be.
      deps.warn(what, error)
    }
  }

  return { kind: 'switched', persona: target }
}
