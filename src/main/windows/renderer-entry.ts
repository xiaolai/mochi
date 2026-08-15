import type { BrowserWindow } from 'electron'
import { join } from 'node:path'

/**
 * Which document a window loads.
 *
 * ONE rule, two callers, and the name is a closed union -- so a new window is a
 * change to this type rather than a new string built at a call site. The
 * project's third settled rule forbids guessing paths at runtime for a concrete
 * reason: a packaging mistake is invisible while a development copy is still
 * findable, so it only shows up on somebody else's machine.
 *
 * Dev and packaged differ in exactly one way, the base. Under `electron-vite
 * dev` the renderer root is `src/renderer`, so each window is a subdirectory of
 * the dev server; a production build puts the same subdirectories under
 * `out/renderer`. Naming the window is therefore enough in both.
 */
export type RendererName = 'companion' | 'settings'

/**
 * A renderer's console, in the main log.
 *
 * Applied to EVERY window, which is the whole point of it living here. It was
 * wired only to the companion, so the settings window had no voice at all: a
 * CSP refusal, a failed module or a throw in its boot path went to a devtools
 * console nobody has open, and the only symptom was a blank window. That is the
 * same failure the companion's version was written to prevent, rediscovered the
 * moment a second window existed.
 */
export function forwardConsole(win: BrowserWindow, name: RendererName): void {
  win.webContents.on('console-message', (details) => {
    // Vite's HMR notices, and only those. Matching the whole `[vite]` prefix
    // would also swallow its errors, which are exactly the ones worth seeing.
    if (/^\[vite\] (connect|hot updated|connected|hmr)/i.test(details.message)) return
    // Tested for EMPTINESS, not for undefined. Electron types `sourceId` as a
    // plain string, so the `=== undefined` branch could never run and the
    // suppression it was written for never happened: a message with no source
    // logged as ` (:0)`. What actually arrives for an unattributed message is
    // the empty string.
    const where = details.sourceId === '' ? '' : ` (${details.sourceId}:${details.lineNumber})`
    const line = `[${name}] ${details.message}${where}`
    // Severity preserved. Routing an error through console.log puts renderer
    // errors on stdout, where anything filtering for failures would miss them.
    if (details.level === 'error') console.error(line)
    else if (details.level === 'warning') console.warn(line)
    else console.log(line)
  })

  // A renderer that dies takes its console with it, so the reason has to come
  // from the process-level event or it is lost entirely.
  win.webContents.on('render-process-gone', (_event, details) => {
    console.error(`[${name}] renderer gone: ${details.reason} (exit ${details.exitCode})`)
  })
  win.webContents.on('preload-error', (_event, preloadPath, error) => {
    // The specific failure behind a window with no bridge. Without this it is
    // invisible: the document loads perfectly and `window.mochiSettings` is
    // simply undefined.
    console.error(`[${name}] preload failed (${preloadPath}):`, error)
  })
}

/**
 * Nail the window to the document it was opened with.
 *
 * A preload is attached to a WINDOW, not to a page: whatever document that
 * window ends up showing gets the bridge. The companion's bridge moves her
 * window, disables click-through, mints an ephemeral key and opens a
 * microphone — so a navigation is a transfer of all of that to whatever
 * navigated. Nothing here should ever navigate, which makes refusing cheap and
 * makes any attempt worth a line in the log.
 *
 * Three doors, because there are three:
 *
 *   `will-navigate`        a link, a `location =`, a form
 *   `setWindowOpenHandler` `window.open`, `target=_blank`
 *   `will-attach-webview`  a `<webview>` with its own preload
 *
 * Blocking only the first is the common half-measure. An external link is not
 * lost by this: `settings/main.ts` sends its two addresses to the OS through a
 * main-side allowlist, which is what that channel is for.
 */
export function sealNavigation(win: BrowserWindow, name: RendererName): void {
  win.webContents.on('will-navigate', (event, url) => {
    event.preventDefault()
    console.warn(`[${name}] refused to navigate to ${url}`)
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    console.warn(`[${name}] refused to open a window for ${url}`)
    return { action: 'deny' }
  })
  win.webContents.on('will-attach-webview', (event) => {
    event.preventDefault()
    console.warn(`[${name}] refused to attach a webview`)
  })
}

export function loadRenderer(
  win: BrowserWindow,
  rendererUrl: string | null,
  name: RendererName,
): Promise<void> {
  // The trailing slash matters: without it Vite serves the directory listing
  // for some configurations rather than its index.html.
  return rendererUrl === null
    ? win.loadFile(join(__dirname, `../renderer/${name}/index.html`))
    : win.loadURL(`${rendererUrl}/${name}/`)
}
