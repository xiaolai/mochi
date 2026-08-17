import { contextBridge, ipcRenderer } from 'electron'
import { isCompanionChannel, type MochiApi, type VoiceReport } from '@shared/ipc'

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

const api: MochiApi = {
  async open() {
    return (await ipcRenderer.invoke(guard('voice:open'))) as Awaited<ReturnType<MochiApi['open']>>
  },
  async sdp(offer: string) {
    return (await ipcRenderer.invoke(guard('voice:sdp'), offer)) as Awaited<
      ReturnType<MochiApi['sdp']>
    >
  },
  async tools() {
    return (await ipcRenderer.invoke(guard('voice:tools'))) as readonly unknown[]
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
}

contextBridge.exposeInMainWorld('mochi', api)
