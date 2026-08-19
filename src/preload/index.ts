import { contextBridge, ipcRenderer } from 'electron'
import {
  isCompanionChannel,
  isHistoryChannel,
  isSettingsChannel,
  type HistoryConversation,
  type HistoryHit,
  type HistoryExport,
  type HistoryProblem,
  type HistoryTurn,
  type MochiApi,
  type MochiHistoryApi,
  type MochiSettingsApi,
  type LookupChange,
  type NoteAction,
  type PersonaAction,
  type PersonaChange,
  type Revealable,
  type SettingsView,
  type SettingsWrite,
  type SessionConfig,
  type VoiceReport,
} from '@shared/ipc'

/**
 * The only path between the page and the main process.
 *
 * `ipcRenderer` is deliberately not forwarded wholesale. Exposing it would hand
 * the page every channel Electron knows about, including internal ones main
 * never registered. What crosses is this object and nothing else.
 *
 * Every channel name is checked against the allowlist here as well as main-side.
 * The types say it cannot be wrong; the types do not survive the boundary,
 * because the caller is a web page and its compiler is not ours.
 */
function guard(channel: string): string {
  if (!isCompanionChannel(channel)) throw new Error(`refusing unknown channel: ${channel}`)
  return channel
}

function guardHistory(channel: string): string {
  if (!isHistoryChannel(channel)) throw new Error(`refusing unknown channel: ${channel}`)
  return channel
}

function guardSettings(channel: string): string {
  if (!isSettingsChannel(channel)) throw new Error(`refusing unknown channel: ${channel}`)
  return channel
}

/**
 * Which document this is, from `additionalArguments`.
 *
 * ONE preload file for every window is the repository's rule, and the role is
 * how a single file serves two. It is read from the process arguments rather
 * than from the URL because a page can change its own URL and cannot change
 * these — the window that main constructed is the window that gets the API.
 */
const role = process.argv.find((one) => one.startsWith('--mochi-role='))?.slice(13) ?? 'companion'

/**
 * Exactly the roles this application constructs. Anything else gets NOTHING.
 *
 * This used to be `if (history) … else companion`, so an unrecognised role fell
 * through to the **privileged** API — the one that mints keys and exchanges SDP
 * offers. A default that widens authority is the wrong direction for a default
 * to fail in, and it becomes load-bearing the moment a third window exists:
 * a capability runner whose role string is misspelt would receive the voice
 * bridge rather than nothing at all.
 */
const ROLES = new Set(['companion', 'history', 'settings'])

const api: MochiApi = {
  async open() {
    return (await ipcRenderer.invoke(guard('voice:open'))) as Awaited<ReturnType<MochiApi['open']>>
  },
  async sdp(offer: string) {
    return (await ipcRenderer.invoke(guard('voice:sdp'), offer)) as Awaited<
      ReturnType<MochiApi['sdp']>
    >
  },
  async config() {
    return (await ipcRenderer.invoke(guard('voice:config'))) as SessionConfig
  },
  call(name: string, callId: string, args: string) {
    ipcRenderer.send(guard('voice:call'), name, callId, args)
  },
  report(event: VoiceReport) {
    ipcRenderer.send(guard('voice:report'), event)
  },
  onSend(handle: (frame: unknown) => void) {
    ipcRenderer.on(guard('voice:send'), (_event, frame: unknown) => handle(frame))
  },
  history() {
    ipcRenderer.send(guard('history:open'))
  },
  copy(text: string) {
    ipcRenderer.send(guard('clipboard:write'), text)
  },
  menu() {
    ipcRenderer.send(guard('companion:menu'))
  },
  wake() {
    ipcRenderer.send(guard('companion:wake'))
  },
  body(box: { left: number; top: number; width: number; height: number }) {
    ipcRenderer.send(guard('companion:body'), box)
  },
  sides(available: readonly string[], using: string) {
    ipcRenderer.send(guard('companion:sides'), { available, using })
  },
  grab(offsetX: number, offsetY: number) {
    ipcRenderer.send(guard('companion:grab'), { offsetX, offsetY })
  },
  drop() {
    ipcRenderer.send(guard('companion:drop'))
  },
}

const history: MochiHistoryApi = {
  async list() {
    return (await ipcRenderer.invoke(guardHistory('history:list'))) as {
      persona: string
      conversations: readonly HistoryConversation[]
    }
  },
  async turns(token: string) {
    return (await ipcRenderer.invoke(
      guardHistory('history:turns'),
      token,
    )) as readonly HistoryTurn[]
  },
  async problems() {
    return (await ipcRenderer.invoke(guardHistory('history:problems'))) as readonly HistoryProblem[]
  },
  settings() {
    ipcRenderer.send(guardHistory('history:settings'))
  },
  async exportAll() {
    return (await ipcRenderer.invoke(guardHistory('history:export'))) as HistoryExport
  },
  async search(query: string) {
    return (await ipcRenderer.invoke(
      guardHistory('history:search'),
      query,
    )) as readonly HistoryHit[]
  },
}

const settings: MochiSettingsApi = {
  async read() {
    return (await ipcRenderer.invoke(guardSettings('settings:read'))) as SettingsView
  },
  async wear(id: string) {
    return (await ipcRenderer.invoke(guardSettings('settings:wear'), id)) as SettingsWrite
  },
  async save(change: PersonaChange) {
    return (await ipcRenderer.invoke(guardSettings('settings:save'), change)) as SettingsWrite
  },
  reveal(what: Revealable) {
    ipcRenderer.send(guardSettings('settings:reveal'), what)
  },
  async lookup(change: LookupChange) {
    return (await ipcRenderer.invoke(guardSettings('settings:lookup'), change)) as SettingsWrite
  },
  async memory(action: NoteAction) {
    return (await ipcRenderer.invoke(guardSettings('settings:memory'), action)) as SettingsWrite
  },
  async persona(action: PersonaAction) {
    return (await ipcRenderer.invoke(guardSettings('settings:persona'), action)) as SettingsWrite
  },
}

// One of the three, never more than one. The conversations window has no
// business minting a key, the companion has no business reading a transcript,
// and neither has any business rewriting who she is -- exposing every API to
// every document would make all three allowlists decorative.
if (!ROLES.has(role)) {
  // Loud, and empty. Silence here would present as a page whose API is simply
  // undefined, which reads as a bug in the page rather than a refusal.
  console.error(`[preload] refusing to expose any API: unknown role "${role}"`)
} else if (role === 'history') {
  contextBridge.exposeInMainWorld('mochiHistory', history)
} else if (role === 'settings') {
  contextBridge.exposeInMainWorld('mochiSettings', settings)
} else {
  contextBridge.exposeInMainWorld('mochi', api)
}
