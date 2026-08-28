import { describe, expect, it } from 'vitest'
import { isLaunch, launchFor, type Launch } from './launch'

/**
 * Turning a located path into a command line, on a Mac, for Windows.
 *
 * The whole reason `launch.ts` is a separate pure module: the branch that
 * matters runs on a platform this suite will never execute on, and the version
 * of it that lived inside `spawnCodex` could only be checked by shipping.
 */

/**
 * A REAL npm `cmd-shim`, copied byte for byte off a Windows 11 box on
 * 2026-08-28 — pnpm's, because the Codex CLI is not installed there.
 *
 * The package name is the only thing that differs between one of these and
 * another: `%APPDATA%\npm\node_modules\<pkg>\bin\<name>.cjs` is `cmd-shim`'s
 * layout, not pnpm's, and three unrelated packages on that machine produced
 * the identical shape. Invented input would have let this test agree with
 * whatever the parser happened to do.
 */
const SHIM = [
  '@ECHO off',
  'GOTO start',
  ':find_dp0',
  'SET dp0=%~dp0',
  'EXIT /b',
  ':start',
  'SETLOCAL',
  'CALL :find_dp0',
  '',
  'IF EXIST "%dp0%\\node.exe" (',
  '  SET "_prog=%dp0%\\node.exe"',
  ') ELSE (',
  '  SET "_prog=node"',
  '  SET PATHEXT=%PATHEXT:;.JS;=;%',
  ')',
  '',
  'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\pnpm\\bin\\pnpm.cjs" %*',
].join('\r\n')

const RUNTIME = 'C:\\app\\Mochi.exe'

function windows(path: string, text: string | null, args: readonly string[] = []): Launch {
  const launch = launchFor({
    path,
    args,
    platform: 'win32',
    runtime: RUNTIME,
    read: () => text,
  })
  if (!isLaunch(launch)) throw new Error(launch.problem)
  return launch
}

describe('anything that is already executable', () => {
  it('passes a POSIX path through untouched', () => {
    const launch = launchFor({
      path: '/opt/homebrew/bin/codex',
      args: ['exec', '-C', '/tmp/w'],
      platform: 'darwin',
      runtime: '/unused',
      read: () => {
        throw new Error('nothing on this platform should be read')
      },
    })
    expect(launch).toEqual({
      command: '/opt/homebrew/bin/codex',
      args: ['exec', '-C', '/tmp/w'],
      adds: {},
    })
  })

  it('passes a Windows .exe through untouched', () => {
    // A native install. There is no shim to read and no runtime to supply —
    // resolving one would be inventing work for the case that already works.
    expect(windows('C:\\tools\\codex.exe', null)).toEqual({
      command: 'C:\\tools\\codex.exe',
      args: [],
      adds: {},
    })
  })
})

describe('an npm shim on Windows', () => {
  it('runs the script the shim names, with our own runtime', () => {
    const launch = windows('C:\\Users\\j\\AppData\\Roaming\\npm\\codex.cmd', SHIM)
    expect(launch.command).toBe(RUNTIME)
    expect(launch.args[0]).toBe(
      'C:\\Users\\j\\AppData\\Roaming\\npm\\node_modules\\pnpm\\bin\\pnpm.cjs',
    )
  })

  it('resolves the target against the SHIM, not against the working directory', () => {
    // `%dp0%` is the shim's own directory. Joining against anything else would
    // produce a path that exists on the developer's machine and nowhere else.
    const launch = windows('D:\\elsewhere\\codex.cmd', SHIM)
    expect(launch.args[0]).toBe('D:\\elsewhere\\node_modules\\pnpm\\bin\\pnpm.cjs')
  })

  it('keeps every argument, in order, after the script', () => {
    const launch = windows('C:\\npm\\codex.cmd', SHIM, ['exec', '-s', 'read-only'])
    expect(launch.args).toEqual([
      'C:\\npm\\node_modules\\pnpm\\bin\\pnpm.cjs',
      'exec',
      '-s',
      'read-only',
    ])
  })

  it('asks for node behaviour, because the runtime is this application', () => {
    // Without it, a packaged build starts a second copy of the app.
    expect(windows('C:\\npm\\codex.cmd', SHIM).adds).toEqual({ ELECTRON_RUN_AS_NODE: '1' })
  })

  it('does not take `node.exe` from the line above the one that runs it', () => {
    // The shim mentions two paths. The first is the runtime it would have used;
    // handing THAT to a runtime would run node against node.
    expect(windows('C:\\npm\\codex.cmd', SHIM).args[0]).not.toContain('node.exe')
  })

  it('reads .bat as well as .cmd', () => {
    expect(windows('C:\\npm\\codex.bat', SHIM).command).toBe(RUNTIME)
  })
})

describe('a shim that cannot be resolved', () => {
  it('says so rather than falling back to a shell', () => {
    /*
      The point of the whole module. `shell: true` is what makes this case
      "work", and it was measured on 2026-08-28 to execute an injected command
      from an argument AND report exit 0 for a run that failed. A refusal that
      names the file is the honest outcome.
    */
    const launch = launchFor({
      path: 'C:\\npm\\codex.cmd',
      args: [],
      platform: 'win32',
      runtime: RUNTIME,
      read: () => '@ECHO off\r\nC:\\somewhere\\codex-native.exe %*\r\n',
    })
    expect(isLaunch(launch)).toBe(false)
    expect(isLaunch(launch) ? '' : launch.problem).toContain('C:\\npm\\codex.cmd')
  })

  it('says so when the shim cannot be read at all', () => {
    const launch = launchFor({
      path: 'C:\\npm\\codex.cmd',
      args: [],
      platform: 'win32',
      runtime: RUNTIME,
      read: () => null,
    })
    expect(isLaunch(launch) ? '' : launch.problem).toContain('could not read')
  })

  it('does not read a target across a line ending', () => {
    // A malformed shim must refuse, not produce a path with a newline in it.
    const launch = launchFor({
      path: 'C:\\npm\\codex.cmd',
      args: [],
      platform: 'win32',
      runtime: RUNTIME,
      read: () => '"%dp0%\\broken\r\nthing.js"',
    })
    expect(isLaunch(launch)).toBe(false)
  })
})

describe('a shim that spells its target absolutely', () => {
  it('uses it as written, without joining anything to it', () => {
    const launch = windows(
      'C:\\npm\\codex.cmd',
      '@ECHO off\r\n"%_prog%" "D:\\installs\\codex\\bin\\codex.js" %*\r\n',
    )
    expect(launch.args[0]).toBe('D:\\installs\\codex\\bin\\codex.js')
  })
})
