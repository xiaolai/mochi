/** The "keys" group of settings. One pane per file; `panes.ts` keeps only the order. */
/**
 * The two global keys, as claimed.
 *
 * Read-only. `shared/shortcuts.ts` holds two constants and `plan-v2.md` records
 * that not carrying v1's editable system over was deliberate — it cost an
 * accelerator parser, a conflict resolver, a pane and a persisted map. What
 * this adds is the half that was invisible: registration returns false when
 * another application owns the combination, and until now that failure only
 * reached a log.
 */
import { element } from '../../element'
import { type Pane } from '../pane'
export const KEYS: Pane = {
  id: 'keys',
  label: 'Keys',
  attention: (view) => {
    const taken = view.keys.filter((one) => one.refused !== null)
    if (taken.length === 0) return null
    return `${taken.map((one) => one.accelerator).join(' and ')} could not be claimed.`
  },
  render(view) {
    const rows = view.keys.map((key) => {
      const row = element('div', 'folder')
      const left = element('div')
      left.append(element('div', undefined, key.what))
      if (key.refused !== null) {
        left.append(element('div', 'refused', `not working — ${key.refused}`))
      }
      const combo = element('code', undefined, key.accelerator)
      row.append(left, combo)
      return row
    })
    return [
      ...rows,
      element(
        'p',
        'note',
        'Fixed, for now. They work while another application has focus, which is the whole ' +
          'point of them — and it is also why one can be taken.',
      ),
    ]
  },
}
