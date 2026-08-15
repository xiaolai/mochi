import { BrowserWindow, screen } from 'electron'
import { join } from 'node:path'
import { ROLE_FLAG } from '@shared/ipc'
import { forwardConsole, loadRenderer, sealNavigation } from './renderer-entry'

/**
 * The window is DERIVED from her, not the other way round.
 *
 * It used to be a fixed 280x280 with the rig fitting her into a fraction of it,
 * which made her real size an emergent property of constants in two files. Now
 * `layoutFor` answers both questions from one place: how big she is, and
 * therefore how big the window around her has to be.
 */

/** How far in from the corner she first appears. A placement policy, so it is named. */
const EDGE_INSET = 60

export interface Companion {
  readonly win: BrowserWindow
  readonly loaded: Promise<void>
}

/**
 * The window she lives in.
 *
 * `forward: true` on the click-through is what makes the whole arrangement
 * work: it lets a window that is NOT taking mouse events still receive
 * `mousemove`. Without it this deadlocks -- once transparent to clicks the
 * renderer hears nothing at all, so it can never discover that the cursor came
 * back onto her, and she is unclickable for the rest of the run.
 */
export function createCompanionWindow(
  rendererUrl: string | null,
  size: { readonly width: number; readonly height: number },
): Companion {
  const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())

  // Clamped to the work area at BOTH ends. Clamping only the lower bound left
  // the comment claiming containment it did not provide: on a work area smaller
  // than she is, the origin pinned to the left edge and she still ran off the
  // right. Flush to the top-left is the most of her that can be shown when she
  // does not fit -- and the corner nearest the origin is the one a user can
  // always reach.
  const fit = (start: number, extent: number, size: number): number =>
    Math.max(
      start,
      Math.min(start + extent - size - EDGE_INSET, start + Math.max(0, extent - size)),
    )
  const origin = {
    x: fit(workArea.x, workArea.width, size.width),
    y: fit(workArea.y, workArea.height, size.height),
  }

  const win = new BrowserWindow({
    ...size,
    x: Math.round(origin.x),
    y: Math.round(origin.y),
    transparent: true,
    frame: false,
    hasShadow: false,
    resizable: false,
    skipTaskbar: true,
    // She must never steal focus. Somebody double-clicking her while typing
    // should not lose the keystroke.
    focusable: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // EXPLICIT, though `companion` was until recently what a window with no
      // role got by default. Relying on that default meant the privileged
      // bridge was the one handed out on the path where nothing was stated --
      // see `roleFromArgv`. Both windows now say which they are.
      additionalArguments: [`${ROLE_FLAG}companion`],
    },
  })

  // 'screen-saver' rather than plain always-on-top: the lower levels put her
  // behind full-screen applications, which is most of the time somebody is
  // looking at their screen.
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  // Transparent to clicks until the renderer says the cursor is over her.
  win.setIgnoreMouseEvents(true, { forward: true })

  forwardConsole(win, 'companion')
  sealNavigation(win, 'companion')

  const loaded = loadRenderer(win, rendererUrl, 'companion')

  return { win, loaded }
}
