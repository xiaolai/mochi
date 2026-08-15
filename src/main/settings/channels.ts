/**
 * Every channel the settings window may drive.
 *
 * Split from `index.ts` by OWNERSHIP, not by size. Each handler here is
 * authorised with `isFromSettings` and each one in the companion's set with
 * `isFromCompanion` — a handler filed under the wrong heading is a handler
 * checked against the wrong window, and that is not a mistake a reader spots in
 * a 578-line composition root.
 *
 * ## Why a `state` object rather than parameters
 *
 * These handlers do not only read the persona and the preferences, they
 * REPLACE them — and the replacement has to be visible to the tray, to the
 * companion window and to the next snapshot. Passing values in would hand each
 * handler a copy; passing setters in would make every assignment a call and
 * lose the `{ ...preferences, x }` idiom that makes a partial update obvious.
 * A façade with getters and setters keeps the code that was here reading
 * exactly as it did.
 *
 * The rest of the host is verbs: things the handlers ask the application to do.
 */

import { renameSync, rmSync, writeFileSync } from 'node:fs'
import { app, dialog, ipcMain, shell } from 'electron'
import {
  IPC,
  type Appearance,
  type AuthVerdict,
  type ImportOutcome,
  type KeptHit,
  type KeptSession,
  type KeptTurn,
  type SaveProblem,
  type SettingsSnapshot,
  type ThemeSaved,
} from '@shared/ipc'
import { parsePolicy, type Policy } from '@shared/policy'
import { format, messagesFor } from '@shared/i18n'
import { CREDENTIAL_SOURCES, apiKeyProblem, isCredentialSource } from '@shared/auth'
import { THEME_IDS, isThemeId } from '@shared/theme'
import { clampSizePercent } from '@shared/avatar-layout'
import { mergeSound } from '@shared/sound'
import { describeIdleChoices, isIdleChoice } from '@shared/companion'
import { clearAuthorisation } from '../codex/authorisation'
import { PROMPT_LIMIT, mergeDelegation } from '@shared/delegation'
import { collides, readShortcuts } from '@shared/shortcuts'
import { isPersonaId, parsePersona, type Persona } from '@shared/persona'
import { parseArchive } from '../store/transcripts'
import { readBounded } from '../store/read-bounded'
import { remedyFor } from '../codex/status'
import { openableUrls } from '../about'
import { type Preferences } from '../store/preferences'
import { clearApiKey, readApiKey, storeApiKey } from '../voice/key-store'
import { verifyApiKey } from '../voice/verify'
import type { BrowserWindow } from 'electron'
import type { Availability } from '../voice/availability'

/**
 * The longest search string this window may send.
 *
 * Generous for a query and far short of a stall: segmentation and FTS query
 * construction both run on the main thread, where a long string competes with
 * her voice.
 */
const MAX_SEARCH_QUERY = 512

/**
 * Store one preference change: mutate, write, roll back on failure, announce.
 *
 * Four handlers spelled this out -- sound, sleep-after, delegation, spoken
 * rules -- and the shape is subtle in a way that invites drift: the rollback
 * must restore the WHOLE previous block rather than the field, and the
 * broadcast must not happen when the write failed. One of the four had already
 * grown a different answer to whether a failure still refreshes the window.
 *
 * The change is a FUNCTION of what is stored, not a value, because every
 * caller needs the previous block to merge onto -- that is what makes "absent
 * means unchanged" true for a partial IPC message.
 */
function storePreference(
  state: SettingsState,
  flush: () => boolean,
  announce: () => void,
  change: (before: Preferences) => Preferences,
): readonly SaveProblem[] {
  const before = state.preferences
  state.preferences = change(before)
  if (!flush()) {
    // The WHOLE block back, not the field. A partial restore leaves the
    // preferences half-written from a save that reported failure.
    state.preferences = before
    return [{ kind: 'save-failed' }]
  }
  announce()
  return []
}

/**
 * Run one post-commit projection without letting it undo the commit.
 *
 * For work that happens AFTER something durable has been written: adopting new
 * state, repainting the tray, telling a window. None of it can be rolled back
 * and none of it decides whether the save happened -- so a throw here must not
 * become a rejected invoke, which the window reads as "your edit was not
 * saved" for an edit that is on disk.
 */
function project(what: string, run: () => void): void {
  try {
    run()
  } catch (error: unknown) {
    console.error(`[settings] the save landed but could not ${what}:`, error)
  }
}

/** The two pieces of application state these handlers replace, live. */
export interface SettingsState {
  persona: Persona
  preferences: Preferences
}

