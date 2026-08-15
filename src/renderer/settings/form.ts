/**
 * The controls the settings form is built from.
 *
 * Beside its caller rather than in `design/`: `design/controls.css` and its
 * test already own that name and describe the STYLESHEET, and only this window
 * builds forms. It moves to `design/` the day a second window needs it — the
 * project's fifth extraction rule, which triggers on the second use and not on
 * the first guess about one.
 *
 * Everything here is a function of its arguments and returns a node, which
 * means it is readable by a test under happy-dom. Nothing reaches for the
 * window's state.
 */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  children: Node[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value)
  for (const child of children) node.append(child)
  return node
}

/** A labelled control, with an optional hint under it. */
export function field(id: string, label: string, control: HTMLElement, hint?: string): HTMLElement {
  // A GROUP is named by reference, never by `for`.
  //
  // `for` names ONE control, so pointing it at a group means pointing it at one
  // member -- and the id it needs has to come from somewhere. It came from the
  // first radio, silently: the colour swatches were built with `theme-<name>`
  // ids and their own labels, and this renamed `theme-moss` to `theme`, leaving
  // that label pointing at nothing. The moss swatch could not be clicked at all
  // -- no selection, no event, no error -- while every other colour worked,
  // because only the first one was ever robbed. It was the built-in's own
  // colour, and it survived a 748-test gate because nothing here rendered.
  const grouped = control.getAttribute('role') === 'radiogroup'
  const labelId = `${id}-label`
  // THREE CASES, resolved before the label is written, because what it points
  // at decides how it has to be written.
  //
  // 1. a control that can be labelled directly -- give it the id, use `for`
  // 2. a wrapper around an unnamed control -- give the INNER one the id
  // 3. a wrapper around a control that already answers to an id -- leave that
  //    id alone and name it by reference instead
  //
  // The third is the one that was wrong. `labelable` declines to rename a
  // control something else may point at, and returns the wrapper; the label had
  // already been built with `for: id`, so it named the wrapper -- and `for` on
  // a `<div>` focuses nothing and announces nothing. The control this function
  // exists to label went back to being unlabelled, silently.
  const inside = isLabelable(control)
    ? null
    : control.querySelector<HTMLElement>('input, select, textarea, button')
  const target = grouped ? control : (inside ?? control)
  // Case 3: it came with an id, so it keeps it and is named by reference.
  const keepsOwnId = !grouped && inside !== null && inside.id !== ''
  const byReference = grouped || keepsOwnId
  const named = el('label', byReference ? { id: labelId } : { for: id }, [
    document.createTextNode(label),
  ])
  if (grouped) {
    control.id = id
    // The reason the id was taken in the first place was real: a group with no
    // accessible name is announced as nothing. This gives it one without
    // touching anything inside it.
    control.setAttribute('aria-labelledby', labelId)
  } else if (keepsOwnId) {
    // Named by reference. Both halves matter: renaming it would break whatever
    // points at that id -- which is how the moss swatch died -- and leaving it
    // unnamed is the outcome this function exists to prevent.
    target.setAttribute('aria-labelledby', labelId)
  } else {
    // The id goes on the thing a label can actually point AT.
    //
    // Composite controls -- the size slider and its readout, the key field and
    // its buttons -- arrive here as a wrapping `<div>`, and `for` pointing at a
    // div names nothing: a screen reader announced those two as an unlabelled
    // slider and an unlabelled text box. `labelable` finds the real control
    // inside, and a simple control is its own answer.
    target.id = id
  }
  const wrap = el('div', { class: 'field' }, [named, control])
  if (hint !== undefined) {
    // ANNOUNCED, not merely drawn. A hint says what a control does and what it
    // costs -- "the microphone stays open and the session keeps billing" is one
    // of them -- and rendering it as loose prose beside the control means it is
    // read by everyone except the people who most need the control described.
    //
    // Kept in its own attribute rather than folded into the label, so
    // `fieldProblem` can add and remove a refusal alongside it without either
    // one erasing the other.
    const hintId = `${id}-hint`
    wrap.append(el('p', { class: 'field-hint', id: hintId }, [document.createTextNode(hint)]))
    describe(target, hintId)
  }
  return wrap
}

