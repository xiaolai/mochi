import type { NoteAction, PersonaAction, PersonaChange, ShelfView } from '@shared/ipc'

/**
 * The characters half of the shelf.
 *
 * ## Why this grew out of the conversations window rather than being a new one
 *
 * The handoff draws the shelf as a new 1440 × 900 window. It is cheaper than
 * that, and better: this window already had the list-and-pane layout, the
 * search, the problems strip and the export — it was the shelf's memory half
 * already. Adding cards to it is a smaller change than a new window plus a new
 * renderer plus a preload role plus a new IPC surface, and it puts memory and
 * characters in one place, which is what the shelf is *for*.
 *
 * ## Everything here MOVED out of settings
 *
 * Not copied. `plan-shell.md`'s split decides what belongs where: a control is
 * the shelf's when it is about who she is or about what came of using her, and
 * settings' when it is true of this machine whoever is worn. Two places to set
 * one thing is what `menuHandlers` already exists to avoid.
 *
 * ## Drawn against the artifact, filled with what is real
 *
 * The card and the plate are `Mochi Extended.dc.html`'s shapes, in its tokens.
 * What they hold is only what this build can answer for — the artifact also
 * draws a command palette, an installer, per-character session counts and a
 * "try on a wake" button, and drawing the chrome for a feature that does not
 * exist is the same failure as offering her a tool she cannot call.
 *
 * ## `document.createElement` and `textContent`, never `innerHTML`
 *
 * The same rule the rest of this window follows, and it matters more here: a
 * character's name and her prompt come out of a folder anybody can write to,
 * and the note below was written by a MODEL. Showing that text to a person is
 * safe; evaluating it is not.
 */

export interface ShelfHandlers {
  readonly wear: (id: string) => void
  readonly save: (change: PersonaChange) => void
  readonly persona: (action: PersonaAction) => void
  readonly memory: (action: NoteAction) => void
  /** Say what happened. Silence after a write reads as the write not landing. */
  readonly say: (text: string, bad?: boolean) => void
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const made = document.createElement(tag)
  if (className !== undefined) made.className = className
  if (text !== undefined) made.textContent = text
  return made
}

function options(
  select: HTMLSelectElement,
  entries: readonly { value: string; label: string }[],
  chosen: string,
): void {
  for (const entry of entries) {
    const option = document.createElement('option')
    option.value = entry.value
    option.textContent = entry.label
    option.selected = entry.value === chosen
    select.append(option)
  }
}

/** One row of a card's table: a tracked label and what it resolved to. */
function detail(list: HTMLElement, label: string, value: string): void {
  list.append(element('dt', undefined, label), element('dd', undefined, value))
}

/**
 * The cards, above everything else.
 *
 * Clicking one WEARS her, which is the handoff's own interaction (1a): the ring
 * moves, the plates re-read and the assembled prompt re-renders. A wake opens a
 * new session, so nothing has to be torn down — switching is a different string
 * on the next wake, and the window says so.
 *
 * It is also what keeps the transcript channels honest. They read whoever is
 * worn, decided in main; a card that merely SELECTED somebody would mean the
 * conversations pane had to name a persona to a query, which is exactly the
 * property this window's allowlist exists to keep.
 */
export function characterCards(
  view: ShelfView,
  openId: string | null,
  onOpen: (id: string) => void,
): readonly HTMLElement[] {
  return view.characters.map((one) => {
    const card = element('button', 'card')
    card.type = 'button'
    card.setAttribute('aria-current', String(one.id === openId))

    const head = element('div', 'row')
    head.append(element('div', 'name', one.name))
    // The ring says which is OPEN; this says which she actually is. They are
    // the same card almost always, and the two questions are still different.
    if (one.id === view.wornId) head.append(element('div', 'worn', 'worn'))
    card.append(head)

    const facts = document.createElement('dl')
    detail(facts, 'face', one.avatarId ?? 'built-in')
    detail(facts, 'voice', one.voice)
    detail(facts, 'bubble', one.bubble ? 'shown' : 'off')
    card.append(facts)

    card.addEventListener('click', () => {
      onOpen(one.id)
    })
    return card
  })
}

