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
import { acknowledged } from '../../rules/acknowledged'
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
  /**
   * Ask before erasing everything she has kept — on a surface of its own.
   *
   * Separate from `memory` on purpose. Every other `NoteAction` is a write that
   * happens; this one OPENS A QUESTION, and the write only follows if it is
   * answered. Routing it through `memory` would have made the pane the thing
   * that decides, which is how the arming pattern got in here in the first
   * place — contract D2.
   */
  readonly askToErase: (id: string) => void
  /** Store the system prompt document. Empty is a real answer. */
  readonly prompt: (text: string) => void
  /** Say what happened. Silence after a write reads as the write not landing. */
  readonly say: (text: string, bad?: boolean) => void
}

/** A caps heading, a hint in mono beside it, and the control underneath. */
export function section(title: string, hint: string, ...body: readonly HTMLElement[]): HTMLElement {
  const wrap = element('section', 'section')
  /*
    `section-head`, NOT `head` — which this window already uses for the HEADER
    OF A PAGE, at `padding: 30px 40px 0`.

    So every one of these nine headings carried a page header's padding: the
    caps label sat forty pixels to the right of the control it names, with an
    unowned thirty above it, on her main page. It is the same collision that put
    the month navigation under a page header's padding, and the tenth of this
    exact shape in this stylesheet.
  */
  const head = element('div', 'section-head')
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
  /*
    What this row has actually ASKED FOR, which stops being `chosen` on the
    first click.

    `chosen` is captured when the sheet is drawn and never moves — the redraw
    comes from an asynchronous save and reload, and until it lands every button
    still believes the original answer. So a second click on the option
    somebody had just selected dispatched a duplicate write, and two quick
    clicks on different options dispatched both.

    Tracked here rather than read back off `aria-current`, because the DOM is
    the thing being corrected: a value the row has asked for is a fact about
    this row, not about what is drawn.
  */
  const wants = acknowledged(chosen)
  /** Every button by its value, so the row can move its own mark. */
  const drawn = new Map<string, HTMLElement>()
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
      // redraw the pane under the pointer for no change. C1's rule, and the
      // acknowledgement half with it — see `rules/acknowledged.ts`.
      if (wants.ask(entry.value) === null) return
      // Moved here too, so the row shows what it asked for while the save is
      // in flight rather than the answer it is replacing.
      for (const [other, control] of drawn) {
        control.setAttribute('aria-current', String(other === entry.value))
      }
      pick(entry.value)
    })
    drawn.set(entry.value, button)
    wrap.append(button)
  }
  return wrap
}

/**
 * A one-line field that saves what was typed, and puts itself back when nothing
 * was.
 *
 * Both fields on this band did the same four things — set a value, set a
 * placeholder, compare a trimmed edit against what is stored, and either put
 * the box back or dispatch a save. Written out twice, and the halves that are
 * easy to lose are the two that are not about saving: the reset, and comparing
 * the TRIMMED value so that typing a space and deleting it is not a change.
 *
 * A control displaying a value that was never stored is the small version of
 * the failure this whole window exists to avoid.
 */
export function savedField(options: {
  readonly className: string
  readonly value: string
  readonly placeholder: string
  readonly save: (value: string) => void
}): HTMLInputElement {
  const field = element('input', options.className)
  field.type = 'text'
  field.placeholder = options.placeholder
  field.value = options.value
  field.addEventListener('change', () => {
    if (field.value.trim() === options.value) {
      // Nothing to save — and the field is put back rather than left showing
      // the spaces somebody added.
      field.value = options.value
      return
    }
    options.save(field.value)
  })
  return field
}