export interface SettingsHost {
  readonly state: SettingsState
  readonly availability: Availability
  // Properties rather than methods, deliberately: these are plain functions,
  // they are destructured below, and a method signature would promise a `this`
  // that does not survive that.
  /** Everything the window needs, as it stands right now. */
  readonly snapshot: () => SettingsSnapshot
  /** Her size and colours, for the companion. */
  readonly appearance: () => Appearance
  readonly refreshTray: () => void
  readonly liveWindow: () => BrowserWindow | null
  readonly settingsWindow: () => BrowserWindow | null
  /** Write the preferences now. False when the disk refused. */
  readonly flush: () => boolean
  /** Write them after the debounce. For values that change at frame rate. */
  readonly persistSoon: () => void
  /** Re-register the global shortcuts from the current preferences. */
  readonly claimShortcuts: () => void
  readonly resizeCompanion: (options: { tellSettings: boolean }) => void
  /**
   * Write an edited persona into the catalog.
   *
   * Provided by the composition root because the catalog and the active id
   * live there. Returns the id it was written under -- editing the built-in
   * forks, so the id can differ from the one submitted, and a fork whose id
   * nobody adopts is an edit that appears to have done nothing.
   */
  readonly writeToCatalog: (persona: Persona) => string
  /**
   * Discard every edit to the built-in.
   *
   * Provided by the composition root because it re-reads the catalog and
   * re-dresses whoever is worn. Throws when the file could not be removed.
   */
  readonly restoreBuiltIn: () => void
  /**
   * Add or remove the workspace in Codex's own trusted list.
   *
   * Injected rather than imported so this module never needs to know where
   * Codex keeps its home or where the workspace is -- both belong to the
   * composition root, which already resolves `userData`.
   */
  readonly setTrust: (trusted: boolean) => Promise<{ readonly ok: boolean }>
  /** Re-read what Codex offers and push a fresh snapshot. Fire and forget. */
  readonly refreshDelegation: () => void
  /**
   * Record whether her conversations are written down, and for how long.
   *
   * Throws when it could not be stored. The rule is that when the effective
   * answer cannot be established, nothing is stored -- which only
   * works if a failed write is something the caller learns about.
   */
  readonly savePolicy: (policy: Policy) => void
  /** The worn persona's conversations, newest first. */
  readonly listSessions: () => readonly KeptSession[]
  /** What was said in one of hers. Empty for anything that is not. */
  readonly readSession: (token: string) => readonly KeptTurn[]
  /** Search hers. There is no wider scope to ask for. */
  readonly searchTranscripts: (query: string) => readonly KeptHit[]
  /** Delete one conversation of hers. False when there was none to delete. */
  readonly forgetSession: (token: string) => boolean
  /** Everything she has, ready to be written to a file. */
  readonly exportTranscripts: () => unknown
  /** Read a parsed archive into her. The caller has already confirmed. */
  readonly importTranscripts: (archive: unknown) => ImportOutcome
  /** Delete the worn persona's notes. Her conversations are left alone. */
  readonly forgetMemory: () => void
  /** Delete one persona's transcripts. Her memory is left alone. */
  readonly forgetTranscripts: (personaId: string) => void
  /** Delete every transcript on this machine. The escape hatch, not a persona action. */
  readonly forgetEverything: () => void
  /**
   * Show the worn persona's package folder, creating it if she has none.
   *
   * Created rather than refused: the built-in has no folder until something
   * writes one, and she is the persona somebody is most likely to want to
   * give an artifact to. Refusing would make the one case that needs this
   * button the one case it does not work for.
   */
  readonly revealPackage: () => Promise<void>
  /** Wear a different persona. False when the catalog does not have her. */
  readonly switchPersona: (id: string) => boolean
  /** Copy the active persona and wear the copy. Returns the new id. */
  readonly addPersona: () => string
  /** Remove her and her notes. Throws when she cannot be removed. */
  readonly removePersona: (id: string) => void
}

