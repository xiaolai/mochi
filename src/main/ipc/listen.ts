import { ipcMain } from 'electron'

/**
 * Register a one-way renderer channel, with the guard `ipcMain.on` does not
 * give you.
 *
 * ## Why `on` is different from `handle`
 *
 * `ipcMain.handle` returns a promise to the renderer, so a throw inside it
 * becomes a rejection the caller sees — unpleasant, but contained and
 * reportable. `ipcMain.on` has nowhere to put one. The listener is invoked
 * from Electron's event loop, so an exception escapes into the main process
 * with no frame above it that knows what it was doing.
 *
 * Before this, **eleven of the twelve** `ipcMain.on` listeners in this app
 * were unguarded. Every one of them calls into something that genuinely
 * throws: the archive, the persona store, `webContents.send` on a window that
 * can die mid-call. The audit that produced this found the gap while checking
 * a fix that claimed to have closed it for one channel — validating a payload
 * and guarding a listener are different things, and a valid payload still
 * reaches code that can fail.
 *
 * ## Why it does not rethrow
 *
 * There is nothing above to catch it and no answer owed to the renderer: these
 * channels are fire-and-forget by construction. Reporting is the entire
 * remedy, and it is a real one — `problems` is what the companion's indicator
 * and the settings pane both read.
 *
 * The `uncaughtException` handler in `index.ts` would also catch these. That
 * is a backstop for paths nobody thought of; this is the path, and a report
 * naming the channel is worth more than one naming the process.
 */
/**
 * Curried on the reporter, so a registration reads exactly as `ipcMain.on` did.
 *
 * Passing `note` per call was the first shape and it cost fifty lines: a third
 * argument pushes every one of these registrations past the line limit, so
 * prettier reflows twelve multi-line handlers and the file grows by more than
 * the guard is worth. Binding it once keeps the call sites identical to what
 * they replaced, which is also what makes the change reviewable.
 */
export function listener(
  note: (channel: string, detail: string) => void,
): (
  channel: string,
  handler: (event: Electron.IpcMainEvent, ...args: readonly unknown[]) => void,
) => void {
  return (channel, handler) => {
    ipcMain.on(channel, (event, ...args: unknown[]) => {
      try {
        handler(event, ...args)
      } catch (error: unknown) {
        console.error(`[ipc] ${channel} threw:`, error)
        note(channel, `a message from a window could not be handled: ${String(error)}`)
      }
    })
  }
}
