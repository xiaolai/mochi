/**
 * Telling the user, and letting them fix it without restarting.
 *
 * Non-blocking on purpose. She comes up either way: a companion who cannot talk
 * is still a companion, and refusing to appear until a CLI is installed turns a
 * missing feature into a broken application.
 *
 * The dialog does NOT run `codex login` for the user. That command opens a
 * browser and waits on a local callback, and spawning it from a GUI app with no
 * terminal gives a process the user cannot see, cannot answer, and cannot
 * cancel. Showing the command and offering to re-check is a worse demo and a
 * better tool.
 */

import { dialog } from 'electron'
import { messagesFor, type LocaleTag, type Messages } from '@shared/i18n'
import { DEFAULT_PRONOUN, type Pronoun } from '@shared/pronoun'
import { checkCodex, remedyFor, type CodexStatus } from './status'

/** Why she cannot talk, in the user's language. */
function reasonFor(status: CodexStatus, messages: Messages, pronoun: Pronoun): string {
  const { codex } = messages
  switch (status.kind) {
    case 'ready':
      return ''
    case 'not-installed':
      return codex.notInstalled[pronoun]
    case 'unusable':
      return codex.unusable
    case 'timed-out':
      return codex.timedOut
    case 'logged-out':
      return codex.loggedOut
    case 'stale':
      return codex.stale
    case 'unreadable':
      return codex.unreadable
  }
}

export interface PromptOptions {
  readonly locale: LocaleTag
  /**
   * How the interface refers to her. Defaults rather than being required, so a
   * caller with no persona loaded yet still gets a sentence that reads.
   */
  readonly pronoun?: Pronoun
  /** Injected so the retry loop is the same code the startup check runs. */
  readonly check?: () => Promise<CodexStatus>
}

/**
 * Show the problem, offer a re-check, and keep offering until it is fixed or
 * the user stops asking.
 *
 * Returns the status it settled on, so the caller can record what she can
 * currently do rather than assuming the dialog fixed anything.
 */
let inFlight: Promise<CodexStatus> | null = null

export function promptForCodex(initial: CodexStatus, options: PromptOptions): Promise<CodexStatus> {
  // SINGLE-FLIGHT here, not only in the caller.
  //
  // `index.ts` guards this with a `repairing` flag, and that flag is why two
  // dialogs stopped racing. But the guarantee then belongs to the caller's
  // discipline: this function is exported, it awaits a dialog and then a probe,
  // and a second entry during either opens a second dialog whose completion can
  // overwrite a newer status with an older one. Returning the live promise
  // makes a second caller wait for the first answer instead, which is the
  // answer they were going to get anyway.
  if (inFlight !== null) return inFlight
  const run = promptOnce(initial, options)
  inFlight = run
  return run.finally(() => {
    // Only if it is still ours. A `finally` that clears unconditionally would,
    // in a future where this is re-entered after resolution, release a guard
    // somebody else is holding.
    if (inFlight === run) inFlight = null
  })
}

async function promptOnce(initial: CodexStatus, options: PromptOptions): Promise<CodexStatus> {
  const check = options.check ?? ((): Promise<CodexStatus> => checkCodex())
  const messages = messagesFor(options.locale)
  const pronoun = options.pronoun ?? DEFAULT_PRONOUN
  const { codex } = messages

  let status = initial
  let retried = false

  while (status.kind !== 'ready') {
    const remedy = remedyFor(status)
    // `ready` is the only status with no remedy and the loop has excluded it,
    // so this cannot be null -- but the type says it can, and asserting that
    // away would be the place a new status silently produced an empty dialog.
    //
    // LOUD rather than a bare `break`. Reaching here means a status was added
    // without a remedy, and the user's experience of that is the repair menu
    // item doing nothing at all, twice, before they stop clicking it. Logged
    // instead of thrown because this runs behind a tray click and taking the
    // app down is a worse answer than a broken dialog.
    if (remedy === null) {
      console.error(`[codex] no remedy is defined for status "${status.kind}" — cannot prompt`)
      break
    }

    const { response } = await dialog.showMessageBox({
      type: 'info',
      title: codex.title,
      message: codex.title,
      detail: [
        retried ? codex.stillNotReady : '',
        reasonFor(status, messages, pronoun),
        codex.remedy[remedy],
      ]
        .filter((line) => line !== '')
        .join('\n\n'),
      buttons: [codex.checkAgain, codex.later],
      defaultId: 0,
      cancelId: 1,
    })
    if (response !== 0) return status

    retried = true
    status = await check()
  }
  return status
}