/**
 * The open character: her name, then four plates.
 *
 * The fourth plate is a READOUT. `workspace` is app-level — one directory this
 * machine lets her read, whoever is worn — so drawing it as a control here
 * would be inventing a per-character field the format does not have, and
 * drawing only three would lose the fact that a lookup has a workspace at all.
 *
 * What she will be TOLD is not here. It lives in the inspector beside this, as
 * 1a draws it: the plates on the left assemble, and the card on the right is
 * the string that assembly produces.
 */
export function characterSheet(view: ShelfView, handlers: ShelfHandlers): HTMLElement {
  const worn = view.characters.find((one) => one.id === view.wornId)
  const page = element('div', 'sheet')
  if (worn === undefined) {
    page.append(element('p', 'empty', 'No characters loaded.'))
    return page
  }

  page.append(
    namePlate(worn, handlers),
    facePlate(view, worn, handlers),
    voicePlate(view, worn, handlers),
    promptPlate(view, worn, handlers),
    workspacePlate(view),
    memoryPlate(view, handlers),
    actions(worn, handlers),
  )
  return page
}

/**
 * Her name, as a plate rather than as a heading.
 *
 * The open character is identified by the RING on her card — that is what 1a's
 * card row is for — so a second large name below it would be the same fact
 * twice, and the one on top would be the one that is not a control. Editing a
 * character happens in the plates, which is where 1a puts every other field.
 */
function namePlate(worn: ShelfView['characters'][number], handlers: ShelfHandlers): HTMLElement {
  const name = element('input')
  name.type = 'text'
  name.value = worn.name
  name.addEventListener('change', () => {
    if (name.value.trim() === worn.name) {
      // Nothing to save — and the field is put back rather than left showing
      // the spaces somebody added. A control displaying a value that was never
      // stored is the small version of the failure this window avoids.
      name.value = worn.name
      return
    }
    handlers.save({ id: worn.id, name: name.value })
  })
  // Where her file is, beside the field that renames it — the one place that
  // answers "which of these on disk am I editing".
  return plate('name', name, worn.source ?? 'the built-in, with no file of her own')
}

/** A plate: a tracked label, a control, and what it actually resolved to. */
function plate(label: string, control: HTMLElement, meta: string | null): HTMLElement {
  const row = element('div', 'plate')
  const value = element('div', 'value')
  value.append(control)
  if (meta !== null) value.append(element('span', 'meta', meta))
  row.append(element('span', 'label', label), value)
  return row
}

function facePlate(
  view: ShelfView,
  worn: ShelfView['characters'][number],
  handlers: ShelfHandlers,
): HTMLElement {
  const face = document.createElement('select')
  /**
   * Every avatar on disk — plus the one she names that ISN'T, when there is one.
   *
   * A persona may legally hold an avatar id whose file has since been deleted:
   * `resolveFaceFor` falls back to the built-in and reports it, and the id
   * stays. Listing only what exists made the control show "Built-in" as though
   * that were the stored value, and choosing it fired no change event — so the
   * one way to clear a dangling reference was the one option that did nothing.
   */
  const missing =
    worn.avatarId !== null && !view.avatars.some((one) => one.id === worn.avatarId)
      ? [{ value: worn.avatarId, label: `${worn.avatarId} — missing` }]
      : []
  options(
    face,
    [
      ...missing,
      ...view.avatars.map((one) => ({
        // The built-in is stored as `null`; the empty string is only how a
        // `<select>` can carry that, and it is turned back at the boundary
        // below.
        value: one.id ?? '',
        label: one.id ?? 'Built-in',
      })),
    ],
    worn.avatarId ?? '',
  )
  face.addEventListener('change', () => {
    handlers.save({ id: worn.id, avatarId: face.value === '' ? null : face.value })
  })
  return plate('face', face, resolvedFace(view))
}

