/**
 * Where the Codex CLI is, on any of the three platforms.
 *
 * Resolved rather than shelled out to. `spawn('codex', …, { shell: true })`
 * would let the platform find it for us, but a shell also interprets its
 * argument, and a helper that only works because nothing hostile has ever been
 * passed to it is one refactor away from being a hole. Everything here is a
 * path we computed, spawned without a shell.
 *
 * Pure apart from the injected `exists`, so the search order is testable on a
 * machine that has none of these directories.
 */

export interface LocateOptions {
  readonly platform: NodeJS.Platform
  readonly env: Readonly<Record<string, string | undefined>>
  readonly home: string
  /**
   * Injected: is there an executable file here?
   *
   * ASYNC, because the real implementation touches the filesystem and the real
   * PATH can point at a network mount. Every one of these ran synchronously
   * before the first `await` in `checkCodex`, so a stale NFS entry froze the
   * main thread at startup — the exact failure this module's header describes
   * having already fixed once, in the spawning half.
   */
  readonly exists: (path: string) => boolean | Promise<boolean>
  /** Injected: what is in this directory? Empty when it does not exist. Omit to skip nvm. */
  readonly list?: (directory: string) => readonly string[] | Promise<readonly string[]>
  /**
   * Absolute directories to search after PATH. Defaults to the usual homes.
   *
   * Part of the probe rather than a constant, because otherwise `checkCodex`
   * carries a hidden dependency on the machine it happens to run on: no probe
   * could describe a computer without `/opt/homebrew/bin`, so the one branch
   * that matters most -- Codex genuinely absent -- was untestable against a
   * real filesystem, and the attempt to fake it by stripping PATH quietly
   * found the binary anyway.
   */
  readonly roots?: readonly string[]
}

/**
 * Every `~/.nvm/versions/node/<version>/bin`, newest last.
 *
 * The single Codex install found on the fleet lives here, and it is invisible
 * to every shell-based lookup on that machine: `which -a`, `bash -lc command
 * -v` and `zsh -lc command -v` all return nothing, because `NVM_DIR` is set in
 * `.zshrc` and nothing else reads it. Only an interactive zsh finds it.
 *
 * That is the strongest argument for resolving paths ourselves rather than
 * shelling out. `spawn('codex', { shell: true })` would report "not installed"
 * on a machine where `codex --version` works; stat-ing the directory finds it.
 *
 * Needs a directory listing rather than a stat, which is why `list` exists.
 * Without it this contributes nothing and the rest still works.
 */
async function nvmBins(options: LocateOptions): Promise<readonly string[]> {
  const { platform, home, list } = options
  if (list === undefined) return []
  const root = JOIN(platform, home, '.nvm', 'versions', 'node')
  return [...(await list(root))].sort().map((version) => JOIN(platform, root, version, 'bin'))
}

export interface Located {
  readonly path: string
  /** Every place looked, in order. Reported when nothing was found. */
  readonly searched: readonly string[]
}

const SEPARATOR = (platform: NodeJS.Platform): string => (platform === 'win32' ? ';' : ':')
const JOIN = (platform: NodeJS.Platform, ...parts: string[]): string =>
  parts.join(platform === 'win32' ? '\\' : '/')

/**
 * Filename forms to try, in order. Measured on a real Windows 11 box, because
 * the first version of this list was reasoned about and got the order wrong.
 *
 * An npm global install writes THREE files per CLI and no `.exe`:
 *
 *   codex        an extensionless sh script, for Git-Bash / MSYS
 *   codex.cmd    what cmd.exe and where.exe actually resolve
 *   codex.ps1    for PowerShell callers
 *
 * So `.cmd` FIRST. The extensionless file exists on Windows and is a shell
 * script Windows cannot execute -- listing it first, as this did, meant finding
 * the one entry that is guaranteed not to run and reporting `unusable` on a
 * machine where the CLI works. It stays last as a native-install fallback.
 *
 * `.ps1` is gone: the measured PATHEXT is
 * `.COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC;.CPL` -- no `.PS1`, so
 * bare-name resolution never reaches it and searching for it is dead code.
 *
 * `.js` is deliberately NOT here even though PATHEXT contains it at position 7.
 * The npm shim calls a `codex.js` launcher, and handing that to Windows by name
 * starts Windows Script Host rather than node -- a strange failure instead of a
 * clean one. We only ever name files we resolved ourselves, never glob.
 */
