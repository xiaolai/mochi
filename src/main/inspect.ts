import { BrowserWindow, Menu, type MenuItemConstructorOptions, type WebContents } from 'electron'

/**
 * Right-click to inspect an element, in development only.
 *
 * ## Electron has no such menu
 *
 * Chrome's "Inspect Element" is the BROWSER's context menu, not the engine's.
 * An Electron window right-clicks to nothing until somebody builds one, which
 * is why every panel in this app had to be found by reading the stylesheet and
 * measuring it from a harness. The default application menu — which this app
 * never replaces — does carry View → Toggle Developer Tools, so the keyboard
 * route already worked; what was missing was pointing at a thing and asking
 * what it is.
 *
 * ## DETACHED, always
 *
 * `inspectElement` opens the tools docked by default, and this app has no
 * window that survives being docked into. The companion is ~120x140 and
 * transparent: docking devtools inside her means devtools drawn over the
 * desktop with a mochi in the corner. The shell is three columns at 1440 and
 * loses one of them. So the tools are opened detached first, and only then
 * asked to select the node.
 *
 * ## Development only, and not by a flag somebody can forget
 *
 * Gated on `ELECTRON_RENDERER_URL`, which `electron-vite dev` sets and a build
 * does not — the same signal `window.ts` uses to decide whether to load from
 * the dev server or from disk. One source of truth for "is this a dev run",
 * rather than a second one that can disagree with it.
 *
 * A packaged build gets nothing. An "Inspect Element" item on a companion that
 * sits on somebody's desktop all day is a surface with no reason to be there.
 *
 * ## What this does NOT reach
 *
 * The companion is `setIgnoreMouseEvents(true, { forward: true })` — clicks
 * pass through her window until the renderer says the pointer is on her painted
 * pixels. So right-clicking HER works and right-clicking the empty part of her
 * window goes to whatever is underneath, which is the same rule every other
 * click in that window follows.
 */

/** Whether this process was started by the dev server. See above. */
export function inDevelopment(env: NodeJS.ProcessEnv): boolean {
  // Against `undefined` rather than for truthiness, exactly as `window.ts`
  // checks it: an empty value is a broken dev run and should not read as a
  // packaged one.
  return env['ELECTRON_RENDERER_URL'] !== undefined
}

/** The menu, as data, so it can be checked without a display. */
export function inspectMenuTemplate(
  at: { readonly x: number; readonly y: number },
  inspect: (x: number, y: number) => void,
): MenuItemConstructorOptions[] {
  return [
    {
      label: 'Inspect Element',
      click: () => {
        inspect(at.x, at.y)
      },
    },
  ]
}

/**
 * Give one window's contents the menu. A no-op outside development.
 *
 * Returns whether it was attached, so a caller can say so in the log rather
 * than wondering why a right-click does nothing.
 */
export function letDevToolsInspect(contents: WebContents, env = process.env): boolean {
  if (!inDevelopment(env)) return false
  contents.on('context-menu', (_event, params) => {
    const template = inspectMenuTemplate(params, (x, y) => {
      // Detached BEFORE the inspect call, because `inspectElement` opens them
      // docked and neither window in this app survives that. See the header.
      if (!contents.isDevToolsOpened()) contents.openDevTools({ mode: 'detach' })
      contents.inspectElement(x, y)
    })
    // Anchored to the window the click came from. `popup()` with no window
    // targets the FOCUSED one, and a right-click on the companion does not
    // necessarily focus her — she is always-on-top and click-through.
    const window = BrowserWindow.fromWebContents(contents)
    Menu.buildFromTemplate(template).popup(window === null ? {} : { window })
  })
  return true
}