/** Where her face actually resolved to, not where it was asked to look. */
function resolvedFace(view: ShelfView): string {
  const { avatarId, source } = view.plates.face
  if (source !== null) return `reading ${source}`
  // A named avatar that resolved to nothing fell back to the built-in, and
  // saying so is the whole point — "the app ignored my file" is the least
  // debuggable outcome this feature can have.
  return avatarId === null ? 'the shipped face' : `${avatarId} could not be read`
}

function voicePlate(
  view: ShelfView,
  worn: ShelfView['characters'][number],
  handlers: ShelfHandlers,
): HTMLElement {
  const voice = document.createElement('select')
  options(
    voice,
    view.voices.map((one) => ({ value: one, label: one })),
    worn.voice,
  )
  voice.addEventListener('change', () => {
    handlers.save({ id: worn.id, voice: voice.value })
  })
  // §21 locks the voice after her first audio, so a change is a reconnect
  // rather than an update — which is the same shape as changing who she is.
  return plate('voice', voice, 'from her next wake')
}

/**
 * Her own prompt, and the bubble that shows what it produces.
 *
 * Lifted the way 1a lifts it — her own edge and an elevation — because it is
 * the one thing on this page that is genuinely hers rather than a reference to
 * something else. Read-only for now: `Persona.style` is edited in her file, and
 * a textarea that wrote it would need the same fenced-input reasoning
 * `instructionsFor` applies to memory. That is a work item, not a control.
 */
function promptPlate(
  view: ShelfView,
  worn: ShelfView['characters'][number],
  handlers: ShelfHandlers,
): HTMLElement {
  const block = element('div', 'plate prompt')

  const head = element('div', 'head')
  const bubble = element('input')
  bubble.type = 'checkbox'
  bubble.checked = worn.bubble
  bubble.id = 'bubble'
  bubble.addEventListener('change', () => {
    handlers.save({ id: worn.id, bubble: bubble.checked })
  })
  const label = element('label', undefined, 'show her words above her head')
  label.htmlFor = 'bubble'
  const wrap = element('div', 'row')
  wrap.append(bubble, label)
  head.append(element('span', 'label', 'prompt'), element('span', 'grow'), wrap)

  const body = element('div', 'body-pad')
  const text = element('pre')
  text.textContent =
    view.plates.prompt === '' ? 'She has no prompt of her own.' : view.plates.prompt
  if (view.plates.prompt === '') text.classList.add('empty-note')
  body.append(text)

  block.append(head, body)
  return block
}

function workspacePlate(view: ShelfView): HTMLElement {
  const path = element('code', undefined, view.plates.workspace)
  return plate('workspace', path, 'one folder, for everyone · Settings')
}

/**
 * What she remembers, with the one step back.
 *
 * The note is the one thing on this page a MODEL writes — `remember_this` when
 * somebody asks out loud, and the sleep summariser when it lands — so it is the
 * one thing that needs an undo at all.
 */
function memoryPlate(view: ShelfView, handlers: ShelfHandlers): HTMLElement {
  const block = element('div', 'plate prompt')
  const head = element('div', 'head')

  const undo = element('button', 'plain', 'Undo the last change')
  undo.type = 'button'
  // Null means nothing has ever been rewritten. That is NOT the same as going
  // back to an empty note, which is a real version somebody may want.
  undo.disabled = view.note.previous === null
  undo.addEventListener('click', () => {
    // NAMED. The sheet stays clickable while a character switch is in flight,
    // and main refuses an action for anybody but whoever is worn now.
    handlers.memory({ kind: 'restore', id: view.wornId })
  })

  // TWO STEPS rather than a dialog. This throws away something a person may
  // have spent months accumulating, and a button that does it on one click is a
  // button somebody hits by accident. It is undoable, and it should still ask.
  const forget = element('button', 'plain', 'Forget everything')
  forget.type = 'button'
  forget.disabled = view.note.text === ''
  let armed = false
  forget.addEventListener('click', () => {
    if (!armed) {
      armed = true
      forget.textContent = 'Really forget it all?'
      forget.classList.add('arming')
      return
    }
    handlers.memory({ kind: 'clear', id: view.wornId })
  })

  head.append(element('span', 'label', 'notes'), element('span', 'grow'), undo, forget)

  const body = element('div', 'body-pad')
  const text = element('pre')
  text.textContent =
    view.note.text === '' ? 'She has not written anything down about you yet.' : view.note.text
  if (view.note.text === '') text.classList.add('empty-note')
  body.append(text)

  block.append(head, body)
  return block
}

