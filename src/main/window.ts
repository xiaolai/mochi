import { join } from 'node:path'
import { BrowserWindow } from 'electron'

export function createCompanionWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 360,
    height: 360,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // All three, and none of them is optional. Drop any one and the allowlist
      // in `@shared/ipc` becomes decorative, because page content could reach
      // IPC without passing through the bridge that enforces it.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  // Show once there is something to show, so a launch is never a white rectangle
  // that then repaints into the real thing.
  window.once('ready-to-show', () => {
    window.show()
  })

  // `ELECTRON_RENDERER_URL` is set by `electron-vite dev` and absent in a build,
  // which is what distinguishes the two. Checked against `undefined` rather than
  // for truthiness so an empty value fails loudly here instead of silently
  // loading the packaged document while claiming to be in development.
  const devServerUrl = process.env.ELECTRON_RENDERER_URL
  if (devServerUrl === undefined) {
    void window.loadFile(join(__dirname, '../renderer/companion/index.html'))
  } else {
    void window.loadURL(`${devServerUrl}/companion/index.html`)
  }

  return window
}
