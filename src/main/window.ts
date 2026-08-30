import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, nativeImage, nativeTheme, screen } from 'electron'
import { FEET_FROM_TOP, WINDOW_H, WINDOW_W, fullPad, originHolding } from '@shared/avatar-layout'
import { containToWorkArea, KEEP_ON_SCREEN } from './drag'
import { letDevToolsInspect } from './inspect'

/**
 * How long after the last move or resize the window's place is written.
 *
 * Long enough that a drag is one write and short enough that nobody notices it
 * is deferred. `close` flushes, so the only way to lose a placement is to kill
 * the process mid-drag.
 */
const SETTLE_MS = 250
import { problems } from './problems'
import { readHerPlace, readShelfPlace, writeShelfPlace, type Place } from './store/worn'

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

/**
 * How far she rests from the corner she starts in.
 *
 * Measured to HER, not to her window. The window is created far larger than she
 * is, because the bubble is drawn inside it and has to be able to go above,
 * below or beside her — so with her in a corner most of it hangs off the
 * display. Positioning the WINDOW with a margin would park her hundreds of
 * pixels inland.
 *
 * `KEEP_ON_SCREEN` rather than a number of its own. There were two constants
 * for "how close to the edge she may be" and they were 6x apart: the drag would
 * put her 4px from the corner and the first launch put her at 24, so she started
 * noticeably further out than anybody could then drag her, for no reason either
 * one stated. One number, and it is the drag's — that one has the argument
 * attached to it, about zero reading as half of her having fallen off.
 */
const MARGIN = KEEP_ON_SCREEN

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

/**
 * Where to put her WINDOW so that SHE lands where she was left.
 *
 * ## What is remembered is her, not the window
 *
 * Her window is resized constantly — `companion:fit` grows it when a bubble is
 * up and shrinks it when one is not — and `originHolding` exists precisely so
 * that those resizes do not move her. Remembering the window's origin would
 * therefore remember a number that means something different depending on
 * whether she happened to be speaking when it was written. Her body's top-left
 * on screen is the fact that stays still, so that is what is stored, and this
 * turns it back into an origin against the nominal pad the window is born with.
 *
 * ## Nothing stored is trusted
 *
 * The display it was written against may be gone — an external monitor
 * unplugged, a resolution changed — so a value that was right when written can
 * be off every screen when read. `containToWorkArea` is the same clamp the drag
 * uses, and it picks the display nearest HER rather than nearest her window,
 * which matters because most of the window hangs off the display on purpose.
 *
 * ## The default is the same arithmetic, not a second copy of it
 *
 * Bottom right, her inset by `MARGIN`. Written as a place rather than as an
 * origin so that the stored and the default path cannot drift — they were two
 * expressions of the same corner, and only one of them would have been fixed.
 */
function herWindowOrigin(stored: Place | null): { x: number; y: number } {
  const work = screen.getPrimaryDisplay().workArea
  const body = stored === null ? NOMINAL : { width: stored.width, height: stored.height }
  const pad = fullPad(body)
  const place = stored ?? {
    x: Math.round(work.x + work.width - MARGIN - NOMINAL.width),
    y: Math.round(work.y + work.height - MARGIN - NOMINAL.height),
  }
  const origin = originHolding(place, pad)
  return containToWorkArea(
    origin.x,
    origin.y,
    { left: pad.left, top: pad.top, width: body.width, height: body.height },
    KEEP_ON_SCREEN,
  )
}

/**
 * Load a renderer, from the dev server or from disk, and SAY SO if it fails.
 *
 * ## `app.isPackaged` is the boundary, not the variable
 *
 * This was `ELECTRON_RENDERER_URL === undefined ? loadFile : loadURL` at each of
 * two call sites. An environment variable is INHERITED, so a packaged build
 * launched from a shell that still had it set would load an arbitrary URL into
 * a renderer carrying the privileged preload bridge. The variable is only
 * consulted now once the build is already known to be unpackaged.
 *
 * ## The promise is not thrown away
 *
 * Both call sites were `void window.loadFile(...)`. A missing renderer artifact
 * or a dev server that is not up rejects, and the rejection went nowhere: the
 * companion stayed an invisible transparent rectangle and the shelf an empty
 * frame, with nothing in the log. It is the same failure `store/avatars.ts`
 * calls the least debuggable outcome this application can produce.
 */
