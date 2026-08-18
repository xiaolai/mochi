import type { MochiSettingsApi, Revealable, SettingsView } from '@shared/ipc'

declare global {
  interface Window {
    readonly mochiSettings: MochiSettingsApi
  }
}

/**
 * The window that means nobody has to open a text editor.
 *
 * `document.createElement` and `textContent`, never `innerHTML`. Half of what
 * is drawn here came out of a folder anybody can write to — a persona's name, a
 * refused capability's description — and this is the one surface that shows
 * that text at all. Showing it to a person is safe; evaluating it is not.
 *
 * Every change is sent one at a time and the view is re-read from main
 * afterwards. Nothing is kept in a local model that could disagree with the
 * files: the store is the truth, and a window that believed its own copy would
 * be the second place a persona lives.
 */

const who = document.querySelector('#who')
const capabilities = document.querySelector('#capabilities')
const folders = document.querySelector('#folders')
const said = document.querySelector('#said')
if (
  !(who instanceof HTMLElement) ||
  !(capabilities instanceof HTMLElement) ||
  !(folders instanceof HTMLElement) ||
  !(said instanceof HTMLElement)
) {
  throw new Error('settings: the document is not the one this expects')
}
const whoEl: HTMLElement = who
const capsEl: HTMLElement = capabilities
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

function renderCapabilities(view: SettingsView): void {
  if (view.capabilities.length === 0) {
    capsEl.textContent = 'None.'
    return
  }
  capsEl.replaceChildren(
    ...view.capabilities.map((capability) => {
      const block = document.createElement('div')
      block.className = `cap ${capability.state}`
      const name = document.createElement('div')
      name.className = 'name'
      name.textContent = capability.name
      const desc = document.createElement('p')
      desc.className = 'desc'
      desc.textContent = capability.description
      block.append(name, desc)
      if (capability.why !== null) {
        const why = document.createElement('p')
        why.className = 'why'
        why.textContent = capability.why
        block.append(why)
      }
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
  renderFolders(view)
}

void load().catch((error: unknown) => {
  say(`Could not read your settings: ${String(error)}`, true)
})
