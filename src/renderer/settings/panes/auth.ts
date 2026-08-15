/**
 * Where her bearer comes from, as a pane.
 *
 * Its own module because it was the largest single subject in the settings
 * window and had nothing to do with the rest of it: a source control, a
 * password field, and a live status line that goes and asks.
 *
 * The key travels ONE WAY. It is read out of the field, sent to main, and the
 * field cleared before the await — a secret left in a DOM node outlives the
 * paste and survives into a screenshot. Nothing sends it back; the pane learns
 * only that one is stored and its last four characters.
 */

import { CREDENTIAL_SOURCES, type CredentialSource } from '@shared/auth'
import { messagesFor } from '@shared/i18n'
import type { AuthVerdict, SaveProblem, SettingsSnapshot, AuthChange } from '@shared/ipc'
import { el, field, select } from '../form'
import type { Copy } from '../copy'

/** What this pane needs the window to do for it. */
export interface AuthDeps {
  readonly act: (
    what: string,
    run: () => Promise<readonly SaveProblem[] | void>,
    after?: () => void,
  ) => void
  readonly showProblems: (problems: readonly SaveProblem[]) => void
}

/**
 * What the dot can say. Each has a matching `.auth-dot.is-*` rule.
 *
 * `wait` is not a nicety: without it a rate limit renders in the same red as a
 * refused key, and the obvious response to that is to go and issue a new one.
 */
type StatusTone = 'unknown' | 'busy' | 'ok' | 'bad' | 'wait'

/**
 * Where her bearer comes from.
 *
 * ## One choice, one set of controls
 *
 * The source is a single choice, so only the chosen one has controls on
 * screen. Showing the key field while Codex is selected meant half the pane
 * was permanently dead — a text box and two buttons that do nothing to the
 * credential actually in use, which is worse than absent because it invites
 * you to fill it in.
 *
 * ## One status line, reused
 *
 * Both sources answer the same question, so they share the answer. There was a
 * per-source row as well as the live status, which said the same thing twice
 * and disagreed while a check was running.
 *
 * The key travels ONE WAY: read out of the field, sent to main, field cleared
 * before the await. Nothing sends it back — the pane learns only that a key is
 * stored and its last four characters.
 */
export function authPane(copy: Copy, snapshot: SettingsSnapshot, deps: AuthDeps): HTMLElement {
  const { t } = copy
  const { auth } = snapshot

  const save = (next: AuthChange): void => {
    deps.act('could not save the credential', async () => {
      deps.showProblems(await window.mochiSettings.saveAuth(next))
      // No re-check here: main broadcasts, the pane rebuilds, and a rebuilt
      // pane checks on open. Doing both is two round trips for one answer.
    })
  }

  return el('div', { class: 'auth' }, [
    field(
      'auth-source',
      t.authSource,
      select<CredentialSource>(
        CREDENTIAL_SOURCES,
        (value) => (value === 'codex' ? t.authCodex : t.authApiKey),
        auth.source,
        (value) => save({ source: value, key: 'keep' }),
      ),
    ),
    // Only for the source actually in use. See the header.
    ...(auth.source === 'apikey' ? [keyField(copy, auth, save)] : []),
    // LAST, under whatever it is reporting on. The status is a conclusion about
    // the rows above it -- reading it before the key field meant reading the
    // verdict before the thing it judges.
    authStatus(copy),
  ])
}

/**
 * The dot, the sentence beside it, and the button that goes and asks.
 *
 * Lifted out of `authPane`, which was 138 lines doing rendering, credential
 * state, status checks, secret handling, persistence and localisation at
 * once -- so the one rule that matters here, that the dot and the sentence
 * always come from the same verdict, was buried among five other concerns.
 */
