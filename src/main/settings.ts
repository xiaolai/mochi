/**
 * What the settings window is allowed to change, decided here.
 *
 * The window draws; main decides. Every function below takes the values a page
 * sent and treats them as untrusted text — an id that becomes a path segment,
 * a voice that goes on the wire, a folder somebody wants opened. The renderer
 * never names a location, never picks which file a change lands in, and never
 * learns where anything lives beyond a string to display.
 *
 * ## Why this window exists at all
 *
 * Until now the only way to change who she is or what she looks like was to
 * hand-edit JSON under `Application Support`. The store has had a full write
 * path the whole time — `savePersonaTo`, carried over from v1 and tested —
 * with nothing reaching it. Its own comment says as much: *"it was unreachable
 * through the settings window"*. This is the window.
 */

import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  PERSONA_LIMITS,
  VOICE_NAMES,
  isPersonaId,
  type Persona,
  type VoiceName,
} from '@shared/persona'
import type {
  GrantUse,
  LookupChange,
  ScreenChange,
  SettingsGrant,
  SettingsKey,
  SettingsLookup,
  SettingsScreen,
  PersonaChange,
  Revealable,
  SettingsAvatar,
  SettingsCapability,
  SettingsPersona,
  SettingsWrite,
} from '@shared/ipc'
import { GRANT_SPECS, type Grants } from '@shared/grants'
import type { Usage } from './store/usage'
import { WEB_SEARCH_MODES, isWebSearchMode, type WebSearchMode } from '@shared/delegation'
import type { Registry } from '@shared/capability/registry'
import { PERSONAS_DIR, type PersonaCatalog } from './store/personas'
import { AVATARS_DIR } from './store/avatars'

/**
 * Every avatar somebody could wear: the shipped one, plus every `.json` beside
 * it.
 *
 * Listed by NAME rather than by path, because the name is what a persona
 * stores and what `resolveAvatarById` turns back into a location. The renderer
 * receiving a path would be the renderer able to ask for one.
 *
 * Files are not opened here. A listing that parsed every avatar to check it
 * would make opening this window cost as much as loading them all, and a broken
 * one already reports itself through `problems` when it is actually worn.
 */
export function listAvatars(avatarsFolder: string): readonly SettingsAvatar[] {
  let names: string[] = []
  try {
    names = readdirSync(avatarsFolder, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => entry.name.slice(0, -'.json'.length))
      .filter((name) => isPersonaId(name))
      .sort()
  } catch {
    // A missing folder is ordinary on a fresh install: the built-in is the
    // answer, and `seedAvatars` will make the folder the next time it runs.
    names = []
  }
  // The built-in first, and as `null`: that is literally what a persona stores
  // for "the shipped face", so there is nothing to translate on the way back.
  return [{ id: null, builtIn: true }, ...names.map((id) => ({ id, builtIn: false }))]
}

/** The personas on the shelf, in a shape a page can draw and nothing more. */
export function listPersonas(catalog: PersonaCatalog): readonly SettingsPersona[] {
  return [...catalog.personas.values()]
    .map((persona) => ({
      id: persona.id,
      name: persona.name,
      voice: persona.voice,
      bubble: persona.bubble,
      avatarId: persona.avatarId,
      source: catalog.sources.get(persona.id) ?? null,
    }))
    .sort((a, b) => (a.name < b.name ? -1 : 1))
}

/**
 * What she can do.
 *
 * One list now, and every entry on it is on the wire. This used to have a
 * second half — capabilities found in the user's folder, listed with their
 * descriptions and marked refused, because the settings window was the one
 * place that attacker-controlled text was safe to show. Nothing loads from that
 * folder any more: a capability is a folder in the source that whoever built
 * this compiled, so every description here came from the same place the code
 * did.
 */
export function listCapabilities(registry: Registry): readonly SettingsCapability[] {
  return registry.tools.map((tool) => ({ name: tool.name, description: tool.description }))
}

/**
 * The four standing grants, with a "last used" that is real or absent.
 *
 * 5b's acceptance is exactly that: *"'Last used' is real or the row does not
 * claim it"*. Two of the four are capabilities, so the ledger's durable half
 * has a time for them; the microphone and speaking first are not tool calls and
 * nothing records them, which is `not-recorded` rather than `never`. A single
 * nullable number would collapse those two into one answer, and the wrong one:
 * a panel that says "never" about a microphone she has used all morning is
 * making a claim rather than admitting a gap.
 */
