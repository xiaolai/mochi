import { afterAll, describe, expect, it } from 'vitest'
import { EXPIRY_MARGIN_MS, authModeOf, readTokenState } from './auth'
import { isLocated, locateCodex } from './locate'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { LOCALE_TAGS, messagesFor } from '@shared/i18n'
import { needsShell, checkCodex, remedyFor, type CodexStatus, type Remedy } from './status'

/** A JWT with the given `exp`. Only the payload matters; nothing verifies it. */
function jwt(expSeconds: number | null): string {
  const claims = expSeconds === null ? { sub: 'x' } : { sub: 'x', exp: expSeconds }
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url')
  return `header.${body}.signature`
}

const NOW = Date.UTC(2026, 7, 11, 12, 0, 0)
const chatgpt = (exp: number | null): unknown => ({
  auth_mode: 'chatgpt',
  OPENAI_API_KEY: null,
  tokens: { access_token: jwt(exp), refresh_token: 'r', account_id: 'a' },
})

describe('readTokenState', () => {
  it('accepts a token with time left', async () => {
    const state = readTokenState(chatgpt(NOW / 1000 + 3600), NOW)
    expect(state.kind).toBe('valid')
  })

  it('rejects one that has already expired', async () => {
    const state = readTokenState(chatgpt(NOW / 1000 - 60), NOW)
    expect(state.kind).toBe('expired')
  })

  it('rejects one expiring inside the margin', async () => {
    // Minting a key and opening a session takes seconds. A token that dies
    // during that fails in the middle of somebody speaking to her, rather than
    // before they start -- so the margin buys a clear error instead of a
    // mysterious one.
    const state = readTokenState(chatgpt((NOW + EXPIRY_MARGIN_MS / 2) / 1000), NOW)
    expect(state.kind).toBe('expired')
  })

  it('accepts one expiring just outside the margin', async () => {
    const state = readTokenState(chatgpt((NOW + EXPIRY_MARGIN_MS * 2) / 1000), NOW)
    expect(state.kind).toBe('valid')
  })

  it('treats a token with no readable expiry as unreadable, not as eternal', async () => {
    // The tempting default is "assume it works". That defers the failure to the
    // moment somebody talks to her, which is the worst place to discover it.
    expect(readTokenState(chatgpt(null), NOW).kind).toBe('unreadable')
    const notAJwt = { auth_mode: 'chatgpt', tokens: { access_token: 'opaque-string' } }
    expect(readTokenState(notAJwt, NOW).kind).toBe('unreadable')
  })

  it('recognises an API key login, which does not expire', async () => {
    const state = readTokenState({ auth_mode: 'apikey', OPENAI_API_KEY: 'sk-x' }, NOW)
    expect(state.kind).toBe('api-key')
  })

  it('rejects apikey mode with no key rather than calling it absent', async () => {
    const state = readTokenState({ auth_mode: 'apikey', OPENAI_API_KEY: null }, NOW)
    expect(state.kind).toBe('unreadable')
  })

  it('reports absence for a file with no tokens at all', async () => {
    expect(readTokenState({ auth_mode: 'chatgpt' }, NOW).kind).toBe('absent')
    expect(readTokenState({ auth_mode: 'chatgpt', tokens: {} }, NOW).kind).toBe('absent')
  })

  it('survives junk instead of throwing', async () => {
    for (const value of [null, 42, 'x', [], { tokens: 'not an object' }]) {
      expect(() => readTokenState(value, NOW)).not.toThrow()
    }
  })

  it('never returns the token or the account id', async () => {
    // The one thing this module must not do. Asserted on the whole serialised
    // result, so a field added later cannot quietly start leaking one.
    const serialised = JSON.stringify(readTokenState(chatgpt(NOW / 1000 + 3600), NOW))
    expect(serialised).not.toContain('access_token')
    expect(serialised).not.toContain('header.')
    expect(serialised).not.toContain('account_id')
  })
})

describe('authModeOf', () => {
  it('reads both spellings Codex has used', async () => {
    expect(authModeOf({ auth_mode: 'chatgpt' })).toBe('chatgpt')
    expect(authModeOf({ auth_mode: 'chatgpt_login' })).toBe('chatgpt')
    expect(authModeOf({ auth_mode: 'apikey' })).toBe('apikey')
  })

  it('says unknown rather than guessing', async () => {
    for (const value of [null, {}, { auth_mode: 'something-new' }, 5]) {
      expect(authModeOf(value)).toBe('unknown')
    }
  })
})

