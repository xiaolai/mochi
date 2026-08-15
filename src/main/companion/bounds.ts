/**
 * Where she sits, and keeping her somewhere a person can reach.
 *
 * Geometry only. Each of these takes the window and moves it; none of them
 * tells anybody afterwards, because who needs telling depends on what caused
 * the move and that is the composition root's business.
 *
 * The three cases are genuinely different and were wired to the same handler
 * once, with the obvious result — see `keepReachable`.
 */

import { screen, type BrowserWindow } from 'electron'
import { containToWorkArea, type Size } from '../surfaces/placement'

/**
 * Put her back inside a display, WITHOUT moving her if she is already in one.
 *
 * `display-metrics-changed` fires for a scale-factor change, a rotation, and
 * every time the work area moves — a dock appearing, a menu bar auto-hiding, an
 * external screen waking. All of those were wired straight to `recentre`, so
 * plugging in a monitor or hiding the dock teleported her to the middle of
 * whichever screen the cursor happened to be on, discarding a position the user
 * had chosen. Nothing about a metrics change means she is lost.
 *
 * A clamp is the whole answer: a no-op while she is reachable, and the shortest
 * move back when she is not.
 */
export function keepReachable(win: BrowserWindow): void {
  const bounds = win.getBounds()
  const { x, y } = containToWorkArea(bounds.x, bounds.y, bounds)
  if (x !== bounds.x || y !== bounds.y) win.setPosition(x, y)
}

/**
 * Put her back on a display that exists.
 *
 * No longer a tray item, and the menu is right to have dropped it: dragging is
 * clamped (`drag.ts`) and so is resizing, so she cannot be put off-screen by
 * any action a user can take. The one case that remained was a DISPLAY going
 * away underneath her — not something anybody should have to notice and fix
 * from a menu — so it is handled on the event instead. What was a manual
 * recovery is now automatic, which is what makes the menu item redundant
 * rather than merely absent.
 */
export function recentre(win: BrowserWindow): void {
  const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  // Her LIVE bounds, not the size she was created at: resizing her changes the
  // window, and centring against a stale size puts her off-centre by exactly
  // the amount she was resized by.
  const bounds = win.getBounds()
  win.setPosition(
    Math.round(workArea.x + (workArea.width - bounds.width) / 2),
    Math.round(workArea.y + (workArea.height - bounds.height) / 2),
  )
  if (!win.isVisible()) win.showInactive()
}

/**
 * Grow or shrink her about her own centre, then clamp.
 *
 * Clamped AFTER centring, because growing her near an edge pushes the new
 * bounds off the display — half of her past the right edge, or under the menu
 * bar, with the drag handle out of reach. `drag.ts` has always clamped; the
 * resize path had the same need and no guard.
 */
export function resizeAboutCentre(win: BrowserWindow, next: Size): void {
  const now = win.getBounds()
  const at = containToWorkArea(
    Math.round(now.x + (now.width - next.width) / 2),
    Math.round(now.y + (now.height - next.height) / 2),
    next,
  )
  win.setBounds({ x: at.x, y: at.y, width: next.width, height: next.height })
}
