import type { LookupChange, MochiSettingsApi, Revealable, SettingsView } from '@shared/ipc'

declare global {
  interface Window {
    readonly mochiSettings: MochiSettingsApi
  }
}

/**
 * The window that means nobody has to open a text editor.
 *
 * `document.createElement` and `textContent`, never `innerHTML`. Some of what
 * is drawn here came out of a folder anybody can write to — a persona's name,
 * an avatar's — and showing that text to a person is safe where evaluating it
 * is not.
 *
 * Every change is sent one at a time and the view is re-read from main
 * afterwards. Nothing is kept in a local model that could disagree with the
 * files: the store is the truth, and a window that believed its own copy would
 * be the second place a persona lives.
 */

const who = document.querySelector('#who')
const lookup = document.querySelector('#lookup')
const note = document.querySelector('#note')
const capabilities = document.querySelector('#capabilities')
const folders = document.querySelector('#folders')
const said = document.querySelector('#said')
if (
  !(who instanceof HTMLElement) ||
  !(capabilities instanceof HTMLElement) ||
  !(lookup instanceof HTMLElement) ||
  !(note instanceof HTMLElement) ||
  !(folders instanceof HTMLElement) ||
  !(said instanceof HTMLElement)
) {
  throw new Error('settings: the document is not the one this expects')
}
const whoEl: HTMLElement = who
const capsEl: HTMLElement = capabilities
const lookupEl: HTMLElement = lookup
const noteEl: HTMLElement = note
const foldersEl: HTMLElement = folders
const saidEl: HTMLElement = said

/** Say what happened. Silence after a write reads as the write not landing. */
function say(text: string, bad = false): void {
  saidEl.textContent = text
  saidEl.classList.toggle('bad', bad)
}