describe('locateCodex', () => {
  const unix = {
    platform: 'darwin' as NodeJS.Platform,
    home: '/Users/x',
    env: { PATH: '/usr/bin:/opt/homebrew/bin' },
  }

  it('finds it on PATH', async () => {
    const found = await locateCodex({ ...unix, exists: (p) => p === '/opt/homebrew/bin/codex' })
    expect(isLocated(found) && found.path).toBe('/opt/homebrew/bin/codex')
  })

  it('prefers PATH over a well-known directory', async () => {
    // Somebody who put a specific build on their PATH meant that one.
    const found = await locateCodex({
      ...unix,
      env: { PATH: '/custom/bin' },
      exists: (p) => p === '/custom/bin/codex' || p === '/usr/local/bin/codex',
    })
    expect(isLocated(found) && found.path).toBe('/custom/bin/codex')
  })

  it('looks beyond PATH, because a GUI app does not inherit the shell’s', async () => {
    // The real failure this guards: launched from Finder, an app gets a minimal
    // launchd PATH with no homebrew and no npm prefix, so the same CLI that
    // works in the user's terminal is invisible.
    const found = await locateCodex({
      ...unix,
      env: { PATH: '/usr/bin' },
      exists: (p) => p === '/Users/x/.local/bin/codex',
    })
    expect(isLocated(found) && found.path).toBe('/Users/x/.local/bin/codex')
  })

  it('reports everywhere it looked when there is nothing', async () => {
    const found = await locateCodex({ ...unix, exists: () => false })
    expect(isLocated(found)).toBe(false)
    expect(found.searched.length).toBeGreaterThan(4)
    expect(found.searched).toContain('/usr/bin/codex')
  })

  it('prefers codex.cmd over the extensionless file on Windows', async () => {
    // Measured: an npm global install writes THREE files and no .exe --
    // `codex` (an sh script for Git-Bash), `codex.cmd`, `codex.ps1`. Listing
    // the extensionless one first, as this did, finds the single entry Windows
    // cannot execute and reports `unusable` on a working machine.
    const found = await locateCodex({
      platform: 'win32',
      home: 'C:\\Users\\x',
      env: { PATH: 'C:\\bin' },
      exists: (p) => p === 'C:\\bin\\codex' || p === 'C:\\bin\\codex.cmd',
    })
    expect(isLocated(found) && found.path).toBe('C:\\bin\\codex.cmd')
  })

  it('never names codex.ps1 or codex.js', async () => {
    // .PS1 is absent from the measured PATHEXT, so bare-name resolution can
    // never reach it. .JS is present at position 7, which is worse: handing
    // Windows a `codex.js` starts Windows Script Host instead of node, so it
    // fails strangely rather than cleanly.
    const found = await locateCodex({
      platform: 'win32',
      home: 'C:\\Users\\x',
      env: { PATH: 'C:\\bin' },
      exists: () => false,
    })
    expect(found.searched.some((p) => p.endsWith('.ps1'))).toBe(false)
    expect(found.searched.some((p) => p.endsWith('.js'))).toBe(false)
  })

  it('searches every nvm node version, where the only real install lives', async () => {
    // The single Codex on the surveyed fleet sits in an nvm tree and is
    // invisible to which/command -v, because NVM_DIR is set in .zshrc alone.
    // Stat-ing the directory finds what every shell-based lookup misses.
    const found = await locateCodex({
      ...unix,
      env: { PATH: '/usr/bin' },
      list: (dir) => (dir === '/Users/x/.nvm/versions/node' ? ['v20.0.0', 'v22.19.0'] : []),
      exists: (p) => p === '/Users/x/.nvm/versions/node/v22.19.0/bin/codex',
    })
    expect(isLocated(found) && found.path).toBe('/Users/x/.nvm/versions/node/v22.19.0/bin/codex')
  })

  it('no longer searches directories that never existed', async () => {
    // ~/.npm-global/bin and ~/.bun/bin appeared zero times across five Linux
    // hosts; %LOCALAPPDATA%\\Programs\\codex was a native-installer layout with
    // no instance anywhere. Guesses cost a stat each and imply evidence.
    const found = await locateCodex({ ...unix, exists: () => false })
    for (const gone of ['.npm-global', '.bun']) {
      expect(
        found.searched.some((p) => p.includes(gone)),
        gone,
      ).toBe(false)
    }
  })

  it('tries the Windows extensions, without which npm’s shim is invisible', async () => {
    // npm's global install writes `codex.cmd`. A scan looking only for a bare
    // `codex` finds nothing on a machine where the CLI works perfectly.
    const found = await locateCodex({
      platform: 'win32',
      home: 'C:\\Users\\x',
      env: { PATH: 'C:\\bin', APPDATA: 'C:\\Users\\x\\AppData\\Roaming' },
      exists: (p) => p === 'C:\\Users\\x\\AppData\\Roaming\\npm\\codex.cmd',
    })
    expect(isLocated(found) && found.path).toBe('C:\\Users\\x\\AppData\\Roaming\\npm\\codex.cmd')
  })

  it('uses the platform’s own separators', async () => {
    const found = await locateCodex({
      platform: 'win32',
      home: 'C:\\Users\\x',
      env: { PATH: 'C:\\a;C:\\b' },
      exists: (p) => p === 'C:\\b\\codex.exe',
    })
    expect(isLocated(found) && found.path).toBe('C:\\b\\codex.exe')
  })

  it('copes with an empty or absent PATH', async () => {
    for (const env of [{}, { PATH: '' }]) {
      await expect(locateCodex({ ...unix, env, exists: () => false })).resolves.toBeDefined()
    }
  })
})

