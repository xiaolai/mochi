/**
 * Ask a short-lived child process a question, without blocking anything.
 *
 * ONE implementation, because there were two and the second was already
 * wrong. `codex/status.ts` and `surfaces/tray.ts` both needed "run a small
 * command, read one line, give up after a while", and each grew its own — so
 * when the first was fixed for an unbounded buffer and a listener that
 * outlived a failed `kill()`, the second silently kept both defects. Two
 * copies of a careful thing are one careful thing and one liability.
 *
 * Everything here exists because of a specific failure:
 *
 * - **Async.** These began as `spawnSync` with a 10s deadline each, and
 *   `checkCodex` makes up to three — thirty seconds of frozen main thread.
 * - **The caller's environment.** A probe that describes a machine must SPAWN
 *   against that machine. Inheriting `process.env` instead made the test suite
 *   load-dependent: busy, the npm lookup timed out and the test passed; idle,
 *   it answered and the same test failed.
 * - **A capped buffer.** Every caller reads one short line. An unbounded one
 *   grows for as long as a chatty process runs.
 * - **Cleanup that does not trust `kill()`.** It is best-effort; a child that
 *   ignores the signal, or a grandchild that outlives it, keeps writing into a
 *   closure nothing else releases.
 */

import { spawn } from 'node:child_process'

/** Enough for a version string or a path, and far short of a leak. */
export const MAX_PROBE_OUTPUT = 64 * 1024

export interface ProbeResult {
  /** Exit code, or null if it never exited cleanly. */
  readonly status: number | null
  readonly stdout: string
  /** It could not be run, or it ran out of time. Distinct from a non-zero exit. */
  readonly failed: boolean
  /**
   * It ran out of time, as opposed to failing to start.
   *
   * The two were one flag, and the caller turned both into "reinstall Codex".
   * A binary that will not spawn is plausibly a broken install; one that is
   * merely slow to answer on a loaded machine is not, and telling somebody to
   * reinstall a working tool because their laptop was busy is advice that
   * costs an afternoon.
   */
  readonly timedOut: boolean
}

export interface ProbeOptions {
  readonly platform: NodeJS.Platform
  readonly env: NodeJS.ProcessEnv
  /** Windows batch shims cannot be executed without one. See `needsShell`. */
  readonly shell?: boolean
  readonly timeoutMs?: number
}

export function runProbe(
  command: string,
  args: readonly string[],
  options: ProbeOptions,
): Promise<ProbeResult> {
  const shell = options.shell === true
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(shell ? `"${command}"` : command, [...args], {
        shell,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'],
        env: options.env,
      })
    } catch {
      // `spawn` can throw synchronously rather than emitting `error`, and an
      // unresolved promise here would hang whatever awaited it.
      resolve({ status: null, stdout: '', failed: true, timedOut: false })
      return
    }

    let stdout = ''
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      // SLICED to the cap, not "append the whole chunk while under it" — that
      // form overshoots by up to one chunk, so the declared limit was a
      // suggestion rather than a bound.
      if (stdout.length >= MAX_PROBE_OUTPUT) return
      stdout += chunk.slice(0, MAX_PROBE_OUTPUT - stdout.length)
    })

    let settled = false
    const finish = (result: ProbeResult): void => {
      if (settled) return
      settled = true
      clearTimeout(deadline)
      child.stdout?.removeAllListeners('data')
      child.stdout?.destroy()
      resolve(result)
    }
    const deadline = setTimeout(() => {
      child.kill()
      finish({ status: null, stdout, failed: true, timedOut: true })
    }, options.timeoutMs ?? 10_000)
    child.on('error', () => finish({ status: null, stdout, failed: true, timedOut: false }))
    child.on('close', (code) => finish({ status: code, stdout, failed: false, timedOut: false }))
  })
}
