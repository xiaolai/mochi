import { join } from 'node:path'
import { BrowserWindow, screen } from 'electron'

/**
 * Her window: a shape on the desktop, not a rectangle with her inside it.
 *
 * ## Transparent, frameless, always on top — and click-through by default
 *
 * The window is a square of empty pixels with a mochi drawn somewhere in it.
 * Without `setIgnoreMouseEvents` the invisible corners still swallow clicks, so
 * she would be a transparent brick sitting over whatever is underneath — and
 * the failure is silent, because nothing looks wrong.
 *
 * `forward: true` matters as much as the flag. It lets the renderer keep
 * receiving `mousemove` while clicks pass through, which is what makes the
 * gaze follow the cursor and what lets the renderer say "the pointer is on her
 * now, take the mouse back". Without it she would be either always clickable or
 * blind.
 *
 * ## `visibleOnAllWorkspaces` and the screen-saver level
 *
 * A companion that vanishes when you switch desktops is a companion you stop
 * believing is there. `screen-saver` is the level above a normal always-on-top
 * window; a plain one loses to full-screen apps, which is precisely when
 * somebody is most likely to be working.
 */

/** Big enough for the widest frame she can reach, in CSS pixels. */
const SIZE = 320

export function createCompanionWindow(): BrowserWindow {
  const display = screen.getPrimaryDisplay().workArea
  const window = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    // Bottom right, inset by a margin. Somewhere out of the way, and where the
    // Dock is not — she starts where nothing else lives.
    x: display.x + display.width - SIZE - 24,
    y: display.y + display.height - SIZE - 24,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    hasShadow: false,
    // Not in the window list and not in the app switcher. She is furniture.
    skipTaskbar: true,
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

  // Logged because a transparent, frameless, taskbar-less window that fails to
  // appear looks exactly like one that appeared somewhere unexpected, and the
  // desktop may be several displays wide while `workArea` is one of them.
  const at = window.getBounds()
  console.log(
    `[window] ${at.width}x${at.height} at ${at.x},${at.y} on a ${display.width}x${display.height} work area`,
  )

  window.setAlwaysOnTop(true, 'screen-saver')
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  // Click-through until the renderer says the pointer is actually on her.
  // `forward` keeps `mousemove` arriving so it can tell.
  window.setIgnoreMouseEvents(true, { forward: true })

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
