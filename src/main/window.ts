import { join } from 'node:path'
import { app, BrowserWindow, nativeTheme, screen } from 'electron'
import { FEET_FROM_TOP, WINDOW_H, WINDOW_W } from '@shared/avatar-layout'

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
/**
 * How far she rests from the corner she starts in.
 *
 * Measured to HER, not to her window. The window is `WINDOW_W` x `WINDOW_H` —
 * far larger than she is, because the bubble is drawn inside it and has to be
 * able to go above, below or beside her — so with her in a corner most of it
 * hangs off the display. Positioning the WINDOW with a margin would park her
 * hundreds of pixels inland.
 */
const MARGIN = 24

/**
 * Where she stands inside her own window: horizontally centred, feet at
 * `FEET_FROM_TOP`.
 *
 * A nominal body, because the window is created before the persona resolves and
 * therefore before her real size is known. It only decides where she FIRST
 * appears; a bigger avatar starts a little closer to the corner, which nobody
 * will notice and which one drag corrects for good.
 */
const NOMINAL = { width: 94, height: 73 }

export function createCompanionWindow(): BrowserWindow {
  const display = screen.getPrimaryDisplay().workArea
  const window = new BrowserWindow({
    width: WINDOW_W,
    height: WINDOW_H,
    /**
     * Created somewhere it FITS, then moved. This is not a style choice.
     *
     * macOS constrains a window at creation to be entirely on screen, and it
     * does so by SHRINKING it: asked for 980x560 at the bottom right, it
     * produced 882x504 — the same window at exactly 0.9 — because that is what
     * fits in the corner. Her window is deliberately larger than the screen
     * allows there, since the bubble is drawn inside it and has to have
     * somewhere to go.
     *
     * `setPosition` afterwards is NOT constrained, which is how the drag has
     * been putting her against an edge all along. So the window is born in the
     * corner of the work area, where it fits at full size, and moved to where
     * she actually belongs on the next line.
     */
    x: display.x,
    y: display.y,
    /**
     * Held back until the first paint, and safe to do so HERE only.
     *
     * The conversations window did exactly this and never opened: a hidden
     * window in an app that is never frontmost is never composited, so it never
     * paints and `ready-to-show` never fires. See `bringForward`.
     *
     * Hers is the exception, and not by luck — she is `alwaysOnTop` at
     * screen-saver level and marked visible on every workspace a few lines
     * below, which is what keeps her composited whatever has focus. A third
     * window copying this pattern without those two would hang the same way.
     */
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
      // NAMED, like the other two. The preload used to default to `companion`
      // when no role was passed, which meant the most privileged API in this
      // application was what a window got for saying nothing — so the bridge
      // failed open in exactly the direction it argues against. It refuses an
      // absent role now, and this is what keeps her own window working.
      additionalArguments: ['--mochi-role=companion'],
    },
  })

  // Logged because a transparent, frameless, taskbar-less window that fails to
  // appear looks exactly like one that appeared somewhere unexpected, and the
  // desktop may be several displays wide while `workArea` is one of them.
  const at = window.getBounds()
  console.log(
    `[window] ${at.width}x${at.height} at ${at.x},${at.y} on a ${display.width}x${display.height} work area`,
  )

  /**
   * Where she actually starts: bottom right, HER inset by a margin, with the
   * window's overhang hanging off the display. See the note on the size above
   * for why this is a move rather than a position.
   */
  window.setPosition(
    Math.round(display.x + display.width - MARGIN - (WINDOW_W + NOMINAL.width) / 2),
    Math.round(display.y + display.height - MARGIN - FEET_FROM_TOP),
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

/**
 * The shelf: her characters, and everything belonging to one.
 *
 * Named for what it holds. It was the conversations window and it still holds
 * them — the character half grew into it rather than into a fourth window,
 * because it already had the list-and-pane layout the shelf needs. The role
 * string is still `history`, which nobody sees; the title is what people read.
 *
 * An ordinary window, and every way it differs from hers is deliberate. It has
 * a frame, because it is a document and a document needs somewhere to grab. It
 * is opaque, resizable and NOT always on top, because it is something you open,
 * read and close — the opposite of furniture.
 *
 * `--mochi-role=history` is what makes the one preload file expose the
 * conversations API and not the voice one. Passed as an argument rather than
 * inferred from the URL, because a page can navigate itself and cannot rewrite
 * the arguments it was constructed with.
 *
 * Only ever one: a second copy of the same read-only list is clutter, and both
 * would go stale in different ways.
 */
let history: BrowserWindow | null = null

/**
 * Show it, and make sure it lands where the person who asked is looking.
 *
 * This window used to be created with `show: false` and shown from
 * `ready-to-show`, which is the pattern every Electron guide gives for avoiding
 * a white flash. **It never fired**, so the conversations window was created,
 * reported `isVisible()`, logged its bounds — and did not exist. Nobody had
 * ever seen it.
 *
 * The reason is this app's own shape. It runs as an accessory — `LSUIElement`
 * in the packaged bundle, `setActivationPolicy('accessory')` in development —
 * so that she can sit on the desktop without being an app you switch to. An
 * accessory app is never frontmost, a hidden window in a background app is
 * never composited, and a window that is never composited never paints. So the
 * event that was waiting for the first paint waited for ever.
 *
 * The window is therefore created already shown, with a background colour that
 * matches the document. That is what `ready-to-show` was avoiding — a white
 * rectangle for one frame — and setting the colour avoids it without depending
 * on an event that this app cannot rely on.
 *
 * `focus({ steal: true })` is what makes an accessory app frontmost. Without it
 * the window opens behind whatever is in front, on an app that cannot be
 * activated by clicking it, and the only way back is the control on her bubble.
 */
function bringForward(window: BrowserWindow): void {
  becomeOrdinary(window)
  window.show()
  if (process.platform === 'darwin') app.focus({ steal: true })
  window.focus()
  /**
   * Logged HERE, not at the call sites, because there are two of each now — a
   * control on her bubble and an item in the menu bar.
   *
   * The line used to live in the IPC handler, so opening a window from the tray
   * said nothing at all. "Nothing happened" has two readings — the click never
   * arrived, or the window opened somewhere unexpected — and they need
   * completely different fixes. One of them being silent is how they become
   * indistinguishable.
   */
  const at = window.getBounds()
  console.log(`[window] ${window.getTitle()} ${at.width}x${at.height} at ${at.x},${at.y}`)
}

/**
 * An app with real windows open is a real app, and stops being one when they
 * close.
 *
 * The accessory policy is what keeps her out of the Dock and out of the app
 * switcher — she is furniture, not something you alt-tab to. The cost, once
 * there was a second window, is that **an accessory app cannot be raised by
 * clicking it**: no Dock icon, no switcher entry, and clicking its window does
 * not activate an app that is not allowed to activate. Both real windows went
 * behind the first thing that took focus and could not be got back except by
 * clicking the control on her bubble again.
 *
 * So the policy follows the windows. While an ordinary one is open the app is
 * `regular` and behaves like anything else on the desktop; when the last closes
 * it goes back to `accessory` and the Dock icon disappears with it. Her own
 * window never counts — it is `alwaysOnTop` on every workspace and was never
 * the thing that needed raising.
 */
const ordinary = new Set<BrowserWindow>()

function becomeOrdinary(window: BrowserWindow): void {
  if (process.platform !== 'darwin') return
  if (ordinary.has(window)) return
  ordinary.add(window)
  app.setActivationPolicy('regular')
  window.on('closed', () => {
    ordinary.delete(window)
    // Furniture again, the moment the last real window is gone.
    if (ordinary.size === 0) app.setActivationPolicy('accessory')
  })
}

export function showHistoryWindow(): BrowserWindow {
  if (history !== null && !history.isDestroyed()) {
    // Raise the one that exists rather than opening another.
    if (history.isMinimized()) history.restore()
    bringForward(history)
    return history
  }

  /**
   * 1440 x 900, from the handoff — clamped to whatever display this is.
   *
   * The design assumes a large always-open window and the layout needs the
   * width: a 1fr/380px body with a row of 236px cards above it. But 1440 is
   * wider than the work area on a 13" laptop, and macOS answers a too-large
   * window by SHRINKING it at creation — the same behaviour her own window
   * works around — which would silently produce a size nobody chose. Asking for
   * what fits is the honest version of the same outcome.
   */
  const work = screen.getPrimaryDisplay().workArea
  const window = new BrowserWindow({
    width: Math.min(1440, work.width),
    height: Math.min(900, work.height),
    minWidth: 900,
    minHeight: 560,
    // Shown from the start — see `bringForward` for why waiting for the first
    // paint never returns here. The colour is what `ready-to-show` was for.
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1c1d1a' : '#f7f6f1',
    title: 'Shelf',
    // Her window hides from this; this one belongs in it.
    skipTaskbar: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: ['--mochi-role=history'],
    },
  })
  history = window
  window.on('closed', () => {
    history = null
  })
  bringForward(window)

  const devServerUrl = process.env.ELECTRON_RENDERER_URL
  if (devServerUrl === undefined) {
    void window.loadFile(join(__dirname, '../renderer/history/index.html'))
  } else {
    void window.loadURL(`${devServerUrl}/history/index.html`)
  }
  return window
}

