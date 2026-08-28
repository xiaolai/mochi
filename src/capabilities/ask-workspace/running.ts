import type { RunHandle } from './spawn'

/**
 * How many lookups may be in flight, and what happens to them when the app
 * quits.
 *
 * ## Two failures, one place, because they are the same fact
 *
 * Nothing knew which children were alive. That single absence produced both of
 * these:
 *
 *   - **Nothing bounded them.** Each `ask_workspace` spawns a Codex process
 *     that may run for three minutes. The model can call a tool repeatedly, and
 *     nothing said no — so a loop of lookups spawns a process per call, each
 *     holding a workspace scan and a network connection, until the machine
 *     decides which one to stop.
 *
 *   - **Nothing stopped them.** `will-quit` closed the archive and left every
 *     running child alive. The app disappears from the Dock and a Codex process
 *     goes on reading somebody's workspace with no window, no tray icon and
 *     nothing to say it is there.
 *
 * ## Why refuse rather than queue
 *
 * A queue turns "she is busy" into a three-minute silence with no explanation,
 * and the model has no way to know it is waiting. A refusal is a sentence she
 * can say and act on — and `dispatch` already guarantees every call gets an
 * answer, so a refusal is a shape the rest of the system understands.
 */

/**
 * The bound.
 *
 * Two, not one: a follow-up question while a long lookup is still running is
 * an ordinary thing for somebody to ask, and refusing it would make the
 * capability feel broken rather than busy. Not more, because each one is a
 * full workspace scan and they compete for the same disk.
 */
export const MOST_AT_ONCE = 2

export interface Running {
  /**
   * Take a slot, or say there is none.
   *
   * The returned `done` MUST be called — in a `finally`, not on the success
   * path — or the slot leaks and the capability refuses for ever after a
   * handler that threw.
   */
  begin(): { readonly ok: true; readonly done: () => void } | { readonly ok: false }
  /** Hold a live child so it can be stopped at quit. */
  hold(handle: RunHandle): () => void
  /**
   * Hold it, and let go when it finishes — however it finishes.
   *
   * ## Why this is a method and not three lines at each call site
   *
   * It WAS three lines at each call site, written out identically in the
   * lookup capability, the note rewrite and the conversation titler. All three
   * ended `void handle.finished.finally(release)`, and `finally` returns a NEW
   * promise that rejects when the original does. `void` discards it, so a
   * rejecting `finished` produced an unhandled rejection — in the main process,
   * where Electron's default is to log it and carry on, from a run that was
   * being handled perfectly well.
   *
   * `spawnCodex`'s `finished` resolves on every path and never rejects, so this
   * is latent rather than live. It is latent in three places, the type permits
   * a handle that rejects, and tests supply their own — which is the shape that
   * becomes live the day somebody writes a fourth caller.
   */
  holdUntilDone(handle: RunHandle): void
  /**
   * Stop every live child. Called when the app is going away.
   *
   * SIGKILL, not SIGTERM: this runs inside `will-quit`, which Electron waits
   * on only for a synchronous handler. There is no grace period to offer, and
   * a request the child is free to ignore is not one to make here.
   */
  stopAll(): number
  /** For the log and for tests. */
  count(): number
}

export function createRunning(mostAtOnce = MOST_AT_ONCE): Running {
  let inFlight = 0
  const live = new Set<RunHandle>()

  return {
    begin() {
      if (inFlight >= mostAtOnce) return { ok: false }
      inFlight += 1
      let released = false
      return {
        ok: true,
        done: () => {
          // Idempotent: a `finally` that runs twice, or a caller that releases
          // and then throws, must not free a slot somebody else is holding.
          if (released) return
          released = true
          inFlight -= 1
        },
      }
    },

    hold(handle) {
      live.add(handle)
      return () => live.delete(handle)
    },

    holdUntilDone(handle) {
      live.add(handle)
      const release = (): void => {
        live.delete(handle)
      }
      // `catch` on the promise `finally` RETURNS, which is the one this has to
      // handle: `finally` passes a rejection straight through.
      handle.finished.finally(release).catch(() => undefined)
    },

    stopAll() {
      const stopped = live.size
      for (const handle of live) {
        try {
          handle.kill('SIGKILL')
        } catch {
          // Already gone. Quitting is not a moment to throw.
        }
      }
      live.clear()
      return stopped
    },

    count: () => inFlight,
  }
}
