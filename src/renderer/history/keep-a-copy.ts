import { sureExportEl, sureYesEl } from './elements'
import { say } from './status'

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
    void window.mochiHistory
      .exportAll()
      .then((result) => {
        if (result.ok) {
          sureExportEl.textContent = `Saved ${String(result.conversations)}`
          say(`Exported ${String(result.conversations)} to ${result.path}`)
        } else if (!result.cancelled) {
          say(`Could not export: ${result.why}`, true)
        }
      })
      .catch((error: unknown) => {
        say(`Could not export: ${String(error)}`, true)
      })
      .finally(() => {
        sureExportEl.disabled = false
        sureYesEl.disabled = false
      })
  })
}
