import { contextBridge, ipcRenderer } from 'electron'
import {
  isCompanionChannel,
  isHistoryChannel,
  type HistoryConversation,
  type HistoryHit,
  type HistoryTurn,
  type MochiApi,
  type MochiHistoryApi,
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

/**
 * Which document this is, from `additionalArguments`.
 *
 * ONE preload file for every window is the repository's rule, and the role is
 * how a single file serves two. It is read from the process arguments rather
 * than from the URL because a page can change its own URL and cannot change
 * these — the window that main constructed is the window that gets the API.
 */
const role = process.argv.find((one) => one.startsWith('--mochi-role='))?.slice(13) ?? 'companion'

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
  async search(query: string) {
    return (await ipcRenderer.invoke(
      guardHistory('history:search'),
      query,
    )) as readonly HistoryHit[]
  },
}

// One or the other, never both. The conversations window has no business
// minting a key, and the companion has no business reading a transcript --
// exposing both to both would make the two allowlists decorative.
if (role === 'history') contextBridge.exposeInMainWorld('mochiHistory', history)
else contextBridge.exposeInMainWorld('mochi', api)
