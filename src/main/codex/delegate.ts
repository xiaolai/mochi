/**
 * Running one read-only Codex over the workspace, and refusing to when it is
 * not safe or not possible.
 *
 * ## Two checks, in this order, and they say different things
 *
 * 1. `status` -- Codex missing, logged out, or holding a token only Codex can
 *    refresh. That is a FAULT, and each one carries a command that fixes it.
 * 2. `guard` -- the workspace holds a file Codex reads as INSTRUCTIONS. That is
 *    a REFUSAL, and it carries the filenames so they can be dealt with.
 *
 * Collapsing them into one "cannot run" would merge advice with an accusation.
 * The order matters too: an uninstalled Codex makes the workspace question moot,
 * and scanning a directory to then say "install Codex" reads as a non sequitur.
 *
 * ## The gate runs before the process, and that is asserted
 *
 * `delegate.test.ts` records the call order and fails if a spawn happens with
 * no preceding guard. A measurement showed what the guard is for: an
 * `AGENTS.md` in the workspace put its payload straight into the field she
 * reads aloud. A run that skips it is the whole failure, and it is silent.
 *
 * ## Neither the schema nor the answer is written into the workspace
 *
 * Both live in `userData` alongside it. A file placed inside would be read by
 * the NEXT delegation -- Codex would be summarising its own previous output --
 * and it would also have to be excluded from the guard's scan, which is a hole
 * in the thing the guard exists to close.
 */

import { mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Remedy } from '@shared/auth'
import { DEFAULT_DELEGATION_PROMPT } from '@shared/delegation'
import type {
  CodexReadiness,
  DelegationSettings,
  WorkspaceHazard,
  WorkspaceVerdict,
} from '@shared/delegation'
import { guardWorkspace } from './workspace-guard'
import { readinessOf, remedyFor, type CodexStatus } from './status'

/**
 * How long before a run is abandoned.
 *
 * Measured (§8): a real question took 36-56 seconds on this network and a
 * question that reads nothing still took twenty. Three minutes is therefore
 * generous rather than tight -- it is there to stop "she never wakes up again",
 * not to police slowness.
 */
export const DELEGATION_DEADLINE_MS = 180_000

/** Enough for a spoken sentence and a page of detail; far short of a leak. */
const MAX_ANSWER_BYTES = 256 * 1024

/** A couple of sentences. Matches `maxLength` in the schema below. */
const MAX_SPOKEN = 400

/**
 * How long a killed process is given to die before it is killed harder.
 *
 * `kill()` sends SIGTERM, which a process is free to ignore -- so the deadline
 * was a request rather than a bound, and the promise it guards could stay
 * pending for as long as Codex felt like running.
 */
const GRACE_MS = 5_000

/** What she can be told, as values rather than sentences. */
export type DelegationOutcome =
  | { readonly kind: 'answered'; readonly spoken: string; readonly detail: string }
  /** Codex itself cannot be used. Carries what to type. */
  | {
      readonly kind: 'not-ready'
      readonly readiness: CodexReadiness
      readonly remedy: Remedy | null
    }
  /** The workspace can give Codex instructions. Carries which files. */
  | { readonly kind: 'refused'; readonly hazards: readonly WorkspaceHazard[] }
  | { readonly kind: 'unreadable-workspace' }
  /** A second request arrived while one was running. Said, never queued. */
  | { readonly kind: 'busy' }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'timed-out' }
  | { readonly kind: 'failed'; readonly reason: string }

export interface RunHandle {
  readonly finished: Promise<{ readonly code: number | null; readonly stderr: string }>
  /** SIGTERM by default; the deadline escalates to SIGKILL if that is ignored. */
  readonly kill: (signal?: NodeJS.Signals) => void
}

export interface DelegateDeps {
  /** Where a delegation reads. Its parent bounds the guard's upward walk. */
  readonly workspace: string
  readonly userData: string
  readonly settings: DelegationSettings
  readonly status: () => Promise<CodexStatus>
  /** The resolved Codex binary, never a bare name -- see `locate.ts`. */
  readonly codexPath: () => Promise<string | null>
  /** Injected so tests never spawn. Given an absolute path and argv. */
  readonly run: (path: string, args: readonly string[]) => RunHandle
  readonly deadlineMs?: number
  /**
   * How long a killed process is given before it is killed harder.
   *
   * Injected for the same reason as the deadline: the escalation is only
   * observable in a test that can afford to wait for it, and five real seconds
   * per assertion is not a price a suite should pay.
   */
  readonly graceMs?: number
}

