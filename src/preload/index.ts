import { contextBridge, ipcRenderer } from 'electron'
import {
  isCompanionChannel,
  isSettingsChannel,
  isShelfChannel,
  type HistoryConversation,
  type HistoryHit,
  type HistoryExport,
  type HistoryProblem,
  type HistoryTurn,
  type MochiApi,
  type MochiHistoryApi,
  type MochiSettingsApi,
  type GrantChange,
  type LookupChange,
  type NoteAction,
  type PersonaAction,
  type PersonaChange,
  type Revealable,
  type ScreenChange,
  type SettingsView,
  type SettingsWrite,
  type SessionConfig,
  type ShelfView,
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

function guardShelf(channel: string): string {
  if (!isShelfChannel(channel)) throw new Error(`refusing unknown channel: ${channel}`)
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
 * how a single file serves three. It is read from the process arguments rather
 * than from the URL because a page can change its own URL and cannot change
 * these — the window that main constructed is the window that gets the API.
 *
 * **No default.** This used to fall back to `companion`, which is the most
 * privileged role there is — it mints credentials and exchanges SDP offers —
 * so a window constructed without the argument received the voice bridge. The
 * note below already said a default that widens authority is the wrong
 * direction for a default to fail in; it was true of the unrecognised case and
 * not of the missing one, which is the same hole with a different shape. Her
 * own window now passes the argument like the other two.
 */
const role = process.argv.find((one) => one.startsWith('--mochi-role='))?.slice(13) ?? ''

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
    const channel = guard('voice:send')
    const listener = (_event: unknown, frame: unknown): void => {
      handle(frame)
    }
    ipcRenderer.on(channel, listener)
    // The way back off. `ipcRenderer.on` has no lifetime of its own, so without
    // this every session ever opened stayed subscribed — and each one holds a
    // peer connection and a data channel in its closure.
    return () => {
      ipcRenderer.removeListener(channel, listener)
    }
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
  fit(request: {
    pad: { left: number; top: number; right: number; bottom: number }
    body: { left: number; top: number; width: number; height: number }
    at: { x: number; y: number }
  }) {
    ipcRenderer.send(guard('companion:fit'), request)
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
    return (await ipcRenderer.invoke(guardShelf('history:list'))) as {
      persona: string
      conversations: readonly HistoryConversation[]
    }
  },
  async turns(token: string) {
    return (await ipcRenderer.invoke(guardShelf('history:turns'), token)) as readonly HistoryTurn[]
  },
  async problems() {
    return (await ipcRenderer.invoke(guardShelf('history:problems'))) as readonly HistoryProblem[]
  },
  settings() {
    ipcRenderer.send(guardShelf('history:settings'))
  },
  onShow(run: (place: string) => void) {
    // The value is passed through as a plain string and checked by the shell,
    // not here: the bridge's job is the channel, and what counts as a place is
    // the window's business.
    ipcRenderer.on(guardShelf('shell:show'), (_event, place: unknown) => {
      if (typeof place === 'string') run(place)
    })
  },
  async exportAll() {
    return (await ipcRenderer.invoke(guardShelf('history:export'))) as HistoryExport
  },
  async search(query: string) {
    return (await ipcRenderer.invoke(guardShelf('history:search'), query)) as readonly HistoryHit[]
  },
  async shelf() {
    return (await ipcRenderer.invoke(guardShelf('shelf:read'))) as ShelfView
  },
  async wear(id: string) {
    return (await ipcRenderer.invoke(guardShelf('shelf:wear'), id)) as SettingsWrite
  },
  async saveCharacter(change: PersonaChange) {
    return (await ipcRenderer.invoke(guardShelf('shelf:save'), change)) as SettingsWrite
  },
  async character(action: PersonaAction) {
    return (await ipcRenderer.invoke(guardShelf('shelf:persona'), action)) as SettingsWrite
  },
  async memory(action: NoteAction) {
    return (await ipcRenderer.invoke(guardShelf('shelf:memory'), action)) as SettingsWrite
  },
}

const settings: MochiSettingsApi = {
  async read() {
    return (await ipcRenderer.invoke(guardSettings('settings:read'))) as SettingsView
  },
  reveal(what: Revealable) {
    ipcRenderer.send(guardSettings('settings:reveal'), what)
  },
  async lookup(change: LookupChange) {
    return (await ipcRenderer.invoke(guardSettings('settings:lookup'), change)) as SettingsWrite
  },
  async screen(change: ScreenChange) {
    return (await ipcRenderer.invoke(guardSettings('settings:screen'), change)) as SettingsWrite
  },
  async grant(change: GrantChange) {
    return (await ipcRenderer.invoke(guardSettings('settings:grant'), change)) as SettingsWrite
  },
}

// One of the three, never more than one. The conversations window has no
// business minting a key, the companion has no business reading a transcript,
// and neither has any business rewriting who she is -- exposing every API to
// every document would make all three allowlists decorative.
if (!ROLES.has(role)) {
  // Loud, and empty. Silence here would present as a page whose API is simply
  // undefined, which reads as a bug in the page rather than a refusal. An empty
  // string is the ABSENT case, and it lands here rather than on the companion.
  console.error(`[preload] refusing to expose any API: unknown role "${role}"`)
} else if (role === 'history') {
  /*
    ONE window now, so one role gets both APIs — and that is a real widening,
    stated rather than slipped in.
    
    `history` is the role string the shell window is constructed with. The name
    predates the window growing character cards and then absorbing settings;
    renaming it would rename a string nobody sees in three files.
    
    What this ADDS is that the document showing a transcript can also change a
    grant. The two were separate on defence-in-depth grounds, and folding them
    is the cost of the merge: they are one window, and a window cannot have two
    preload roles.
    
    What it does NOT add is the thing that argument was really about.
    `COMPANION_CHANNELS` stays its own list, so no window that draws a
    transcript can mint a key or exchange an SDP offer — which is the sentence
    `@shared/ipc` uses to justify separate allowlists, and it is still true.
  */
  contextBridge.exposeInMainWorld('mochiHistory', history)
  contextBridge.exposeInMainWorld('mochiSettings', settings)
} else {
  contextBridge.exposeInMainWorld('mochi', api)
}
