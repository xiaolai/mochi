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
import { problems } from './problems'
import type { FaceSpec } from '@shared/avatar-spec'
import { isThemeId, type Theme } from '@shared/theme'
import { join } from 'node:path'
import { BUBBLE_SIDES } from '@shared/persona'
import { isPersonaId } from '@shared/parse-persona'
import { HALO_WHEN, isHaloWhen, type HaloWhen } from '@shared/ipc'
import type {
  GrantUse,
  HearingChange,
  LookupChange,
  ScreenChange,
  KeyChange,
  SettingsGrant,
  SettingsKey,
  SettingsCodex,
  SettingsLookup,
  SettingsScreen,
  Revealable,
  SettingsAvatar,
  SettingsCapability,
  SettingsPersona,
  SettingsWrite,
} from '@shared/ipc'
import { acceleratorProblem } from '@shared/accelerator'
import { GRANT_SPECS, type Grants } from '@shared/grants'
import { MOST_LANGUAGES, isLanguageCode } from '@shared/transcription'

import type { Usage } from './store/usage'
import { WEB_SEARCH_MODES, isWebSearchMode, type WebSearchMode } from '@shared/delegation'
import type { WireTool } from '@shared/capability/registry'
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
  } catch (error: unknown) {
    /*
      ENOENT ONLY, which is the rule this project applies everywhere else it
      reads something it did not write.

      A missing folder is ordinary on a fresh install: the built-in is the
      answer and `seedAvatars` makes it the next time it runs. A permission
      error, an I/O failure or a folder that is not a folder are all different
      in kind — the avatars ARE there and could not be listed — and treating
      them as "none" hides every custom face somebody has, silently, behind a
      window that looks like a fresh install.

      `readBounded` states the general form: absent means "nothing yet",
      anything else means "cannot tell", and cannot-tell must not become an
      answer. `unmarkDeleting` was corrected to it on the same grounds.
    */
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') {
      console.warn(`[settings] the avatars folder could not be listed (${code ?? 'unknown'})`)
      problems.note(
        'avatar',
        null,
        `the avatars folder could not be read (${code ?? 'unknown'}), so any custom faces are not listed`,
      )
    }
    names = []
  }
  // The built-in first, and as `null`: that is literally what a persona stores
  // for "the shipped face", so there is nothing to translate on the way back.
  return [{ id: null }, ...names.map((id) => ({ id }))]
}

/** The personas on the shelf, in a shape a page can draw and nothing more. */
export function listPersonas(
  catalog: PersonaCatalog,
  faceFor: (persona: {
    id: string
    avatarId: string | null
    theme: Theme
    size: number | null
  }) => FaceSpec | undefined,
  /**
   * Whether her conversations are being written down.
   *
   * Passed in rather than read here for the same reason `faceFor` is: this
   * module is the shape of a page, and the answer needs the policy store and
   * the carried-policy map that a failed migration parks its choice in.
   */
  keepsFor: (personaId: string) => boolean,
): readonly SettingsPersona[] {
  return (
    [...catalog.personas.values()]
      .map((persona) => ({
        id: persona.id,
        name: persona.name,
        voice: persona.voice,
        bubble: persona.bubble,
        bubbleSide: persona.bubbleSide,
        bubbleSides: [...BUBBLE_SIDES],
        size: persona.size,
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
      }))
      /*
      A REAL comparator, where this returned 1 for two equal names.

      `(a, b) => a.name < b.name ? -1 : 1` never answers 0, so for equal names
      it says both that a follows b and that b follows a. That is not a
      well-ordering, and what a sort does with one is unspecified — V8's is
      stable for consistent comparators and has no obligation here.

      Names can repeat: ids are made unique by suffixing, names are not, so two
      characters called "Ada" is an ordinary thing to have. `localeCompare` is
      what a list somebody READS wants — it puts accented and CJK names where a
      person expects rather than where their code points fall — and the id
      breaks the remaining tie so the order is the same on every load.
    */
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
  )
}

/**
 * What she can do.
 *
 * One list now, and every entry on it is on the wire. This used to have a
 * second half — capabilities found in the user's folder, listed with their
 * descriptions and marked refused, because the settings window was the one
 * place that attacker-controlled text was safe to show. Nothing loads from that
 * folder any more: a capability is a folder in the source that whoever built
 * this compiled.
 *
 * ## The wire list, not the registry
 *
 * It took a `Registry` and read `.tools` off it, which is the SHIPPED text.
 * Those descriptions are editable — `describedTools` explains how long they
 * were editable without being read — so the pane was showing the source's
 * wording while a different string went to the model. Taking the list means
 * this cannot reach past `toolsNow` to the original, which is the only way the
 * two panes of one window are guaranteed to agree.
 */