/** The schema that makes the answer speakable rather than terminal markdown. */
const ANSWER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['spoken', 'detail'],
  properties: {
    spoken: {
      type: 'string',
      // BOUNDED, because the description alone is a request and this field is
      // what gets read out loud. Without it a valid answer could put the whole
      // file in her mouth, and the schema would still be satisfied.
      maxLength: 400,
      description:
        'One or two sentences of plain prose, to be read aloud. No markdown, no code, no file paths.',
    },
    // Kept although nothing displays it yet, and the description no longer
    // claims otherwise. It earns its place by giving the long form somewhere to
    // go: without it, everything Codex wants to say lands in `spoken`, which is
    // the field that gets read aloud. A screen for it is M10's remaining piece.
    detail: {
      type: 'string',
      description: 'The full answer in markdown, for reading rather than speaking.',
    },
  },
}

/**
 * The fixed part of the command line.
 *
 * `-s read-only` is the load-bearing flag: it is what makes the objection
 * -- the output being somebody's files -- untrue by mechanism rather than by
 * policy. `-C` is NOT a read fence and is not treated as one; it only
 * decides where the model starts looking.
 *
 * `--skip-git-repo-check` because the workspace is not a repository, and
 * `--ephemeral` so a companion's questions do not accumulate in the user's own
 * Codex session history.
 */
export function argsFor(
  options: Pick<DelegateDeps, 'workspace' | 'settings'> & {
    readonly schemaPath: string
    readonly outPath: string
    readonly question: string
  },
): readonly string[] {
  const { settings } = options
  return [
    'exec',
    '-s',
    'read-only',
    '-C',
    options.workspace,
    '--skip-git-repo-check',
    '--ephemeral',
    // Emptied, because this one cannot be guarded by NAME.
    //
    // `project_doc_fallback_filenames` lets a user's own Codex configuration
    // nominate further files to load as instructions -- so the guard's list
    // could be complete and still be bypassed by a name only that config knows.
    // Overriding it to nothing means the set of instruction files is fixed and
    // therefore checkable, which is what makes the guard's list meaningful.
    '-c',
    'project_doc_fallback_filenames=[]',
    '--output-schema',
    options.schemaPath,
    '-o',
    options.outPath,
    // Only when chosen. Absent means the user's own `config.toml` decides, which
    // is a first-class choice rather than a gap -- see `DelegationSettings`.
    ...(settings.model === null ? [] : ['-m', settings.model]),
    ...(settings.effort === null ? [] : ['-c', `model_reasoning_effort="${settings.effort}"`]),
    // `-c` overrides the machine-wide setting, so whether she may search is the
    // user's choice per delegation rather than whatever their Codex happens to
    // be configured with. `follow` sends nothing and lets that config decide.
    ...(settings.webSearch === 'follow' ? [] : ['-c', `web_search="${settings.webSearch}"`]),
    framed(options.question, settings.prompt),
  ]
}

/**
 * The question, with the only instruction that keeps the answer honest.
 *
 * Codex is a general assistant. Handed a bare question it answers like one, and
 * the difference between that and a sourced answer is invisible once she has
 * spoken it aloud.
 *
 * The first version of this framing forbade everything but the files, on a
 * wrong reading of a live session: asked "check the weather of Shenzhen today"
 * over an empty workspace it answered with a real forecast, which looked like
 * an invention until the answer file turned out to carry a source URL and the
 * user's `config.toml` turned out to have `web_search` on. It had searched. So
 * the web is allowed, deliberately -- it is most of what makes the feature
 * worth having.
 *
 * What survives from that scare is the part that was right for the wrong
 * reason: SOURCED or SILENT. Codex must say where an answer came from and must
 * say plainly when it could not find one, rather than reaching for what it
 * happens to remember. `-s read-only` governs what it may WRITE; this governs
 * what it may claim.
 */
export function framed(question: string, template: string | null): string {
  const text = template ?? DEFAULT_DELEGATION_PROMPT
  // Appended when the placeholder is gone. Somebody editing this has no reason
  // to know `{question}` is load-bearing, and a delegation that runs and asks
  // nothing is a worse answer than one whose wording is slightly off.
  return text.includes(PLACEHOLDER)
    ? text.split(PLACEHOLDER).join(question)
    : `${text}\n\n${question}`
}

const PLACEHOLDER = '{question}'