describe('remedyFor', () => {
  const cases: ReadonlyArray<[CodexStatus, Remedy | null]> = [
    [{ kind: 'ready', version: 'v', mode: 'chatgpt' }, null],
    [{ kind: 'not-installed', searched: [] }, 'install'],
    [{ kind: 'unusable', path: '/x', reason: 'boom' }, 'reinstall'],
    // A busy machine is not a broken install: the answer is to ask again, never
    // to reinstall a tool that is working.
    [{ kind: 'timed-out', path: '/x' }, 'retry'],
    [{ kind: 'logged-out', version: 'v' }, 'login'],
    [{ kind: 'stale', version: 'v', expiredAt: new Date(NOW) }, 'login'],
    [{ kind: 'unreadable', version: 'v', reason: 'r' }, 'login'],
  ]

  it('names a remedy for every unhappy state, and none when ready', async () => {
    // The whole point of the module. A state with no remedy is a companion who
    // cannot hear you and will not say why.
    for (const [status, expected] of cases) {
      expect(remedyFor(status), status.kind).toBe(expected)
    }
  })

  it('covers every status kind', async () => {
    // Adding a kind fails here until somebody decides what a person does about
    // it -- which is the only way a new failure mode cannot ship as a silent one.
    const covered = new Set(cases.map(([status]) => status.kind))
    const all: ReadonlyArray<CodexStatus['kind']> = [
      'ready',
      'not-installed',
      'unusable',
      'logged-out',
      'stale',
      'unreadable',
    ]
    for (const kind of all) expect(covered.has(kind), kind).toBe(true)
  })

  it('every remedy has a sentence in every language', async () => {
    // The coupling that actually matters: a remedy key with no message renders
    // an empty dialog, which is worse than no dialog -- it looks like the app
    // tried to tell you something and failed.
    for (const tag of LOCALE_TAGS) {
      const { remedy } = messagesFor(tag).codex
      for (const [, key] of cases) {
        if (key === null) continue
        expect(remedy[key]?.trim(), `${tag}.${key}`).toBeTruthy()
      }
    }
  })

  it('every status has a reason line in every language', async () => {
    for (const tag of LOCALE_TAGS) {
      const { codex } = messagesFor(tag)
      // `notInstalled` is one line per pronoun; the rest name no one. Both
      // are flattened so this keeps asserting what it always did -- that every
      // reason a locale can show is a real sentence.
      for (const line of [
        ...Object.values(codex.notInstalled),
        codex.unusable,
        codex.loggedOut,
        codex.stale,
        codex.unreadable,
      ]) {
        expect(line.trim(), tag).toBeTruthy()
      }
    }
  })
})