/**
 * Add one id to a control's `aria-describedby` without dropping the others.
 *
 * A control can be described by more than one thing at once -- a hint AND the
 * sentence saying why its value will not save -- and the two are added and
 * removed by different code at different times. Assigning the attribute would
 * make whichever ran last the only one announced.
 */
export function describe(control: HTMLElement, id: string): void {
  const present = (control.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean)
  if (present.includes(id)) return
  control.setAttribute('aria-describedby', [...present, id].join(' '))
}

/** Remove one id from `aria-describedby`, leaving any others in place. */
export function undescribe(control: HTMLElement, id: string): void {
  const rest = (control.getAttribute('aria-describedby') ?? '')
    .split(/\s+/)
    .filter((one) => one !== '' && one !== id)
  if (rest.length === 0) control.removeAttribute('aria-describedby')
  else control.setAttribute('aria-describedby', rest.join(' '))
}

/** Whether a `<label for>` may point at this element directly. */
function isLabelable(control: HTMLElement): boolean {
  return (
    control instanceof HTMLInputElement ||
    control instanceof HTMLSelectElement ||
    control instanceof HTMLTextAreaElement ||
    control instanceof HTMLButtonElement
  )
}

/**
 * A slider with its value beside it, applied LIVE.
 *
 * On `input`, coalesced to one message per animation frame. The first version
 * applied on `change` — on release — reasoning that resizing an always-on-top
 * window at pointer rate would judder. That reasoning was wrong on its own
 * evidence: dragging her already calls `setBounds` every 16ms and is smooth.
 * A size slider whose effect you cannot see while dragging is a slider you
 * have to use by trial and error.
 *
 * The coalescing is the part that matters. `input` fires faster than frames on
 * a trackpad, and every event is an IPC round trip plus a window resize plus a
 * repaint — so the queue would grow behind the pointer and she would keep
 * resizing after you stopped. One frame, one size.
 */
export interface SliderHandle {
  readonly node: HTMLElement
  /** Reflect back what was actually accepted. See the comment where it is built. */
  readonly accepted: (value: number) => void
}

export function slider(
  value: number,
  bounds: { min: number; max: number; step: number },
  format: (value: number) => string,
  onChange: (next: number) => void,
): SliderHandle {
  const input = el('input', {
    type: 'range',
    class: 'slider',
    min: String(bounds.min),
    max: String(bounds.max),
    step: String(bounds.step),
  })
  input.value = String(value)
  const readout = el('span', { class: 'slider-value' })
  readout.textContent = format(value)

  /*
   * How much of the track is filled, as a percentage the stylesheet can paint.
   *
   * The track is drawn from tokens rather than by the user agent -- see
   * `controls.css` -- and a styled track loses the browser's automatic fill, so
   * the position has to come from here. Set on the element rather than in a
   * stylesheet because it is the one value in the sheet that is per-instance.
   */
  const paintTrack = (at: number): void => {
    const span = bounds.max - bounds.min
    const fraction = span <= 0 ? 0 : (at - bounds.min) / span
    input.style.setProperty('--fill', `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`)
  }
  paintTrack(value)

  let pending: number | null = null
  let frame = 0
  const apply = (next: number): void => {
    pending = next
    if (frame !== 0) return
    frame = requestAnimationFrame(() => {
      frame = 0
      if (pending !== null) onChange(pending)
      pending = null
    })
  }

  input.addEventListener('input', () => {
    const next = Number(input.value)
    readout.textContent = format(next)
    paintTrack(next)
    apply(next)
  })
  // Keyboard arrows and a release both end here. The last `input` has usually
  // already sent this value; sending it again guarantees the final position
  // lands even if a frame was dropped.
  //
  // The PENDING FRAME IS CANCELLED FIRST. It was not, so a release inside the
  // frame window sent the value twice -- and each send is an IPC call and a
  // window resize, so the duplicate is a second `setBounds` on an
  // always-on-top window for a position it is already at. Idempotent in
  // outcome, not in cost.
  input.addEventListener('change', () => {
    if (frame !== 0) {
      cancelAnimationFrame(frame)
      frame = 0
    }
    pending = null
    onChange(Number(input.value))
  })
  return {
    node: el('div', { class: 'slider-row' }, [input, readout]),
    // Written back with the value main ACCEPTED, which is not necessarily the
    // one that was asked for -- main clamps.
    //
    // RETURNED rather than published into module state. The old version wrote
    // itself into a `sizeReadout` binding so an async callback could find it
    // later, on the argument that `render` builds the form in one expression
    // and has nowhere to put a handle. A handle the caller keeps satisfies that
    // just as well and cannot be left pointing at a control that was replaced
    // by the next paint.
    accepted(value: number): void {
      if (!Number.isFinite(value)) return
      readout.textContent = format(value)
      paintTrack(value)
      // The slider itself moves only when it DISAGREES, so writing back does
      // not fight a thumb the user is still holding.
      if (Number(input.value) !== value) input.value = String(value)
    },
  }
}

