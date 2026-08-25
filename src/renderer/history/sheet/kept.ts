import { element } from '../../element'
import { section } from './row'
import type { ShelfHandlers } from './row'
import type { ShelfView } from '@shared/history-window'

/**
 * What she has kept, and the way to take it back.
 *
 * ## Why this section is not optional
 *
 * `memory.ts` states the rule this repository holds everywhere: a second
 * archive "with no retention policy and no delete button, sitting beside one
 * that has both" is the shape this project refuses. Her store is a second
 * archive. Without a way to see it and clear it, it should not exist at all.
 *
 * It lists collections rather than entries. The sweeping gestures belong here,
 * where they can be seen before they happen; removing one entry is a
 * conversation she can have, and `forget_kept` is where that lives.
 */
/** Long enough that a fast second click is a slip rather than an answer. */
const SETTLE_MS = 350
/** After this an armed button has been forgotten about, and disarms itself. */
const FORGETS_MS = 8_000

/**
 * A destructive button that has to be pressed twice.
 *
 * Two gestures, per this project's rule that permanent deletion needs one — and
 * these are permanent: there is no undo copy of her store, deliberately, since
 * a hidden copy would contradict the promise the delete button is there to
 * keep. The second press is a different word in a different colour, so it
 * cannot be reached by a double-click on the first.
 *
 * Disabled the moment it dispatches. Without that, a slow write leaves a live
 * button whose second press asks again for something already happening.
 */
function twicePlease(label: string, sure: string, act: () => void): HTMLButtonElement {
  const button = element('button', 'btn', label)
  button.type = 'button'
  let armedAt: number | null = null
  const disarm = (): void => {
    armedAt = null
    button.textContent = label
    button.classList.remove('arming')
  }
  button.addEventListener('blur', disarm)
  button.addEventListener('click', (event) => {
    /*
      A double-click must not be able to confirm.

      Arming on the first press and acting on the second means an ordinary
      double-click deletes everything, which is the opposite of a confirmation.
      `event.detail` counts the clicks in a sequence, so anything past the first
      of a rapid pair is refused outright — and the window below is what stops
      an armed button sitting there for the rest of the session waiting to be
      pressed by somebody who has forgotten it.
    */
    if (event.detail > 1) return
    const now = performance.now()
    if (armedAt === null || now - armedAt < SETTLE_MS || now - armedAt > FORGETS_MS) {
      armedAt = now
      button.textContent = sure
      button.classList.add('arming')
      return
    }
    button.disabled = true
    disarm()
    act()
  })
  return button
}

export function keptSection(view: ShelfView, handlers: ShelfHandlers): HTMLElement | null {
  // Nothing kept renders as no section at all, not as an empty heading. The
  // same reason `instructions.ts` omits an empty notes block: a heading with
  // nothing under it invites somebody to wonder what belongs there.
  if (view.kept.length === 0) return null

  const rows = view.kept.map((one) => {
    const row = element('div', 'kept-row')
    row.append(
      element('span', 'grow', one.collection),
      element('span', 'kept-count', String(one.entries)),
    )
    row.append(
      twicePlease('Forget these', 'Really forget them?', () => {
        handlers.forgetKept({
          personaId: view.wornId,
          kind: 'collection',
          collection: one.collection,
        })
      }),
    )
    return row
  })

  const all = twicePlease('Forget everything she has kept', 'Really forget all of it?', () => {
    handlers.forgetKept({ personaId: view.wornId, kind: 'all' })
  })

  return section('What she has kept', 'written by her, when you asked her to', ...rows, all)
}
