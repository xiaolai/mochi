import { app } from 'electron'
import type { SettingsUpdate } from '@shared/ipc'

/**
 * Whether there is a newer build, and getting it if you want it.
 *
 * ## Nothing happens without being asked
 *
 * `autoDownload` is off and `autoInstallOnAppQuit` is off. She sits on somebody's
 * desktop all day; an application that quietly fetched 120MB and then replaced
 * itself on the next quit would be doing two things nobody asked for, one of
 * them on a metered connection. Three deliberate steps instead: look, fetch,
 * restart — each behind its own press.
 *
 * ## Why this is a module and not four lines in `index.ts`
 *
 * It holds state that outlives a call — what the last check found, and whether a
 * download has landed — and it is the one place that talks to a network service
 * on the app's own behalf rather than the user's. `index.ts` is the composition
 * root and the LOC note in this repository is explicit that a decision which
 * merely happens to live there is the thing to lift out.
 *
 * ## The feed is the release this repository already publishes
 *
 * `electron-builder` writes `app-update.yml` into the bundle from the manifest's
 * repository field — `provider: github, owner: xiaolai, repo: mochi` — and
 * `release.yml` uploads the `latest-mac.yml` and the zips it points at. So there
 * is no endpoint configured anywhere: the updater reads the same release page a
 * person would.
 *
 * ## Unsupported is a real answer, not a failure
 *
 * An unpackaged build has no `app-update.yml` and no signature to check against,
 * and `electron-updater` throws rather than shrugging. Saying so is better than
 * a red error in a development window that means nothing.
 */

/** What the last check or download established. Read by `settings:read`. */
let state: SettingsUpdate = { kind: 'idle' }

export function updateState(): SettingsUpdate {
  /*
    An unpackaged build says so BEFORE it is asked.

    The state starts `idle`, which drew "Not checked yet" and a "Check for
    updates" button in a development window — a control that cannot work,
    offered as though it could. Answering `unsupported` from the start makes the
    pane draw the sentence and no button, which is the honest shape.

    Not stored, because `app.isPackaged` is a fact about this process rather
    than something a check established, and writing it into `state` would let a
    real result be overwritten by a redraw.
  */
  if (!possible()) return { kind: 'unsupported' }
  return state
}

/**
 * The module, imported only when it is actually going to be used.
 *
 * `electron-updater` reads `app-update.yml` at import time in some versions and
 * complains loudly when there is not one, which is every development run. A
 * dynamic import keeps that out of the startup path entirely.
 */
async function updater() {
  const { autoUpdater } = await import('electron-updater')
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  // Its own logging is verbose and goes to a file nobody reads. What matters
  // here is reported through the state above, in words the pane can draw.
  autoUpdater.logger = null
  return autoUpdater
}

/** Whether an update can be looked for at all. */
function possible(): boolean {
  return app.isPackaged
}

/**
 * Ask the release page whether there is a newer build.
 *
 * Returns the state rather than mutating and letting the caller re-read, for
 * `recheckCodex`'s reason: the pane draws from what it is handed, and a second
 * read is a second chance to draw something else.
 */
export async function checkForUpdate(): Promise<SettingsUpdate> {
  if (!possible()) {
    state = { kind: 'unsupported' }
    return state
  }
  try {
    const found = await (await updater()).checkForUpdates()
    // `null` when the check was skipped rather than answered — treated as "no
    // answer", not as "no update", because those are different things to
    // somebody deciding whether to look again.
    const version = found?.updateInfo?.version
    state =
      typeof version === 'string' && version !== app.getVersion()
        ? { kind: 'available', version }
        : { kind: 'none', checkedAt: Date.now() }
  } catch (error: unknown) {
    state = { kind: 'failed', why: String(error) }
  }
  return state
}

/**
 * Fetch it, and resolve only once it is on disk.
 *
 * A promise that finishes when the download does is what lets the pane show
 * "Downloading…" while it is outstanding and redraw to "Restart to install"
 * when it is not, without a progress channel of its own. Progress is not drawn:
 * it would need a push channel and a redraw per frame for a bar somebody looks
 * at once.
 */
export async function downloadUpdate(): Promise<SettingsUpdate> {
  if (!possible()) {
    state = { kind: 'unsupported' }
    return state
  }
  if (state.kind !== 'available') {
    // Nothing to fetch. Not an error — a second press while the first is still
    // running, or after it finished, lands here.
    return state
  }
  const version = state.version
  try {
    await (await updater()).downloadUpdate()
    state = { kind: 'ready', version }
  } catch (error: unknown) {
    state = { kind: 'failed', why: String(error) }
  }
  return state
}

/**
 * Replace this build with the one that was downloaded, now.
 *
 * Only from `ready`. `quitAndInstall` on a build that has not been downloaded
 * closes the application and installs nothing, which reads as a crash.
 */
export async function installUpdate(): Promise<void> {
  if (state.kind !== 'ready') return
  const autoUpdater = await updater()
  // `false, true`: do not force-close other windows silently, and do run the
  // installer after quitting. The second is the whole point; the first leaves
  // the ordinary quit path — and its flush of the open conversation — intact.
  autoUpdater.quitAndInstall(false, true)
}