/** Parse the structured answer, or say why it could not be used. */
export function readAnswer(text: string): DelegationOutcome {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return { kind: 'failed', reason: 'the answer was not valid JSON' }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { kind: 'failed', reason: 'the answer was not an object' }
  }
  const record = value as Record<string, unknown>
  const spoken = record['spoken']
  const detail = record['detail']
  if (typeof spoken !== 'string' || typeof detail !== 'string') {
    return { kind: 'failed', reason: 'the answer was missing a field' }
  }
  // Enforced HERE as well as in the schema. The schema is a request made of
  // another program; this is the check, and the field it guards is the one she
  // speaks.
  if (spoken.length > MAX_SPOKEN)
    return { kind: 'failed', reason: 'the spoken answer was too long' }
  return { kind: 'answered', spoken, detail }
}

/**
 * One at a time, and the slot is claimed SYNCHRONOUSLY.
 *
 * `busy` is separate from `inFlight` because of a race the tests caught: the
 * handle does not exist until after `status` and the guard have been awaited,
 * so a version that tested `inFlight !== null` let two keypresses a few
 * milliseconds apart both pass the check and both spawn. The user would be
 * charged for two runs, see one, and be able to cancel neither reliably.
 *
 * So the flag is set before the first `await` and cleared in `finally`.
 */
let runCounter = 0
let busy = false
let inFlight: RunHandle | null = null
/** Set by `cancelDelegation` so a cancel arriving DURING setup is not lost. */
let cancelRequested = false

/** True while a delegation is running. Read by the awake-hold in `index.ts`. */
export function isDelegating(): boolean {
  return busy
}

/**
 * Stop the run in progress, if there is one.
 *
 * Idempotent and safe to call when nothing is running: the cancel path is
 * reachable from a keypress and from a click, and making the caller check first
 * would be inviting the race between the two.
 *
 * Also works BEFORE the process exists. Cancelling during the status probe used
 * to do nothing, so a run begun by mistake could not be stopped for the ten
 * seconds that probe is allowed -- and then it started anyway.
 */
export function cancelDelegation(force = false): void {
  cancelRequested = true
  // FORCED during shutdown. Ordinary cancellation asks politely and lets the
  // deadline escalate, but on quit this process is about to stop -- so the
  // timer that would have escalated never fires, and a Codex ignoring SIGTERM
  // simply outlives the app that spawned it, still spending the user's quota.
  inFlight?.kill(force ? 'SIGKILL' : undefined)
}

export async function delegate(question: string, deps: DelegateDeps): Promise<DelegationOutcome> {
  // Said, not queued. Silently stacking a second run would spend the user's
  // quota on something they cannot see and cannot stop.
  //
  // Claimed before the first `await`, so two keypresses in the same tick cannot
  // both get past it. See the note on `busy`.
  if (busy) return { kind: 'busy' }
  busy = true
  cancelRequested = false

  try {
    return await attempt(question, deps)
  } catch (error: unknown) {
    // EVERY path returns an outcome. `status`, `mkdir`, the guard's ancestry
    // check and `run` can all throw, and a rejection here was caught by the
    // caller's logger -- which meant no `function_call_output` was ever sent
    // and the tool call sat unresolved in the conversation for the rest of the
    // session. The one invariant this module has is that it always answers.
    // A CATEGORY, not the error. `String(error)` on a filesystem failure carries
    // absolute paths -- the workspace, the user data directory, the resolved
    // binary -- and this reason is forwarded to the voice model and spoken. The
    // detail is worth having, so it is logged here where it stays.
    console.error('[delegate] could not start:', error)
    return { kind: 'failed', reason: 'it could not be started' }
  } finally {
    busy = false
    inFlight = null
  }
}