function authStatus(copy: Copy): HTMLElement {
  const { t } = copy
  const status = el('span', { class: 'auth-state' })
  const dot = el('span', { class: 'auth-dot' })
  const check = el('button', { class: 'button', type: 'button' }, [
    document.createTextNode(t.authCheck),
  ])

  const show = (state: StatusTone, text: string): void => {
    dot.className = `auth-dot is-${state}`
    status.textContent = text
  }
  show('unknown', t.authUnchecked)

  /** Words, never the raw mode name. `chatgpt` is a value, not a sentence. */
  const modeWords = (mode: string | null): string =>
    mode === 'chatgpt' ? t.authModeSubscription : mode === 'apikey' ? t.authModeKey : ''

  const sentence = (verdict: AuthVerdict): string => {
    if (verdict.ok) {
      const words = modeWords(verdict.mode)
      return words === '' ? t.authWorks : `${t.authWorks} · ${words}`
    }
    switch (verdict.why.kind) {
      case 'no-key':
        return t.authNoKey
      case 'codex':
        return messagesFor(copy.locale).codex.remedy[verdict.why.remedy]
      case 'rejected':
        return `${t.authRejected} (${String(verdict.why.status)})`
      case 'unavailable':
        return `${t.authUnavailable} (${String(verdict.why.status)})`
      case 'unreachable':
        return t.authUnreachable
    }
  }

  const runCheck = (): void => {
    if (check.disabled) return
    check.disabled = true
    show('busy', t.authChecking)
    // NOT through `act`. Every other action reports a failure in the problem
    // list; this one owns a status line and a coloured dot, and putting the
    // same failure in two places at once would have the pane contradicting
    // itself -- a red dot beside a list item saying the same thing.
    void (async () => {
      try {
        show(...verdictToState(await window.mochiSettings.checkAuth(), sentence))
      } catch (error: unknown) {
        console.error('[settings] the credential check failed:', error)
        show('bad', messagesFor(copy.locale).settings.saveFailed)
      } finally {
        check.disabled = false
      }
    })()
  }
  check.addEventListener('click', runCheck)
  // Checked on open, so the pane never shows an answer settled at launch.
  queueMicrotask(runCheck)
  return el('div', { class: 'auth-status' }, [dot, status, check])
}

/**
 * The password field and its two buttons. Only drawn for the API key source.
 *
 * The key travels ONE WAY: read out of the field, sent to main, and the field
 * cleared before the await -- a secret left in a DOM node outlives the paste
 * and survives into a screenshot.
 */
function keyField(
  { t, say }: Copy,
  auth: SettingsSnapshot['auth'],
  save: (next: AuthChange) => void,
): HTMLElement {
  const input = el('input', {
    type: 'password',
    class: 'input',
    placeholder: t.authKeyPlaceholder,
    autocomplete: 'off',
    spellcheck: 'false',
  })
  input.disabled = !auth.canStoreKey

  const store = el('button', { class: 'button', type: 'button' }, [
    document.createTextNode(t.authKeySave),
  ])
  store.disabled = !auth.canStoreKey
  store.addEventListener('click', () => {
    const typed = input.value
    // Cleared BEFORE the await. A secret left in a DOM node outlives the
    // paste and survives into a screenshot.
    input.value = ''
    save({ source: auth.source, key: 'replace', value: typed })
  })

  const remove = el('button', { class: 'button', type: 'button' }, [
    document.createTextNode(t.authKeyClear),
  ])
  remove.disabled = !auth.keySet
  remove.addEventListener('click', () => {
    save({ source: auth.source, key: 'clear' })
  })

  // The stored state belongs in the HINT, not in a row of its own labelled
  // with the same words as the field above it. There is nothing to show but
  // the last four characters, so a whole labelled row for it was a label
  // introducing four characters.
  const stored = auth.keySet ? `${t.authStored} ${auth.keyHint} · ` : ''
  return field(
    'auth-key',
    t.authKeyLabel,
    el('div', { class: 'key-row' }, [input, store, remove]),
    auth.canStoreKey ? `${stored}${say(t.authKeyPrivate)}` : t.authNoKeychain,
  )
}

/** The dot's state and the sentence beside it, from one verdict. */
function verdictToState(
  verdict: AuthVerdict,
  sentence: (verdict: AuthVerdict) => string,
): [StatusTone, string] {
  if (verdict.ok) return ['ok', sentence(verdict)]
  // Not every failure is a red light. A rate limit and a dead network are both
  // "ask again later" -- painting them the same red as a refused key is what
  // sends somebody to the API console to replace a key that works.
  const soft = verdict.why.kind === 'unavailable' || verdict.why.kind === 'unreachable'
  return [soft ? 'wait' : 'bad', sentence(verdict)]
}