function candidates(platform: NodeJS.Platform): readonly string[] {
  if (platform !== 'win32') return ['codex']
  // `.exe` stays, and its justification got STRONGER rather than weaker.
  //
  // Only one Windows machine could be measured (the second is wedged at the
  // SSH session layer), so "does any machine here use scoop, WinGet,
  // chocolatey or a native installer with a real .exe" is n=1 and honestly
  // UNKNOWN -- not "probably not". One failed stat is the right price for an
  // unknown; deleting the branch would be asserting an answer nobody has.
  //
  // The `.cmd`-first ordering does not rest on that single machine. Three
  // independent packages there -- claude, pnpm, pnpx -- each produced the same
  // extensionless/.cmd/.ps1 triplet, which points at npm's own `cmd-shim`
  // generator. That is a property of npm, not of a machine, so it holds
  // wherever npm installed Codex. Mechanism, not second-machine-measured.
  return ['codex.cmd', 'codex.exe', 'codex.bat', 'codex']
}

/**
 * Directories to search beyond PATH.
 *
 * A GUI application on macOS does NOT inherit the shell's PATH -- it gets a
 * minimal one from launchd, typically without `/opt/homebrew/bin` or any npm
 * prefix. So an app launched from Finder finds nothing while the same command
 * works in the user's terminal, which reads as "your app is broken" rather
 * than "your app cannot see my PATH". These are the usual homes.
 *
 * Best effort, and deliberately so: a directory that does not exist costs one
 * failed stat.
 *
 * Surveyed across eight machines. `npm prefix -g` came back with FIVE different
 * answers on six hosts -- `%APPDATA%\npm`, `~/.local`, `/usr/local`, `/usr`, and
 * on one host a value pointing somewhere the binary is not, because the install
 * happened under a different active node. A fixed list is therefore
 * structurally incomplete, not merely short; `npmGlobalBin` in status.ts asks
 * npm at runtime when this list comes up empty.
 *
 * Two entries removed for want of any evidence: `~/.npm-global/bin` and
 * `~/.bun/bin` appeared zero times across five Linux hosts, and
 * `%LOCALAPPDATA%\Programs\codex` was a native-installer layout with no
 * instance anywhere.
 */
async function extraDirectories(options: LocateOptions): Promise<readonly string[]> {
  if (options.roots !== undefined) return options.roots
  const { platform, env, home } = options
  if (platform === 'win32') {
    const appData = env['APPDATA']
    const localAppData = env['LOCALAPPDATA']
    // Confirmed: `npm prefix -g` is exactly %APPDATA%\npm on Windows 11.
    return [
      ...(appData === undefined ? [] : [JOIN(platform, appData, 'npm')]),
      ...(localAppData === undefined ? [] : [JOIN(platform, localAppData, 'pnpm')]),
    ]
  }
  return [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    // A real npm global bin on one surveyed host, so it stays.
    JOIN(platform, home, '.local', 'bin'),
    JOIN(platform, home, '.codex', 'bin'),
    ...(await nvmBins(options)),
  ]
}

/** The first Codex executable found, or every place that was looked. */
export async function locateCodex(
  options: LocateOptions,
): Promise<Located | { readonly searched: string[] }> {
  const { platform, env, exists } = options
  const fromPath = (env['PATH'] ?? '').split(SEPARATOR(platform)).filter((part) => part !== '')
  // PATH first: a user who installed a specific build and put it on their PATH
  // meant that one, and a well-known directory should not outrank the choice
  // they made explicitly.
  const directories = [...fromPath, ...(await extraDirectories(options))]

  const searched: string[] = []
  for (const directory of directories) {
    for (const name of candidates(platform)) {
      const full = JOIN(platform, directory, name)
      searched.push(full)
      if (await exists(full)) return { path: full, searched }
    }
  }
  return { searched }
}

export function isLocated(value: Located | { readonly searched: string[] }): value is Located {
  return 'path' in value
}
