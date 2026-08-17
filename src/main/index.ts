import { app, BrowserWindow, ipcMain } from 'electron'
import type { CompanionChannel } from '@shared/ipc'
import { createCompanionWindow } from './window'

// The same string as `appId` in `electron-builder.yml`. Two spellings of an
// application's identity is how a notification arrives attributed to nothing and
// a taskbar grows a second entry for the app that is already running.
const APP_USER_MODEL_ID = 'com.mochi.companion'

app.setAppUserModelId(APP_USER_MODEL_ID)

// `LSUIElement` in `electron-builder.yml` covers the packaged bundle; this covers
// `pnpm dev`, where there is no plist to read. Both are needed, and they are not
// redundant: the plist stops a Dock icon existing before this line runs, and this
// line is the only thing keeping it hidden in development.
if (process.platform === 'darwin') {
  app.setActivationPolicy('accessory')
}

// Registered by a name checked against the shared list rather than by a bare
// literal: `satisfies` makes a channel renamed in `@shared/ipc` a compile error
// here, instead of leaving main quietly answering a name nobody calls any more.
ipcMain.handle('companion:ping' satisfies CompanionChannel, () => 'pong')

void app.whenReady().then(
  () => {
    createCompanionWindow()

    // macOS keeps the process alive after the last window closes, so activating
    // the app has to be able to bring one back.
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createCompanionWindow()
    })
  },
  (error: unknown) => {
    // Fail loud. A main process that dies quietly during startup looks exactly
    // like one that is still working on it.
    console.error('[main] startup failed', error)
    app.exit(1)
  },
)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
