import { describe, expect, it } from 'vitest'
import { MAX_PROBE_OUTPUT, runProbe } from './probe'

/**
 * Real child processes, not mocks.
 *
 * Everything this module guards against is a property of an actual process —
 * a chatty one, a slow one, a missing one — and a fake `spawn` would only
 * prove the fake behaves as written. `node -e` is available by definition
 * wherever this test runs.
 */
const node = process.execPath
const here = { platform: process.platform, env: process.env }

describe('runProbe', () => {
  it('returns what a command printed, with its exit code', async () => {
    const result = await runProbe(node, ['-e', 'process.stdout.write("hello")'], here)
    expect(result.stdout).toBe('hello')
    expect(result.status).toBe(0)
    expect(result.failed).toBe(false)
  })

  it('reports a non-zero exit as a status, not a failure', async () => {
    // The distinction the callers depend on: `npm prefix -g` exiting 1 means
    // "no answer", while a failure means "could not even run". Collapsing them
    // would make a missing tool and a working tool with bad news identical.
    const result = await runProbe(node, ['-e', 'process.exit(3)'], here)
    expect(result.status).toBe(3)
    expect(result.failed).toBe(false)
  })

  it('reports a command that cannot run as failed', async () => {
    const result = await runProbe('definitely-not-a-real-binary-xyz', [], here)
    expect(result.failed).toBe(true)
    expect(result.status).toBeNull()
  })

  it('caps the buffer EXACTLY, rather than by up to one chunk', async () => {
    // The bug this replaced was `if (stdout.length < CAP) stdout += chunk`,
    // which appends a WHOLE chunk once under the limit and so overshoots by
    // however large that chunk is.
    //
    // The chunk sizes are chosen to expose it, and the first version of this
    // test did not: writing one huge string arrives in 64KiB pieces that land
    // exactly on the cap, so the buggy form scored a perfect 65536 by luck and
    // the test passed against the defect it existed to catch. Three unaligned
    // 40KiB writes cannot land on the boundary — the naive version reaches
    // 81920 on the second.
    const chunk = Math.round(MAX_PROBE_OUTPUT * 0.625)
    const script = [
      `const c = "x".repeat(${chunk});`,
      'let n = 0;',
      'const t = setInterval(() => { process.stdout.write(c); if (++n === 3) clearInterval(t) }, 20)',
    ].join(' ')
    const result = await runProbe(node, ['-e', script], { ...here, timeoutMs: 20_000 })
    expect(result.stdout.length).toBe(MAX_PROBE_OUTPUT)
  })

  it('gives up on a process that will not finish, and says so', async () => {
    const started = Date.now()
    const result = await runProbe(node, ['-e', 'setInterval(() => {}, 1000)'], {
      ...here,
      timeoutMs: 300,
    })
    expect(result.failed).toBe(true)
    // Bounded by the deadline rather than by the process, which is the point.
    expect(Date.now() - started).toBeLessThan(5_000)
  })

  it('spawns against the environment it was GIVEN, not this process’s', async () => {
    // The property that makes a probe a probe. Getting this wrong made the
    // Codex suite load-dependent: busy, the npm lookup timed out and the test
    // passed; idle, npm answered from the real environment and it failed.
    const result = await runProbe(
      node,
      ['-e', 'process.stdout.write(process.env.MOCHI_MARK ?? "")'],
      {
        ...here,
        env: { ...process.env, MOCHI_MARK: 'from-the-probe' },
      },
    )
    expect(result.stdout).toBe('from-the-probe')
  })
})