/**
 * The web preferences every window in this application gets.
 *
 * ## Why this is one function
 *
 * It was written out twice, differing only in the role — and the companion's
 * copy carried the whole argument for the three flags while the shelf's carried
 * none of them. Two copies of a SECURITY configuration is one that gets
 * hardened and one that quietly does not: the next person to add a flag adds it
 * where they are looking.
 *
 * ## The flags
 *
 * All three, and none of them is optional. Drop any one and the allowlist in
 * `@shared/ipc` becomes decorative, because page content could reach IPC
 * without passing through the bridge that enforces it.
 *
 * The role is NAMED rather than defaulted. The preload used to fall back to
 * `companion` when none was passed, which meant the most privileged API in this
 * application was what a window got for saying nothing — the bridge failing
 * open in exactly the direction it argues against. It refuses an absent role
 * now, and this is what keeps both windows working.
 */
function bridgeFor(role: 'companion' | 'history'): Electron.WebPreferences {
  return {
    preload: join(__dirname, '../preload/index.js'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    additionalArguments: [`--mochi-role=${role}`],
  }
}

function loadRenderer(window: BrowserWindow, page: 'companion' | 'history'): void {
  // Checked against `undefined` rather than for truthiness, so an empty value
  // fails loudly instead of silently loading the packaged document while
  // claiming to be in development.
  const devServerUrl = app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL
  const where =
    devServerUrl === undefined
      ? join(__dirname, `../renderer/${page}/index.html`)
      : `${devServerUrl}/${page}/index.html`
  const load = devServerUrl === undefined ? window.loadFile(where) : window.loadURL(where)
  load.catch((error: unknown) => {
    /*
      REPORTED, not only logged — a packaged app has no console.

      A renderer that fails to load leaves a live `BrowserWindow` with no
      document in it. For the companion that is worse than it sounds: she is a
      transparent frameless window, so the failure is INVISIBLE, and the show
      backstop then presents an empty transparent rectangle a few hundred
      milliseconds later as though she had started. Nothing on screen, nothing
      in the tray menu, and the only record on a console nobody has.

      This is the one failure in this file that cannot be recovered from here —
      there is no second document to try — so what is owed is that somebody can
      find out. `problems.ts` exists for exactly this: eleven `console.error`
      sites in main, and "a packaged app has no console" as its first sentence.
    */
    console.error(`[window] ${page} could not load ${where}:`, error)
    problems.note(
      'window',
      page,
      `the ${page} window could not load its page (${String(error)}), so it is empty`,
    )
  })
}

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
    webPreferences: bridgeFor('companion'),
  })

  /**
   * Where she actually starts: where she was left, or bottom right.
   *
   * See the note on the size above for why this is a move rather than a
   * position. `herWindowOrigin` is the whole of the arithmetic and is shared
   * with the fit path, so "where she is" has one definition.
   */
  /*
    Said out loud, because "she is not where I left her" has two causes and they
    need different fixes: nothing was ever stored, or something was stored and
    the clamp moved it. Reading the log used to answer neither — the line below
    reports the window's birth corner, which is never where she ends up.
  */
  const stored = readHerPlace(app.getPath('userData'))
  const origin = herWindowOrigin(stored)
  console.log(
    stored === null
      ? '[window] nothing stored about where she sits; the default corner it is'
      : `[window] she was left at ${String(stored.x)},${String(stored.y)}; ` +
          `window origin ${String(origin.x)},${String(origin.y)}`,
  )
  window.setPosition(origin.x, origin.y)
  /*
    Born at the worst-case size and shrunk on the renderer's first frame.

    It cannot be created small: the renderer decides what has to fit, and it has
    not run yet. So the window starts as the window this build always had — with
    her already in the corner, which the placement above still gets exactly right
    — and `companion:fit` brings it down to what is actually drawn as soon as
    there is a frame to measure. Starting small and growing would show her in the
    wrong place for one frame; starting large and shrinking shows nothing at all,
    because every pixel of the difference is transparent.
  */

  /*
    Logged AFTER the move, and reporting HER rather than the window.

    It said `980x560 at 0,30` — the corner the window is born in, which is not
    where anything ends up and is the one position that is never interesting.
    The comment on it says it exists because "a window that fails to appear looks
    exactly like one that appeared somewhere unexpected", and a birth position
    cannot tell those apart. Her feet and her right edge can, which is what
    somebody reading this log is actually trying to check.
  */
  const at = window.getBounds()
  console.log(
    `[window] ${at.width}x${at.height} at ${at.x},${at.y} on a ${display.width}x${display.height} work area; ` +
      `her right edge ${display.x + display.width - (at.x + WINDOW_W / 2 + NOMINAL.width / 2)}px ` +
      `and her feet ${display.y + display.height - (at.y + FEET_FROM_TOP)}px from the corner`,
  )

  window.setAlwaysOnTop(true, 'screen-saver')
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  // Click-through until the renderer says the pointer is actually on her.
  // `forward` keeps `mousemove` arriving so it can tell.
  window.setIgnoreMouseEvents(true, { forward: true })

  /*
    NOT shown here. `companion:fit` shows her, once she is the size she will be.

    ## What was measured

    macOS CLAMPS a window onto the display the first time it is shown. Probed
    against this exact configuration:

    ```
    afterSetPosition: 1957,1058    setPosition on a hidden window works
    afterLoad:        1957,1058    and survives the load
    afterShow:        1580, 880    show() moved it
    ```

    1957 + 980 = 2937, which is 377 past a 2560-wide display; 1058 + 560 = 1618,
    which is 178 past 1440. It came back 377 left and 178 up — exactly the
    overhang, on both axes.

    ## Why this window can never be shown at this size

    She is 443px in from the left of a 980-wide window and 267 down from its top.
    Putting her body in the bottom-right corner therefore REQUIRES the window to
    hang off two edges, and the clamp refuses. The size exists so a speech bubble
    has somewhere to go, and the window is transparent everywhere she is not —
    but macOS does not know that, and it is not going to.
    
    This is why she kept coming back somewhere else, and it is not what any of
    the three previous fixes were about: they were all about which process
    reported her position, while the position was being changed after it was set
    and nothing re-applied it.

    ## Waiting is safe, and that was measured too

    `ready-to-show` fires for a HIDDEN window in an accessory app here — she is
    `alwaysOnTop` at screen-saver level and visible on every workspace, which is
    what keeps her composited whatever has focus, and is exactly the argument
    `bringForward` makes for why the OTHER windows cannot do this. Probed: it
    fired while hidden, with no `show()` anywhere.

    Once she is visible, growing the window back over the display edge is
    honoured — the clamp is a first-show behaviour, not a standing one. So the
    bubble still gets its room the moment she has something to say.
  */

  // Right-click to inspect, in development only. Reaches her painted pixels and
  // nothing else, because the rest of this window is click-through.
  letDevToolsInspect(window.webContents)

  loadRenderer(window, 'companion')

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

