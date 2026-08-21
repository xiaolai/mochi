/**
 * Can she talk yet, and if not, what does the user do about it?
 *
 * Three questions in order, because each only makes sense if the previous one
 * answered yes: is Codex installed, does it run, and is its login usable BY US.
 * The last is stricter than Codex's own answer -- see `auth.ts`.
 *
 * Every unhappy state carries the exact command that fixes it. A companion that
 * simply cannot hear you, with nothing on screen saying why, is the failure
 * this whole module exists to prevent.
 */

import { runProbe, type ProbeResult } from '../probe'
import { constants } from 'node:fs'
import { access, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { authModeOf, readAuthJson, readTokenState, type AuthMode, type TokenState } from './auth'
import { isLocated, locateCodex } from '../../capabilities/ask-workspace/locate'

export type CodexStatus =
  | { readonly kind: 'not-installed'; readonly searched: readonly string[] }
  /** Found, but it would not run. A broken shim, a half-finished install. */
  | { readonly kind: 'unusable'; readonly path: string; readonly reason: string }
  /**
   * Found, ran, and did not answer inside the deadline.
   *
   * Its own status because it used to be `unusable`, whose remedy is
   * "reinstall". A ten-second deadline is generous for `codex --version` and
   * still reachable on a machine that is thrashing — so a busy laptop told the
   * user their Codex install was broken. Nothing here is broken and nothing
   * needs reinstalling; the answer is to ask again.
   */
  | { readonly kind: 'timed-out'; readonly path: string }
  | { readonly kind: 'logged-out'; readonly version: string; readonly path: string }
  /** Codex thinks it is logged in; its access token is stale and only Codex can refresh it. */
  | {
      readonly kind: 'stale'
      readonly version: string
      readonly path: string
      readonly expiredAt: Date
    }
  | {
      readonly kind: 'unreadable'
      readonly version: string
      readonly path: string
      readonly reason: string
    }
  | {
      readonly kind: 'ready'
      readonly version: string
      readonly path: string
      readonly mode: AuthMode
      /** Absent for an API key, which does not expire. */
      readonly expiresAt?: Date
    }

/**
 * What the user should do about it.
 *
 * A KEY, not a sentence: the words are user-visible and belong to the message
 * table. Exhaustive over `kind`, so adding a status without deciding what a
 * person does about it fails to compile -- which is the only way a new failure
 * mode cannot ship as a silent one.
 */
import type { CodexReadiness, Remedy } from '@shared/delegation'

export type { Remedy }

/**
 * The kind alone, for the settings window.
 *
 * `CodexStatus` carries a `Date`, a resolved binary path, and the whole list of
 * directories that were searched. A search path is a home directory, which is a
 * username -- so the window is told which of the seven states it is in and
 * nothing else. Written as a switch rather than `status.kind` so it is
 * exhaustive: a new status that nobody decided how to display fails to compile,
 * which is the same guarantee `remedyFor` below is written for.
 */
export function readinessOf(status: CodexStatus): CodexReadiness {
  switch (status.kind) {
    case 'ready':
      return 'ready'
    case 'not-installed':
      return 'not-installed'
    case 'unusable':
      return 'unusable'
    case 'timed-out':
      return 'timed-out'
    case 'logged-out':
      return 'logged-out'
    case 'stale':
      return 'stale'
    case 'unreadable':
      return 'unreadable'
  }
}

export function remedyFor(status: CodexStatus): Remedy | null {
  switch (status.kind) {
    case 'ready':
      return null
    case 'not-installed':
      return 'install'
    case 'unusable':
      return 'reinstall'
    case 'timed-out':
      return 'retry'
    case 'logged-out':
    case 'unreadable':
      return 'login'
    case 'stale':
      // Deliberately not "wait for Codex to refresh". Codex refreshes when
      // Codex runs, and somebody who has not opened it since yesterday has
      // nothing scheduled that would fix this on its own.
      return 'login'
  }
}

export interface CodexProbe {
  readonly platform: NodeJS.Platform
  readonly env: Readonly<Record<string, string | undefined>>
  readonly home: string
  /** Well-known directories to search after PATH. Omit for the platform's usual set. */
  readonly roots?: readonly string[]
  /**
   * How long each child process gets. Omit for the ten seconds `probe.ts` uses.
   *
   * Part of the probe for the same reason the roots are: the probe describes a
   * machine, and "a machine where Codex does not answer" is otherwise only
   * expressible by waiting ten real seconds for it.
   */
  readonly timeoutMs?: number
}

function defaults(): CodexProbe {
  return { platform: process.platform, env: process.env, home: homedir() }
}

/** `CODEX_HOME` if set, else `~/.codex`. Codex itself honours the variable. */
export function codexHome(probe: CodexProbe = defaults()): string {
  const configured = probe.env['CODEX_HOME']
  return configured !== undefined && configured !== '' ? configured : join(probe.home, '.codex')
}

/**
 * The whole route, run at startup and on demand.
 *
 * ASYNC, and the comment here used to claim the opposite. It was synchronous
 * "on purpose", on the argument that two short local calls could not be slow;
 * they were three `spawnSync` calls with a ten-second deadline each, on the
 * main thread, before the window exists. Thirty seconds of frozen UI is the
 * worst case, and a missing `npm` on a busy machine reaches it.
 */
export async function checkCodex(probe: CodexProbe = defaults()): Promise<CodexStatus> {
  // No conditional `roots` spread: `...probe` already copied it, so the extra
  // clause could only ever set the field to the value it already had.
  const found = await locateCodex({ ...probe, list: listing, exists: executable })
  if (!isLocated(found)) {
    // Last resort: ask npm where it puts global binaries.
    //
    // The fixed list above is structurally incomplete, not merely short --
    // surveyed across six machines, `npm prefix -g` gave FIVE different
    // answers. Asking costs a process spawn, so it happens only after the
    // cheap paths have all missed.
    const fromNpm = await npmGlobalBin(probe)
    if (fromNpm.kind !== 'bin') {
      // Said out loud when the search could not be finished. The answer is
      // still `not-installed` -- installing is the one remedy that helps
      // either way, and inventing a fourth status for "we are not sure" would
      // give the user no action -- but a support thread that starts "it says
      // Codex is not installed and it is" is settled by this line.
      if (fromNpm.kind === 'unavailable') {
        console.warn(
          `[codex] the npm prefix could not be read (${fromNpm.why}), so a custom global prefix was not searched`,
        )
      }
      // No retry happened, so there is nothing to append. Concatenating
      // `retry.searched` here listed every path TWICE -- `retry` was `found`
      // itself -- and the report those paths exist for is the one a user reads
      // to work out where the app looked.
      return { kind: 'not-installed', searched: found.searched }
    }
    const retry = await locateCodex({
      ...probe,
      roots: [fromNpm.path],
      exists: executable,
      list: listing,
    })
    if (!isLocated(retry)) {
      const searched = [...new Set([...found.searched, ...retry.searched])]
      return { kind: 'not-installed', searched }
    }
    return describeInstall(retry.path, probe)
  }
  return describeInstall(found.path, probe)
}

/**
 * Whether this command has to go through a shell to be runnable.
 *
 * Windows batch shims -- `.cmd` and `.bat` -- CANNOT be executed by
 * `spawnSync` directly. Node refuses them with `EINVAL` since the fix for
 * CVE-2024-27980 ("BatBadBut"), because passing arguments to a batch file
 * safely is not possible without going through `cmd.exe`.
 *
 * This is not a corner case here, it is the ordinary one: `npm i -g
 * @openai/codex` installs exactly one usable entry point on Windows, and it is
 * `%APPDATA%\npm\codex.cmd`. Measured on a real Windows 11 machine
 * (2026-08-12): the locator found the shim correctly and the spawn then failed
 * with EINVAL, so a perfectly good installation was reported as `unusable`
 * with the remedy "reinstall". The same bug silently disabled the `npm prefix
 * -g` fallback, which spawns `npm.cmd`, and simply returned null forever.
 *
 * Exported so the rule can be tested without spawning anything.
 */
export function needsShell(command: string, platform: NodeJS.Platform): boolean {
  return platform === 'win32' && /\.(cmd|bat)$/i.test(command)
}

/**
 * Run a program the same way everywhere, batch shim or not.
 *
 * ONE place, because this went wrong in two of the three spawn sites and the
 * third would have been next. The command is quoted when a shell is involved:
 * `cmd.exe` splits on spaces, and a path like `C:\Program Files\...` would
 * otherwise be read as a command plus an argument. The arguments here are
 * fixed literals chosen by this module, never user input, which is what makes
 * the shell acceptable at all.
 */
/** The shared probe, told how this platform wants the command invoked. */
function run(command: string, args: readonly string[], probe: CodexProbe): Promise<ProbeResult> {
  return runProbe(command, args, {
    platform: probe.platform,
    // The PROBE's environment, not this process's — see `probe.ts`.
    env: probe.env,
    shell: needsShell(command, probe.platform),
    ...(probe.timeoutMs === undefined ? {} : { timeoutMs: probe.timeoutMs }),
  })
}

/**
 * What `npm prefix -g` had to say, and whether it managed to say anything.
 *
 * Four outcomes used to collapse into `null`: npm absent, npm timed out, npm
 * failed to spawn, npm exited non-zero. The caller read all four as "npm has
 * no global prefix" and reported `not-installed` — definitively, to a user
 * who may well have Codex installed under a custom prefix that this is the
 * only way to discover. "We could not finish looking" and "we looked
 * everywhere and it is not there" are different answers.
 */
type NpmPrefix =
  | { readonly kind: 'bin'; readonly path: string }
  /** npm answered, and has no prefix to offer. The search is complete. */
  | { readonly kind: 'none' }
  /** npm could not be asked. The search is INCOMPLETE. */
  | { readonly kind: 'unavailable'; readonly why: string }

async function npmGlobalBin(probe: CodexProbe): Promise<NpmPrefix> {
  const result = await run(probe.platform === 'win32' ? 'npm.cmd' : 'npm', ['prefix', '-g'], probe)
  if (result.failed) {
    return { kind: 'unavailable', why: result.timedOut ? 'it timed out' : 'it could not be run' }
  }
  if (result.status !== 0) {
    return { kind: 'unavailable', why: `it exited ${String(result.status)}` }
  }
  const prefix = result.stdout.trim()
  if (prefix === '') return { kind: 'none' }
  // On Windows the prefix IS the bin directory; elsewhere binaries land in bin/.
  return { kind: 'bin', path: probe.platform === 'win32' ? prefix : join(prefix, 'bin') }
}

/**
 * An executable REGULAR FILE at this path.
 *
 * Three conditions, and the third was missing. `access(X_OK)` succeeds on a
 * directory — the execute bit on a directory means "searchable" — so a
 * directory named `codex` on the PATH ended the search, and the real binary
 * further down the list was never reached. The failure then presented as
 * `unusable`: found it, could not run it, reinstall.
 *
 * Async, like everything else on this path: these run against the user's real
 * PATH, which can include a network mount.
 */
async function executable(path: string): Promise<boolean> {
  try {
    const stats = await stat(path)
    if (!stats.isFile()) return false
    await access(path, constants.F_OK | constants.X_OK)
    return true
  } catch {
    return false
  }
}

async function listing(directory: string): Promise<readonly string[]> {
  try {
    return await readdir(directory)
  } catch {
    return []
  }
}

/**
 * Three questions, asked in order, each with its own answer.
 *
 * Split because it was one 60-line function doing four things — running the
 * binary, running its sign-in check, reading the auth file, and classifying
 * the token — with the early return of each stage interleaved with the setup
 * of the next. Each step below either produces a final status or hands on the
 * one fact the next step needs.
 */
async function describeInstall(path: string, probe: CodexProbe): Promise<CodexStatus> {
  const version = await askVersion(path, probe)
  if (typeof version !== 'string') return version

  const signedIn = await askSignIn(path, probe)
  if (signedIn !== true) {
    return signedIn === false ? { kind: 'logged-out', version, path } : signedIn
  }

  return judgeToken(version, path, probe)
}

/** Its version string, or the status that explains why there is not one. */
async function askVersion(path: string, probe: CodexProbe): Promise<string | CodexStatus> {
  const version = await run(path, ['--version'], probe)
  if (version.timedOut) return { kind: 'timed-out', path }
  if (version.failed || version.status !== 0) {
    return {
      kind: 'unusable',
      path,
      reason: version.failed ? 'it could not be run' : `exited ${String(version.status)}`,
    }
  }
  return version.stdout.trim() || 'unknown version'
}

/**
 * Whether Codex says it is signed in.
 *
 * Its EXIT CODE carries the answer — 0 for logged in, 1 for not — which was
 * worth measuring: the text is English prose that will not survive
 * localisation or a rewording, and reading `$?` through a pipe reports the
 * pipe.
 *
 * ONLY exit 1 means signed out. Anything else — a spawn failure, the deadline,
 * a signal, an exit code nobody has seen — used to be reported as
 * `logged-out`, which sends the user to `codex login` for a problem that
 * command cannot fix. Telling somebody to run the wrong remedy is worse than
 * admitting the check did not work.
 */
async function askSignIn(path: string, probe: CodexProbe): Promise<boolean | CodexStatus> {
  const login = await run(path, ['login', 'status'], probe)
  if (login.timedOut) return { kind: 'timed-out', path }
  if (login.failed) {
    return { kind: 'unusable', path, reason: 'the sign-in check could not be run' }
  }
  if (login.status !== 0 && login.status !== 1) {
    return { kind: 'unusable', path, reason: `the sign-in check exited ${String(login.status)}` }
  }
  return login.status === 0
}

/**
 * What the stored token is actually worth.
 *
 * ONE read of auth.json, not two. `readTokenState` and `authModeOf` each opened
 * and parsed it, so a credential refresh landing between them produced a status
 * built from two different files: a token from before the refresh described by
 * an auth mode from after it.
 */
async function judgeToken(version: string, path: string, probe: CodexProbe): Promise<CodexStatus> {
  // The SHARED reader, not a second one. `voice/credential.ts` reads the same
  // file, and the copy that used to live here had already drifted: it reported
  // a missing file and a permission error identically, and built its message
  // with `String(error)`, which carries the absolute path.
  const auth = await readAuthJson(codexHome(probe))
  const token: TokenState = auth.ok
    ? readTokenState(auth.value, Date.now())
    : auth.missing
      ? { kind: 'absent' }
      : { kind: 'unreadable', reason: auth.reason }
  // No try/catch around this. `authModeOf` takes `unknown` and answers
  // `'unknown'` for anything it does not recognise -- it has no throwing path,
  // so the catch could only ever hide a future one.
  const mode: AuthMode = auth.ok ? authModeOf(auth.value) : 'unknown'

  switch (token.kind) {
    case 'absent':
      return { kind: 'logged-out', version, path }
    case 'unreadable':
      return { kind: 'unreadable', version, path, reason: token.reason }
    case 'expired':
      return { kind: 'stale', version, path, expiredAt: token.expiredAt }
    case 'api-key':
      return { kind: 'ready', version, path, mode: 'apikey' }
    case 'valid':
      return { kind: 'ready', version, path, mode, expiresAt: token.expiresAt }
  }
}

/**
 * The binary this status is about, when one was found and ran.
 *
 * Carried on four of the seven states because main has to SPAWN it, and until
 * this existed there were two answers to "where is Codex": the status ladder's,
 * which had run the thing and read its version, and a second bare `locateCodex`
 * whose answer was used. Two searches, and only one of them knew whether the
 * file it found was executable at all.
 *
 * Never reaches a renderer. `readinessOf` is the whole of what crosses, for the
 * reason stated on `CODEX_READINESS`: a path here is a home directory.
 */
export function pathOf(status: CodexStatus): string | null {
  switch (status.kind) {
    case 'not-installed':
      return null
    case 'unusable':
    case 'timed-out':
    case 'logged-out':
    case 'stale':
    case 'unreadable':
    case 'ready':
      return status.path
  }
}

/**
 * Everything the status knows, as one log line.
 *
 * These fields — `searched`, `path`, `reason`, `version`, `expiredAt`,
 * `expiresAt` — had no consumer at all. Only `kind` and `ready.mode` were ever
 * read, so a comment above `searched` describing it as "the report a user
 * reads to work out where the app looked" was describing something nobody
 * could see. Deleting them was the other option; logging them is better,
 * because the support question this data answers — "it says Codex is not
 * installed and it is" — is otherwise unanswerable without a debugger.
 */
export function describeStatus(status: CodexStatus): string {
  switch (status.kind) {
    case 'ready':
      return status.expiresAt === undefined
        ? `ready (${status.version}, ${status.mode})`
        : `ready (${status.version}, ${status.mode}, expires ${status.expiresAt.toISOString()})`
    case 'not-installed':
      return `not installed; looked in ${String(status.searched.length)} places: ${status.searched.join(', ')}`
    case 'unusable':
      return `unusable at ${status.path}: ${status.reason}`
    case 'timed-out':
      return `timed out at ${status.path}`
    case 'logged-out':
      return `logged out (${status.version})`
    case 'stale':
      return `stale (${status.version}, expired ${status.expiredAt.toISOString()})`
    case 'unreadable':
      return `unreadable (${status.version}): ${status.reason}`
  }
}
