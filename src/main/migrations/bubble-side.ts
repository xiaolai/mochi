import { applyChange } from '../store/persona-change'
import { bubbleSideMigrated, markBubbleSideMigrated, readLegacyBubbleSide } from '../store/worn'
import type { PersonaCatalog } from '../store/personas'
import type { Persona } from '@shared/persona'

/**
 * Carry v1's single bubble-side preference onto every character, once.
 *
 * Lifted out of `index.ts` because a one-time migration is not composition: it
 * is a decision with an ordering argument, and the argument below is the whole
 * of it. It was also untestable there — `index.ts` cannot be imported outside
 * Electron — which is a poor property for a thing that runs exactly once, on
 * somebody's real data, and can never be observed doing it again.
 */

export interface BubbleSideMigrationDeps {
  readonly userData: () => string
  readonly catalogue: (userData: string) => PersonaCatalog
  readonly savePersona: (userData: string, catalog: PersonaCatalog, persona: Persona) => void
  readonly log: (line: string) => void
  readonly warn: (line: string, error?: unknown) => void
}

/**
 * Carry the old app-level bubble side onto every character, once.
 *
 * ## Why every character, and not the worn one
 *
 * The value it replaces was GLOBAL: one side, inherited by whoever was worn. A
 * migration that wrote it to the worn persona alone would leave every other
 * character on `auto` and call the difference a migration. Behaviour-preserving
 * means all of them see what they saw before.
 *
 * At the moment this runs, no persona has ever carried the field — it did not
 * exist — so every one of them is on the parser's default. Writing the legacy
 * value to all of them is exactly what they had.
 *
 * ## The marker goes down FIRST
 *
 * `bubbleSideMigrated` explains the ordering: `auto` is both the default and a
 * real choice, so a second pass cannot tell a character nobody has touched from
 * one whose owner has since picked `auto`. Marked first, a crash mid-pass skips
 * the carry-over — one visible trip to a dropdown. Marked last, it would
 * silently revert a later choice.
 *
 * ## And nothing at all when the legacy value was `auto`
 *
 * Which is the ordinary case: `auto` is what the setting shipped as and what
 * the new field defaults to. The marker still goes down, so this never runs
 * again either way.
 */
export function migrateBubbleSide(deps: BubbleSideMigrationDeps): void {
  const userData = deps.userData()
  if (bubbleSideMigrated(userData)) return
  const legacy = readLegacyBubbleSide(userData)
  try {
    markBubbleSideMigrated(userData)
  } catch (error: unknown) {
    // Ungated, so it must not run. Skipping costs a dropdown; running twice
    // could overwrite a choice made in between.
    deps.warn('[persona] the bubble-side migration could not be gated:', error)
    return
  }
  if (legacy === 'auto') {
    deps.log('[persona] bubble side: nothing to carry over')
    return
  }
  const catalog = deps.catalogue(userData)
  let carried = 0
  for (const persona of catalog.personas.values()) {
    const changed = applyChange(persona, { id: persona.id, bubbleSide: legacy }, [])
    if (!changed.ok) continue
    try {
      deps.savePersona(userData, catalog, changed.persona)
      carried += 1
    } catch (error: unknown) {
      // Said, not thrown. One character that could not be written must not stop
      // the others, and the marker is already down.
      deps.warn(`[persona] ${persona.id} did not take the old bubble side:`, error)
    }
  }
  deps.log(`[persona] bubble side ${legacy} carried onto ${String(carried)} character(s)`)
}
