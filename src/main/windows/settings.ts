import { BrowserWindow, app, nativeImage } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { ROLE_FLAG } from '@shared/ipc'
import { forwardConsole, loadRenderer, sealNavigation } from './renderer-entry'

/**
 * The settings window: one at a time, focused if it already exists.
 *
 * A singleton because the alternative is two windows editing one persona, where
 * whichever is saved last silently discards the other's edits. Holding the
 * reference here rather than in `index.ts` keeps that guarantee next to the
 * code that could break it.
 */
let win: BrowserWindow | null = null

/**
 * The window's own icon, for platforms that take one from the window.
 *
 * Windows draws the taskbar icon from `BrowserWindow`'s `icon`, falling back to
 * the EXECUTABLE's icon when none is given -- which is why the settings window
 * appeared in the taskbar as Electron's logo. The companion window never showed
 * the problem because it is `skipTaskbar`.
 *
 * A different asset from either macOS one, deliberately: Windows applies no
 * mask, so the full-bleed square meant for the macOS bundle would render as a
 * solid colour block beside neighbours that are all logos on transparency.
 */
function windowIcon(): string | null {
  if (process.platform === 'darwin') return null
  const path = app.isPackaged
    ? join(process.resourcesPath, 'icons', 'window-256.png')
    : join(__dirname, '../../resources/icons/window-256.png')
  // Cosmetic, so absent is not fatal -- unlike the tray, where an invisible
  // icon is an app you cannot quit.
  if (!existsSync(path)) {
    console.warn(`[settings] no window icon at ${path} — run \`pnpm icons\``)
    return null
  }
  return path
}

/**
 * Her app icon, for the Dock tile.
 *
 * The SAME generated asset the tray mark comes from, so there is one graphical
 * source and no fourth place her likeness is drawn. Only needed unpackaged: a
 * packaged app takes its tile from the bundle, while `electron .` shows the
 * generic Electron logo -- which is what appeared the first time the settings
 * window brought a tile with it.
 */
function dockIcon(): Electron.NativeImage | null {
  if (app.isPackaged) return null
  // The PRE-MASKED tile, not the full-bleed one: an image handed straight to
  // the Dock is not promised the system's squircle crop, and a full-bleed square
  // would show as a square. See scripts/make-icons.ts.
  const path = join(__dirname, '../../resources/icons/dock.png')
  // Absent is not fatal here, unlike the tray. A missing Dock icon is a
  // cosmetic fallback to Electron's own; a missing tray icon is an app with no
  // way to quit it.
  if (!existsSync(path)) {
    console.warn(`[settings] no dock icon at ${path} — run \`pnpm icons\``)
    return null
  }
  const image = nativeImage.createFromPath(path)
  return image.isEmpty() ? null : image
}

/**
 * Become an ordinary application while a real window is open, and furniture
 * again when it closes.
 *
 * The app runs as `accessory` so SHE has no Dock tile and no Cmd-Tab entry --
 * she is furniture, not something you switch to. A settings window inherits
 * that and should not: with no Dock tile and no Cmd-Tab entry, the moment it
 * falls behind another application the tray is the only way back to it, and a
 * window you cannot raise reads as a window that has closed itself.
 *
 * This is the ordinary menu-bar-app pattern, and it is confined to macOS
 * because no other platform has the concept -- elsewhere `skipTaskbar` on the
 * companion already does the equivalent, per window rather than per process.
 */
function setActivation(regular: boolean): void {
  if (process.platform !== 'darwin') return
  app.setActivationPolicy(regular ? 'regular' : 'accessory')
  if (regular) {
    const icon = dockIcon()
    // Set on every open rather than once at startup: `accessory` has no tile to
    // put an icon on, so a call made before the first switch to `regular` is
    // silently discarded.
    if (icon !== null) app.dock?.setIcon(icon)
  }
  // Switching TO regular does not by itself bring the app forward; without
  // this the Dock tile appears while the window stays behind whatever had
  // focus, which is the confusing half of the transition rather than the fix.
  if (regular) app.focus({ steal: true })
}

