/**
 * What the renderer said the session did, as an event the lifecycle knows.
 *
 * A pure mapping, and its own module because it is the kind of pure mapping
 * that has already been wrong: it lived in the composition root, where nothing
 * could import it, and the bug below was found by reading rather than by a
 * failing test.
 *
 * The `openFailed` / `sessionLost` split is the whole reason this is not a
 * one-line lookup. They were once a single `failed` that became
 * `sessionFailed`, an event the machine only handles while WAKING — so a
 * connection dropping after she was ready was discarded, and main stayed awake
 * over a session the renderer had already torn down.
 *
 * Four of the six arms do look identical. They are not collapsible without
 * putting the two that differ back in reach of the same edit.
 */

import type { CompanionEvent } from '@shared/companion'
import type { VoiceReport } from '@shared/ipc'

export interface Translated {
  readonly event: CompanionEvent
  /** Worth a line in the log. Only the two failures carry one. */
  readonly log: string | null
}

/**
 * Everything the renderer reports that DRIVES the state machine.
 *
 * `said` and `utteranceEnded` are excluded rather than given cases, because
 * neither drives the machine: one is a line of text on its way to the
 * transcript store and the other is an outcome a CAPABILITY reacts to. Both
 * are handled before this is reached. Adding no-op branches would let a future
 * report that genuinely does move the machine be given the same treatment by
 * mistake: it is a line of text on its way to the transcript store, and the
 * caller handles it before this is reached. Adding a no-op branch would let a
 * future report that genuinely does move the machine be given the same
 * treatment by mistake -- the exhaustiveness here is the check, so what it
 * covers has to be what it is for.
 */
export type MachineReport = Exclude<
  VoiceReport,
  | { readonly kind: 'said' }
  | { readonly kind: 'utteranceEnded' }
  // `workspaceAsked` joins them for the same reason: it starts a Codex run and
  // is answered later through `workspaceAnswer`, and at no point does it move
  // the session state machine. Giving it a no-op branch here is precisely what
  // the comment above warns against -- the exhaustiveness is the check, so what
  // it covers has to stay what it is for.
  | { readonly kind: 'workspaceAsked' }
>

export function translateReport(report: MachineReport): Translated {
  switch (report.kind) {
    case 'ready':
      return { event: { kind: 'sessionReady' }, log: null }
    case 'openFailed':
      return { event: { kind: 'sessionFailed' }, log: `[voice] open failed: ${report.reason}` }
    case 'sessionLost':
      return { event: { kind: 'sessionLost' }, log: `[voice] session lost: ${report.reason}` }
    case 'voiceStarted':
      return { event: { kind: 'voiceStarted' }, log: null }
    case 'voiceStopped':
      return { event: { kind: 'voiceStopped' }, log: null }
    case 'userSpoke':
      return { event: { kind: 'userSpoke' }, log: null }
    case 'loopback':
      // Logged, because it is the one report that says something about the
      // ROOM rather than about the session, and it is the thing to look at
      // first when somebody says she keeps interrupting herself.
      return {
        event: { kind: 'loopback', present: report.present },
        log: `[voice] her own voice ${report.present ? 'IS' : 'is not'} coming back into the microphone`,
      }
  }
}