/**
 * Where a shipped icon lives — ONE path, decided by whether this is packaged.
 *
 * The tray's rule, applied to the other folder in `extraResources`. Guessing at
 * runtime hides exactly the failure that matters: a packaging mistake leaving
 * the asset out of the bundle is invisible while a development copy is still
 * findable, so it only appears on somebody else's machine.
 */
function iconPath(file: string): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'icons', file)
    : join(app.getAppPath(), 'resources/icons', file)
}

/**
 * Her face on the Dock tile, and the reason there was an Electron logo there.
 *
 * `resources/icons/dock.png` has been in this repository the whole time. It is
 * shipped by `extraResources`, and `shipped-icons.test.ts` measures it against
 * the rig that draws her — an asset verified against the artwork and consumed
 * by nothing at all. The tile it was drawn for showed the generic Electron logo
 * every time a real window opened under `pnpm dev`.
 *
 * ## Only unpackaged, and that is not laziness
 *
 * A packaged app takes its tile from the bundle: `electron-builder.yml` points
 * `mac.icon` at the 1024px source and the `.icns` is derived from it, so
 * calling `setIcon` there would replace a correct icon with a second copy of
 * the same drawing at lower resolution. `electron .` has no bundle to read.
 *
 * ## The PRE-MASKED tile, not the full-bleed square
 *
 * An image handed to `dock.setIcon` is not promised the system's squircle crop
 * — that is applied to a bundle's icon, not to a `NativeImage` set at runtime —
 * so the full-bleed 1024 square meant for the `.icns` would appear as a square
 * among rounded neighbours. `dock.png` is the version carrying its own rounded
 * plate, which is why it exists as a separate asset.
 *
 * That sentence was true of the hand-drawn original, then false for five days,
 * and is true again. When the assets moved to a generator the plate became a
 * full-bleed square — all `rig/svg.ts` could draw — and the mark it framed went
 * from 62% of a plate to 51% of a tile without any number changing. A
 * screenshot of the real Dock caught it at 50.8% while every neighbour filled
 * theirs. `rig/icons.ts` carries the measurements it was rebuilt from.
 *
 * Absent is not fatal, unlike the tray: a missing Dock tile falls back to
 * Electron's own, while a missing tray icon is an app nobody can quit.
 */