function field(label: string, control: HTMLElement): HTMLElement {
  const row = document.createElement('div')
  row.className = 'field'
  const name = document.createElement('label')
  name.textContent = label
  row.append(name, control)
  return row
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

/** The persona being edited: whoever is worn. */
function renderWho(view: SettingsView): void {
  const worn = view.personas.find((p) => p.id === view.wornId) ?? view.personas[0]
  if (worn === undefined) {
    whoEl.textContent = 'No personas loaded.'
    return
  }

  const wearing = document.createElement('select')
  options(
    wearing,
    view.personas.map((p) => ({ value: p.id, label: p.name })),
    worn.id,
  )
  wearing.addEventListener('change', () => {
    // Wearing someone changes which conversations she can recall — the archive
    // is scoped per persona — so this is not a cosmetic switch and the message
    // says so.
    void window.mochiSettings.wear(wearing.value).then(async (result) => {
      if (!result.ok) return say(result.why, true)
      say('Wearing changed. She will be this persona from her next session.')
      await load()
    })
  })

  const name = document.createElement('input')
  name.type = 'text'
  name.value = worn.name
  const commitName = (): void => {
    if (name.value.trim() === worn.name) return
    void change({ id: worn.id, name: name.value })
  }
  name.addEventListener('change', commitName)

  const voice = document.createElement('select')
  options(
    voice,
    view.voices.map((v) => ({ value: v, label: v })),
    worn.voice,
  )
  voice.addEventListener('change', () => {
    void change({ id: worn.id, voice: voice.value })
  })

  const avatar = document.createElement('select')
  options(
    avatar,
    view.avatars.map((a) => ({
      // The built-in is stored as `null`; the empty string is only how a
      // `<select>` can carry that, and it is turned back at the boundary below.
      value: a.id ?? '',
      label: a.id ?? 'Built-in',
    })),
    worn.avatarId ?? '',
  )
  avatar.addEventListener('change', () => {
    void change({ id: worn.id, avatarId: avatar.value === '' ? null : avatar.value })
  })

  const bubble = document.createElement('input')
  bubble.type = 'checkbox'
  bubble.checked = worn.bubble
  bubble.id = 'bubble'
  bubble.addEventListener('change', () => {
    void change({ id: worn.id, bubble: bubble.checked })
  })
  const bubbleWrap = document.createElement('div')
  bubbleWrap.className = 'switch'
  const bubbleLabel = document.createElement('label')
  bubbleLabel.htmlFor = 'bubble'
  bubbleLabel.textContent = 'Show what she is saying above her head'
  bubbleWrap.append(bubble, bubbleLabel)

  whoEl.replaceChildren(
    field('Wearing', wearing),
    field('Name', name),
    field('Voice', voice),
    field('Face', avatar),
    field('Speech bubble', bubbleWrap),
  )

  if (worn.source !== null) {
    const note = document.createElement('p')
    note.className = 'note'
    note.textContent = `Saved to ${worn.source}`
    whoEl.append(note)
  }

  whoEl.append(personaActions(worn))
}

/**
 * Making, copying and removing characters.
 *
 * The whole shelf was read-only from here: you could wear somebody and edit
 * whoever was worn, and every way of getting a second persona onto the shelf —
 * or a first one off it — was a function with no caller.
 *
 * A NAME, never an id. The id is derived in main against what is already taken
 * AND what a pending deletion still reserves, because an id is what her memory
 * and her conversations are filed under: choosing one from here would be
 * choosing whose leftovers a new character inherits.
 */
function personaActions(worn: SettingsView['personas'][number]): HTMLElement {
  const wrap = document.createElement('div')
  wrap.className = 'actions'

  const name = document.createElement('input')
  name.type = 'text'
  name.placeholder = 'name'
  const named = (): string => name.value.trim()

  const make = document.createElement('button')
  make.type = 'button'
  make.textContent = 'New'
  make.addEventListener('click', () => {
    if (named() === '') return say('A new persona needs a name.', true)
    void doPersona({ kind: 'create', name: named() })
  })

  const copy = document.createElement('button')
  copy.type = 'button'
  copy.textContent = `Duplicate ${worn.name}`
  copy.addEventListener('click', () => {
    if (named() === '') return say('Give the copy a name first.', true)
    void doPersona({ kind: 'duplicate', name: named() })
  })

  wrap.append(name, make, copy)

  if (worn.source === null) {
    // The built-in has no file to delete. What somebody actually wants here is
    // her original prompt back, which lives in the source and not in this
    // window — so without this, editing her is a one-way door.
    const restore = document.createElement('button')
    restore.type = 'button'
    restore.textContent = 'Put the built-in back as she ships'
    restore.addEventListener('click', () => {
      void doPersona({ kind: 'restore-built-in' })
    })
    wrap.append(restore)
    return wrap
  }

  // TWO STEPS. This takes her notes and her conversations with her, and unlike
  // the note there is no one-step undo waiting behind it.
  const remove = document.createElement('button')
  remove.type = 'button'
  remove.textContent = `Delete ${worn.name}`
  let armed = false
  remove.addEventListener('click', () => {
    if (!armed) {
      armed = true
      remove.textContent = `Delete ${worn.name}, her notes and her conversations?`
      remove.classList.add('arming')
      return
    }
    void doPersona({ kind: 'delete', id: worn.id })
  })
  wrap.append(remove)
  return wrap
}

async function doPersona(action: Parameters<MochiSettingsApi['persona']>[0]): Promise<void> {
  const result = await window.mochiSettings.persona(action)
  if (!result.ok) {
    say(result.why, true)
    await load()
    return
  }
  say(
    action.kind === 'delete'
      ? 'Deleted. She is wearing the built-in now.'
      : action.kind === 'restore-built-in'
        ? 'The built-in is back as she ships.'
        : 'Made, and worn. She will be this persona from her next session.',
  )
  await load()
}

async function change(what: Parameters<MochiSettingsApi['save']>[0]): Promise<void> {
  const result = await window.mochiSettings.save(what)
  if (!result.ok) {
    say(result.why, true)
    // Re-read, so the control snaps back to what is actually stored rather than
    // sitting on a value that was refused.
    await load()
    return
  }
  say('Saved. It takes effect on her next session.')
  await load()
}

async function changeLookup(what: LookupChange): Promise<void> {
  const result = await window.mochiSettings.lookup(what)
  if (!result.ok) {
    say(result.why, true)
    // Re-read, so a refused control snaps back to what is actually stored
    // rather than sitting on a value nothing accepted.
    await load()
    return
  }
  say('Saved. It applies to her next lookup.')
  await load()
}

/**
 * How a lookup runs: where she reads, whether she may search, which profile.
 *
 * These were settable only by hand-editing `preferences.json` — a file nothing
 * documents — while the workspace is the thing that decides what she can read
 * at all. A capability nobody can point at a directory is a capability that
 * answers about an empty folder.
 */
function renderLookup(view: SettingsView): void {
  const workspace = document.createElement('input')
  workspace.type = 'text'
  workspace.value = view.lookup.workspace
  workspace.spellcheck = false
  workspace.addEventListener('change', () => {
    if (workspace.value.trim() === view.lookup.workspace) return
    void changeLookup({ workspace: workspace.value })
  })

  const search = document.createElement('select')
  options(
    search,
    view.lookup.webSearchModes.map((mode) => ({
      value: mode,
      // `follow` is not one of Codex's own values — it is the ABSENCE of the
      // flag, leaving whatever the machine is configured for in charge. Saying
      // so is the difference between a choice and a mystery.
      label: mode === 'follow' ? 'follow the machine' : mode,
    })),
    view.lookup.webSearch,
  )
  search.addEventListener('change', () => {
    void changeLookup({ webSearch: search.value })
  })

  const profile = document.createElement('input')
  profile.type = 'text'
  profile.value = view.lookup.profile ?? ''
  profile.spellcheck = false
  profile.placeholder = 'none'
  profile.addEventListener('change', () => {
    const name = profile.value.trim()
    void changeLookup({ profile: name === '' ? null : name })
  })

  lookupEl.replaceChildren(
    field('Workspace', workspace),
    field('Web search', search),
    field('Codex profile', profile),
  )

  if (view.lookup.workspaceIsDefault) {
    const note = document.createElement('p')
    note.className = 'note'
    note.textContent = 'Nobody has chosen one, so this is the default.'
    lookupEl.append(note)
  }
  if (view.lookup.profilePath !== null) {
    // The FILE is the thing somebody edits. "There is a profile, somewhere,
    // called something" is not an instruction anybody can follow.
    const note = document.createElement('p')
    note.className = 'note'
    const path = document.createElement('code')
    path.textContent = view.lookup.profilePath
    note.append('Settings for it live in ', path)
    lookupEl.append(note)
  }
}

/**
 * What she remembers, shown, with the one step back.
 *
 * `store/memory.ts` has said since it was written that "the settings window can
 * show what changed and the user can put it back". Until now it could not, and
 * a comment describing a window that does not exist is worse than no comment.
 *
 * The note is the one thing here a MODEL writes — `remember_this` when somebody
 * asks out loud — so it is the one thing that needs an undo at all.
 */
function renderNote(view: SettingsView): void {
  const body = document.createElement('pre')
  body.className = 'note-body'
  // `textContent`, like everywhere else here. This text came from a model and
  // from a file anybody can edit; showing it to a person is safe, evaluating it
  // is not.
  body.textContent =
    view.note.text === '' ? 'She has not written anything down about you yet.' : view.note.text
  if (view.note.text === '') body.classList.add('empty')

  const undo = document.createElement('button')
  undo.type = 'button'
  undo.textContent = 'Undo the last change'
  // Null means nothing has ever been rewritten. That is NOT the same as going
  // back to an empty note, which is a real version somebody may want.
  undo.disabled = view.note.previous === null
  undo.addEventListener('click', () => {
    void act({ kind: 'restore' })
  })

  // TWO STEPS rather than a dialog. This throws away something a person may
  // have spent months accumulating, and a button that does it on one click is a
  // button somebody hits by accident. It is undoable, and it should still ask.
  const forget = document.createElement('button')
  forget.type = 'button'
  forget.textContent = 'Forget everything'
  forget.disabled = view.note.text === ''
  let armed = false
  forget.addEventListener('click', () => {
    if (!armed) {
      armed = true
      forget.textContent = 'Really forget it all?'
      forget.classList.add('arming')
      return
    }
    void act({ kind: 'clear' })
  })

  const buttons = document.createElement('div')
  buttons.className = 'row'
  buttons.append(undo, forget)
  noteEl.replaceChildren(body, buttons)
}

async function act(action: Parameters<MochiSettingsApi['memory']>[0]): Promise<void> {
  const result = await window.mochiSettings.memory(action)
  if (!result.ok) {
    say(result.why, true)
    await load()
    return
  }
  say(action.kind === 'restore' ? 'Put back as it was.' : 'Forgotten.')
  await load()
}

function renderCapabilities(view: SettingsView): void {
  if (view.capabilities.length === 0) {
    capsEl.textContent = 'None.'
    return
  }
  capsEl.replaceChildren(
    ...view.capabilities.map((capability) => {
      const block = document.createElement('div')
      block.className = 'cap'
      const name = document.createElement('div')
      name.className = 'name'
      name.textContent = capability.name
      const desc = document.createElement('p')
      desc.className = 'desc'
      desc.textContent = capability.description
      block.append(name, desc)
      return block
    }),
  )
}

function renderFolders(view: SettingsView): void {
  const rows = (Object.keys(view.folders) as Revealable[]).map((kind) => {
    const row = document.createElement('div')
    row.className = 'folder'
    const left = document.createElement('div')
    const name = document.createElement('div')
    name.textContent = kind
    const path = document.createElement('code')
    path.textContent = view.folders[kind]
    left.append(name, path)
    const open = document.createElement('button')
    open.type = 'button'
    open.textContent = 'Show'
    // A KIND, never the path beside it. The string on screen is for reading.
    open.addEventListener('click', () => {
      window.mochiSettings.reveal(kind)
    })
    row.append(left, open)
    return row
  })
  foldersEl.replaceChildren(...rows)
}

async function load(): Promise<void> {
  const view = await window.mochiSettings.read()
  renderWho(view)
  renderCapabilities(view)
  renderLookup(view)
  renderNote(view)
  renderFolders(view)
}

/**
 * Read again whenever this window comes back.
 *
 * There are two ways to change who is worn — this window and the menu bar item
 * — and v1's note is explicit that one setting behind two entry points is how a
 * project ends up with two refresh paths that drift. They share one handler in
 * main; this is the other half, so a switch made on the tray is on screen here
 * the moment somebody looks.
 */
window.addEventListener('focus', () => {
  void load()
})

void load().catch((error: unknown) => {
  say(`Could not read your settings: ${String(error)}`, true)
})
