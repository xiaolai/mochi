import { describe, expect, it } from 'vitest'
import { spawnCodex } from './spawn'

/**
 * The REAL adapter, against a real process.
 *
 * This exists because its absence let a defect through a whole audit round. The
 * deadline's SIGKILL escalation was added, tested against an injected
 * `RunHandle` that honoured the signal, and shipped inert -- production was
 * `kill: () => child.kill()`, which discards the argument. The suite was green
 * and the feature was dead, and the reason was that the only code the test
 * could reach was the test's own stub.
 *
 * So these spawn `node`. Slower than a fake and the point is precisely that
 * they are not one.
 */
describe('the process a delegation really runs', () => {
  it('reports the exit code of a process that ends normally', async () => {
    const handle = spawnCodex(process.execPath, ['-e', 'process.exit(7)'])
    expect(await handle.finished).toMatchObject({ code: 7 })
  })

  it('reports a binary that does not exist rather than throwing', async () => {
    const handle = spawnCodex('/nonexistent/codex', ['exec'])
    expect(await handle.finished).toMatchObject({ code: null })
  })

  it('captures stderr, bounded', async () => {
    const handle = spawnCodex(process.execPath, [
      '-e',
      'process.stderr.write("x".repeat(50000)); process.exit(1)',
    ])
    const { stderr } = await handle.finished
    expect(stderr.length).toBeGreaterThan(0)
    expect(stderr.length).toBeLessThanOrEqual(8192)
  })

  it('stops a process that goes when asked', async () => {
    const handle = spawnCodex(process.execPath, ['-e', 'setInterval(() => {}, 1000)'])
    handle.kill()
    const { code } = await handle.finished
    expect(code).toBeNull()
  })

  /**
   * The assertion that was missing.
   *
   * A process ignoring SIGTERM is what makes the escalation load-bearing: if
   * the signal is dropped on the way through, this hangs until the suite times
   * out rather than passing quietly.
   */
  it('forwards SIGKILL to a process that ignores SIGTERM', async () => {
    const handle = spawnCodex(process.execPath, [
      '-e',
      // Ignores the polite request, exactly as a wedged Codex would.
      'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)',
    ])
    // Give the handler time to install before the first signal.
    await new Promise((resolve) => setTimeout(resolve, 200))
    handle.kill()
    await new Promise((resolve) => setTimeout(resolve, 200))
    handle.kill('SIGKILL')
    const { code } = await handle.finished
    expect(code).toBeNull()
  }, 10_000)
})