/**
 * A single-line box that commits when you LEAVE it.
 *
 * It used to call back on every keystroke, into a whole-sheet draft that waited
 * for a Save button. There is no Save button now, so a per-keystroke
 * callback would be a per-keystroke write: a catalog re-read and an IPC round
 * trip per character, and a prompt field handed to her half-typed.
 *
 * `hold` is where uncommitted text is filed, and it is NOT the control's id.
 * The id names a box in this window; the hold names a box belonging to a
 * CHARACTER. The tray can switch persona while this window is open, and a key
 * of `name` alone would show A's half-typed name on
 * B's sheet -- then commit it to B on the next blur. That was the bug the
 * whole-sheet draft store was written to prevent, and it is the same bug one
 * field down.
 */
export function textInput(
  hold: string,
  value: string,
  onCommit: (next: string) => void,
): HTMLInputElement {
  const input = el('input', { type: 'text', class: 'input' })
  commitOnLeaving(input, hold, value, onCommit)
  return input
}

export function select<T extends string>(
  options: readonly T[],
  labelOf: (value: T) => string,
  current: T,
  onChange: (next: T) => void,
): HTMLSelectElement {
  const node = el('select', { class: 'select' })
  for (const value of options) {
    const option = el('option', { value })
    option.textContent = labelOf(value)
    node.append(option)
  }
  // Chosen ONCE, after every option exists, rather than by flagging one of them
  // on the way in.
  //
  // Marking the option instead is correct and depends on an algorithm rather
  // than on a statement: inserting an option makes the select recompute which
  // one is chosen, and the answer falls out of how many were already there and
  // which of them had been flagged. Chromium runs that correctly; happy-dom
  // does not, and a three-option select asked for its last value came back with
  // its middle one. The app had no three-option select until the sound section,
  // so nothing had ever depended on it.
  //
  // Setting the value has no such dependency: `current` is one of `options` by
  // the type, so this always names an option that is already there.
  node.value = current
  node.addEventListener('change', () => onChange(node.value as T))
  return node
}

/**
 * A multi-line box, for the prompts a person may want to read and rewrite.
 *
 * Its own helper rather than a taller `textInput`, because the value here is
 * paragraphs: a single-line input silently hides everything past the first
 * screenful, and these are texts somebody is meant to READ before deciding
 * whether to change them.
 *
 * `change` rather than `input`, deliberately. Each keystroke would be a save,
 * an IPC round trip and a repaint that moves the caret out from under the
 * person typing -- and the repaint is what would make it unusable.
 */
