import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawnCodex, taskkillPath, type RunHandle } from './spawn'

/**
 * The process this module actually starts, and the kill that actually lands.
 *
 * ## Why this file exists at all
 *
 * `spawn.ts`'s header says the module was carved out of `index.ts` so that a
 * test could point at the code that really runs — because the kill path had
 * been asserted against a hand-supplied `RunHandle` while production discarded
 * the signal entirely, and passed. The boundary was drawn on 2026-08-19 and
 * nothing was ever asserted across it. A comment claiming a check that does not
 * exist is the same defect as the one it describes, one level up.
 *
 * So these spawn REAL processes. Nothing here is a double: `node -e …` for the
 * ordinary paths, and `/bin/sh` for the process tree, because the thing being
 * measured is what the operating system does with a signal.
 */

/** Every pid a test asked to be cleaned up, whatever the assertions did. */
const strays: number[] = []

afterEach(() => {
  for (const pid of strays.splice(0)) {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // Already gone, which is the outcome most of these tests are asserting.
    }
  }
})

/** Is this process still there? `signal 0` asks without sending anything. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Wait for a pid to go, up to a bound. Returns whether it went. */
async function gone(pid: number, withinMs = 4_000): Promise<boolean> {
  const until = Date.now() + withinMs
  while (Date.now() < until) {
    if (!alive(pid)) return true
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  return false
}

describe('running something and reading it back', () => {
  it('reports the exit code', async () => {
    const handle = spawnCodex(process.execPath, ['-e', 'process.exit(7)'])
    expect((await handle.finished).code).toBe(7)
  })

  it('hands the prompt down stdin and closes it', async () => {
    // Closing is the load-bearing half: `codex exec` reads until end-of-input,
    // so a stream left open is a child that never starts work.
    const handle = spawnCodex(
      process.execPath,
      ['-e', 'process.stdin.on("data",(d)=>process.stderr.write(String(d)))'],
      'the question',
    )
    const finished = await handle.finished
    expect(finished.stderr).toBe('the question')
    expect(finished.code).toBe(0)
  })

  it('does not open stdin when there is no prompt', async () => {
    // `'ignore'` rather than a pipe nobody writes to. An open pipe would be the
    // same hang, arrived at from the other direction.
    const handle = spawnCodex(process.execPath, [
      '-e',
      'process.stderr.write(require("node:fs").fstatSync(0).isFIFO()?"pipe":"not a pipe")',
    ])
    expect((await handle.finished).stderr).toBe('not a pipe')
  })

  it('bounds the diagnostics it keeps', async () => {
    // Another program's stderr, and its size is not ours.
    const handle = spawnCodex(process.execPath, ['-e', 'process.stderr.write("A".repeat(20000))'])
    expect((await handle.finished).stderr).toHaveLength(8192)
  })

  it('answers a null code rather than throwing when there is nothing to run', async () => {
    // `runSchema` reads this as "the run produced no answer" and shows the
    // stderr. A throw would arrive as an unhandled capability failure instead.
    const handle = spawnCodex('/nonexistent/codex', [])
    expect((await handle.finished).code).toBeNull()
  })
})

/**
 * The claim in `spawn.ts`: a shim whose real work is its own child survives
 * `child.kill()` and does not survive the group kill.
 *
 * BOTH ARMS, because only the first one makes the second one mean anything. A
 * child that dies either way would let a broken group kill look like a clean
 * pass — which is exactly how the Windows `taskkill` measurement went wrong on
 * its first attempt and had to be thrown out.
 */
describe.skipIf(process.platform === 'win32')('killing a process and what it started', () => {
  let scratch = ''

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'mochi-spawn-'))
  })

  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true })
  })

  /**
   * A leader that backgrounds a child and waits — the shape of an npm or nvm
   * shim, where the process we hold is a script and the work is beneath it.
   *
   * The two pids go to a FILE rather than to stderr. `finished` is the only way
   * out of the handle and it does not resolve until the process closes, so
   * stderr is unreadable for exactly as long as the test needs the process to
   * be alive.
   */
  function shimAndChild(): { readonly handle: RunHandle; readonly report: string } {
    const report = join(scratch, 'pids')
    return {
      handle: spawnCodex('/bin/sh', ['-c', `sleep 30 & echo "$$ $!" > ${report}; wait`]),
      report,
    }
  }

  async function pidsFrom(report: string): Promise<{ leader: number; child: number }> {
    const until = Date.now() + 4_000
    while (Date.now() < until) {
      const [leader = 0, child = 0] = (existsSync(report) ? readFileSync(report, 'utf8') : '')
        .trim()
        .split(/\s+/)
        .map(Number)
      if (Number.isInteger(leader) && Number.isInteger(child) && leader > 0 && child > 0) {
        strays.push(leader, child)
        return { leader, child }
      }
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    throw new Error('the leader never reported its pids')
  }

  it('CONTROL: signalling the leader alone leaves its child running', async () => {
    /*
      The negative control, and the original defect. This is what `child.kill()`
      did before `detached` and the negated pid: the deadline fired, `ask`
      returned "did not finish", and a Codex went on reading somebody's
      workspace with nothing holding it.

      Deliberately NOT `handle.kill`, which is the thing under test.
    */
    const { handle, report } = shimAndChild()
    const { leader, child } = await pidsFrom(report)
    process.kill(leader, 'SIGKILL')
    /*
      NOT `await handle.finished`, and the reason is worth keeping.

      `close` fires when the process has ended AND its stdio has closed. The
      surviving child inherited the stderr pipe, so it holds that fd for its
      whole thirty seconds: the leader is dead and `finished` does not resolve.
      Measured here by waiting for it and timing out at five seconds.

      That is not a quirk of the test. It is the failure `ask.ts`'s `abandoned`
      race exists for — a run whose leader is gone and whose promise never
      settles would otherwise hold the tool call, the ledger entry and the slot
      open for ever. This arm is where that behaviour is actually observable.
    */
    void handle
    expect(await gone(leader)).toBe(true)
    // Still there after the leader is confirmed gone. If this ever fails the
    // arrangement below stops being evidence, and the answer is to rebuild it
    // rather than to delete this.
    expect(alive(child)).toBe(true)
  })

  it('the group kill takes the child with it', async () => {
    const { handle, report } = shimAndChild()
    const { child } = await pidsFrom(report)
    expect(handle.kill('SIGKILL')).toBe(true)
    await handle.finished
    expect(await gone(child)).toBe(true)
  })

  it('forwards the signal it is given rather than picking one', async () => {
    /*
      Dropping the signal made the deadline's SIGKILL escalation inert in
      production while the test — which supplied its own adapter — went on
      passing. A SIGTERM the child ignores is what proves the argument arrives:
      if it were replaced by SIGKILL, the child would die.
    */
    const report = join(scratch, 'deaf')
    const handle = spawnCodex('/bin/sh', ['-c', `trap "" TERM; echo $$ > ${report}; sleep 30`])
    const until = Date.now() + 4_000
    let deaf = 0
    while (Date.now() < until && deaf <= 0) {
      deaf = Number((existsSync(report) ? readFileSync(report, 'utf8') : '').trim())
      if (deaf <= 0) await new Promise((resolve) => setTimeout(resolve, 25))
    }
    expect(deaf).toBeGreaterThan(0)
    strays.push(deaf)
    handle.kill('SIGTERM')
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(alive(deaf)).toBe(true)
    handle.kill('SIGKILL')
    expect(await gone(deaf)).toBe(true)
  })

  it('answers false when there is nothing left to signal', async () => {
    const handle = spawnCodex(process.execPath, ['-e', ''])
    await handle.finished
    // The ordinary race between a deadline firing and a child exiting on its
    // own. `ESRCH` is caught and answered the way `child.kill` answers it.
    expect(handle.kill('SIGKILL')).toBe(false)
  })
})

