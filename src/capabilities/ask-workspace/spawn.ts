/**
 * The real process behind a delegation.
 *
 * Its own module for one reason: it lived in `index.ts`, which imports electron
 * and therefore cannot be loaded by a test -- so the only test of the kill path
 * supplied its own `RunHandle` and asserted against that. It passed while
 * production discarded the signal entirely, which is exactly how a dead
 * SIGKILL escalation survived a whole audit round. A module boundary here is
 * what lets the assertion point at the code that actually runs.
 */

import { spawn } from 'node:child_process'
/**
 * What a running Codex looks like to its caller.
 *
 * Declared here rather than imported from the orchestration above it: this
 * module is the one that produces one, and a type owned by its consumer is a
 * cycle waiting for a third file.
 */
export interface RunHandle {
  readonly finished: Promise<{ readonly code: number | null; readonly stderr: string }>
  readonly kill: (signal?: NodeJS.Signals) => boolean
}

/** Bounded: this is another program's diagnostics, and its size is not ours. */
const MAX_STDERR = 8192

/**
 * Run Codex, and hand it the prompt down stdin rather than in an argument.
 *
 * ## Why not an argv entry, which is what this used to be
 *
 * The prompt is a whole question, and for the sleep summariser it is a whole
 * transcript. An argv entry is not private: `ps` shows the full command line of
 * every process to every user on the machine, so the words somebody said to her
 * were readable by anything running as anybody. It is also bounded — `ARG_MAX`
 * is a few hundred kilobytes, and a long conversation is the one input here
 * that grows without a ceiling.
 *
 * `codex exec` reads its instructions from stdin when no PROMPT argument is
 * given. Nothing about the invocation changes except where the text arrives.
 *
 * NO shell either way, so nothing parses the text but the process itself.
 */
export function spawnCodex(path: string, args: readonly string[], input?: string): RunHandle {
  const child = spawn(path, [...args], {
    windowsHide: true,
    stdio: [input === undefined ? 'ignore' : 'pipe', 'ignore', 'pipe'],
    /*
      ITS OWN PROCESS GROUP, so the kill reaches what it started.

      `child.kill()` signals one process. The thing being launched is a CLI that
      spawns its own workers — and on a machine where `codex` resolves to an
      nvm or npm shim, the process this holds is a shell script and the real
      work is its child. Signalling the leader alone left those running: the
      deadline fired, `ask` returned "did not finish", and a Codex went on
      reading somebody's workspace with nothing holding it.

      `detached` makes this process the group leader; `kill` below negates the
      pid to signal the whole group. That is also what makes `running.stopAll()`
      at quit mean what its comment says.

      MEASURED, §73, with a control: a shim whose real work is its own child
      survives `child.kill('SIGKILL')` and does not survive the group kill.
    */
    detached: true,
  })
  if (input !== undefined) {
    /*
      Written and CLOSED, and the error swallowed.

      Codex reads until end-of-input, so a stream left open is a child that
      never starts work. And a child that died before the write lands gives
      `EPIPE` on this handle rather than anywhere useful — `finished` already
      reports that death with its exit code and its stderr, which is the answer
      the caller acts on.
    */
    child.stdin?.on('error', () => undefined)
    child.stdin?.end(input, 'utf8')
  }
  let stderr = ''
  child.stderr?.setEncoding('utf8')
  child.stderr?.on('data', (chunk: string) => {
    if (stderr.length < MAX_STDERR) stderr += chunk.slice(0, MAX_STDERR - stderr.length)
  })
  return {
    finished: new Promise((resolve) => {
      child.on('error', () => resolve({ code: null, stderr }))
      child.on('close', (code) => resolve({ code, stderr }))
    }),
    // The SIGNAL is forwarded. Dropping it made the deadline's escalation inert
    // in production while the test -- which supplied its own adapter -- went on
    // passing.
    /*
      THE GROUP, falling back to the process.

      `process.kill(-pid, …)` signals every member of the group this leads.
      It throws `ESRCH` once the group is gone, which is the ordinary race
      between a deadline firing and a child exiting on its own — caught, and
      answered the way `child.kill` answers it.
    */
    kill: (signal?: NodeJS.Signals) => {
      const pid = child.pid
      if (pid === undefined) return false
      try {
        process.kill(-pid, signal)
        return true
      } catch (error: unknown) {
        /*
          ESRCH IS THE ORDINARY RACE. Anything else is a possible leak, and says so.

          `ESRCH` means the group is gone — the child exited between the
          deadline firing and this line, which happens and costs nothing. A
          group persists while any member is in it, so this cannot be ESRCH
          while a descendant is still running.

          Every other errno is different in kind: the group is THERE and could
          not be signalled, and the fallback below reaches only the leader. That
          is precisely the leak `running.ts` exists to prevent, so it is
          reported rather than absorbed — a fallback that quietly does less than
          the thing it replaced is how the first version of this went unnoticed.
        */
        const code = (error as NodeJS.ErrnoException).code
        if (code !== 'ESRCH') {
          console.warn(
            `[codex] could not signal the process group (${code ?? 'unknown'}); ` +
              'falling back to the leader alone, and any children it started may survive',
          )
        }
        return child.kill(signal)
      }
    },
  }
}