export function textArea(
  id: string,
  /**
   * What is STORED, or empty when nothing is.
   *
   * Not the default text. Rendering the default as the value meant any
   * interaction with the box saved a copy of it -- so opening it and clicking
   * away silently pinned that day's wording, and the app stopped tracking
   * improvements to its own default with nothing but a "put it back" button to
   * say so. Observed on a real preferences file: a saved block identical to the
   * built-in except for one sentence that had changed since.
   */
  value: string,
  /** The default, shown greyed. Visible to read, and never submitted. */
  placeholder: string,
  onChange: (next: string) => void,
  /**
   * Where uncommitted text is filed. Defaults to the control's own id.
   *
   * The machine-wide prompts leave this alone: they belong to the MACHINE, so
   * there is no character to scope them by. A persona's own prompt passes a
   * scoped key, for the reason `textInput` gives -- the tray can change who is
   * worn while this window is open, and an unscoped key would show one
   * character's half-written prompt on another's sheet.
   */
  hold: string = id,
): HTMLTextAreaElement {
  // `.input` is the boxed treatment every typed-in control shares, including
  // its placeholder colour. There is no `.prompt` class and there was no reason
  // to invent one.
  const node = el('textarea', { class: 'input', rows: '8', placeholder, id })
  commitOnLeaving(node, hold, value, onChange)
  return node
}

/**
 * Hold what is typed; commit it when the control is left.
 *
 * One function for the box and the paragraph box, because the rules are the
 * same and both of them were arrived at by getting one wrong:
 *
 * A DRAFT survives the repaint that a change from anywhere else triggers. A
 * settings broadcast rebuilds the pane, and the new node is built from the
 * stored snapshot — silently discarding whatever was on screen. Somebody
 * rewriting a field would lose it to a repaint they did not cause and could
 * not see coming.
 *
 * The draft is dropped only when the STORED value has caught up with it, which
 * is the round trip completing. Clearing it on submit instead meant a save that
 * was refused, or one still in flight during a repaint, threw the text away and
 * put the old value back.
 */
function commitOnLeaving(
  node: HTMLInputElement | HTMLTextAreaElement,
  hold: string,
  value: string,
  onCommit: (next: string) => void,
): void {
  const draft = drafts.get(hold)
  // CONVERGED, not identical.
  //
  // Callers canonicalise before storing -- a box holding only spaces is stored
  // as empty, and `verbatim` becomes `null` -- so a raw comparison never
  // matched for exactly those values. The draft therefore outlived the round
  // trip it was waiting for: it reappeared on every repaint and was
  // resubmitted on every later blur, against a store that had already accepted
  // it and normalised it.
  //
  // Comparing trimmed forms converges precisely when the difference is
  // surrounding whitespace, which is what every caller's canonicalisation
  // removes. The stored value wins when they converge, which is correct: what
  // is on disk is what was accepted.
  if (draft !== undefined && draft.trim() === value.trim()) drafts.delete(hold)
  node.value = drafts.get(hold) ?? value

  /**
   * What this box has already sent. NOT the value it was built with.
   *
   * A persona save is not broadcast, so nothing repaints after a commit and
   * this node lives on with the value it was born holding. Comparing against
   * that: type `Ada`, leave, come back, type `Mochi` again, leave -- the second
   * blur sees the ORIGINAL `Mochi` and sends nothing. She stays Ada on disk
   * while the box in front of you says Mochi, and there is no third state for
   * anything to notice the disagreement in.
   */
  let committed = value

  node.addEventListener('input', () => drafts.set(hold, node.value))
  // BLUR as well as `change`. A repaint replaces the node, so the value the
  // user typed was set programmatically on the replacement -- and a programmatic
  // value emits no `change` when it is later blurred. The draft would then sit
  // there, visible, and never be submitted at all.
  const commit = (): void => {
    if (node.value === committed) return
    committed = node.value
    drafts.set(hold, node.value)
    onCommit(node.value)
  }
  node.addEventListener('change', commit)
  node.addEventListener('blur', commit)
}