export function listGrants(grants: Grants, used: Usage): readonly SettingsGrant[] {
  return GRANT_SPECS.map((spec) => {
    const lastUsed = ((): GrantUse => {
      // Nothing writes a time for the microphone or for speaking first, and a
      // record nobody can read is the same answer for a different reason: in
      // both cases this does not know, and saying "never" would be a claim.
      if (spec.capability === null || !used.ok) return { kind: 'not-recorded' }
      const at = used.used.get(spec.capability)
      return at === undefined ? { kind: 'never' } : { kind: 'at', at }
    })()
    return { id: spec.id, allowed: grants[spec.id], lastUsed }
  })
}

/**
 * How a lookup runs, in a shape a page can draw.
 *
 * `workspaceIsDefault` rather than leaving the window to compare strings: the
 * default is a path this module computes, and a window that recomputed it would
 * be the second place that rule lives.
 *
 * The profile PATH is included because the file is the thing somebody edits,
 * and "there is a file, somewhere, called something" is not an instruction
 * anybody can follow. Null when no profile is in force — there is no file to
 * point at, and inventing one would be pointing at something that is not there.
 */
export function listLookup(input: {
  readonly workspace: string
  readonly defaultWorkspace: string
  readonly webSearch: string
  readonly profile: string | null
  readonly profilePath: string | null
  readonly codexFound: boolean
}): SettingsLookup {
  return {
    workspace: input.workspace,
    workspaceIsDefault: input.workspace === input.defaultWorkspace,
    webSearch: input.webSearch,
    webSearchModes: [...WEB_SEARCH_MODES],
    profile: input.profile,
    profilePath: input.profile === null ? null : input.profilePath,
    codexFound: input.codexFound,
  }
}

/**
 * The two global keys, and whether this application actually got one.
 *
 * `what` rather than the internal id, because "rest" is our word for it and
 * "Let her rest, or wake her" is the thing somebody is looking for. The
 * accelerator is shown whether or not it was claimed: a key another
 * application owns is exactly the case worth seeing, and hiding the row would
 * make it look as though this app never wanted one.
 */
export function listKeys(
  outcomes: readonly {
    readonly id: string
    readonly accelerator: string
    readonly refused: string | null
  }[],
): readonly SettingsKey[] {
  const what: Readonly<Record<string, string>> = {
    rest: 'Let her rest, or wake her',
    hide: 'Hide her, or bring her back',
  }
  return outcomes.map((one) => ({
    id: one.id,
    what: what[one.id] ?? one.id,
    accelerator: one.accelerator,
    refused: one.refused,
  }))
}

/**
 * What she looks like on the desktop, in a shape a page can draw.
 *
 * Every side that can be CHOSEN, which is not the same as every side that fits
 * right now — that shrinks as she is dragged into a corner, and it is the
 * renderer's answer rather than main's. A settings window whose options changed
 * when somebody moved her would be describing this moment instead of a setting.
 */
export function listScreen(bubbleSide: string, sides: readonly string[]): SettingsScreen {
  return { bubbleSide, sides: [...sides] }
}

/**
 * Fold a page's request about the screen into calls main will make.
 *
 * The same shape as `applyLookup`, and for the same reason: a spread would let
 * a page set whatever the type happens to allow today.
 */
export function applyScreen(
  change: ScreenChange,
  sides: readonly string[],
):
  | { readonly ok: true; readonly change: { readonly bubbleSide?: string } }
  | { readonly ok: false; readonly why: string } {
  if (change.bubbleSide === undefined) return { ok: true, change: {} }
  if (!sides.includes(change.bubbleSide)) {
    return { ok: false, why: `The bubble cannot sit ${String(change.bubbleSide)}.` }
  }
  return { ok: true, change: { bubbleSide: change.bubbleSide } }
}

/**
 * A change that has been checked, in the types the stores actually take.
 *
 * NARROWER than `LookupChange`, which is the wire shape and has to accept
 * whatever a page sent. Carrying the validated value back as a `string` would
 * make every caller assert it again — and an assertion is what somebody writes
 * instead of a check when the two drift.
 */
export interface CheckedLookup {
  readonly workspace?: string
  readonly webSearch?: WebSearchMode
  readonly profile?: string | null
}

/**
 * Fold a page's request about a lookup into calls main will make — field by
 * field, refusing anything unrecognised.
 *
 * The same shape as `applyChange`, and for the same reason: a spread would let
 * a page set whatever the type happens to allow today. Every field here decides
 * what runs on somebody's machine, so each is checked rather than passed on.
 *
 * Returns the changes to APPLY rather than applying them, so the rule about
 * what is acceptable is testable without a filesystem.
 */