/**
 * The one place a person can change who she is without opening a text editor.
 *
 * A third window rather than a third pane in the conversations one. They are
 * genuinely different jobs — that window is a reader of a person's own words,
 * this one writes to the persona those words are filed under — and they have
 * different allowlists for exactly that reason. Sharing a document would make
 * the split decorative.
 */
let settings: BrowserWindow | null = null

export function showSettingsWindow(): BrowserWindow {
  if (settings !== null && !settings.isDestroyed()) {
    if (settings.isMinimized()) settings.restore()
    bringForward(settings)
    return settings
  }

  const window = new BrowserWindow({
    // 780 x 620, from the handoff. The nav column is 196 and the pane's
    // reading measure is 62ch, which is what that width is for.
    width: 780,
    height: 620,
    minWidth: 620,
    minHeight: 420,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1c1d1a' : '#f7f6f1',
    title: 'Settings',
    skipTaskbar: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: ['--mochi-role=settings'],
    },
  })
  settings = window
  window.on('closed', () => {
    settings = null
  })
  // Shown at once, for the reason `bringForward` gives at length: waiting for a
  // first paint in an accessory app is waiting for something that never comes.
  bringForward(window)

  const devServerUrl = process.env.ELECTRON_RENDERER_URL
  if (devServerUrl === undefined) {
    void window.loadFile(join(__dirname, '../renderer/settings/index.html'))
  } else {
    void window.loadURL(`${devServerUrl}/settings/index.html`)
  }
  return window
}