/**
 * Uncommitted text, by hold key, for the lifetime of the window.
 *
 * Kept until the snapshot comes back carrying it, so a failed save keeps what
 * was written rather than reverting the box under the person who wrote it.
 */
const drafts = new Map<string, string>()

/**
 * Throw away uncommitted text, because somebody asked for exactly that.
 *
 * The only caller is "put her back to how she came" — every other path leaves
 * a draft alone, which is the whole point of keeping one. Named keys rather
 * than "clear everything", so restoring a persona does not also wipe a prompt
 * being rewritten two sections further down the same pane.
 */
export function forgetDrafts(holds: readonly string[]): void {
  for (const hold of holds) drafts.delete(hold)
}

/**
 * Carry uncommitted text from one hold key to another.
 *
 * For the one moment an identity changes underneath a draft: editing the
 * built-in FORKS her, so main writes a copy under a new id and everything keyed
 * by the old one is suddenly filed under a name nothing will ask for again. The
 * visible symptom is a half-typed field vanishing — change her colour while her
 * greeting is mid-sentence and the greeting disappears — and the invisible one
 * is a map that only grows.
 *
 * Pairs rather than two lists, so a caller cannot hand over one more `from`
 * than `to` and silently drop the last draft.
 */
export function moveDrafts(pairs: ReadonlyArray<readonly [string, string]>): void {
  for (const [from, to] of pairs) {
    const held = drafts.get(from)
    if (held === undefined) continue
    drafts.delete(from)
    drafts.set(to, held)
  }
}

/**
 * Say — or stop saying — why one control's value has not been stored.
 *
 * Beside the box rather than in the pane's problem list. That list is where a
 * refused ACTION reports, and it sits at the foot of a long sheet; a field that
 * will not commit has to say so where the person is looking, which is the field
 * they are leaving.
 *
 * By id and against the live document, so the same call serves both callers:
 * a commit that was refused, and a repaint that has just rebuilt the box. One
 * function, so the two cannot render a refusal differently.
 */
export function fieldProblem(id: string, message: string | null): void {
  const control = document.getElementById(id)
  if (control === null) return
  // The whole `.field` row, because the note is a THIRD grid item in it and
  // `controls.css` places it in the control column. Appended after the control
  // and therefore before the hint: the reason it will not save outranks the
  // sentence explaining what the field is for.
  control.closest('.field')?.querySelector('.field-error')?.remove()
  const noteId = `${id}-error`
  if (message === null) {
    control.removeAttribute('aria-invalid')
    // Only OUR id. Assigning the attribute here removed the field's hint along
    // with the refusal -- so clearing an error also silenced the sentence
    // explaining what the control is for, permanently, for the readers who
    // depend on it.
    undescribe(control, noteId)
    return
  }
  control.setAttribute('aria-invalid', 'true')
  // Named, not merely coloured. Red alone says nothing to a screen reader, and
  // this is the only thing standing between an edit and being silently dropped.
  // Added ALONGSIDE the hint: a control can be described by both at once, and
  // which one survives must not depend on which code ran last.
  describe(control, noteId)
  control.after(el('p', { class: 'field-error', id: noteId }, [document.createTextNode(message)]))
}

/**
 * A button, in the one style this window has for them.
 *
 * `.button` and nothing else. `controls.css` draws a distinction the whole
 * sheet rests on -- things you TYPE IN or CHOOSE FROM are boxed, things you DO
 * are underlined -- and a class the sheet has never heard of renders as a raw
 * browser button, which is a third visual language in a window that has two.
 */
export function button(label: string, onClick: () => void): HTMLButtonElement {
  const node = el('button', { class: 'button', type: 'button' })
  node.textContent = label
  node.addEventListener('click', onClick)
  return node
}