export function applyLookup(
  change: LookupChange,
  isProfileName: (value: unknown) => boolean,
):
  | { readonly ok: true; readonly change: CheckedLookup }
  | { readonly ok: false; readonly why: string } {
  const next: { workspace?: string; webSearch?: WebSearchMode; profile?: string | null } = {}

  if (change.workspace !== undefined) {
    // CHECKED, not trusted. `LookupChange` is the wire shape and a page can put
    // anything in it — `.trim()` on an object throws, which comes back to the
    // window as a rejected invoke rather than as the refusal this promises.
    if (typeof change.workspace !== 'string') {
      return { ok: false, why: 'That is not a workspace.' }
    }
    const workspace = change.workspace.trim()
    // ABSOLUTE only. A relative path is resolved against whatever the process
    // considers its working directory, which for a packaged app is `/` — so it
    // would silently point her somewhere nobody chose. `readWorkspace` already
    // refuses one on the way out; refusing it here is what lets somebody be
    // TOLD, rather than having their choice quietly ignored.
    if (!workspace.startsWith('/')) {
      return { ok: false, why: 'A workspace has to be a full path, starting with a slash.' }
    }
    next.workspace = workspace
  }

  if (change.webSearch !== undefined) {
    if (!isWebSearchMode(change.webSearch)) {
      return { ok: false, why: `There is no web search setting called ${change.webSearch}.` }
    }
    next.webSearch = change.webSearch
  }

  if (change.profile !== undefined) {
    // Null is "no profile", which is a real choice rather than a missing value.
    if (change.profile !== null && !isProfileName(change.profile)) {
      return {
        ok: false,
        why: 'A profile name is lowercase letters, digits and hyphens, starting with a letter.',
      }
    }
    next.profile = change.profile
  }

  return { ok: true, change: next }
}

function isVoice(value: unknown): value is VoiceName {
  return typeof value === 'string' && (VOICE_NAMES as readonly string[]).includes(value)
}

/**
 * Fold a page's request into the persona it names — field by field, refusing
 * anything unrecognised.
 *
 * Spreading the change over the persona would have been one line and would
 * have let a page set `id`, `version`, `instructions` or anything else the type
 * happens to allow today. `id` in particular keys her memory and her
 * transcripts: a change to it is not an edit, it is a new persona plus an
 * orphaned history.
 */
export function applyChange(
  persona: Persona,
  change: PersonaChange,
  knownAvatars: readonly string[],
): { readonly ok: true; readonly persona: Persona } | { readonly ok: false; readonly why: string } {
  let next = persona

  if (change.name !== undefined) {
    // Checked before it is trimmed, for the reason `applyLookup` gives: this is
    // whatever a page sent, and `.trim()` on an object throws out of an IPC
    // handler instead of answering.
    if (typeof change.name !== 'string') return { ok: false, why: 'That is not a name.' }
    const name = change.name.trim()
    // A blank name is not a name, and it would leave the shelf with an entry
    // nobody can point at.
    if (name.length === 0) return { ok: false, why: 'A name cannot be empty.' }
    // `PERSONA_LIMITS.name`, not a literal. This said 64 while the parser says
    // 60, so a name of 61 to 64 characters SAVED and then failed to load — the
    // character was accepted, written, and gone on the next launch. One number,
    // in the file that owns the format.
    if (name.length > PERSONA_LIMITS.name) return { ok: false, why: 'That name is too long.' }
    next = { ...next, name }
  }

  if (change.voice !== undefined) {
    if (!isVoice(change.voice))
      return { ok: false, why: `There is no voice called ${change.voice}.` }
    next = { ...next, voice: change.voice }
  }

  if (change.bubble !== undefined) {
    if (typeof change.bubble !== 'boolean') return { ok: false, why: 'That is not a yes or a no.' }
    next = { ...next, bubble: change.bubble }
  }

  if (change.avatarId !== undefined) {
    // Checked against what is actually on disk, not merely against the
    // character set. A persona naming an avatar that is not there falls back to
    // the built-in silently, which is the exact "the app ignored my file"
    // failure the avatar store exists to avoid.
    if (change.avatarId !== null && !knownAvatars.includes(change.avatarId)) {
      return { ok: false, why: `There is no avatar called ${change.avatarId}.` }
    }
    next = { ...next, avatarId: change.avatarId }
  }

  return { ok: true, persona: next }
}

/** Turn a named folder into a location. The ONLY place that mapping is made. */
export function folderFor(userData: string, what: Revealable): string {
  return what === 'avatars' ? join(userData, AVATARS_DIR) : join(userData, PERSONAS_DIR)
}

/** A refusal shaped like every other answer, so callers have one path. */
export function refuse(why: string): SettingsWrite {
  return { ok: false, why }
}