function dockIcon(): Electron.NativeImage | null {
  if (app.isPackaged) return null
  const path = iconPath('dock.png')
  if (!existsSync(path)) {
    console.warn(`[window] no dock icon at ${path}`)
    return null
  }
  const image = nativeImage.createFromPath(path)
  if (image.isEmpty()) {
    console.warn(`[window] the dock icon at ${path} could not be decoded`)
    return null
  }
  return image
}

/**
 * The taskbar icon, for the platforms that take one from the WINDOW.
 *
 * Windows draws it from `BrowserWindow`'s `icon` and falls back to the
 * executable's when none is given, which is why an unpackaged run shows
 * Electron's logo beside a window called Mochi. Her own window never showed it
 * because it is `skipTaskbar`.
 *
 * A different asset from either macOS one, deliberately: Windows applies no
 * mask, so the full-bleed square meant for the bundle would render as a solid
 * colour block beside neighbours that are all logos on transparency. `null` on
 * macOS, which takes its icon from the application rather than the window.
 */
function windowIcon(): string | null {
  if (process.platform === 'darwin') return null
  const path = iconPath('window-256.png')
  if (!existsSync(path)) {
    console.warn(`[window] no taskbar icon at ${path}`)
    return null
  }
  return path
}

function becomeOrdinary(window: BrowserWindow): void {
  if (process.platform !== 'darwin') return
  if (ordinary.has(window)) return
  ordinary.add(window)
  app.setActivationPolicy('regular')
  /*
    EVERY time, not once at startup.

    `accessory` has no tile to put an icon on, so a call made before the first
    switch to `regular` is silently accepted and discarded — which is the shape
    of bug this whole file keeps finding: something that runs, returns, and did
    nothing. Setting it here means it is set at the one moment there is a tile.
  */
  const icon = dockIcon()
  if (icon !== null) app.dock?.setIcon(icon)
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
   * 1280 x 800, from the v2 delivery — clamped to whatever display this is.
   *
   * Clamped for the same reason the old 1440 was: macOS answers a too-large
   * window by SHRINKING it at creation — the same behaviour her own window works
   * around — which would silently produce a size nobody chose. Asking for what
   * fits is the honest version of the same outcome.
   *
   * It matters much less now. 1440 x 900 was wider than a 13" work area and
   * taller than one; 1280 x 800 was picked against that exact machine, so the
   * clamp is a guard rather than the usual path.
   */
  const stored = readShelfPlace(app.getPath('userData'))
  /*
    THE DISPLAY IT WAS LEFT ON, not the primary one.

    This read `screen.getPrimaryDisplay().workArea` and clamped the stored size
    against it before `containToWorkArea` had chosen a display at all. So a
    shelf left on a larger secondary monitor was shrunk to the laptop's work
    area on every relaunch — while that monitor was still connected and about
    to be the one it opened on.

    The clamp is right and its reason is right: macOS answers a too-large window
    by SHRINKING it at creation, so asking for what fits is the honest version
    of the same outcome. It was simply asking the wrong display what fits.

    `getDisplayNearestPoint` is the same question `containToWorkArea` answers a
    few lines down, asked once and early so both halves agree. With nothing
    stored there is no position to ask about, and the primary is the right
    default for a first launch.
  */
  const work =
    stored === null
      ? screen.getPrimaryDisplay().workArea
      : screen.getDisplayNearestPoint({ x: stored.x, y: stored.y }).workArea
  /**
   * Where it was left, or the handoff's size clamped to this display.
   *
   * The same rule her own window now follows, and the same reason: a size and a
   * position that quietly reset on relaunch make closing a window a way to undo
   * a resize. Clamped through `containToWorkArea` with a zero-inset body, which
   * for an ordinary window is exactly "keep it on a display that exists" — the
   * overhang argument that makes hers different does not apply here.
   */
  /*
    1280 x 800, derived rather than chosen.

    The archive is the page with three columns competing, and it closes exactly:
    rail 232 + list 368 + gutter 32 + transcript 616 + gutter 32 = 1280. Height
    800 fits the 13" default scaling with about 60px spare — 1470x956 less a
    25px menu bar and roughly 70 of Dock.

    It was 1440 x 900, and both halves were wrong for this layout. At 1440 the
    transcript column is 136px wider than the 600px measure it holds, which is
    the "no fixed column holding 700px of nothing" finding from the other side.
    At 900 tall the window does not fit a 13" screen at all.
  */
  const size =
    stored === null
      ? { width: Math.min(1280, work.width), height: Math.min(800, work.height) }
      : {
          // Still clamped to the display. A window restored from a 27" monitor
          // onto a laptop would otherwise be created too large and silently
          // SHRUNK by macOS, which is the behaviour this whole block avoids.
          width: Math.min(stored.width, work.width),
          height: Math.min(stored.height, work.height),
        }
  const at =
    stored === null
      ? null
      : containToWorkArea(stored.x, stored.y, { left: 0, top: 0, ...size }, KEEP_ON_SCREEN)
  /*
    Named before the options, because `icon` cannot be spread conditionally
    under `exactOptionalPropertyTypes`: `icon: undefined` is not the same as an
    absent `icon`, and the second is what macOS wants.
  */
  const taskbarIcon = windowIcon()
  const window = new BrowserWindow({
    ...size,
    ...(at === null ? {} : { x: at.x, y: at.y }),
    ...(taskbarIcon === null ? {} : { icon: taskbarIcon }),
    /*
      What the delivered layout actually needs, rather than a number inherited
      from an arrangement that no longer exists.

      Two floors ago this was 900×560, chosen for a three-tab window whose panes
      each had the whole width. Then 1100×700, for a frame that spent a fixed
      210 on the rail and a fixed 236 on the margin on every page.

      1120×680 is the v2 delivery's, and it is derived the same way the default
      is: rail 232 + list 328 + gutter 32 + transcript 520 + gutter 32 = 1120,
      with the reading measure falling back to 520 and the apparatus column
      collapsed. Narrower than that and the rail would have to collapse too,
      which is a different design rather than a smaller one.

      The height floor goes DOWN, 700 to 680, and that is deliberate rather than
      careless: six of the twenty-one screens are already taller than 800 and
      scroll at the default size, so the floor is not what decides whether
      anything is reachable.
    */
    minWidth: 1120,
    minHeight: 680,
    // Shown from the start — see `bringForward` for why waiting for the first
    // paint never returns here. The colour is what `ready-to-show` was for.
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1c1d1a' : '#f7f6f1',
    /*
      Named for the application, not for one of its three places.

      It was "Shelf", which is the Cast tab's own subject — the archive and this
      machine are the other two and neither is a shelf. The tray used to carry
      "Shelf…" and "Settings…" as separate items for the same reason, and both
      halves of that confusion are settled together.
    */
    title: app.getName(),
    // Her window hides from this; this one belongs in it.
    skipTaskbar: false,
    webPreferences: bridgeFor('history'),
  })
  history = window
  /*
    Written when it MOVES, not when it closes.

    A `closed` handler cannot read bounds — the window is already gone — and a
    `close` one runs on quit, which is exactly when an application is least
    reliable about finishing a write. `moved` and `resized` fire while it is
    plainly alive, and `writeJsonAtomically` underneath makes a torn file
    impossible even at a bad moment.

    Not while MINIMIZED or full screen: both report bounds that are about a
    temporary state rather than about where somebody put the window, and
    restoring into either is the failure this is meant to avoid.
  */
  /*
    SETTLED FIRST, because `moved` and `resized` fire continuously.

    macOS sends these on every frame of a drag, and each one did a read, a
    merge, a temp file, an `fsync` and a rename of `preferences.json` — on the
    MAIN process, which is also the one drawing her. A drag across the screen
    was a few hundred synchronous round trips to the disk, and the visible half
    is her window stuttering while the shelf is moved.

    A quarter of a second after the last event, so a drag writes once. The timer
    is `unref`'d — a pending save is not a reason to hold the process open — and
    the `closed` handler flushes, because quitting mid-drag is exactly when
    somebody has just put the window somewhere.
  */
  let settling: NodeJS.Timeout | null = null
  const remember = (): void => {
    if (settling !== null) clearTimeout(settling)
    settling = setTimeout(rememberNow, SETTLE_MS)
    settling.unref()
  }
  const rememberNow = (): void => {
    if (settling !== null) {
      clearTimeout(settling)
      settling = null
    }
    if (window.isDestroyed() || window.isMinimized() || window.isFullScreen()) return
    const bounds = window.getBounds()
    try {
      writeShelfPlace(app.getPath('userData'), {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
      })
    } catch (error: unknown) {
      // Not fatal — the window is where somebody put it for this run — but this
      // is a `moved` handler, so an uncaught throw here would come out of an
      // event listener with nothing above it. `writePlaceKey` refuses a place
      // it cannot store, and a refusal nobody can see is the failure that
      // presents as "it does not remember".
      console.error('[window] could not remember where the shelf was left:', error)
    }
  }
  window.on('moved', remember)
  window.on('resized', remember)
  // Written straight away rather than left to settle: `moved` fires up to the
  // moment a window goes, and a place somebody chose in the last quarter second
  // of the session is still a place they chose. `rememberNow` refuses a
  // destroyed window, so this is safe on every path into it.
  window.on('close', rememberNow)
  window.on('closed', () => {
    history = null
  })
  letDevToolsInspect(window.webContents)
  bringForward(window)

  loadRenderer(window, 'history')
  return window
}

/*
  The settings window is gone, and this is where it was.

  It held six groups in their own window and now they are the MACHINE tab of the
  shell — see `renderMachine` in the shelf's renderer. The comment that stood
  here argued that two documents with different allowlists must not share one,
  and that argument is answered rather than ignored: the two lists are still
  separate and each API still guards its own, but one window carries both. What
  it never covered, and still does not, is the companion — `COMPANION_CHANNELS`
  is untouched, so nothing that draws a transcript can mint a key.
*/
