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
import type { FaceSpec } from '@shared/avatar-spec'
import { EMOTIONS, type Emotion } from '@shared/avatar'
import { isPronoun } from '@shared/pronoun'
import { isThemeId, type Theme } from '@shared/theme'
import { join } from 'node:path'
import {
  BUBBLE_SIDES,
  PERSONA_LIMITS,
  VOICE_NAMES,
  type Persona,
  type VoiceName,
  type BubbleSide,
} from '@shared/persona'
import { isPersonaId } from '@shared/parse-persona'
import { HALO_WHEN, isHaloWhen, type HaloWhen } from '@shared/ipc'
import type {
  GrantUse,
  HearingChange,
  LookupChange,
  ScreenChange,
  SettingsGrant,
  SettingsKey,
  SettingsCodex,
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
import { MOST_LANGUAGES, isLanguageCode } from '@shared/transcription'

import type { Usage } from './store/usage'
import { WEB_SEARCH_MODES, isWebSearchMode, type WebSearchMode } from '@shared/delegation'
import type { Registry } from '@shared/capability/registry'
import { type PersonaCatalog } from './store/personas'
import { PERSONAS_DIR } from './store/persona-files'
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
export function listPersonas(
  catalog: PersonaCatalog,
  faceFor: (persona: { id: string; avatarId: string | null; theme: Theme }) => FaceSpec,
  /**
   * Whether her conversations are being written down.
   *
   * Passed in rather than read here for the same reason `faceFor` is: this
   * module is the shape of a page, and the answer needs the policy store and
   * the carried-policy map that a failed migration parks its choice in.
   */
  keepsFor: (personaId: string) => boolean,
): readonly SettingsPersona[] {
  return [...catalog.personas.values()]
    .map((persona) => ({
      id: persona.id,
      name: persona.name,
      voice: persona.voice,
      bubble: persona.bubble,
      bubbleSide: persona.bubbleSide,
      bubbleSides: [...BUBBLE_SIDES],
      keeps: keepsFor(persona.id),
      avatarId: persona.avatarId,
      source: catalog.sources.get(persona.id) ?? null,
      // Injected rather than resolved here: resolution needs the avatars root
      // and the persona's package folder, and this module is the shape of a
      // page rather than a reader of disk.
      face: faceFor(persona),
      pronoun: persona.pronoun,
      addressUser: persona.addressUser,
      // A `CustomTheme` object is a hue nobody picked from the swatches, and
      // the grid cannot show one — so it is reported as absent rather than as
      // the nearest of the eight. See `SettingsPersona.theme`.
      theme: isThemeId(persona.theme) ? persona.theme : null,
      style: persona.style,
      // The INSTRUCTION half only. `verbatim` is exact words a manifest author
      // wrote and no control offers it, so sending it to a page that cannot
      // express it is how it gets overwritten with the other half.
      greeting: persona.greeting.instruction,
      farewell: persona.farewell.instruction,
      faces: persona.faces,
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
  /**
   * How ready Codex is, already reduced to what a window may hear.
   *
   * Handed in rather than checked here, because the check spawns processes with
   * a deadline and this function is called on every `settings:read` — a status
   * that re-probed the machine each time the window redrew would put two child
   * processes behind a tab change. Main holds the last answer and refreshes it
   * on demand; see `settings:codex-recheck`.
   */
  readonly codex: SettingsCodex
}): SettingsLookup {
  return {
    workspace: input.workspace,
    workspaceIsDefault: input.workspace === input.defaultWorkspace,
    webSearch: input.webSearch,
    webSearchModes: [...WEB_SEARCH_MODES],
    profile: input.profile,
    profilePath: input.profile === null ? null : input.profilePath,
    codex: input.codex,
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
export function listScreen(rest: {
  readonly halo: HaloWhen
  readonly shoulderChip: boolean
  readonly sleepAfterMinutes: number
}): SettingsScreen {
  return {
    halo: rest.halo,
    // Offered by main rather than held by the page: two lists is two answers to
    // what may be chosen, and only one of them is checked on the way back.
    haloChoices: [...HALO_WHEN],
    shoulderChip: rest.shoulderChip,
    sleepAfterMinutes: rest.sleepAfterMinutes,
    // Sent rather than written into the pane: a page holding its own list would
    // be a second answer to what may be chosen, and only one is checked back.
    sleepAfterChoices: [...SLEEP_AFTER_CHOICES],
  }
}

/**
 * The idle timeouts the pane offers. `0` is never, and is first because it is
 * the one answer that is a decision rather than a duration.
 *
 * A fixed list rather than a number field: this is a preference somebody sets
 * once, the useful range is small, and a free-text minute count invites the
 * value that reads as reasonable and is not — 0.5, or 600. `readSleepAfter-
 * Minutes` still validates whatever is on disk, because the file is
 * hand-editable and this list is not the only way in.
 */
export const SLEEP_AFTER_CHOICES: readonly number[] = [0, 5, 10, 15, 30, 60]

/**
 * Fold a page's request about the screen into calls main will make.
 *
 * The same shape as `applyLookup`, and for the same reason: a spread would let
 * a page set whatever the type happens to allow today.
 */
export interface CheckedScreen {
  readonly halo?: HaloWhen
  readonly shoulderChip?: boolean
  readonly sleepAfterMinutes?: number
}

export function applyScreen(
  change: ScreenChange,
):
  | { readonly ok: true; readonly change: CheckedScreen }
  | { readonly ok: false; readonly why: string } {
  const checked: {
    halo?: HaloWhen
    shoulderChip?: boolean
    sleepAfterMinutes?: number
  } = {}

  if (change.halo !== undefined) {
    // Against the OFFERED list, not merely "is a string". This decides whether
    // an indicator is drawn, and a value this side cannot read is not one it
    // may act on — the same rule the grants frame states.
    // The GUARD, not `includes` plus a cast: a cast is a promise the compiler
    // takes on trust, and this is the one place an arbitrary wire value becomes
    // a value main will act on.
    if (!isHaloWhen(change.halo)) {
      return { ok: false, why: `The halo cannot be drawn ${String(change.halo)}.` }
    }
    checked.halo = change.halo
  }

  if (change.shoulderChip !== undefined) {
    // An explicit boolean, for the reason the halo states two lines up: a value
    // this side cannot read is not one it may act on. Truthiness would let a
    // page send the string "false" and turn the control off.
    if (typeof change.shoulderChip !== 'boolean') {
      return { ok: false, why: 'That is not a yes or a no.' }
    }
    checked.shoulderChip = change.shoulderChip
  }

  if (change.sleepAfterMinutes !== undefined) {
    // Checked against the OFFERED list rather than only against the store's
    // grammar. The store accepts any whole minute up to an hour, which is right
    // for a hand-edited file and wrong for a page: a renderer sending 47 would
    // be setting a value no control here can express or show back.
    if (!SLEEP_AFTER_CHOICES.includes(change.sleepAfterMinutes)) {
      return { ok: false, why: `${String(change.sleepAfterMinutes)} is not one of the choices.` }
    }
    checked.sleepAfterMinutes = change.sleepAfterMinutes
  }

  return { ok: true, change: checked }
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

/** A checked hearing change, in the types the store actually takes. */
export interface CheckedHearing {
  readonly languages?: readonly string[]
}

/**
 * Fold a page's request about her hearing into a call main will make.
 *
 * `applyLookup`'s shape and `applyLookup`'s reason: the wire type accepts
 * whatever a page sent, so every field is checked here rather than passed on.
 *
 * ## Refused rather than filtered
 *
 * The tempting version drops the codes it does not recognise and saves the
 * rest, which is how somebody chooses four languages, gets two, and is told it
 * worked. `readLanguages` is deliberately tolerant because it reads a FILE that
 * may have been written by another version; this reads a control somebody just
 * operated, and the two want opposite behaviour. A person who can see what they
 * clicked should be told when it was not what got saved.
 *
 * The empty list is accepted and means detect — see `readTranscriptionLanguages`.
 */
export function applyHearing(
  change: HearingChange,
):
  | { readonly ok: true; readonly change: CheckedHearing }
  | { readonly ok: false; readonly why: string } {
  const next: { languages?: readonly string[] } = {}

  if (change.languages !== undefined) {
    if (!Array.isArray(change.languages)) {
      return { ok: false, why: 'That is not a list of languages.' }
    }
    const asked = change.languages
    if (asked.length > MOST_LANGUAGES) {
      return {
        ok: false,
        why: `Choose at most ${String(MOST_LANGUAGES)} languages, or none to let her work it out.`,
      }
    }
    for (const one of asked) {
      if (!isLanguageCode(one)) return { ok: false, why: `${String(one)} is not a language code.` }
    }
    // Deduplicated here so the answer main stores is the answer that was
    // asked for -- `writeTranscriptionLanguages` would collapse them anyway,
    // and a stored value that differs from the request is the thing this
    // function exists to prevent.
    next.languages = [...new Set(asked as readonly string[])]
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

  if (change.pronoun !== undefined) {
    // `isPronoun` rather than a list here: one answer to "which pronouns exist",
    // and it already refuses the retired `they` while `parsePersona` maps a
    // stored one forward. A window may not write what a file may still carry.
    if (!isPronoun(change.pronoun)) {
      return { ok: false, why: `There is no pronoun called ${String(change.pronoun)}.` }
    }
    next = { ...next, pronoun: change.pronoun }
  }

  if (change.addressUser !== undefined) {
    if (typeof change.addressUser !== 'string') return { ok: false, why: 'That is not a name.' }
    const called = change.addressUser.trim()
    // EMPTY IS ALLOWED, and is the default. "Nobody has said" is a real answer —
    // `addressLine` omits the instruction entirely rather than telling her to
    // address somebody as "you", which is a sentence that says nothing.
    if (called.length > PERSONA_LIMITS.addressUser) {
      return { ok: false, why: 'That name is too long.' }
    }
    next = { ...next, addressUser: called }
  }

  if (change.theme !== undefined) {
    if (!isThemeId(change.theme)) {
      return { ok: false, why: `There is no theme called ${String(change.theme)}.` }
    }
    // The named eight only. A custom hue is a `CustomTheme` object, and a window
    // that could post one would be a window that can set any colour on the
    // interface — `contrastFailures` refuses an unreadable one at load, but the
    // control offered here is the swatches, so this accepts what they can send.
    next = { ...next, theme: change.theme }
  }

  if (change.style !== undefined) {
    if (typeof change.style !== 'string') return { ok: false, why: 'That is not a prompt.' }
    // Empty is allowed since 2026-08-17: `CORE_PROMPT` says who she is, so an
    // empty box is somebody asking for the floor and nothing else.
    if (change.style.length > PERSONA_LIMITS.style) {
      return { ok: false, why: 'That prompt is too long.' }
    }
    next = { ...next, style: change.style }
  }

  for (const moment of ['greeting', 'farewell'] as const) {
    const said = change[moment]
    if (said === undefined) continue
    if (typeof said !== 'string') return { ok: false, why: 'That is not an instruction.' }
    const line = said.trim()
    // NOT empty: `parsePersona` refuses an empty instruction, so saving one here
    // would write a manifest this build cannot load — the failure that presents
    // as "the app ate my character" one launch later.
    if (line.length === 0) return { ok: false, why: 'That cannot be empty.' }
    /*
      `instruction`, not `name * 4`.

      240 against the format's own 300, arrived at by multiplying an unrelated
      limit by four. A 250-character instruction is valid in a manifest, loads
      fine, and could not be typed here — the control was stricter than the
      thing it writes to, which is the same class of mistake as being looser.
    */
    if (line.length > PERSONA_LIMITS.instruction) return { ok: false, why: 'That is too long.' }
    // `verbatim` is left alone. It is the other half of a `SpokenMoment` and no
    // control offers it; overwriting it from a field that cannot express it
    // would silently discard something a manifest author wrote.
    next = { ...next, [moment]: { ...next[moment], instruction: line } }
  }

  if (change.bubbleSide !== undefined) {
    /*
      Against the OFFERED list, and stored as given.

      There is no "unset" to protect here any more. `auto` is one of the five
      answers rather than the absence of one — see `Persona.bubbleSide` for why
      an invisible third state was worse than the app-level default it was
      guarding.
    */
    if (!(BUBBLE_SIDES as readonly string[]).includes(change.bubbleSide)) {
      return { ok: false, why: `The bubble cannot sit ${String(change.bubbleSide)}.` }
    }
    next = { ...next, bubbleSide: change.bubbleSide as BubbleSide }
  }

  if (change.faces !== undefined) {
    if (!Array.isArray(change.faces)) return { ok: false, why: 'That is not a list of faces.' }
    for (const one of change.faces) {
      if (typeof one !== 'string' || !(EMOTIONS as readonly string[]).includes(one)) {
        return { ok: false, why: `There is no expression called ${String(one)}.` }
      }
    }
    // In EMOTIONS order, for the reason `readFaces` gives: the tuple is the
    // contract the rig draws from, so two ways of saying the same set must
    // produce the same character.
    const chosen = new Set(change.faces as readonly Emotion[])
    next = { ...next, faces: EMOTIONS.filter((one) => chosen.has(one)) }
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