export function registerSettingsChannels(host: SettingsHost): void {
  // Destructured so the moved code reads exactly as it did in the composition
  // root. `state` is a live façade; the rest are verbs.
  const {
    state,
    availability,
    snapshot,
    appearance,
    refreshTray,
    liveWindow,
    settingsWindow,
    flush: flushPreferences,
    persistSoon: persistPreferencesSoon,
    claimShortcuts,
    resizeCompanion,
    writeToCatalog,
    restoreBuiltIn,
    setTrust,
    refreshDelegation,
    savePolicy,
    listSessions,
    readSession,
    searchTranscripts,
    forgetSession,
    exportTranscripts,
    importTranscripts,
    forgetMemory,
    forgetTranscripts,
    forgetEverything,
    revealPackage,
    switchPersona,
    addPersona,
    removePersona,
  } = host

  function isFromSettings(event: { readonly senderFrame: unknown }): boolean {
    const target = settingsWindow()
    return target !== null && event.senderFrame === target.webContents.mainFrame
  }

  /**
   * Channels the SETTINGS window may drive.
   *
   * Split from the companion's by ownership, not by tidiness: everything here is
   * authorised with `isFromSettings` and everything below with `isFromCompanion`,
   * and a handler filed under the wrong heading is a handler checked against the
   * wrong window.
   */
  function registerReadSettings(): void {
    ipcMain.handle(IPC.getSettings, (event) => (isFromSettings(event) ? snapshot() : null))
  }

  function registerSavePersona(): void {
    ipcMain.handle(IPC.savePersona, (event, payload: unknown): readonly SaveProblem[] => {
      if (!isFromSettings(event)) return [{ kind: 'not-permitted' }]
      // Re-validated here, not trusted from the window. The renderer's own checks
      // exist to tell the user sooner; this one is what decides.
      const result = parsePersona(payload)
      if (!result.ok) return result.problems

      // The id is MAIN'S, not the window's.
      //
      // A save says "here is the persona I was editing", and which persona
      // that was is something main already knows. Taking the submitted id
      // instead let any message on this channel name a different one -- and
      // since memory is filed under the id, adopting a foreign id would route
      // one character's private notes into another's session. The renderer is
      // the least trusted process in this app; this is not a hypothetical it
      // is worth leaving open.
      if (result.persona.id !== state.persona.id) {
        return [{ kind: 'unknown-value', field: 'id', allowed: state.persona.id }]
      }

      // WRITTEN first, adopted second. Assigning before the write meant a failed
      // save reported failure and left the new state.persona live anyway: the window
      // said "could not be saved", she started using it immediately, and the next
      // launch loaded the old one back. Whichever the user believed, one of the
      // two was lying to them.
      let written: string
      try {
        // Into the CATALOG, not the retired singleton file. Writing
        // `persona.json` left the catalog and its id-to-source map untouched,
        // so switching away and back restored the pre-edit persona, the tray
        // kept the old name, and the next launch found a legacy file to
        // migrate all over again.
        written = writeToCatalog(result.persona)
      } catch (error: unknown) {
        // Reported, never swallowed. A save that appeared to work and did not is
        // the worst outcome this window has: it teaches you your edits do not
        // stick, with nothing to point at. The DETAIL goes to the log; the window
        // gets a localised sentence, because an errno and an absolute path are
        // neither translated nor actionable.
        console.error('[settings] could not write the persona:', error)
        return [{ kind: 'save-failed' }]
      }
      const recoloured = state.persona.theme !== result.persona.theme
      // EVERYTHING BELOW IS AFTER THE COMMIT, and none of it may undo it.
      //
      // The persona is on disk by this point. What follows is projection --
      // adopting her, repainting the tray, pushing a face -- and each of those
      // can throw: the state setter refreshes the capability, and a window send
      // reaches a renderer that may have gone. A throw made the invoke REJECT,
      // so the window reported a failed save for a persona that had been
      // written perfectly, and the user's next act was to type it again.
      //
      // Each projection therefore runs independently and reports its own
      // failure to the log. A tray that did not repaint is a smaller problem
      // than a save that lies about itself.
      project('adopt the saved persona', () => {
        // The id the catalog actually used. Editing the built-in forks her, so
        // this is how the app starts pointing at the copy instead of continuing
        // to show edits against a persona that cannot hold them.
        state.persona = { ...result.persona, id: written }
      })
      // The pronoun lives on the state.persona, so the menu wording changes with it.
      project('refresh the tray', refreshTray)
      // And so does her colour. Sent only when it actually changed: this fires on
      // every save, and pushing a face at her for a rename would drop the cached
      // silhouette mid-conversation for nothing.
      if (recoloured) {
        project('send her new colour', () => {
          liveWindow()?.webContents.send(IPC.appearanceChanged, appearance())
        })
      }
      // A FORK has to be announced, or the window never learns its own name.
      // The renderer records what it submitted as the new baseline, so after
      // an unannounced fork it still believes it is editing `mochi` -- and its
      // very next save is refused by the id check three blocks above. Saving
      // once would permanently break saving again.
      //
      // UNREACHABLE TODAY, and kept deliberately. `savePersonaTo` returns
      // `BUILT_IN_ID` for the built-in -- editing her writes an OVERLAY under
      // her own id rather than forking her -- and the submitted id for
      // everyone else, so the two are always equal. That is a property of a
      // function two modules away, not of anything visible here, and the
      // failure if it ever changes is silent and permanent. The check costs a
      // comparison.
      if (written !== result.persona.id) {
        settingsWindow()?.webContents.send(IPC.settingsChanged, snapshot())
      }
      return []
    })
  }

  function registerOpenExternal(): void {
    ipcMain.handle(IPC.openExternal, async (event, url: unknown) => {
      if (!isFromSettings(event)) return false
      // An ALLOWLIST, checked here. `shell.openExternal` hands the string to the
      // OS, which launches whatever is registered for its scheme -- so a renderer
      // able to name the destination is a renderer able to launch anything the
      // machine can open. The About group needs exactly two addresses, both known
      // at build time, so main compares against the set rather than inspecting
      // the string.
      if (typeof url !== 'string' || !openableUrls().has(url)) {
        console.warn('[settings] refused to open an address that is not ours:', url)
        return false
      }
      try {
        await shell.openExternal(url)
        return true
      } catch (error: unknown) {
        console.error('[settings] could not open', url, error)
        return false
      }
    })
  }

  /** Tell an open settings window that something under it changed. */
  const announceToWindow = (): void => {
    settingsWindow()?.webContents.send(IPC.settingsChanged, snapshot())
  }

  function registerSaveSound(): void {
    ipcMain.handle(IPC.saveSound, (event, payload: unknown): readonly SaveProblem[] => {
      if (!isFromSettings(event)) return [{ kind: 'not-permitted' }]
      // MERGED ONTO WHAT IS STORED, not read as a whole block.
      //
      // The comment here used to promise that a message missing a field left
      // that field alone. `readSound` does the opposite: it is the tolerant
      // reader for a FILE on disk, so every absent or invalid field comes back
      // as its default. A partial payload therefore reset the fields it did not
      // mention and reported success -- change the eagerness from a window
      // built before echo cancellation existed and the cancellation silently
      // went back to its default.
      //
      // Reading it over the stored block makes the promise true: absent means
      // unchanged, because the stored value is what absence falls back to.
      // NOT applied to the live session. The capture constraints and the turn
      // detection are decided when a session opens, and moving either under a
      // turn already in flight would cut a sentence in half to fix a setting
      // that can wait. The pane says so.
      return storePreference(state, flushPreferences, announceToWindow, (before) => ({
        ...before,
        sound: mergeSound(before.sound, payload),
      }))
    })
  }

  function registerSaveIdle(): void {
    ipcMain.handle(IPC.saveIdle, (event, payload: unknown): readonly SaveProblem[] => {
      if (!isFromSettings(event)) return [{ kind: 'not-permitted' }]
      // Rejected rather than coerced. Every other channel here takes a block and
      // falls back per field, which is right when a message can be PARTIAL. This
      // one carries a single value out of a fixed set, so there is no partial
      // version of it -- and quietly substituting the default would answer "the
      // setting did not change" with an empty problem list.
      if (!isIdleChoice(payload)) {
        return [{ kind: 'unknown-value', field: 'idleMs', allowed: describeIdleChoices() }]
      }
      // APPLIED LIVE, unlike `saveSound` above. The lifecycle reads its settings
      // on every tick, so there is nothing to reopen and no turn to cut short --
      // and somebody lengthening this because she keeps leaving means now.
      return storePreference(state, flushPreferences, announceToWindow, (before) => ({
        ...before,
        idleMs: payload,
      }))
    })
  }

  function registerSaveDelegation(): void {
    ipcMain.handle(IPC.saveDelegation, (event, payload: unknown): readonly SaveProblem[] => {
      if (!isFromSettings(event)) return [{ kind: 'not-permitted' }]
      // Merged onto the stored block, for the reason `saveSound` above gives:
      // `readDelegation` is a file reader, so absent fields come back as
      // defaults rather than as "unchanged". A partial payload could otherwise
      // clear the model, the prompt, the effort, the search mode or the
      // trigger -- and report that it saved.
      const before = state.preferences
      const next = mergeDelegation(before.delegation, payload)
      const problems = storePreference(state, flushPreferences, announceToWindow, (had) => ({
        ...had,
        delegation: next,
      }))
      if (problems.length > 0) return problems
      // A CHANGED TRIGGER drops whatever authorisation was outstanding.
      //
      // Tightening from `anytime` to `hotkey` must not inherit anything: under
      // `anytime` a press can be recorded and never spent, and a completed run
      // can leave a follow-up window open. Either one would let the first
      // delegation after the tightening run without the keypress the user just
      // asked to require -- the setting appearing not to work, in the direction
      // that matters.
      if (before.delegation.trigger !== next.trigger) clearAuthorisation()
      return []
    })
  }

  function registerSaveSpokenRules(): void {
    ipcMain.handle(IPC.saveSpokenRules, (event, payload: unknown): readonly SaveProblem[] => {
      if (!isFromSettings(event)) return [{ kind: 'not-permitted' }]
      if (typeof payload !== 'string') {
        return [{ kind: 'unknown-value', field: 'spokenRules', allowed: 'text' }]
      }
      if (payload.length > PROMPT_LIMIT) {
        return [{ kind: 'field-length', field: 'spokenRules', limit: PROMPT_LIMIT }]
      }
      // Empty means the built-in, not "send nothing". Clearing the box is how
      // somebody asks for the original back.
      const next = payload.trim() === '' ? null : payload
      // NOT applied to the live session, like the sound settings: the
      // instructions are built when a session opens, and rewriting them under a
      // turn already in flight would change who she is mid-sentence.
      return storePreference(state, flushPreferences, announceToWindow, (before) => ({
        ...before,
        spokenRules: next,
      }))
    })
  }

  function registerSetWorkspaceTrust(): void {
    ipcMain.handle(
      IPC.setWorkspaceTrust,
      async (event, payload: unknown): Promise<readonly SaveProblem[]> => {
        if (!isFromSettings(event)) return [{ kind: 'not-permitted' }]
        if (typeof payload !== 'boolean') {
          return [{ kind: 'unknown-value', field: 'trusted', allowed: 'true, false' }]
        }
        // This writes to `~/.codex/config.toml`, which belongs to another
        // program -- so its failure is reported as its own thing rather than as
        // a preference that would not save. See `codex/trust.ts` for the four
        // rules that make the write safe.
        const change = await setTrust(payload)
        if (!change.ok) return [{ kind: 'save-failed' }]
        // The preference records what the user ASKED for, and the pane reads the
        // real state back from Codex's file on the next refresh. Storing the
        // request separately from the fact is what lets the pane show a switch
        // that did not take effect, rather than one that silently lies.
        const before = state.preferences
        state.preferences = {
          ...before,
          delegation: { ...before.delegation, trustWorkspace: payload },
        }
        const wrote = flushPreferences()
        if (!wrote) state.preferences = before
        // REFRESHED EITHER WAY, and after the rollback rather than instead of
        // it. Codex's configuration has already changed by this point -- that
        // write is not ours to undo -- so returning `save-failed` while leaving
        // the pane showing the old trust state tells the user nothing happened
        // when something did. The refresh reads the real file back, so the
        // switch shows the fact and the problem explains the preference.
        refreshDelegation()
        return wrote ? [] : [{ kind: 'save-failed' }]
      },
    )
  }

  function registerSaveTheme(): void {
    ipcMain.handle(IPC.saveTheme, (event, theme: unknown): ThemeSaved => {
      const refused = (problems: readonly SaveProblem[]): ThemeSaved => ({
        problems,
        personaId: state.persona.id,
      })
      if (!isFromSettings(event)) return refused([{ kind: 'not-permitted' }])
      if (!isThemeId(theme)) {
        return refused([{ kind: 'unknown-value', field: 'theme', allowed: THEME_IDS.join(', ') }])
      }
      // NO short circuit when the theme "already" matches.
      //
      // It compared against MAIN's saved persona while the window paints its
      // swatches from the DRAFT, so the moment those two disagreed -- a
      // restore is the plain way to get there -- the one colour main happened
      // to be holding was the one colour that could not be written. The user
      // sees an unselected swatch and clicks a swatch that does nothing.
      //
      // Writing the same theme again is idempotent and costs one small file.
      // That is the whole price of the guard, and it was buying a state where
      // what is visible and what is writable differ.

      // Only the theme. The window may have half-typed edits in it, and main's
      // `state.persona` is the SAVED one -- so writing this touches her colour and
      // nothing the user is still working on.
      const next = { ...state.persona, theme }
      // No branch for the built-in and no fork to adopt. Every persona,
      // including her, is written where she already lives -- so a colour pick
      // cannot change who is worn, which is what it silently used to do.
      try {
        writeToCatalog(next)
      } catch (error: unknown) {
        console.error('[settings] could not write the theme:', error)
        return refused([{ kind: 'save-failed' }])
      }
      state.persona = next

      // COMMITTED. Everything below is a projection, and none of it may fail
      // the call: disk and main have already adopted the fork, so throwing
      // here would reject the invoke and deny the window the `personaId` it
      // needs to follow. Same shape as `persona-switch.ts`, and for the same
      // reason -- that module learned it the expensive way.
      for (const [what, run] of [
        [
          'showing her new colour',
          () => liveWindow()?.webContents.send(IPC.appearanceChanged, appearance()),
        ],
      ] as const) {
        try {
          run()
        } catch (error: unknown) {
          console.warn(`[settings] ${what} failed after a theme change:`, error)
        }
      }

      // NOT broadcast to the window that asked.
      //
      // The reply below carries everything it needs, and a broadcast racing it
      // is not merely redundant -- it is destructive. Arriving first, the
      // snapshot goes through `applyExceptDraft`, which parks the dirty
      // built-in draft under `mochi` and adopts the persisted fork; by the
      // time the reply calls `adoptTheme`, the draft it was supposed to carry
      // across is no longer the current one. The user's half-typed name
      // disappears from the character in front of them because they picked a
      // colour. The renderer refreshes the rest itself, in an order it
      // controls.
      // `state.persona.id` rather than the id `writeToCatalog` returned: the
      // built-in branch never calls it, and that branch is precisely the one
      // where the id used to change underneath the window.
      return { problems: [], personaId: state.persona.id }
    })
  }

  /**
   * Which persona is worn, and adding or removing one.
   *
   * Split out of a single 386-line function named `registerSaveTheme`, which
   * registered sixteen unrelated channels -- persona management, retention,
   * destructive actions, import and export -- under the name of the first one.
   * A reader looking for where deleting every transcript is wired found it
   * inside a function about colours.
   */
  function registerPersonaChoice(): void {
    ipcMain.handle(IPC.switchPersona, (event, id: unknown): readonly SaveProblem[] => {
      if (!isFromSettings(event)) return [{ kind: 'not-permitted' }]
      // Checked here as well as in the catalog: this arrives from a web page,
      // and a non-string would simply miss the lookup and be reported as "not
      // found", which is a misleading answer to a malformed message.
      if (!isPersonaId(id)) return [{ kind: 'field', field: 'id', reason: 'malformed' }]
      if (!switchPersona(id)) {
        return [{ kind: 'unknown-value', field: 'id', allowed: 'a persona in the list' }]
      }
      // NOT broadcast here. `switchPersonaTo` already does it through its
      // `tellSettings` hook, after the face and the window have caught up --
      // so a second one from this handler pushed a snapshot taken at a
      // different moment, and which of the two the window rendered last
      // depended on ordering nobody controls.
      return []
    })

    ipcMain.handle(IPC.addPersona, (event): readonly SaveProblem[] => {
      if (!isFromSettings(event)) return [{ kind: 'not-permitted' }]
      try {
        addPersona()
      } catch (error: unknown) {
        console.error('[settings] could not add a persona:', error)
        return [{ kind: 'save-failed' }]
      }
      settingsWindow()?.webContents.send(IPC.settingsChanged, snapshot())
      return []
    })

    ipcMain.handle(IPC.deletePersona, (event, id: unknown): readonly SaveProblem[] => {
      if (!isFromSettings(event)) return [{ kind: 'not-permitted' }]
      if (!isPersonaId(id)) return [{ kind: 'field', field: 'id', reason: 'malformed' }]
      try {
        removePersona(id)
      } catch (error: unknown) {
        console.error('[settings] could not remove the persona:', error)
        return [{ kind: 'save-failed' }]
      }
      settingsWindow()?.webContents.send(IPC.settingsChanged, snapshot())
      return []
    })
  }

  /**
   * Whether her conversations are written down, and for how long.
   *
   * Split out of a single 386-line function named `registerSaveTheme`, which
   * registered sixteen unrelated channels -- persona management, retention,
   * destructive actions, import and export -- under the name of the first one.
   * A reader looking for where deleting every transcript is wired found it
   * inside a function about colours.
   */
  function registerRetention(): void {
    ipcMain.handle(IPC.savePolicy, (event, value: unknown): readonly SaveProblem[] => {
      if (!isFromSettings(event)) return [{ kind: 'not-permitted' }]
      // Re-parsed here, not trusted. Everything from the window is data, and
      // this particular datum decides whether conversations reach the disk.
      const policy = parsePolicy(value)
      if (policy === null) return [{ kind: 'field', field: 'keeps', reason: 'malformed' }]
      try {
        savePolicy(policy)
      } catch (error: unknown) {
        console.error('[settings] could not store her retention setting:', error)
        return [{ kind: 'save-failed' }]
      }
      settingsWindow()?.webContents.send(IPC.settingsChanged, snapshot())
      refreshTray()
      return []
    })
  }

  /**
   * Reading and deleting one conversation of hers.
   *
   * Split out of a single 386-line function named `registerSaveTheme`, which
   * registered sixteen unrelated channels -- persona management, retention,
   * destructive actions, import and export -- under the name of the first one.
   * A reader looking for where deleting every transcript is wired found it
   * inside a function about colours.
   */
  function registerTranscriptReads(): void {
    ipcMain.handle(IPC.listSessions, (event): readonly KeptSession[] => {
      // An empty list rather than a refusal for a sender that is not the
      // settings window: a channel that answers differently depending on who
      // asked is a channel that tells an attacker they found something.
      if (!isFromSettings(event)) return []
      return listSessions()
    })

    ipcMain.handle(IPC.readSession, (event, token: unknown): readonly KeptTurn[] => {
      if (!isFromSettings(event)) return []
      if (typeof token !== 'string') return []
      // Scoped to whoever is WORN, in main. The renderer names a conversation
      // but never a persona -- the scope is not a parameter, so it cannot be
      // widened by a caller. A token the worn persona does not own
      // reads exactly like one that never existed.
      return readSession(token)
    })

    ipcMain.handle(IPC.searchTranscripts, (event, query: unknown): readonly KeptHit[] => {
      if (!isFromSettings(event)) return []
      if (typeof query !== 'string') return []
      // BOUNDED before it reaches the segmenter.
      //
      // Search runs on the Electron MAIN thread: the CJK rewrite in
      // `segment.ts` walks the string and the FTS query is built from what it
      // produces, so a megabyte pasted into the box is a megabyte of scanning
      // and allocation with the whole app -- her voice included -- stopped
      // behind it. No real query is longer than a sentence.
      if (query.length > MAX_SEARCH_QUERY) return []
      return searchTranscripts(query)
    })

    ipcMain.handle(IPC.forgetSession, (event, token: unknown): readonly SaveProblem[] => {
      if (!isFromSettings(event)) return [{ kind: 'not-permitted' }]
      if (typeof token !== 'string') return [{ kind: 'save-failed' }]
      try {
        // The answer is discarded on purpose. "There was nothing to delete"
        // and "it is deleted" are the same outcome from where the user is
        // standing, and reporting the difference would tell a caller whether
        // a conversation they cannot read exists.
        forgetSession(token)
      } catch (error: unknown) {
        console.error('[settings] could not forget that conversation:', error)
        return [{ kind: 'save-failed' }]
      }
      settingsWindow()?.webContents.send(IPC.settingsChanged, snapshot())
      return []
    })
  }

  /**
   * The three separate "forget" actions.
   *
   * Split out of a single 386-line function named `registerSaveTheme`, which
   * registered sixteen unrelated channels -- persona management, retention,
   * destructive actions, import and export -- under the name of the first one.
   * A reader looking for where deleting every transcript is wired found it
   * inside a function about colours.
   */
  function registerForgetting(): void {
    ipcMain.handle(IPC.forgetMemory, (event): readonly SaveProblem[] => {
      if (!isFromSettings(event)) return [{ kind: 'not-permitted' }]
      try {
        // Her NOTES, and nothing else. There are three separate
        // actions here precisely so that clearing what she remembers is not a
        // way to lose the conversations, or the reverse.
        forgetMemory()
      } catch (error: unknown) {
        console.error('[settings] could not forget her notes:', error)
        return [{ kind: 'save-failed' }]
      }
      settingsWindow()?.webContents.send(IPC.settingsChanged, snapshot())
      return []
    })

    ipcMain.handle(IPC.forgetTranscripts, (event): readonly SaveProblem[] => {
      if (!isFromSettings(event)) return [{ kind: 'not-permitted' }]
      try {
        // HERS, by id. There is no "all personas" scope on this channel and
        // that is the rule rather than an omission: a delete that
        // reaches past whoever is worn belongs in the machine half, where the
        // reader expects it to.
        forgetTranscripts(state.persona.id)
      } catch (error: unknown) {
        console.error('[settings] could not forget her transcripts:', error)
        return [{ kind: 'save-failed' }]
      }
      settingsWindow()?.webContents.send(IPC.settingsChanged, snapshot())
      return []
    })

    ipcMain.handle(IPC.forgetEverything, async (event): Promise<readonly SaveProblem[]> => {
      if (!isFromSettings(event)) return [{ kind: 'not-permitted' }]
      const window = settingsWindow()
      if (window === null) return [{ kind: 'save-failed' }]
      // Asked HERE, natively, and not only in the pane.
      //
      // The two-press arming in the settings window is a guard against a
      // misread click, and it is the right shape for that. It is not a
      // guarantee: the renderer is the least-trusted process in this app, and
      // anything running in it can invoke this channel directly, at which
      // point the widest irreversible action in the product had nothing in
      // front of it but a check on which window sent the message. The other
      // irreversible cross-persona action -- reading someone else's archive
      // in -- already asks in main for exactly this reason.
      const words = messagesFor(snapshot().locale).settings
      const answer = await dialog.showMessageBox(window, {
        type: 'warning',
        buttons: [words.keptForgetAll, words.keptImportStop],
        defaultId: 1,
        cancelId: 1,
        message: words.keptForgetAllConfirm,
        detail: words.keptForgetAllDetail,
      })
      // Cancelling is an answer, not a failure.
      if (answer.response !== 0) return []
      try {
        forgetEverything()
      } catch (error: unknown) {
        console.error('[settings] could not forget every transcript:', error)
        return [{ kind: 'save-failed' }]
      }
      settingsWindow()?.webContents.send(IPC.settingsChanged, snapshot())
      return []
    })
  }

  /**
   * Her history to a file, and back again.
   *
   * Split out of a single 386-line function named `registerSaveTheme`, which
   * registered sixteen unrelated channels -- persona management, retention,
   * destructive actions, import and export -- under the name of the first one.
   * A reader looking for where deleting every transcript is wired found it
   * inside a function about colours.
   */
  function registerArchive(): void {
    ipcMain.handle(IPC.exportTranscripts, async (event): Promise<readonly SaveProblem[]> => {
      if (!isFromSettings(event)) return [{ kind: 'not-permitted' }]
      const window = settingsWindow()
      if (window === null) return [{ kind: 'save-failed' }]
      const worn = state.persona
      try {
        // Modal to the settings window rather than the app. The companion is
        // always on top, and an app-modal dialog behind her is a dialog
        // nobody can find.
        const chosen = await dialog.showSaveDialog(window, {
          defaultPath: `${worn.id}-conversations.json`,
          filters: [{ name: 'JSON', extensions: ['json'] }],
        })
        // Cancelling is not a failure and must not read as one.
        if (chosen.canceled || chosen.filePath === '') return []
        // The tray can switch persona while a dialog is open, and the host
        // resolves whoever is worn AT COMMIT -- so the file named after Ada
        // would have been filled with Coach's conversations. Refused rather
        // than retargeted: the filename is the only thing the user agreed to.
        if (state.persona.id !== worn.id) return [{ kind: 'save-failed' }]
        // BESIDE, then over. A direct write truncates the destination first, so
        // a failure part-way through -- a full disk, the process ending --
        // leaves the user with neither the old export nor a complete new one,
        // and they chose that filename precisely because something was there.
        //
        // `mode` on `writeFileSync` applies only when the file is CREATED, so
        // overwriting an existing export left whatever permissions it already
        // had; the temporary file is always new, so its 0600 is real, and
        // `rename` carries it to the destination.
        const staging = `${chosen.filePath}.writing`
        writeFileSync(staging, JSON.stringify(exportTranscripts(), null, 2), {
          encoding: 'utf8',
          mode: 0o600,
        })
        try {
          renameSync(staging, chosen.filePath)
        } catch (error: unknown) {
          rmSync(staging, { force: true })
          throw error
        }
      } catch (error: unknown) {
        console.error('[settings] could not export her conversations:', error)
        return [{ kind: 'save-failed' }]
      }
      return []
    })

    ipcMain.handle(IPC.importTranscripts, async (event): Promise<ImportOutcome> => {
      if (!isFromSettings(event)) return { kind: 'refused', problems: [{ kind: 'not-permitted' }] }
      const window = settingsWindow()
      if (window === null) return { kind: 'refused', problems: [{ kind: 'save-failed' }] }
      const worn = state.persona
      try {
        const chosen = await dialog.showOpenDialog(window, {
          properties: ['openFile'],
          filters: [{ name: 'JSON', extensions: ['json'] }],
        })
        const path = chosen.filePaths[0]
        if (chosen.canceled || path === undefined) return { kind: 'cancelled' }
        // BOUNDED, and not through a symlink, like every other file this app
        // reads from somewhere the user can point it.
        const read = readBounded(path)
        if (!read.ok) return { kind: 'refused', problems: [{ kind: 'save-failed' }] }
        let value: unknown
        try {
          value = JSON.parse(read.text)
        } catch {
          return { kind: 'refused', problems: [{ kind: 'save-failed' }] }
        }
        const parsed = parseArchive(value)
        if (!parsed.ok) return { kind: 'refused', problems: [{ kind: 'save-failed' }] }
        // Same hazard as the export, and worse here: the confirmation below
        // names a persona, and the host writes into whoever is worn at commit.
        // A switch during the file dialog would have shown "this will land on
        // Ada" and then landed it on Coach -- turning the one guarantee this
        // flow makes into a sentence about a persona it did not touch.
        if (state.persona.id !== worn.id) {
          return { kind: 'refused', problems: [{ kind: 'save-failed' }] }
        }
        // Naming BOTH sides, and only when they differ. An archive carries the
        // persona it came from, and reading somebody else's history into the
        // character you are wearing is the operation nobody can undo by
        // hand -- so it is the one that has to be said out loud first. The
        // check is here rather than in the window because a renderer able to
        // skip it would make the guarantee a convention.
        // Asked unless the file SAYS it came from the persona being worn.
        //
        // "Says", not "proves": the archive names its own source, and nothing
        // signs it. Editing `personaId` to match whoever is worn skips this
        // question. That is not a hole worth closing here -- the file is
        // chosen by the person at a native dialog, and an attacker who can put
        // a file on their disk and get them to pick it has easier paths than
        // forging a field. The confirmation is for the ordinary mistake of
        // importing the wrong export, and it should not read as more.
        //
        // It used to skip the question when `personaId` was empty -- which is
        // what `parseArchive` yields for an archive that names no source or
        // names one that is not a string. So the one file whose provenance
        // cannot be established was the one that went in without asking, and
        // "not sure" is the case this confirmation exists for.
        if (parsed.archive.personaId !== worn.id) {
          const words = messagesFor(snapshot().locale).settings
          const answer = await dialog.showMessageBox(window, {
            type: 'warning',
            buttons: [words.keptImportGo, words.keptImportStop],
            defaultId: 1,
            cancelId: 1,
            message: words.keptImportCross,
            detail: format(words.keptImportDetail, {
              from:
                parsed.archive.personaId === ''
                  ? words.keptImportUnknown
                  : parsed.archive.personaId,
              to: worn.name,
            }),
          })
          // Nothing has been written at this point, and nothing will be.
          if (answer.response !== 0) return { kind: 'cancelled' }
        }
        // Checked AGAIN, after the confirmation: that dialog is the second
        // await in this handler, and the persona can change across it too.
        if (state.persona.id !== worn.id) {
          return { kind: 'refused', problems: [{ kind: 'save-failed' }] }
        }
        const outcome = importTranscripts(value)
        settingsWindow()?.webContents.send(IPC.settingsChanged, snapshot())
        return outcome
      } catch (error: unknown) {
        console.error('[settings] could not import conversations:', error)
        return { kind: 'refused', problems: [{ kind: 'save-failed' }] }
      }
    })
  }

  /**
   * Her package on disk: opening it, and undoing edits to the built-in.
   *
   * Split out of a single 386-line function named `registerSaveTheme`, which
   * registered sixteen unrelated channels -- persona management, retention,
   * destructive actions, import and export -- under the name of the first one.
   * A reader looking for where deleting every transcript is wired found it
   * inside a function about colours.
   */
  function registerPersonaFiles(): void {
    ipcMain.handle(IPC.revealPackage, async (event): Promise<readonly SaveProblem[]> => {
      if (!isFromSettings(event)) return [{ kind: 'not-permitted' }]
      try {
        await revealPackage()
      } catch (error: unknown) {
        console.error('[settings] could not show the package folder:', error)
        return [{ kind: 'save-failed' }]
      }
      return []
    })

    ipcMain.handle(IPC.restoreBuiltIn, (event): readonly SaveProblem[] => {
      if (!isFromSettings(event)) return [{ kind: 'not-permitted' }]
      try {
        restoreBuiltIn()
      } catch (error: unknown) {
        console.error('[settings] could not restore the built-in:', error)
        return [{ kind: 'save-failed' }]
      }
      // Her APPEARANCE, to the COMPANION. Restoring may put her colour back,
      // and a companion still wearing the discarded one would be the same "two
      // surfaces disagree about who is worn" split that every defect in this
      // feature has come from.
      liveWindow()?.webContents.send(IPC.appearanceChanged, appearance())

      // NOT broadcast to the window that asked -- the same rule `saveTheme`
      // above is written to, and the same reason. A `send` inside a handler
      // reaches the renderer BEFORE the invoke reply resolves, so a snapshot
      // sent here would be applied while the draft is still live: `adoptFor`
      // would resume the very edits the restore was meant to discard and put
      // the old name straight back on screen, a moment before the reply
      // arrived to throw it away. The window refreshes itself afterwards, in
      // an order it controls.
      return []
    })
  }

  function registerCheckAuth(): void {
    ipcMain.handle(IPC.checkAuth, async (event): Promise<AuthVerdict> => {
      if (!isFromSettings(event)) {
        return { ok: false, source: state.preferences.credentialSource, why: { kind: 'no-key' } }
      }
      const source = state.preferences.credentialSource

      if (source === 'apikey') {
        const key = readApiKey(app.getPath('userData'))
        if (key === null) return { ok: false, source, why: { kind: 'no-key' } }
        const verdict = await verifyApiKey(key)
        if (verdict.kind === 'ok') return { ok: true, source, mode: 'apikey' }
        // One arm per verdict, no default. The three failures are three different
        // instructions -- replace the key, wait, check the network -- and a
        // default arm is how two of them silently become the first.
        switch (verdict.kind) {
          case 'rejected':
            return { ok: false, source, why: { kind: 'rejected', status: verdict.status } }
          case 'unavailable':
            return { ok: false, source, why: { kind: 'unavailable', status: verdict.status } }
          case 'unreachable':
            return { ok: false, source, why: { kind: 'unreachable' } }
        }
      }

      // RE-PROBED, not re-read. The cached status was settled at launch, so
      // signing out of Codex left this window reporting a login that no longer
      // existed -- which is exactly what a Check button is for.
      const status = await availability.probe()
      const remedy = remedyFor(status)
      if (remedy === null) {
        return { ok: true, source, mode: status.kind === 'ready' ? status.mode : null }
      }
      return { ok: false, source, why: { kind: 'codex', remedy } }
    })
  }

  function registerSaveAuth(): void {
    ipcMain.handle(IPC.saveAuth, (event, payload: unknown): readonly SaveProblem[] => {
      if (!isFromSettings(event)) return [{ kind: 'not-permitted' }]
      const record = (typeof payload === 'object' && payload !== null ? payload : {}) as Record<
        string,
        unknown
      >
      const source = record['source']
      if (!isCredentialSource(source)) {
        return [
          {
            kind: 'unknown-value',
            field: 'credentialSource',
            allowed: CREDENTIAL_SOURCES.join(', '),
          },
        ]
      }

      const userData = app.getPath('userData')
      // ONE OF THREE OPERATIONS, and the message says which.
      //
      // This used to take `key: string | null` and `clearKey: boolean`, which
      // can express "replace it and delete it" -- so the handler carried a
      // paragraph explaining the order it resolved that in. `AuthChange` makes
      // the contradiction unsendable, and the shape checks that existed to
      // catch a numeric `key` or a string `"true"` become one discriminant.
      const key = record['key']
      if (key !== 'keep' && key !== 'replace' && key !== 'clear') {
        return [{ kind: 'unknown-value', field: 'key', allowed: 'keep, replace, clear' }]
      }
      if (key === 'replace') {
        const value = record['value']
        if (typeof value !== 'string') {
          return [{ kind: 'unknown-value', field: 'value', allowed: 'a string' }]
        }
        // CHECKED before anything is destroyed. An obvious paste error is
        // caught here rather than fifteen seconds into a failed wake, and
        // validation is free while irreversible work is not.
        const problem = apiKeyProblem(value)
        if (problem !== null) return [{ kind: 'key-shape', reason: problem }]
        // `storeApiKey` writes beside the target and renames over it, so this
        // already replaces whatever was there -- there is nothing to clear
        // first, and clearing first is what once left a user with neither.
        //
        // A machine with no keychain REFUSES rather than writing the key in the
        // clear. See `key-store.ts` -- silent plaintext with the window
        // reporting success is the outcome the encryption exists to prevent.
        const stored = storeApiKey(userData, value)
        if (!stored.ok) return [{ kind: 'key-store', reason: stored.why }]
      } else if (key === 'clear') {
        // Reported, not ignored. A remove that silently failed left the pane
        // showing the key gone and the file still on disk -- and the next wake
        // would use the credential the user believes they deleted.
        const cleared = clearApiKey(userData)
        if (!cleared.ok) return [{ kind: 'key-store', reason: cleared.why }]
      }

      const previousSource = state.preferences.credentialSource
      state.preferences = { ...state.preferences, credentialSource: source }
      const wrote = flushPreferences()
      if (!wrote) state.preferences = { ...state.preferences, credentialSource: previousSource }
      // TOLD EITHER WAY, and after the rollback rather than instead of it.
      //
      // The keychain has already been written or cleared by this point -- that
      // is not a preference and this rollback cannot undo it. Returning
      // `save-failed` while leaving the pane showing the old key state said
      // nothing had happened when the credential itself had changed, which is
      // the half of the operation the user most needs to know about.
      //
      // The tray shows whether she can speak, and that answer may have just
      // changed -- from "install Codex" to "ready", or the reverse.
      refreshTray()
      settingsWindow()?.webContents.send(IPC.settingsChanged, snapshot())
      return wrote ? [] : [{ kind: 'save-failed' }]
    })
  }

  function registerSaveShortcuts(): void {
    ipcMain.handle(IPC.saveShortcuts, (event, payload: unknown): readonly SaveProblem[] => {
      if (!isFromSettings(event)) return [{ kind: 'not-permitted' }]
      // Re-read through the shared grammar, never trusted from the window. The
      // renderer's own check exists to tell the user sooner; this one decides,
      // and it is what stands between a hand-crafted IPC message and a throw
      // inside `globalShortcut.register`.
      const { shortcuts, problems } = readShortcuts(payload)
      if (problems.length > 0) {
        return problems.map((id) => ({ kind: 'shortcut-unusable', id }) as const)
      }

      // Two actions on one chord registers FINE and silently drops the second
      // handler -- the OS has no opinion about it. Caught here, before anything
      // is claimed, because afterwards there is nothing to observe.
      const clash = collides(shortcuts)
      if (clash !== null) return [{ kind: 'shortcut-clash' }]

      const previous = state.preferences.shortcuts
      state.preferences = { ...state.preferences, shortcuts }
      claimShortcuts()
      // Written only once the keys are live, so a failure to persist cannot
      // leave the machine and the file describing different bindings.
      if (!flushPreferences()) {
        state.preferences = { ...state.preferences, shortcuts: previous }
        claimShortcuts()
        return [{ kind: 'save-failed' }]
      }
      settingsWindow()?.webContents.send(IPC.settingsChanged, snapshot())
      return []
    })
  }

  function registerSaveSize(): void {
    ipcMain.handle(IPC.saveSize, (event, percent: unknown) => {
      if (!isFromSettings(event)) return state.preferences.sizePercent
      // A NUMBER first, then clamped.
      //
      // `clampSizePercent` answers a nearest-valid value for anything, so a
      // string, a NaN or a missing field all became the fallback percentage --
      // silently resizing her and reporting success. Clamping is right for a
      // number that is out of range and wrong for something that was never a
      // number: the first is a value with an obvious nearest answer, the second
      // is a message this window did not send.
      if (typeof percent !== 'number' || !Number.isFinite(percent)) {
        return state.preferences.sizePercent
      }
      const sizePercent = clampSizePercent(percent)
      state.preferences = { ...state.preferences, sizePercent }
      // Resize NOW, write LATER. The slider is live, so this arrives once per
      // animation frame while somebody drags — and writing the file at frame
      // rate would be a synchronous temp-file-plus-rename per frame, on the main
      // thread, for a value that is about to change again.
      // `false`: this handler only runs for messages from the settings window,
      // so the window that would be told is the window that just asked.
      resizeCompanion({ tellSettings: false })
      persistPreferencesSoon()
      return sizePercent
    })
  }

  // The index. Every channel above, registered once.
  //
  // ONCE, and that word is load-bearing: `ipcMain.handle` THROWS on a channel
  // that already has a handler, so a second call here does not merely
  // re-register -- it takes the whole main process down before any window
  // appears. A duplicate survived a full green gate, because nothing in the
  // suite boots main.
  registerSettingsIpc()

  function registerSettingsIpc(): void {
    // One function per channel -- ASPIRED to, and not yet true. This was a
    // single 179-line function holding eight unrelated handlers with their
    // validation, persistence, state updates and broadcasts interleaved, so
    // the shape every handler shares (check the sender, validate, act, tell
    // the window) was invisible, and the two that skipped a step looked
    // exactly like the six that did not.
    //
    // `registerSaveTheme` used to hold sixteen of them -- persona management,
    // retention, the destructive actions, import and export -- under the name
    // of the first channel it registered, so somebody looking for where
    // "forget every transcript" is wired found it inside a function about
    // colours. They are grouped by subject now, and this list is a table of
    // contents rather than a formality.
    registerReadSettings()
    registerSavePersona()
    registerOpenExternal()
    registerSaveTheme()
    registerPersonaChoice()
    registerRetention()
    registerTranscriptReads()
    registerForgetting()
    registerArchive()
    registerPersonaFiles()
    registerSaveSound()
    registerSaveIdle()
    registerSaveDelegation()
    registerSaveSpokenRules()
    registerSetWorkspaceTrust()
    registerCheckAuth()
    registerSaveAuth()
    registerSaveShortcuts()
    registerSaveSize()
  }
}