/**
 * Making, copying and removing characters.
 *
 * A NAME, never an id. The id is derived in main against what is already taken
 * AND what a pending deletion still reserves, because an id is what her memory
 * and her conversations are filed under: choosing one from here would be
 * choosing whose leftovers a new character inherits.
 */
function actions(worn: ShelfView['characters'][number], handlers: ShelfHandlers): HTMLElement {
  const wrap = element('div', 'actions')

  const name = element('input')
  name.type = 'text'
  name.placeholder = 'name'
  const named = (): string => name.value.trim()

  /**
   * Disabled the moment one is pressed, and left that way.
   *
   * The write is asynchronous and the sheet is replaced when it lands, so an
   * ordinary double-click sent TWO create actions — and each derives its own id
   * against what was taken when it ran, so it made two characters rather than
   * failing. They are re-enabled by the re-render, which is what the reload
   * does.
   */
  const guarded: HTMLButtonElement[] = []
  const once = (act: () => void): void => {
    for (const button of guarded) button.disabled = true
    act()
  }

  const make = element('button', 'plain her', 'New')
  make.type = 'button'
  make.addEventListener('click', () => {
    if (named() === '') return handlers.say('A new character needs a name.', true)
    once(() => {
      handlers.persona({ kind: 'create', name: named() })
    })
  })

  const copy = element('button', 'plain', `Duplicate ${worn.name}`)
  copy.type = 'button'
  copy.addEventListener('click', () => {
    if (named() === '') return handlers.say('Give the copy a name first.', true)
    once(() => {
      handlers.persona({ kind: 'duplicate', name: named() })
    })
  })

  wrap.append(name, make, copy)
  guarded.push(make, copy)

  if (worn.source === null) {
    // The built-in has no file to delete. What somebody actually wants here is
    // her original prompt back, which lives in the source and not in this
    // window — so without this, editing her is a one-way door.
    const restore = element('button', 'plain', 'Put the built-in back as she ships')
    restore.type = 'button'
    restore.addEventListener('click', () => {
      once(() => {
        handlers.persona({ kind: 'restore-built-in' })
      })
    })
    wrap.append(restore)
    guarded.push(restore)
    return wrap
  }

  // TWO STEPS. This takes her notes and her conversations with her, and unlike
  // the note there is no one-step undo waiting behind it.
  const remove = element('button', 'plain', `Delete ${worn.name}`)
  remove.type = 'button'
  let armed = false
  remove.addEventListener('click', () => {
    if (!armed) {
      armed = true
      remove.textContent = `Delete ${worn.name}, her notes and her conversations?`
      remove.classList.add('arming')
      return
    }
    handlers.persona({ kind: 'delete', id: worn.id })
  })
  wrap.append(remove)
  return wrap
}

/**
 * The exact string she will be handed, not a summary of it.
 *
 * 1b's right-hand card is literally `instructionsFor`'s output, and main sends
 * it as one string for that reason — a card that re-assembled it here would be
 * a second place her prompt is built, and the two would drift the first time
 * either changed.
 */
export function assembledPanel(view: ShelfView): readonly HTMLElement[] {
  const head = element('div', 'row')
  head.append(
    element('h4', undefined, 'What she will be told'),
    element('span', 'grow'),
    element('span', 'meta', `${String(view.assembled.length)} chars`),
  )
  const body = element('pre')
  body.textContent = view.assembled
  const foot = element(
    'p',
    'note',
    'Assembled from the plates on the left, on her next wake. Nothing here is sent until then.',
  )
  return [head, body, foot]
}