/** The body, so the wrapper above can guarantee an outcome for every path. */
async function attempt(question: string, deps: DelegateDeps): Promise<DelegationOutcome> {
  {
    const status = await deps.status()
    if (cancelRequested) return { kind: 'cancelled' }
    const readiness = readinessOf(status)
    if (readiness !== 'ready') return { kind: 'not-ready', readiness, remedy: remedyFor(status) }

    // Created before the scan, so a first run on a fresh install refuses for a
    // real reason rather than for "that directory does not exist".
    await mkdir(deps.workspace, { recursive: true })
    // CANONICAL paths, so the chain that is scanned is the chain Codex will
    // open. A symlinked component makes the lexical ancestors differ from the
    // real ones, and the guard would then have inspected directories nobody
    // reads while missing the ones that count.
    //
    // Still not a complete answer: a reserved file created between this scan
    // and Codex loading its instructions is not caught by any check made here.
    // Closing that needs a per-run snapshot rather than a scan, which is a
    // larger change than this one and is recorded as outstanding rather than
    // half-done.
    const [realWorkspace, realUserData] = await Promise.all([
      realpath(deps.workspace).catch(() => deps.workspace),
      realpath(deps.userData).catch(() => deps.userData),
    ])
    const verdict: WorkspaceVerdict = await guardWorkspace({
      workspace: realWorkspace,
      stopAt: realUserData,
      list: async (directory) => await readdirNames(directory),
    })
    if (!verdict.ok) {
      return verdict.why === 'reserved'
        ? { kind: 'refused', hazards: verdict.hazards }
        : { kind: 'unreadable-workspace' }
    }
    if (cancelRequested) return { kind: 'cancelled' }

    const path = await deps.codexPath()
    if (path === null) return { kind: 'not-ready', readiness: 'not-installed', remedy: 'install' }

    const schemaPath = join(deps.userData, 'delegation-schema.json')
    // A NEW file per run, removed afterwards.
    //
    // One shared path meant the previous answer sat on disk indefinitely --
    // including `detail`, which can carry workspace contents -- and a run that
    // exited zero without writing would have replayed it as its own. An answer
    // that is stale is worse than one that is missing: the missing one is
    // reported, and the stale one is spoken.
    runCounter += 1
    const outPath = join(deps.userData, `delegation-answer-${String(runCounter)}.json`)
    try {
      await writeFile(schemaPath, JSON.stringify(ANSWER_SCHEMA), 'utf8')
    } catch {
      return { kind: 'failed', reason: 'the answer schema could not be written' }
    }
    if (cancelRequested) return { kind: 'cancelled' }

    const handle = deps.run(
      path,
      argsFor({
        workspace: deps.workspace,
        settings: deps.settings,
        schemaPath,
        outPath,
        question,
      }),
    )
    inFlight = handle
    // A cancel that landed between the check above and this assignment still
    // has to reach the process. Cheaper to kill an already-doomed run twice
    // than to leave one running that somebody asked to stop.
    if (cancelRequested) handle.kill()

    let timedOut = false
    let hardKill: ReturnType<typeof setTimeout> | undefined
    const deadline = setTimeout(() => {
      timedOut = true
      handle.kill()
      // Escalate if it does not go. Without this the "deadline" only asks.
      hardKill = setTimeout(() => handle.kill('SIGKILL'), deps.graceMs ?? GRACE_MS)
    }, deps.deadlineMs ?? DELEGATION_DEADLINE_MS)

    try {
      const { code } = await handle.finished
      if (timedOut) return { kind: 'timed-out' }
      // Only what was ASKED for counts as a cancellation. `code === null` also
      // arrives when the process could not be spawned at all, and reporting
      // that as "cancelled" tells the user they stopped something they never
      // started -- while hiding a broken Codex install behind their own name.
      if (code === null) {
        return cancelRequested
          ? { kind: 'cancelled' }
          : { kind: 'failed', reason: 'codex did not start, or was stopped by something else' }
      }
      if (code !== 0) {
        console.error(`[delegate] codex exited with ${String(code)}`)
        return { kind: 'failed', reason: 'codex stopped with an error' }
      }
      const text = await readBounded(outPath)
      return text === null
        ? { kind: 'failed', reason: 'the answer could not be read' }
        : readAnswer(text)
    } finally {
      clearTimeout(deadline)
      // AWAITED, not fired and forgotten. The answer has been read by this
      // point, and leaving it would leave workspace contents in `userData` for
      // as long as the app is installed -- so the removal is part of the run
      // rather than something that may or may not have happened by the time
      // anyone looks.
      await rm(outPath, { force: true }).catch(() => undefined)
      if (hardKill !== undefined) clearTimeout(hardKill)
    }
  }
}

/** Entry names, for the guard. Separated so `delegate` states its own I/O. */
async function readdirNames(directory: string): Promise<readonly string[]> {
  const { readdir } = await import('node:fs/promises')
  return await readdir(directory)
}

async function readBounded(path: string): Promise<string | null> {
  try {
    // Size first. Reading and then measuring means the file is already in
    // main's heap by the time the limit has an opinion about it, which makes
    // the limit a report rather than a bound -- and this path is written by
    // another program.
    const { stat } = await import('node:fs/promises')
    const stats = await stat(path)
    if (stats.size > MAX_ANSWER_BYTES) return null
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}
