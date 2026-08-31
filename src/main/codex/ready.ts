/**
 * Whether the CLI she delegates to is usable, and what to say when it is not.
 *
 * Beside `status.ts` and `auth.ts`, which answer the same question at a lower
 * level. The path and the last known status live here with the functions that
 * read them rather than in `index.ts`: three of the four readers were already
 * in this directory, and a status held one import away from the code that
 * interprets it is how "not installed" reached a person as her declining to
 * help, with nothing anywhere saying why.
 */
import { app } from 'electron'
import { problems } from '../problems'
import {
  type CodexStatus,
  checkCodex,
  describeStatus,
  pathOf,
  readinessOf,
  remedyFor,
} from './status'
import { CODEX_SAYS, REMEDY_SAYS } from '@shared/delegation'
import { type SettingsCodex } from '@shared/ipc'
/**
 * Where the Codex CLI is, found once and remembered.
 *
 * Resolved rather than shelled out to — see `ask-workspace/locate.ts` for why, and for the
 * machine on the fleet where every shell-based lookup reports it missing. Null
 * means genuinely absent, which she says out loud rather than answering from
 * memory.
 */
let codexPath: string | null = null

/**
 * What the last check made of the local Codex, and why it is held rather than
 * asked for.
 *
 * `checkCodex` spawns two child processes with a deadline each. `settings:read`
 * runs whenever the window redraws, so probing there would put two spawns
 * behind a tab change — and the answer barely moves: it changes when somebody
 * installs the CLI, signs in, or lets a token expire, none of which happen
 * while a pane is being looked at.
 *
 * Null until the first check completes. The window is told `timed-out` for that
 * window of a second or two, which is the one state whose remedy is "ask
 * again" — the honest answer for "the check has not finished".
 */
let codexStatus: CodexStatus | null = null

/**
 * When the check that set `codexStatus` finished.
 *
 * Beside the status rather than inside it: `CodexStatus` is what the probe
 * found, and this is when we asked — the second is a fact about this process,
 * not about the machine, and `status.ts` is pure of clocks on purpose.
 */
let codexCheckedAt: number | null = null

/** The last answer, reduced to what a renderer may hear. See `SettingsCodex`. */
export function codexForWindow(): SettingsCodex {
  if (codexStatus === null) {
    return { readiness: 'timed-out', remedy: 'retry', version: null, checkedAt: null }
  }
  return {
    readiness: readinessOf(codexStatus),
    remedy: remedyFor(codexStatus),
    /*
      The VERSION, and only the version.

      `CodexStatus` also carries a resolved binary path and the directories that
      were searched — a search path is a home directory, which is a username —
      and `delegation.ts` is explicit that none of that belongs on a wire the
      renderer reads. A version string is a version string.

      `not-installed` and `timed-out` have no version to report, and null is the
      honest answer rather than a guess: it is what makes "older than the
      measurement" unanswerable rather than false.
    */
    version: 'version' in codexStatus ? codexStatus.version : null,
    // A timestamp, not a duration: the renderer redraws on its own schedule and
    // has to be able to say how old this is at the moment it draws.
    checkedAt: codexCheckedAt,
  }
}

/**
 * Run the whole check, take its two consequences, and answer.
 *
 * TWO consequences, and they are different in kind. `codexPath` is what
 * `ask-workspace` spawns, so it must follow the check rather than a separate
 * search — there were two answers to "where is Codex" and only one of them
 * looked at whether the binary runs. The problems note is what somebody sees
 * without opening the settings window at all.
 *
 * `describeStatus` goes to the LOG and nothing else: it carries the resolved
 * path and every directory searched, which is a home directory, which is a
 * username. What reaches the window is `readinessOf`, which is seven words.
 */
export async function checkCodexNow(): Promise<SettingsCodex> {
  const status = await checkCodex({
    platform: process.platform,
    env: process.env,
    home: app.getPath('home'),
  })
  codexStatus = status
  codexCheckedAt = Date.now()
  // From the check that RAN it, not from a second search. There were two
  // answers to "where is Codex" and only this one knows the file is executable.
  codexPath = pathOf(status)
  console.log(`[codex] ${describeStatus(status)}`)
  if (status.kind !== 'ready') {
    // Loud, and reported. Without a usable Codex she cannot look anything up,
    // and the failure otherwise presents as her declining to help.
    problems.note('codex', null, `${CODEX_SAYS[readinessOf(status)]} ${remedySentence(status)}`)
  }
  return codexForWindow()
}

/** The remedy as words, or nothing when there is none. See `REMEDY_SAYS`. */
export function remedySentence(status: CodexStatus): string {
  const remedy = remedyFor(status)
  return remedy === null ? '' : REMEDY_SAYS[remedy]
}

/** The resolved CLI path, read as a thunk so an edit lands on the next lookup. */
export function codexPathNow(): string | null {
  return codexPath
}