describe('a Windows launch that cannot be made', () => {
  it('reports the problem as a finished run rather than throwing', async () => {
    /*
      The whole Windows story, in one assertion. `spawn` refuses a `.cmd`
      without a shell — `EINVAL`, since the fix for CVE-2024-27980 — so every
      lookup on Windows threw out of `spawnCodex`, arrived at `dispatch` as an
      unhandled capability failure, and told the user "the lookup did not
      finish" with the reason nowhere. `runSchema` already knows how to show a
      null exit code and some stderr; this is that shape.
    */
    const real = process.platform
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    try {
      const handle = spawnCodex('C:\\nowhere\\codex.cmd', [])
      const finished = await handle.finished
      expect(finished.code).toBeNull()
      expect(finished.stderr).toContain('could not read')
      // Nothing was started, so there is nothing to signal — and saying `true`
      // would tell `running` it had stopped something it never held.
      expect(handle.kill('SIGKILL')).toBe(false)
    } finally {
      Object.defineProperty(process, 'platform', { value: real, configurable: true })
    }
  })
})

describe('where taskkill is looked for', () => {
  /*
    Named absolutely, never by bare name. `CreateProcess` searches the
    application directory and the working directory before `System32`, and the
    working directory here is a workspace somebody pointed her at — the one
    directory in this feature whose contents are, by design, not ours.
  */
  it('uses the system root it is given', () => {
    expect(taskkillPath('D:\\Windows')).toBe('D:\\Windows\\System32\\taskkill.exe')
  })

  it('falls back to the usual place when the environment says nothing', () => {
    expect(taskkillPath(undefined)).toBe('C:\\Windows\\System32\\taskkill.exe')
  })

  it('is always a path, never a name PATH could resolve', () => {
    for (const root of ['C:\\Windows', 'D:\\Windows', undefined]) {
      expect(taskkillPath(root)).toContain('\\System32\\taskkill.exe')
    }
  })
})
