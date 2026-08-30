import { CONFINEMENT_MEASURED_AGAINST, type CodexReadiness } from '@shared/delegation'

/**
 * How ready the external tool is, as a CARD rather than as a boolean.
 *
 * ## The failure this exists for
 *
 * "Ready / not ready" is two states, and the pane that drew it had three
 * questions behind one answer — installed, signed in, and whether the token is
 * still good. Collapsing them means the card says something is wrong and leaves
 * the person to guess which of three things to do about it.
 *
 * ## Unknown is not unavailable, and that is the whole point
 *
 * Two of these states say NOTHING EITHER WAY: a check that is still running,
 * and a check that never came back. Drawing either as "not installed" tells
 * somebody to reinstall a working tool after a network blip, which costs an
 * afternoon and is exactly the advice `CODEX_SAYS['timed-out']` already refuses
 * to give. `certainty` is a separate axis from `state` for that reason — the
 * mark beside the sentence is filled when she can, hollow when she cannot, and
 * dashed when nobody knows.
 *
 * ## Nine, where the design draws seven
 *
 * The delivery's B1b draws seven cards. This answers eight, and the difference
 * runs both ways.
 *
 * It UNDERCOUNTS by two, because it was drawn against the screens rather than
 * against the wire. `CodexReadiness` carries two states a person has to be able
 * to act on:
 *
 * - `unusable` — it is installed and it would not run. Not "not installed";
 *   the remedy is different and so is the sentence.
 * - `unreadable` — signed in, and the credential could not be read.
 *
 * Folding either into one of the seven would put a wrong instruction on screen,
 * which is the defect this module exists to prevent, one layer up.
 *
 * It also OVERCOUNTS by nothing: the two the design draws that the wire cannot
 * carry are both here. Neither is a probe result — `checking` is "a probe is in
 * flight", which beats whatever the last one said, and `too-old` is a comparison
 * against the version the confinement was measured on.
 */

/** Whether she can look anything up, and whether we know. */
export type Certainty = 'usable' | 'unusable' | 'unknown'

/** The one thing this card offers. Never two — a card with two next steps has none. */
export type ReadinessAction =
  'check-again' | 'open-a-terminal' | 'how-to-install' | 'sign-in-again' | 'update-it' | 'try-again'

export type ReadinessState =
  | 'ready'
  | 'too-old'
  | 'not-signed-in'
  | 'not-installed'
  | 'would-not-run'
  | 'credential-expired'
  | 'credential-unreadable'
  | 'checking'
  | 'no-answer'

export interface Readiness {
  readonly state: ReadinessState
  readonly certainty: Certainty
  readonly action: ReadinessAction
}

/**
 * What the probe found, plus the two facts it cannot carry.
 *
 * `checking` is a fact about THIS WINDOW — a probe is out — and it beats
 * whatever the last one said, because a stale answer drawn as current is how a
 * person concludes the button did nothing.
 */
export interface Probe {
  readonly readiness: CodexReadiness
  /** A check is in flight right now. */
  readonly checking: boolean
  /** What is installed, when the probe found out. Absent before the first check. */
  readonly version?: string | null
}

/**
 * Older than the version the confinement was measured on.
 *
 * Numeric, not lexical: `'0.9.0' > '0.10.0'` as text and the answer would be
 * backwards. A version this cannot parse is NOT reported as old — an unknown is
 * an unknown, and telling somebody to update something that may already be
 * current is the same class of wrong advice as telling them to reinstall a
 * working tool.
 *
 * ## This state was deleted once, wrongly
 *
 * On the reasoning that nothing recorded which version the read-only
 * confinement was measured against, so there was no second operand and building
 * the state would mean inventing the number.
 *
 * The number was not missing. `verify-codex-precedence.sh` opens by recording
 * it — 2026-08-19, codex-cli 0.148.0 — because measuring that behaviour is the
 * entire purpose of that script. It was looked for as a TypeScript constant and
 * not found, which is a search that answers a different question than the one
 * asked. `CONFINEMENT_MEASURED_AGAINST` is now the one place it lives.
 */
function behind(version: string | null | undefined): boolean {
  if (typeof version !== 'string') return false
  const parts = (text: string): number[] | null => {
    const found = /^v?(\d+(?:\.\d+)*)$/.exec(text.trim())
    return found === null ? null : (found[1] ?? '').split('.').map(Number)
  }
  const here = parts(version)
  const measured = parts(CONFINEMENT_MEASURED_AGAINST)
  if (here === null || measured === null) return false
  for (let at = 0; at < Math.max(here.length, measured.length); at += 1) {
    const a = here[at] ?? 0
    const b = measured[at] ?? 0
    if (a !== b) return a < b
  }
  return false
}

export function readinessOf(probe: Probe): Readiness {
  // In flight beats everything, including the last answer. "Checking…" while
  // showing yesterday's verdict is two claims about one machine.
  if (probe.checking) return { state: 'checking', certainty: 'unknown', action: 'check-again' }

  switch (probe.readiness) {
    case 'ready':
      /*
        Usable, and still offering something.

        An older CLI runs and she can look things up with it, so the mark is
        filled. What is NOT established on it is the confinement — the
        measurement was taken on a newer one — and that is a caveat in the
        sentence rather than a reason to draw a working tool as broken.
      */
      return behind(probe.version)
        ? { state: 'too-old', certainty: 'usable', action: 'update-it' }
        : { state: 'ready', certainty: 'usable', action: 'check-again' }
    case 'logged-out':
      // The terminal, because `codex login` is the only thing that fixes it and
      // this application cannot run it on somebody's behalf.
      return { state: 'not-signed-in', certainty: 'unusable', action: 'open-a-terminal' }
    case 'not-installed':
      return { state: 'not-installed', certainty: 'unusable', action: 'how-to-install' }
    case 'unusable':
      // Installed and would not run. Reinstalling is the remedy, so the action
      // is the install instructions — NOT "not installed", whose sentence would
      // send somebody looking for a binary that is already there.
      return { state: 'would-not-run', certainty: 'unusable', action: 'how-to-install' }
    case 'stale':
      return { state: 'credential-expired', certainty: 'unusable', action: 'sign-in-again' }
    case 'unreadable':
      return { state: 'credential-unreadable', certainty: 'unusable', action: 'sign-in-again' }
    case 'timed-out':
      // NOT unavailable. This says nothing either way, so nothing here claims
      // otherwise — and the action is to ask again rather than to repair.
      return { state: 'no-answer', certainty: 'unknown', action: 'try-again' }
  }
}
