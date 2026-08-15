/**
 * The settings window's view of the application, as one value.
 *
 * Pure: everything it needs arrives as an argument, so it can be read by a test
 * — which matters because this is the boundary the window's own validator
 * checks against. Two descriptions of one snapshot, one in main and one in
 * `renderer/settings/snapshot.ts`, are exactly the pair that drifts.
 *
 * It carries no key and no token. `auth` says whether one is stored and its
 * last four characters, and nothing else about it ever leaves main.
 */

import { describeAccelerator, parseAccelerator } from '@shared/accelerator'
import { LOCALES, LOCALE_TAGS, type LocaleTag } from '@shared/i18n'
import { SHORTCUT_IDS, type ShortcutId, type Shortcuts } from '@shared/shortcuts'
import type { FaceSpec } from '@shared/avatar-spec'
import type { Persona, PersonaLoadProblem } from '@shared/persona'
import type { Policy } from '@shared/policy'
import type { SettingsSnapshot } from '@shared/ipc'
import type { CredentialSource } from '@shared/auth'
import type { DelegationView } from '@shared/delegation'
import type { Sound } from '@shared/sound'
import type { IdleChoice } from '@shared/companion'
import type { About } from '../about'

export interface SnapshotInput {
  readonly persona: Persona
  /** Already themed. Main resolves her colours; this only reports them. */
  readonly face: FaceSpec
  readonly personas: ReadonlyArray<{ readonly id: string; readonly name: string }>
  /** Whether the built-in currently differs from the persona she ships as. */
  readonly builtInEdited: boolean
  readonly sound: Sound
  readonly idleMs: IdleChoice
  readonly loopbackHeard: boolean | null
  readonly kept: SettingsSnapshot['kept']
  readonly policy: Policy
  /** What she remembers, so the pane can show it and offer to clear it. */
  readonly memory: string
  readonly personaProblems: readonly PersonaLoadProblem[]
  readonly locale: LocaleTag
  readonly version: string
  /**
   * `About` also carries a `version`, which is NOT copied through.
   *
   * The snapshot declares four fields here and a `version` at the top level,
   * and `about: about()` used to assign the whole record — so the object on the
   * wire had a fifth field its own type denied, unread by the pane and counted
   * by the redraw signature. Picked explicitly instead.
   */
  readonly about: About
  readonly sizePercent: number
  readonly shortcuts: Shortcuts
  /** What was actually claimed from the OS. `null` means another app owns it. */
  readonly claimed: Readonly<Record<ShortcutId, string | null>>
  readonly credentialSource: CredentialSource
  readonly key: { readonly set: boolean; readonly hint: string }
  readonly canStoreKey: boolean
  /**
   * Already reduced by the caller, deliberately.
   *
   * This builder does no I/O -- reading the model cache and the trust state are
   * file reads, and probing Codex spawns a process. Doing any of that here
   * would put a twenty-second worst case behind every repaint of
   * a settings window.
   */
  readonly delegation: DelegationView
  readonly spokenRules: SettingsSnapshot['spokenRules']
}

export function buildSnapshot(input: SnapshotInput): SettingsSnapshot {
  return {
    persona: input.persona,
    face: input.face,
    personas: input.personas,
    builtInEdited: input.builtInEdited,
    sound: input.sound,
    idleMs: input.idleMs,
    loopbackHeard: input.loopbackHeard,
    kept: input.kept,
    policy: input.policy,
    memory: input.memory,
    personaProblems: input.personaProblems,
    locale: input.locale,
    version: input.version,
    auth: {
      source: input.credentialSource,
      keySet: input.key.set,
      keyHint: input.key.hint,
      canStoreKey: input.canStoreKey,
    },
    delegation: input.delegation,
    spokenRules: input.spokenRules,
    keys: keyView(input.shortcuts, input.claimed),
    about: {
      name: input.about.name,
      repository: input.about.repository,
      author: input.about.author,
      homepage: input.about.homepage,
    },
    sizePercent: input.sizePercent,
    locales: LOCALE_TAGS.map((tag) => ({ tag, nativeName: LOCALES[tag].nativeName })),
  }
}

/**
 * Each binding as a person reads it, with whether it actually works.
 *
 * Formatted HERE rather than in the window: `describeAccelerator` needs the
 * platform to choose between `⇧⌃M` and `Shift+Control+M`, and the renderer has
 * no business knowing which OS it is on.
 *
 * A chord that could not be claimed still appears, with `taken` set. The window
 * has to show you the combination you chose even when something else owns it —
 * an absence would read as though the setting had not saved.
 */
function keyView(
  shortcuts: Shortcuts,
  claimed: Readonly<Record<ShortcutId, string | null>>,
): SettingsSnapshot['keys'] {
  const out = {} as Record<ShortcutId, { accelerator: string; shown: string; unavailable: boolean }>
  for (const id of SHORTCUT_IDS) {
    const accelerator = shortcuts[id]
    const chord = parseAccelerator(accelerator)
    out[id] = {
      accelerator,
      shown: chord === null ? accelerator : describeAccelerator(chord, process.platform),
      // `null` means registration FAILED, and the reason is not knowable
      // from here -- see `unavailable` in `ipc.ts`.
      unavailable: claimed[id] === null,
    }
  }
  return out
}
