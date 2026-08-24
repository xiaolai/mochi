/**
 * What every section of her sheet is built from: a heading, and a row of
 * choices where exactly one is current.
 *
 * Below the sections rather than beside them. `shelf.ts` holds the ORDER the
 * sections appear in and imports each one; each one needs this vocabulary, so
 * leaving it in `shelf.ts` would have made every section import the file that
 * imports it.
 */
import { element } from '../../element'
import { type Emotion } from '@shared/avatar'
import { type NoteAction, type PersonaAction, type PersonaChange } from '@shared/ipc'
export interface ShelfHandlers {
  readonly wear: (id: string) => void
  /**
   * Put an expression on her, now, to look at it. Nothing is stored.
   *
   * Separate from `save` because it is not a change: the switch beside the tile
   * decides what she MAY use, and this decides nothing at all — it is how you
   * see the answer at the size she appears on the desktop rather than at 56px.
   */
  readonly tryFace: (face: Emotion) => void
  readonly save: (change: PersonaChange) => void
  readonly persona: (action: PersonaAction) => void
  readonly memory: (action: NoteAction) => void
  /** Store the system prompt document. Empty is a real answer. */
  readonly prompt: (text: string) => void
  /** Say what happened. Silence after a write reads as the write not landing. */
  readonly say: (text: string, bad?: boolean) => void
}

/** A caps heading, a hint in mono beside it, and the control underneath. */
export function section(title: string, hint: string, ...body: readonly HTMLElement[]): HTMLElement {
  const wrap = element('section', 'section')
  const head = element('div', 'head')
  head.append(element('h3', undefined, title), element('span', 'hint', hint))
  wrap.append(head, ...body)
  return wrap
}

/** A row of buttons where exactly one is current. Used for pronoun and voice. */
export function chooser(
  className: string,
  entries: readonly {
    readonly value: string
    readonly label: string
    /**
     * Whether this one carries a dot, and NOT what the dot means.
     *
     * The caller writes the sentence under the row; the dot is only a pointer
     * at it. A mark whose meaning lived here would be a claim made by a layout
     * helper — see `RECOMMENDED_VOICES` for how careful the claim has to be.
     */
    readonly marked?: boolean
  }[],
  chosen: string,
  pick: (value: string) => void,
): HTMLElement {
  const wrap = element('div', className)
  for (const entry of entries) {
    const button = element('button', undefined, entry.label)
    button.type = 'button'
    button.setAttribute('aria-current', String(entry.value === chosen))
    if (entry.marked === true) {
      /*
        A dot, and the WORD beside it in the accessible name.

        The same rule the microphone mark in the top strip states: an icon alone
        is only a statement to somebody already looking at it, so the fact is
        kept as text for anybody who is not. `aria-hidden` on the dot itself,
        because otherwise the graphic and the name both announce.
      */
      const dot = element('span', 'dot')
      dot.setAttribute('aria-hidden', 'true')
      button.append(dot)
      button.setAttribute('aria-label', `${entry.label} — recommended`)
      button.title = 'recommended for realtime'
    }
    button.addEventListener('click', () => {
      // Nothing to save when it is already the answer, and a write would
      // redraw the pane under the pointer for no change.
      if (entry.value !== chosen) pick(entry.value)
    })
    wrap.append(button)
  }
  return wrap
}
