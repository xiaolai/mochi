import { runProbe, type ProbeOptions } from './probe'

/**
 * The PATH the person actually has, asked of the shell that has it.
 *
 * ## The defect, on a real machine
 *
 * A GUI application on macOS does not inherit a shell's PATH. launchd hands it
 * roughly `/usr/bin:/bin:/usr/sbin:/sbin`, and nothing a user has installed
 * through a version manager is on it. `locate.ts` already knew this and
 * answered it with a list of well-known directories — `/opt/homebrew/bin`,
 * `~/.local/bin`, every `~/.nvm/versions/node/<version>/bin`.
 *
 * A list cannot win. Reported 2026-09-03: Codex present at
 * `~/.local/share/mise/installs/node/lts/bin/codex`, the app saying it was not
 * installed, and `which codex` in the same person's terminal printing the path.
 * mise is the second version manager to need its own branch after nvm, and
 * asdf, fnm, volta, pnpm and bun are all waiting behind it with layouts of
 * their own.
 *
 * ## And finding the file would not have been enough
 *
 * That binary is an npm shim: `#!/usr/bin/env node`. Spawning it with launchd's
 * PATH fails at `env node`, because the node it wants is in the same directory
 * the app could not see. A search-path fix would have found the file and then
 * reported `unusable — it could not be run`, which is a worse answer than "not
 * installed" because it tells somebody to reinstall a working tool.
 *
 * So the thing to repair is the PATH, once, rather than the search. Everything
 * downstream — locating Codex, asking npm for its global prefix, and actually
 * spawning Codex to look something up — then works for the same reason it works
 * in the terminal.
 *
 * ## Why an interactive login shell
 *
 * `-l` alone runs the profile files; `mise activate`, `nvm.sh` and asdf's shims
 * are conventionally sourced from `.zshrc`/`.bashrc`, which is the INTERACTIVE
 * file. Asking for a login shell only would miss exactly the managers this
 * exists for.
 *
 * The cost is that an interactive shell may print a banner, so the PATH is read
 * from the LAST non-empty line rather than from all of stdout.
 *
 * ## It is allowed to fail, and says nothing when it does
 *
 * A shell that is slow, absent, or hostile to non-tty invocation returns null
 * and the caller keeps the PATH it had. This is a widening of where the app can
 * look; it is not a prerequisite for the app working, and a person whose shell
 * takes four seconds to start should not pay that at every launch with an error
 * at the end of it.
 */
export interface ShellPathDeps extends ProbeOptions {
  /** Injected so a test does not spawn the machine's real shell. */
  readonly run?: typeof runProbe
}

/** Long enough for a heavy `.zshrc`, short enough not to be felt at startup. */
export const SHELL_PATH_TIMEOUT_MS = 4000

export async function shellPath(deps: ShellPathDeps): Promise<string | null> {
  // Windows has no equivalent: a GUI process there inherits the user and
  // machine PATH from the registry, which is the same one a shell gets.
  if (deps.platform === 'win32') return null

  const shell = deps.env['SHELL']
  if (shell === undefined || shell === '') return null

  const run = deps.run ?? runProbe
  /*
    `printf` rather than `echo`, and the quoting matters.

    `echo $PATH` unquoted goes through word splitting, so a directory with a
    space in it — `/Users/x/My Tools/bin`, which macOS makes easy to create —
    arrives as two entries and neither exists. Quoted, and with `printf`, what
    comes back is exactly the variable.
  */
  const asked = await run(shell, ['-ilc', 'printf %s "$PATH"'], {
    ...deps,
    timeoutMs: deps.timeoutMs ?? SHELL_PATH_TIMEOUT_MS,
  })
  if (asked.failed || asked.timedOut || asked.status !== 0) return null

  // The last non-empty line: an interactive shell is entitled to print a
  // banner, and several popular configurations do.
  const line = asked.stdout
    .split('\n')
    .map((one) => one.trim())
    .filter((one) => one !== '')
    .pop()
  if (line === undefined || !line.includes('/')) return null
  return line
}

/**
 * The app's PATH widened by the shell's, in that order, without duplicates.
 *
 * The app's own entries stay FIRST. Whatever launchd provided is what every
 * other part of this process has been resolving against, and a shell profile
 * that shadows a system binary should not silently change what `/usr/bin/env`
 * means for an already-running application. This only ever adds places to look.
 */
export function widenPath(current: string | undefined, fromShell: string | null): string {
  const separator = ':'
  const mine = (current ?? '').split(separator).filter((one) => one !== '')
  const theirs = (fromShell ?? '').split(separator).filter((one) => one !== '')
  return [...new Set([...mine, ...theirs])].join(separator)
}
