import { describe, expect, it } from 'vitest'
import { isLocated, locateCodex } from './locate'

/**
 * Where the Codex binary is looked for, and why the list is as long as it is.
 *
 * These moved here from `main/codex/status.test.ts`, which is where they were
 * written and is not where they belong: `locate.ts` came across from v1 without
 * a test of its own, so the module with no coverage was being covered by a file
 * about something else. Every case below is a machine somebody actually had.
 */
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
