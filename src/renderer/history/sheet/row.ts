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

/**
 * Just the head row — a caps heading with its mono fact beside it.
 *
 * For a pane whose rows are already siblings in a column, where `section` would
 * nest a column inside a column to hold one heading.
 */
export function sectionHead(title: string, hint: string): HTMLElement {
  const head = element('div', 'section-head')
  head.append(element('h3', undefined, title), element('span', 'hint', hint))
  return head
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
  wrap.append(sectionHead(title, hint), ...body)
  return wrap
}

/**
 * A setting, as one row: what it is, the control, and a machine fact beside it.
 *
 * Read out of A1, where every setting on her page has this shape — an 82px
 * label in `--ink-2`, the control taking the rest, and an optional mono note
 * that is not part of the control. `Her name · [Mochi] · she|he|it`,
 * `Calls you · [nothing yet] · often left empty`.
 *
 * It did not exist. Each section arranged its own label and control, so a label
 * was a `<span class="inline">` here and a heading there and a bare text node
 * somewhere else — and the column they were meant to line up in was the one
 * thing none of them knew about. The 82px is what makes a column of settings
 * read as a column rather than as a stack of unrelated controls.
 *
 * ## The word is a real `<label>`
 *
 * A `div` looks identical and says nothing: an input beside one has no
 * accessible name at all. A `<label for>` also gives the word a click target,
 * which is free and is what people expect. The id is generated from the row's
 * own word rather than passed in, because an id chosen at the call site is an id
 * two call sites can choose the same.
 *
 * A chooser is a ROW OF BUTTONS, not one control, so there is nothing for `for`
 * to point at — `htmlFor` on a group is a promise the DOM cannot keep. It gets
 * `aria-labelledby` and a group role instead, which is the same claim made in a
 * way a screen reader can act on.
 */
export function settingRow(
  label: string,
  control: HTMLElement,
  /** A machine fact about the setting — never an instruction, never prose. */
  note?: string,
): HTMLElement {
  const row = element('div', 'setting')
  const word = element('label', 'setting-of', label)
  const id = `setting-${label.toLowerCase().replace(/[^a-z]+/g, '-')}`
  /*
    ANY labelable control, not just an input.

    This looked for `HTMLInputElement` only, so a `<select>` — "Which side", the
    one control on her page that is one — fell to the group branch and was given
    `role="group"` with `aria-labelledby`. That is a promise the DOM cannot keep:
    a select is a single control, and announcing it as a group of one leaves a
    screen reader describing a container where there is a chooser. The group
    branch is for a ROW OF BUTTONS, which is the only thing `for` cannot point at.
  */
  const labelable = 'input, select, textarea'
  const field =
    control instanceof HTMLInputElement ||
    control instanceof HTMLSelectElement ||
    control instanceof HTMLTextAreaElement
      ? control
      : control.querySelector<HTMLElement>(labelable)
  if (field !== null) {
    field.id = id
    word.htmlFor = id
  } else {
    word.id = id
    control.setAttribute('role', 'group')
    control.setAttribute('aria-labelledby', id)
  }
  row.append(word, control)
  if (note !== undefined) row.append(element('span', 'setting-fact', note))
  return row
}

/** A row of buttons where exactly one is current. Used for pronoun and voice. */
export function chooser(
  className: string,
  entries: readonly {
    readonly value: string
    readonly label: string
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
    /*
      NO `marked` OPTION. One caller ever set it — the voice row, for a dot
      meaning "OpenAI recommends this" — and that dot went when the voices
      became listenable. A layout helper carrying a capability nothing asks for
      is a capability that will be reached for by somebody who has not read what
      it was careful about.
    */
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