describe('checkCodex against a real filesystem', () => {
  // These call `accessSync` and `spawnSync` for real. The probe describes a
  // machine, so "a machine without Codex" is expressible without uninstalling
  // anything -- which is what the roots override exists for.
  const nowhere = join(tmpdir(), 'mochi-no-such-machine')

  it('reports not-installed when the binary is genuinely absent', async () => {
    // The branch that could not be exercised before. An earlier attempt to fake
    // it by stripping PATH silently found /opt/homebrew/bin/codex and reported
    // nothing at all — a green that meant the test never ran.
    const status = await checkCodex({
      platform: 'darwin',
      env: { PATH: join(nowhere, 'bin') },
      home: nowhere,
      roots: [join(nowhere, 'also-nothing')],
    })
    expect(status.kind).toBe('not-installed')
    expect(remedyFor(status)).toBe('install')
  })

  it('says everywhere it looked, so an install in an odd place is diagnosable', async () => {
    const status = await checkCodex({
      platform: 'darwin',
      env: { PATH: '/a:/b' },
      home: nowhere,
      roots: ['/c'],
    })
    if (status.kind !== 'not-installed')
      throw new Error(`expected not-installed, got ${status.kind}`)
    // The fixed places first and in order; the list then continues with
    // wherever `npm prefix -g` pointed, because a miss on the cheap paths is
    // what triggers asking npm.
    expect(status.searched.slice(0, 3)).toEqual(['/a/codex', '/b/codex', '/c/codex'])
  })

  it('searches real places, and reports honestly about what it found', async () => {
    // The other end of the same function. Guards the instrument: a locator that
    // reported not-installed for everything would pass the test above and be
    // completely broken.
    //
    // What it must NOT assert is that Codex is installed HERE. That made the
    // suite pass or fail on a property of the machine rather than of the code,
    // and it duly went red the first time this ran on a Windows box without
    // Codex on it. So: the search must have really happened and named real
    // candidates, and if a binary was found the status must be about that
    // binary rather than `not-installed`.
    const status = await checkCodex()
    if (status.kind === 'not-installed') {
      expect(status.searched.length, 'a real search looks in real places').toBeGreaterThan(0)
      for (const candidate of status.searched) {
        expect(candidate, 'candidates should be absolute paths').toMatch(/codex/i)
      }
      return
    }
    expect(['unusable', 'logged-out', 'stale', 'unreadable', 'ready']).toContain(status.kind)
  })
})

const scratch: string[] = []
afterAll(() => {
  while (scratch.length > 0) rmSync(scratch.pop()!, { recursive: true, force: true })
})

describe('a directory is not a binary', () => {
  it('walks past an executable directory named codex and keeps looking', async () => {
    // `access(X_OK)` succeeds on a DIRECTORY -- the execute bit there means
    // "searchable", not "runnable". So a directory called `codex` on the PATH
    // ended the search, and the real binary further down the list was never
    // reached. It then presented as `unusable`: found it, could not run it,
    // reinstall -- the worst possible advice, because nothing was broken.
    const root = mkdtempSync(join(tmpdir(), 'mochi-codexdir-'))
    scratch.push(root)
    const decoy = join(root, 'decoy')
    mkdirSync(join(decoy, 'codex'), { recursive: true })

    const status = await checkCodex({
      platform: 'darwin',
      env: { PATH: decoy },
      home: root,
      roots: [join(root, 'nothing')],
    })
    // Not `unusable`: the decoy must not have been mistaken for the binary.
    expect(status.kind).toBe('not-installed')
    if (status.kind === 'not-installed') {
      expect(status.searched).toContain(join(decoy, 'codex'))
    }
  })
})

