import { sureExportEl, sureYesEl } from './elements'
import { exportAllSaying } from './export-all'

/**
 * Saving a copy from inside the confirmation, at the moment it is wanted.
 *
 * The dialog STAYS OPEN and the deletion is not cancelled: saving a copy is a
 * step before deciding, not a decision. The destructive button disables while
 * the save runs so it cannot be reached during a write, and the outcome is said
 * out loud — an export somebody believes happened and did not is worse than no
 * export offered at all.
 *
 * Its own module because it is the one thing this dialog does that is neither
 * confirming nor cancelling, and `main.ts` has no room to spare.
 */
export function offerACopyFirst(): void {
  sureExportEl.addEventListener('click', () => {
    sureExportEl.disabled = true
    sureYesEl.disabled = true
    void exportAllSaying((conversations) => {
      sureExportEl.textContent = `Saved ${String(conversations)}`
    }).finally(() => {
      sureExportEl.disabled = false
      sureYesEl.disabled = false
    })
  })
}