export function listCapabilities(tools: readonly WireTool[]): readonly SettingsCapability[] {
  return tools.map((tool) => ({ name: tool.name, description: tool.description }))
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
      if (spec.capabilities.length === 0 || !used.ok) return { kind: 'not-recorded' }
      // The most recent across everything this switch governs. One grant may
      // cover several tools, and the honest answer to "when was this last
      // used" is the latest of them, not the first one that happens to match.
      const times = spec.capabilities
        .map((name) => used.used.get(name))
        .filter((at): at is number => at !== undefined)
      return times.length === 0 ? { kind: 'never' } : { kind: 'at', at: Math.max(...times) }
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
   * Whether anything is actually at that path.
   *
   * Handed in rather than stat-ed here for the reason `codex` is: this module
   * is the shape of a page and not a reader of disk, and a function that
   * touched the filesystem could not be tested without one.
   */
  readonly profileExists: boolean
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
    // False when there is no profile at all, because there is then no file to
    // be missing — the pane draws neither the sentence nor the button.
    profileExists: input.profile !== null && input.profileExists,
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
 *
 * ## The labels are passed IN, and that is the pronoun bug
 *
 * They were a table here, reading "Let her rest, or wake her" — in main, where
 * `Persona.pronoun` is not, so a character worn as `he` or `it` was described
 * in this window as `her`. That is the exact failure `SettingsView.pronoun`'s
 * own comment names: the field was validated, stored, migrated and tested for
 * the length of this build and never rendered. The words belong beside every
 * other sentence about her, in `panes-says.ts`; this takes them.
 */
export function listKeys(
  outcomes: readonly {
    readonly id: string
    readonly accelerator: string
    readonly refused: string | null
  }[],
  /** What each key does, in this interface's words for whoever is worn. */
  what: Readonly<Record<string, string>>,
  /** What the app ships for each, so `edited` can be decided here. */
  shipped: Readonly<Record<string, string>>,
): readonly SettingsKey[] {
  return outcomes.map((one) => ({
    id: one.id,
    what: what[one.id] ?? one.id,
    accelerator: one.accelerator,
    refused: one.refused,
    // Against the id's own default, falling back to what it is bound to — an
    // id this build does not ship cannot be edited away from a default it does
    // not have, and `true` there would offer a reset that unbinds it.
    edited: one.accelerator !== (shipped[one.id] ?? one.accelerator),
  }))
}

/**
 * Check a request to rebind one global key, before anything is registered.
 *
 * `applyLookup`'s shape and `applyLookup`'s reason: the wire type accepts
 * whatever a page sent, so every field is checked here rather than passed on.
 * A malformed accelerator does not merely store badly — `globalShortcut.register`
 * THROWS on one — so this is the line between a control somebody operated and a
 * crash in the middle of the launch path.
 *
 * ## The collision check is here and nowhere else
 *
 * Electron does NOT refuse a combination this process already holds: it
 * replaces the handler and answers true. So two keys bound to the same
 * combination is not an error anything reports — it is one key that silently
 * does the other one's job, and the pane would show both bound and working.
 * `shared/accelerator.ts` writes one spelling per combination precisely so this
 * check can be a string comparison.
 *
 * `null` means "back to what the app ships", and is checked against the same
 * rules: the shipped combination for one key must not collide with a chosen
 * combination for the other either.
 */
export function applyKey(
  change: KeyChange,
  /** What every key is bound to now, including the one being changed. */
  bound: Readonly<Record<string, string>>,
  /** What the app ships for each, so a reset can be resolved and checked. */
  shipped: Readonly<Record<string, string>>,
):
  | { readonly ok: true; readonly id: string; readonly accelerator: string }
  | { readonly ok: false; readonly why: string } {
  const id = change.id
  // `Object.hasOwn`, not `in`: `'toString' in shipped` is true, so `in` would
  // let an id off `Object.prototype` past this line. It is refused three checks
  // later either way, which is the kind of accident that stops being an
  // accident the moment somebody reorders the function.
  if (typeof id !== 'string' || !Object.hasOwn(shipped, id)) {
    return { ok: false, why: 'There is no key by that name.' }
  }
  if (change.accelerator !== null && typeof change.accelerator !== 'string') {
    return { ok: false, why: 'That is not a key combination.' }
  }
  // Resolved BEFORE the checks below, so a reset is held to the same rules a
  // choice is. A default that collided would otherwise be reachable by
  // resetting, which is the one path nobody thinks to test.
  const wanted = change.accelerator ?? shipped[id]
  if (wanted === undefined) return { ok: false, why: 'There is no key by that name.' }
  const problem = acceleratorProblem(wanted)
  if (problem !== null) return { ok: false, why: problem }
  for (const [other, accelerator] of Object.entries(bound)) {
    if (other === id) continue
    if (accelerator === wanted) {
      return { ok: false, why: `${wanted} is already doing something else in this application.` }
    }
  }
  return { ok: true, id, accelerator: wanted }
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
    /*
      DEDUPLICATED FIRST, so the count is of what will actually be stored.

      The bound used to be applied to the raw request, so asking for the same
      language six times was refused as "too many" while the value that would
      have been stored is one language. The comment below already says the
      stored answer must be the answer that was asked for; the count has to be
      taken on the same footing.
    */
    const asked = [...new Set(change.languages as readonly string[])]
    if (asked.length > MOST_LANGUAGES) {
      return {
        ok: false,
        /*
          PRONOUN-FREE, unlike the pane's version of this sentence.

          This module is a pure checker with no character in hand, and the one
          it used to name was always "her" — so a build worn as `he` refused in
          the wrong words. Threading a pronoun through every checker here to
          serve a message the pane already says first is the expensive way to
          fix that; saying it without one is the honest way. The pane refuses
          the same selection before a write is attempted and DOES have the
          pronoun, so this is what a page bypassing the control gets.
        */
        why: `Choose at most ${String(MOST_LANGUAGES)} languages, or none at all to have the language worked out automatically.`,
      }
    }
    for (const one of asked) {
      if (!isLanguageCode(one)) return { ok: false, why: `${String(one)} is not a language code.` }
    }
    // Already deduplicated above, where the bound is taken.
    // `writeTranscriptionLanguages` would collapse them anyway, and a stored
    // value that differs from the request is what this function exists to
    // prevent.
    next.languages = asked
  }

  return { ok: true, change: next }
}

/** Turn a named folder into a location. The ONLY place that mapping is made. */
export function folderFor(userData: string, what: Revealable): string {
  return what === 'avatars' ? join(userData, AVATARS_DIR) : join(userData, PERSONAS_DIR)
}

/** A refusal shaped like every other answer, so callers have one path. */
export function refuse(why: string): SettingsWrite {
  return { ok: false, why }
}