/**
 * The window on record, if it is still real.
 *
 * `win && !win.isDestroyed() ? win : null` was written out four times -- here,
 * in `settingsWindow`, in `closeSettings` and in the load handler. Four copies
 * of a liveness check is three chances to write `win !== null` and forget that
 * a destroyed BrowserWindow is not null, it is a husk whose every method
 * throws.
 */
function live(): BrowserWindow | null {
  return win !== null && !win.isDestroyed() ? win : null
}

export function openSettings(rendererUrl: string | null): BrowserWindow {
  const existing = live()
  if (existing) {
    setActivation(true)
    // Show BEFORE focus: focusing a minimised window on macOS leaves it
    // minimised and steals the active app, so the click appears to do nothing.
    existing.show()
    existing.focus()
    return existing
  }

  const created = build()
  win = created
  wire(created, rendererUrl)
  return created
}

/**
 * The window itself, and nothing about singletons or loading.
 *
 * Split out because `openSettings` was one 70-line function doing four
 * unrelated things -- resolving the singleton, constructing a window,
 * switching the app's activation policy, and starting a load with its own
 * failure path -- so the interesting part, which is the singleton rule, was
 * buried in forty lines of `BrowserWindow` options.
 */
function build(): BrowserWindow {
  const icon = windowIcon()
  return new BrowserWindow({
    // 780 x 620, per the design's 2b. The old 520 x 640 was a single scrolling
    // column; a nav column beside a pane needs the width, and needs less height
    // because only the pane scrolls.
    width: 780,
    height: 620,
    minWidth: 640,
    minHeight: 480,
    // Spread rather than `icon: undefined`: this project compiles with
    // `exactOptionalPropertyTypes`, and an explicit undefined is not the same
    // as an absent key.
    ...(icon === null ? {} : { icon }),
    // Ordinary chrome, deliberately. She is frameless and click-through because
    // she sits on the desktop; a settings window is a document you resize,
    // move, and close with the button every other window has.
    show: false,
    minimizable: true,
    resizable: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // The role, and the ONLY thing that distinguishes the two windows'
      // bridges. A second preload file leaves both
      // windows without one, and every check stays green.
      additionalArguments: [`${ROLE_FLAG}settings`],
    },
  })
}

/** Console, navigation, activation, lifetime, load. In that order, and why. */
function wire(created: BrowserWindow, rendererUrl: string | null): void {
  // BEFORE the load, or the failures that happen during it are the ones lost.
  forwardConsole(created, 'settings')
  sealNavigation(created, 'settings')
  setActivation(true)

  // Shown on ready-to-show, so it never appears as a white rectangle that then
  // fills in.
  created.once('ready-to-show', () => created.show())
  created.on('closed', () => {
    // Only if this window is STILL the one on record. `closed` can arrive after
    // a replacement has already been opened -- the old handler would then null
    // out the new window's reference and drop the app back to accessory with a
    // live settings window on screen, unreachable from the Dock and unrecognised
    // by the IPC sender check.
    if (win !== created) return
    win = null
    // Back to furniture. Done on `closed` rather than on `close` so a cancelled
    // close cannot strand the app as an accessory with a window still up.
    setActivation(false)
  })

  // NOT fire-and-forget. A failed load left an invisible window registered as
  // the singleton: `openSettings` would then "focus" a blank window forever,
  // and the rejection surfaced as an unhandled promise with nothing tying it to
  // the settings menu item.
  loadRenderer(created, rendererUrl, 'settings').catch((error: unknown) => {
    console.error('[settings] the settings window failed to load:', error)
    if (!created.isDestroyed()) created.destroy()
  })
}

/** The live settings window, or null. Used to check who an IPC message came from. */
export function settingsWindow(): BrowserWindow | null {
  return live()
}

/**
 * Close it, if it exists. Used by the quit path so teardown is deterministic.
 *
 * The reference is cleared by the `closed` handler, NOT here. `close()` is a
 * request: it fires `close` first, which a beforeunload handler can cancel, and
 * it is asynchronous even when nothing cancels it. Nulling immediately defeated
 * the singleton for as long as the window took to go -- `settingsWindow()`
 * returned null while the window was still up and still sending IPC, so
 * `isFromSettings` rejected messages from the real settings window.
 */
export function closeSettings(): void {
  live()?.close()
}
