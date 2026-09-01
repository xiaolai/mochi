/**
 * Where a file that ships beside the bundle lives.
 *
 * ONE path, decided by whether this is packaged, never a list of candidates
 * tried in order. Guessing at runtime hides exactly the failure that matters: a
 * packaging mistake leaving the asset out of the bundle is invisible while a
 * development copy is still findable, so it only appears on somebody else's
 * machine.
 *
 * ## One function, because there were two
 *
 * `tray.ts` wrote this rule and `window.ts` copied it — its comment said so
 * outright, "the tray's rule, applied to the other folder in `extraResources`".
 * Two copies differing in one string is the shape where a fix lands on one of
 * them: the reasoning above is the valuable part and there must be exactly one
 * of it.
 *
 * `folder` is the name on BOTH sides of the mapping, which is what makes one
 * function enough. `electron-builder.yml` declares `resources/tray → tray` and
 * `resources/icons → icons`; a third entry that renamed the folder on the way
 * in would need this to take two names, and should change this rather than
 * grow a second copy of it.
 */

import { app } from 'electron'
import { join } from 'node:path'

export function shippedPath(folder: string, file: string): string {
  return app.isPackaged
    ? join(process.resourcesPath, folder, file)
    : join(app.getAppPath(), `resources/${folder}`, file)
}
