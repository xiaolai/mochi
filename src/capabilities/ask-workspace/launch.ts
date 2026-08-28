import { win32 } from 'node:path'

/**
 * What to actually execute, once `locate.ts` has found the CLI.
 *
 * ## Why a step exists between finding it and running it
 *
 * On Windows the thing that gets found is `codex.cmd`, and `codex.cmd` cannot
 * be spawned. Node has REFUSED to execute `.cmd` and `.bat` without a shell
 * since the fix for CVE-2024-27980 — `spawn` throws `EINVAL` — so the located
 * path went to `spawnCodex`, threw, and every lookup on Windows answered "did
 * not finish" with nothing pointing at why.
 *
 * ## The two ways out, and why only one of them is here
 *
 * `shell: true` is the obvious repair and it is the wrong one, MEASURED on a
 * real Windows 11 box on 2026-08-28 rather than argued from first principles:
 *
 * | with `shell: true`, argument `C:\a dir & echo PWNED > pwned.txt` | |
 * | --- | --- |
 * | `pwned.txt` written | yes |
 * | exit status reported to the parent | **0** |
 *
 * Node does not quote argv when `shell: true`. It joins the arguments with
 * spaces and hands the line to `cmd.exe /d /s /c`, where `&` is a command
 * separator. The second row is the half that would have been missed: `cmd.exe`
 * returns the status of the LAST command in the chain, so the injected `echo`
 * forged a success for a run in which the CLI itself failed. `runSchema` reads
 * `code !== 0` to decide whether an answer exists, and would have gone looking
 * for one.
 *
 * That matters here beyond the general principle, because the argument list is
 * not all ours. `-C <workspace>` carries a directory somebody chose in a file
 * picker, and a directory may be named anything at all.
 *
 * So: RESOLVE THE SHIM. An npm `cmd-shim` names its target explicitly on the
 * line it runs, and spawning our own JavaScript runtime against that file skips
 * `cmd.exe` entirely — there is no interpreter left to inject into. Measured
 * against the same hostile argument on the same box: nothing written, and the
 * status was the CLI's own.
 *
 * Everything here is pure apart from the injected `read`, so the Windows branch
 * is asserted on a Mac rather than reasoned about.
 */

/** The command line to run, and anything that must be in its environment. */
export interface Launch {
  readonly command: string
  readonly args: readonly string[]
  /** Merged over `process.env` by the caller. Empty on every ordinary path. */
  readonly adds: Readonly<Record<string, string>>
}

/** Why this located path cannot be turned into a command line. */
export interface Unlaunchable {
  readonly problem: string
}

export function isLaunch(value: Launch | Unlaunchable): value is Launch {
  return 'command' in value
}

/** A shim we know how to read: the extensions `cmd.exe` will not let us spawn. */
const SHIM = /\.(cmd|bat)$/i

/**
 * The script an npm shim runs, as written in the shim.
 *
 * The generated `.cmd` ends with a line of the measured form
 *
 *     … & "%_prog%"  "%dp0%\node_modules\pnpm\bin\pnpm.cjs" %*
 *
 * `%dp0%` is the shim's own directory and already carries a trailing
 * backslash, which is why the separator after it is optional here.
 *
 * Scanned across the whole file rather than only that line. The other quoted
 * path in a shim is `"%dp0%\node.exe"`, and requiring a JavaScript extension
 * excludes it — while a shim that lays its target out differently still
 * resolves instead of being refused for a formatting difference.
 *
 * `[^"\r\n]` rather than `[^"]`: a target is one path on one line, and letting
 * the match run past a newline would turn a malformed shim into a plausible
 * path rather than a refusal.
 */
const TARGET = /"%dp0%[\\/]*([^"\r\n]+?\.[cm]?js)"/i

/** The same, for a shim that spells the target absolutely. */
const ABSOLUTE = /"([A-Za-z]:[\\/][^"\r\n]+?\.[cm]?js)"/i

export interface LaunchOptions {
  /** What `locateCodex` found. */
  readonly path: string
  readonly args: readonly string[]
  readonly platform: NodeJS.Platform
  /**
   * The JavaScript runtime to run a resolved shim target with.
   *
   * `process.execPath`, which in a packaged build is the app's own binary
   * rather than a `node` — hence `ELECTRON_RUN_AS_NODE` below. Passed in so
   * this stays pure, and so a test names a runtime that is not this process.
   */
  readonly runtime: string
  /** The shim's text, or null when it could not be read. */
  readonly read: (path: string) => string | null
}

/**
 * The command line for a located CLI.
 *
 * Everything but a Windows shim passes straight through: a POSIX `codex` is an
 * executable with a shebang, and a Windows `.exe` from a native install is a
 * program. Neither needs anything between being found and being run.
 */
export function launchFor(options: LaunchOptions): Launch | Unlaunchable {
  const { path, args, platform, runtime, read } = options
  if (platform !== 'win32' || !SHIM.test(path)) return { command: path, args, adds: {} }

  const text = read(path)
  if (text === null) return { problem: `could not read ${path} to find out what it runs` }

  const relative = TARGET.exec(text)
  const absolute = relative === null ? ABSOLUTE.exec(text) : null
  const target =
    relative !== null ? win32.join(win32.dirname(path), relative[1] ?? '') : (absolute?.[1] ?? null)
  if (target === null) {
    /*
      REFUSED, not fallen back to a shell.

      A shim shaped in a way this does not recognise is a reason to say so.
      Reaching for `shell: true` here would put the injection surface back on
      exactly the machines where nobody was looking, which is the shape of
      every defect this codebase has spent the week removing.
    */
    return {
      problem:
        `${path} is a script this does not know how to run: it names no JavaScript ` +
        `file to hand to a runtime. Installing the Codex CLI with npm produces one that does.`,
    }
  }

  return {
    command: runtime,
    args: [target, ...args],
    /*
      ELECTRON_RUN_AS_NODE, because `runtime` is this application.

      `process.execPath` in a packaged build is the app binary, and starting it
      without this launches a second copy of the app rather than running the
      script. Electron reads the variable and behaves as plain node instead.

      It reaches the CLI's own children too, which cannot be helped and costs
      nothing: node ignores it, and the CLI does not start an Electron.
    */
    adds: { ELECTRON_RUN_AS_NODE: '1' },
  }
}
