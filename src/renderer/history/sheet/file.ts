/**
 * What every section of her sheet is built from: a heading, and a row of
 * choices where exactly one is current.
 *
 * Below the sections rather than beside them. `shelf.ts` holds the ORDER the
 * sections appear in and imports each one; each one needs this vocabulary, so
 * leaving it in `shelf.ts` would have made every section import the file that
 * imports it.
 */
import { type ShelfHandlers, section } from './row'
import { type ShelfCharacter, type ShelfView } from '@shared/history-window'
import { anchor } from '../../field'
import { HER_FIELDS } from './fields'
/**
 * Which avatar file she wears.
 *
 * A `<select>` and not pills: this is a list of files on disk, it is as long as
 * somebody's folder, and unlike the ten voices it has no bounded set to draw.
 */
export function fileSection(
  view: ShelfView,
  worn: ShelfCharacter,
  handlers: ShelfHandlers,
): HTMLElement {
  const file = document.createElement('select')
  /*
    Every avatar on disk — plus the one she names that ISN'T, when there is one.

    A persona may legally hold an avatar id whose file has since been deleted:
    `resolveFaceFor` falls back to the built-in and reports it, and the id
    stays. Listing only what exists made the control show "Built-in" as though
    that were the stored value, and choosing it fired no change event — so the
    one way to clear a dangling reference was the one option that did nothing.
  */
  const missing =
    worn.avatarId !== null && !view.avatars.some((one) => one.id === worn.avatarId)
      ? [{ value: worn.avatarId, label: `${worn.avatarId} — missing` }]
      : []
  for (const entry of [
    ...missing,
    ...view.avatars.map((one) => ({
      // The built-in is stored as `null`; the empty string is only how a
      // `<select>` can carry that, and it is turned back at the boundary below.
      value: one.id ?? '',
      /*
        WHERE IT CAME FROM, in the option itself.

        The list read `Built-in`, `mine`, `blueberry` — and nothing said that
        the last two are files the reader put in the avatars folder themselves
        while the first ships with the app. Somebody looking at their own
        `mine` had no way to tell it apart from something Mochi provides, and
        asked exactly that.

        The hint beside the control already names the file that was read, but
        that describes the CURRENT answer. This is the list you read while
        choosing, which is the moment the question is actually being asked.

        Every entry with an id is a file in the avatars folder — the built-in is
        the only one stored as `null` — so the split is exact rather than a
        guess about naming.
      */
      label: one.id === null ? 'Built-in — ships with Mochi' : `${one.id} — your file`,
    })),
  ]) {
    const option = document.createElement('option')
    option.value = entry.value
    option.textContent = entry.label
    option.selected = entry.value === (worn.avatarId ?? '')
    file.append(option)
  }
  file.addEventListener('change', () => {
    handlers.save({ id: worn.id, avatarId: file.value === '' ? null : file.value })
  })
  return anchor(HER_FIELDS.file, section('Face', resolvedFace(view, worn), file))
}

/** Where her face actually resolved to, not where it was asked to look. */
function resolvedFace(view: ShelfView, worn: ShelfCharacter): string {
  if (view.faceSource !== null) return `reading ${view.faceSource}`
  // A named avatar that resolved to nothing fell back to the built-in, and
  // saying so is the whole point — "the app ignored my file" is the least
  // debuggable outcome this feature can have.
  return worn.avatarId === null ? 'the shipped face' : `${worn.avatarId} could not be read`
}
