/**
 * Whether she can speak, and what to do when she cannot.
 *
 * ## Why this is its own module
 *
 * `main/index.ts` is the composition root, and the predecessor project died of
 * one: 1428 lines and thirteen module-level mutable variables, which is the
 * failure this rewrite exists to escape (see AGENTS.md). This file had reached
 * fifteen, and three of them — the last probe result, the repair-dialog guard,
 * and the probe ticket — belong together and to nothing else.
 *
 * They are not three independent flags. They encode one question with three
 * invariants:
 *
 * - **Only the newest probe may settle.** Three callers start one — launch, the
 *   Check button, and each round of the repair dialog — and they used to settle
 *   in completion order, so a slow launch probe finishing after a fast Check
 *   overwrote the newer verdict with its own stale one.
 * - **One repair dialog at a time.** Two clicks produced concurrent dialogs
 *   whose completions raced.
 * - **The remedy depends on the SOURCE.** With an API key selected, every Codex
 *   remedy is the wrong instruction — `login` would send somebody to a terminal
 *   to fix a text field.
 *
 * Held in one place, those are three lines of a state machine. Spread across a
 * composition root, they are three booleans that look independent.
 *
 * ## A ticket, not a shared flight
 *
 * Sharing one in-flight probe would be cheaper, and wrong: the repair dialog
 * re-checks precisely BECAUSE the user has just run `codex login`, and handing
 * it an answer from a probe that started before they did would tell them their
 * login had not worked.
 */

import { checkCodex, describeStatus, remedyFor, type CodexStatus } from '../codex/status'
import type { Remedy } from '@shared/auth'
import type { CredentialSource } from '@shared/auth'

export interface AvailabilityDeps {
  /** Which credential the user chose. Read fresh: it changes while running. */
  readonly source: () => CredentialSource
  /** Whether a key is stored. Only consulted for the `apikey` source. */
  readonly keyStored: () => boolean
  /** Every surface that shows whether she can speak. */
  readonly onChange: () => void
  /** Ask the user to fix Codex. Resolves when the dialog is done with. */
  readonly promptRepair: (status: CodexStatus, check: () => Promise<CodexStatus>) => Promise<void>
  /** Where a missing API key is fixed. Not a Codex problem, not a Codex dialog. */
  readonly openKeySettings: () => void
}

export interface Availability {
  /** What is stopping her from speaking, or null when nothing is. */
  remedy(): Remedy | null
  /** Whether a repair dialog is on screen. The tray greys its own item on this. */
  repairing(): boolean
  /** Probe, and record the answer only if it is still the newest. */
  probe(): Promise<CodexStatus>
  /** Probe, then prompt if there is something to fix. For launch. */
  probeAndOffer(): Promise<void>
  /** Prompt now, from the tray. Single-flight. */
  repair(): Promise<void>
}

export function createAvailability(deps: AvailabilityDeps): Availability {
  // What the last completed probe concluded. Starts pessimistic: nothing has
  // been checked, and claiming she is ready before anything has looked is how
  // Wake gets offered during the check.
  let status: CodexStatus = { kind: 'not-installed', searched: [] }
  let newest = 0
  let inRepair = false

  function remedy(): Remedy | null {
    if (deps.source() === 'apikey') {
      // `login` is the nearest of the three Codex remedies, and it is not this:
      // the fix is to store a key, not to run `codex login`. Reported as its
      // own state so nothing offers the wrong instruction.
      return deps.keyStored() ? null : 'store-key'
    }
    return remedyFor(status)
  }

  function settle(next: CodexStatus): void {
    status = next
    // The whole status, not just its kind. Every other field on it — the paths
    // that were searched most of all — had no reader at all.
    console.log(`[codex] ${describeStatus(next)}`)
    deps.onChange()
  }

  async function probe(): Promise<CodexStatus> {
    const ticket = ++newest
    const answer = await checkCodex()
    // An overtaken probe still returns its answer to ITS caller — which is what
    // that caller asked for — and simply does not become the state every other
    // surface reads.
    if (ticket === newest) settle(answer)
    else console.log('[codex] a slower probe finished last; keeping the newer verdict')
    return answer
  }

  /**
   * Hold the guard for the WHOLE operation, probe and dialog together.
   *
   * The launch path used to set the guard, then call the guarded entry point
   * from its own `.then` — which begins by returning if the guard is held. The
   * startup prompt could therefore never open: a user with no Codex installed
   * launched the app and was told nothing.
   */
  async function guarded(run: () => Promise<void>): Promise<void> {
    if (inRepair) return
    inRepair = true
    deps.onChange()
    try {
      await run()
    } finally {
      inRepair = false
      deps.onChange()
    }
  }

  async function offer(current: CodexStatus): Promise<void> {
    if (remedyFor(current) === null) return
    // `probe` is the ticketed one, so every round of the dialog settles in the
    // same order as everything else — and its final answer needs no separate
    // settle, which could otherwise write a verdict a newer probe replaced
    // while the dialog was open.
    await deps.promptRepair(current, probe)
  }

  return {
    remedy,
    repairing: () => inRepair,
    probe,

    probeAndOffer: () =>
      guarded(async () => {
        // NOT AT ALL when the credential comes from a stored key: Codex is one
        // of two sources and the user picked the other, so this would spawn up
        // to three child processes to answer a question `remedy` never asks.
        if (deps.source() === 'apikey') return
        await offer(await probe())
      }),

    repair: async () => {
      // A key that is missing is not a Codex problem, and the Codex dialog
      // cannot fix it. Send the user where the field actually is.
      if (remedy() === 'store-key') {
        deps.openKeySettings()
        return
      }
      await guarded(() => offer(status))
    },
  }
}
