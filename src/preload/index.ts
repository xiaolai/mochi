import { contextBridge, ipcRenderer } from 'electron'
import { isCompanionChannel, type CompanionChannel, type MochiApi } from '@shared/ipc'

/**
 * The only path between the page and the main process.
 *
 * `ipcRenderer` is deliberately not forwarded wholesale. Exposing it would hand
 * the page every channel Electron knows about, including internal ones main
 * never registered. What crosses is this object and nothing else.
 */
const api: MochiApi = {
  async invoke(channel: CompanionChannel): Promise<unknown> {
    if (!isCompanionChannel(channel)) {
      // The type says this cannot happen. The type does not survive the
      // boundary, because the caller is a web page and its compiler is not ours.
      throw new Error(`refusing unknown channel: ${String(channel)}`)
    }
    return (await ipcRenderer.invoke(channel)) as unknown
  },
}

contextBridge.exposeInMainWorld('mochi', api)