describe('needsShell', () => {
  it('sends Windows batch shims through a shell, and nothing else', async () => {
    // Measured on Windows 11, 2026-08-12: `npm i -g @openai/codex` installs
    // `%APPDATA%\npm\codex.cmd` and nothing executable beside it, and
    // `spawnSync` refuses a `.cmd` with EINVAL since the CVE-2024-27980 fix.
    // Without this, a perfectly good install is reported `unusable` and the
    // user is told to reinstall it.
    expect(needsShell('C:\\Users\\x\\AppData\\Roaming\\npm\\codex.cmd', 'win32')).toBe(true)
    expect(needsShell('C:\\tools\\codex.BAT', 'win32')).toBe(true)
    expect(needsShell('npm.cmd', 'win32')).toBe(true)
  })

  it('leaves real executables alone', async () => {
    // A shell is a cost, not a default: it re-introduces the quoting hazard the
    // CVE was about, so it is used only where it is unavoidable.
    expect(needsShell('C:\\tools\\codex.exe', 'win32')).toBe(false)
    expect(needsShell('codex', 'win32')).toBe(false)
  })

  it('never uses a shell off Windows', async () => {
    // `.cmd` is meaningless on a Unix path, and a shell there would be pure
    // added attack surface.
    for (const platform of ['darwin', 'linux'] as const) {
      expect(needsShell('/usr/local/bin/codex', platform)).toBe(false)
      expect(needsShell('/weird/name.cmd', platform)).toBe(false)
    }
  })
})

describe('what a failed sign-in check is allowed to mean', () => {
  // A fake `codex` binary, so the exit code of `login status` is an input to the
  // test rather than a property of this machine. Real child processes, because
  // the classification being tested is entirely about what a process did.
  const bin = mkdtempSync(join(tmpdir(), 'mochi-fake-codex-'))
  const fake = join(bin, process.platform === 'win32' ? 'codex.cmd' : 'codex')

  const write = (loginExit: number | 'hang'): void => {
    // `hang` sleeps past any deadline the test sets, which is how the timeout
    // branch is reached without waiting for a real one.
    const tail =
      loginExit === 'hang'
        ? process.platform === 'win32'
          ? 'timeout /t 30 >nul\r\n'
          : 'sleep 30\n'
        : process.platform === 'win32'
          ? `exit /b ${String(loginExit)}\r\n`
          : `exit ${String(loginExit)}\n`
    const body =
      process.platform === 'win32'
        ? `@echo off\r\nif "%1"=="--version" (echo 1.2.3 & exit /b 0)\r\n${tail}`
        : `#!/bin/sh\nif [ "$1" = "--version" ]; then echo 1.2.3; exit 0; fi\n${tail}`
    writeFileSync(fake, body, { mode: 0o755 })
  }
  const ask = (timeoutMs?: number): Promise<CodexStatus> =>
    checkCodex({
      platform: process.platform,
      // The fake FIRST, then the real PATH. `locateCodex` returns on its first
      // hit, so the fake still wins the search -- and the script it runs can
      // find `sleep`, which is not a shell builtin. With `PATH` set to the
      // fake's directory alone, the hang case exited 127 (command not found)
      // in 50ms and was classified `unusable`, which is the very confusion
      // this test exists to catch.
      env: { PATH: `${bin}${delimiter}${process.env['PATH'] ?? ''}` },
      home: join(tmpdir(), 'mochi-no-such-home'),
      roots: [bin],
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    })

  afterAll(() => rmSync(bin, { recursive: true, force: true }))

  it('treats exit 1 as signed out, which is what Codex documents', async () => {
    write(1)
    const status = await ask()
    expect(status.kind).toBe('logged-out')
    expect(remedyFor(status)).toBe('login')
  })

  it('does NOT treat an unexpected exit code as signed out', async () => {
    // The defect: every non-zero exit was reported as `logged-out`, so a broken
    // install sent the user to `codex login` -- a command that cannot fix it.
    // Telling somebody to run the wrong remedy is worse than admitting the
    // check did not work.
    write(87)
    const status = await ask()
    expect(status.kind).toBe('unusable')
    if (status.kind === 'unusable') expect(status.reason).toContain('87')
    expect(remedyFor(status)).toBe('reinstall')
  })

  it('does NOT tell you to reinstall a binary that was merely slow', async () => {
    // A timeout and a failure to spawn were one flag, so both became
    // `unusable` -> "reinstall". The ten-second deadline is generous for
    // `codex --version` and still reachable on a thrashing machine, so a busy
    // laptop told the user their working install was broken and to replace it.
    write('hang')
    const status = await ask(300)
    expect(status.kind).toBe('timed-out')
    expect(remedyFor(status)).toBe('retry')
  })
})
