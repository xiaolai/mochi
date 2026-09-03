import { describe, expect, it } from 'vitest'

import { shellPath, widenPath } from './shell-path'
import type { ProbeResult } from './probe'

/**
 * Asking the shell where things are, and refusing to guess when it will not say.
 *
 * The defect this covers was reported from a real machine on 2026-09-03: Codex
 * installed under mise at `~/.local/share/mise/installs/node/lts/bin`, the app
 * reporting it absent, and `which codex` in the same person's terminal printing
 * the path. See `shell-path.ts` for why a longer list of well-known directories
 * is not the answer.
 */
const ok = (stdout: string): ProbeResult => ({
  status: 0,
  stdout,
  failed: false,
  timedOut: false,
})

const asked = (result: ProbeResult): { run: () => Promise<ProbeResult>; seen: string[][] } => {
  const seen: string[][] = []
  return {
    seen,
    run: (command: string, args: readonly string[]) => {
      seen.push([command, ...args])
      return Promise.resolve(result)
    },
  } as never
}

const deps = (
  over: Partial<Parameters<typeof shellPath>[0]> = {},
): Parameters<typeof shellPath>[0] => ({
  platform: 'darwin',
  env: { SHELL: '/bin/zsh' },
  ...over,
})

describe('the PATH the person actually has', () => {
  it('reads it from an interactive login shell', async () => {
    const probe = asked(ok('/opt/homebrew/bin:/usr/bin'))
    const found = await shellPath(deps({ run: probe.run }))
    expect(found).toBe('/opt/homebrew/bin:/usr/bin')
    /*
      `-i` as well as `-l`, and it is the whole point. `mise activate`, `nvm.sh`
      and asdf's shims are sourced from `.zshrc` — the INTERACTIVE file — so a
      login-only shell reports a PATH without the manager that put Codex where
      it is.
    */
    expect(probe.seen[0]).toEqual(['/bin/zsh', '-ilc', 'printf %s "$PATH"'])
  })

  it('takes the last line, because an interactive shell may greet you', async () => {
    const probe = asked(ok('Welcome to your shell!\nyou have mail\n/opt/homebrew/bin:/usr/bin'))
    expect(await shellPath(deps({ run: probe.run }))).toBe('/opt/homebrew/bin:/usr/bin')
  })

  it('says nothing rather than guessing when the shell fails', async () => {
    for (const bad of [
      { status: 1, stdout: '', failed: false, timedOut: false },
      { status: null, stdout: '', failed: true, timedOut: false },
      { status: null, stdout: '', failed: false, timedOut: true },
    ] satisfies ProbeResult[]) {
      expect(await shellPath(deps({ run: asked(bad).run }))).toBeNull()
    }
  })

  it('refuses output that is not a path', async () => {
    // A shell that answered with a banner and nothing else. Returning it would
    // widen PATH with a sentence.
    expect(await shellPath(deps({ run: asked(ok('command not found')).run }))).toBeNull()
  })

  it('does not ask when there is no shell to ask', async () => {
    const probe = asked(ok('/whatever'))
    expect(await shellPath(deps({ env: {}, run: probe.run }))).toBeNull()
    expect(probe.seen).toEqual([])
  })

  it('does not ask on Windows, where a GUI process already has the real PATH', async () => {
    const probe = asked(ok('/whatever'))
    expect(await shellPath(deps({ platform: 'win32', run: probe.run }))).toBeNull()
    expect(probe.seen).toEqual([])
  })
})

describe('widening, not replacing', () => {
  it('keeps what the app already had, first', () => {
    /*
      Order is the assertion. Everything else in this process has been resolving
      against launchd's PATH, and a profile that shadows a system binary must
      not change what `/usr/bin/env` means underneath a running application.
      This only ever adds places to look.
    */
    expect(widenPath('/usr/bin:/bin', '/opt/homebrew/bin:/usr/bin')).toBe(
      '/usr/bin:/bin:/opt/homebrew/bin',
    )
  })

  it('adds the directory the whole thing exists for', () => {
    const widened = widenPath(
      '/usr/bin:/bin:/usr/sbin:/sbin',
      '/Users/someone/.local/share/mise/installs/node/lts/bin:/usr/bin',
    )
    expect(widened.split(':')).toContain('/Users/someone/.local/share/mise/installs/node/lts/bin')
  })

  it('survives a shell that would not say', () => {
    expect(widenPath('/usr/bin:/bin', null)).toBe('/usr/bin:/bin')
  })

  it('drops nothing and repeats nothing', () => {
    const widened = widenPath('/a:/b', '/b:/c')
    expect(widened).toBe('/a:/b:/c')
  })
})
