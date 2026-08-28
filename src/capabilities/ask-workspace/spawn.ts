/**
 * The real process behind a delegation.
 *
 * Its own module for one reason: it lived in `index.ts`, which imports electron
 * and therefore cannot be loaded by a test -- so the only test of the kill path
 * supplied its own `RunHandle` and asserted against that. It passed while
 * production discarded the signal entirely, which is exactly how a dead
 * SIGKILL escalation survived a whole audit round. A module boundary here is
 * what lets the assertion point at the code that actually runs.
 *
 * That last sentence described an intention rather than a fact until
 * `spawn.test.ts` existed: the boundary was drawn and nothing was ever asserted
 * across it. The tests are the second half of the argument the header makes.
 */

import { spawn, spawnSync } from 'node:child_process'
import { win32 } from 'node:path'
import { isLaunch, launchFor } from './launch'
import { readBounded } from '../../main/store/read-bounded'

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
 * A shim is a few hundred bytes. Read through `readBounded` like every other
 * file this app did not write -- it refuses a symlink and refuses a large file
 * before the bytes reach the heap, and a `codex.cmd` that is neither of those
 * things fits many times over.
 */
const MAX_SHIM_BYTES = 65_536

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
 * NO shell on any platform, which on Windows takes a step of work rather than
 * an option: see `launch.ts` for the shim it resolves and for the measurement
 * that rules `shell: true` out.
 */
export function spawnCodex(path: string, args: readonly string[], input?: string): RunHandle {
  const launch = launchFor({
    path,
    args,
    platform: process.platform,
    runtime: process.execPath,
    read: (shim) => {
      const read = readBounded(shim, MAX_SHIM_BYTES)
      return read.ok ? read.text : null
    },
  })
  /*
    A HANDLE THAT REPORTS THE PROBLEM, rather than a throw.

    `runSchema` already knows what to do with a run that produced no answer: a
    null exit code and some stderr becomes the `why` a person reads. Throwing
    here would go up through `dispatch` as an unhandled capability failure and
    lose the one sentence that says what to do about it — which is what the
    Windows failure did for the whole of this build, arriving as "the lookup did
    not finish" with the `EINVAL` nowhere.
  */
  if (!isLaunch(launch)) {
    return {
      finished: Promise.resolve({ code: null, stderr: launch.problem }),
      kill: () => false,
    }
  }

  const child = spawn(launch.command, [...launch.args], {
    windowsHide: true,
    stdio: [input === undefined ? 'ignore' : 'pipe', 'ignore', 'pipe'],
    // Empty on every path but the resolved Windows shim, where it is what stops
    // `process.execPath` starting a second copy of this application.
    env: { ...process.env, ...launch.adds },
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

      ON WINDOWS IT BUYS NOTHING. There are no process groups there; `detached`
      means only that the child may outlive this process. The tree is ended by
      `taskkill /T` instead, and that is measured too — see `killTree`.
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
      if (process.platform === 'win32') return killTree(pid) || child.kill(signal)
      try {
        process.kill(-pid, signal)
        return true
      } catch (error: unknown) {
        /*
          ESRCH IS THE ORDINARY RACE. `ESRCH` means the group is gone: the child
          exited between the deadline firing and this line, which happens and
          costs nothing. A group persists while any member is in it, so this
          cannot be ESRCH while a descendant is still running.

          That sentence is true where process groups exist and MEASURABLY FALSE
          on Windows, which has no such concept — measured on a real Windows 11
          box on 2026-08-28, where `process.kill(-19556)` gave `ESRCH` and
          `process.kill(19556)` succeeded a line later, proving the process was
          alive. Because this warning was gated on the errno, the one platform
          where the group kill can NEVER work was the one platform where the
          warning never fired: the leak was routed into the silence.

          Windows no longer reaches this line at all. `killTree` above is the
          answer there, which is better than warning about it.

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

/**
 * Where `taskkill` is, named absolutely rather than looked up.
 *
 * `CreateProcess` searches the application's own directory and the working
 * directory before `System32`, so spawning it by bare name would run a
 * `taskkill.exe` sitting in the workspace somebody pointed her at. The
 * workspace is the one directory in this feature whose contents are, by
 * design, not ours.
 */
export function taskkillPath(systemRoot: string | undefined): string {
  return win32.join(systemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe')
}

/**
 * End a process and everything below it, on Windows.
 *
 * ## Why not `process.kill(-pid)`, and why not `child.kill()`
 *
 * Windows has no process groups, so the negated pid is an error rather than a
 * tree — measured, and described at the call site. `child.kill()` reaches the
 * leader alone, and the leader is a shim: the real work is its child.
 *
 * `taskkill /T` walks the parent-pid tree instead. MEASURED on a real Windows
 * 11 box on 2026-08-28, with the control that makes it mean something:
 *
 * | arrangement | parent after | detached grandchild after |
 * | --- | --- | --- |
 * | kill nothing, wait 4s | alive | alive — the harness works |
 * | `/F`, no `/T` | gone | **alive — the leak** |
 * | `/T /F` | gone | gone |
 *
 * The middle row is the whole evidence: the same kill without `/T` leaves the
 * detached grandchild running. A first attempt at that measurement used a
 * non-detached grandchild in both arms, which died either way — so `/T` and
 * no-`/T` were indistinguishable while LOOKING like a clean pass for `/T`. It
 * was thrown out. A negative control has to be able to exhibit the failure it
 * controls for.
 *
 * ## `/F` for both signals, which loses nothing
 *
 * The caller escalates SIGTERM to SIGKILL after a grace period. There is no
 * such distinction to preserve here: Node maps EVERY signal to
 * `TerminateProcess` on Windows, so `child.kill('SIGTERM')` was already
 * ungraceful. `/F` for both extends what already happened to the leader across
 * the tree, rather than introducing a force that was not there before.
 *
 * ## What is not known
 *
 * The measurement ran inside an OpenSSH session job object, which takes its
 * descendants with it — a plausible reason the NON-detached grandchild died
 * without `/T`. A desktop Electron app has no such job. So `/T` is treated as
 * REQUIRED rather than as belt-and-braces; nothing here rests on children
 * dying by themselves.
 */
function killTree(pid: number): boolean {
  const done = spawnSync(
    taskkillPath(process.env['SystemRoot']),
    ['/pid', String(pid), '/T', '/F'],
    { windowsHide: true, stdio: 'ignore' },
  )
  if (done.error !== undefined) {
    console.warn(
      `[codex] could not run taskkill (${done.error.message}); ` +
        'falling back to the leader alone, and any children it started may survive',
    )
    return false
  }
  // 0 is killed. 128 is "no such process", which is the ordinary race between a
  // deadline firing and a child exiting on its own, and the same answer
  // `child.kill` gives for it: nothing to do, and nothing wrong.
  return done.status === 0
}
