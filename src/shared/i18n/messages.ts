/**
 * The shape every locale must fill.
 *
 * Declared explicitly rather than inferred from the English file. That is the
 * whole design: missing a key becomes a COMPILE error instead of a silent
 * runtime fallback to English. While the string count is small completeness is
 * cheap to enforce; by the time it is expensive, it is too late to start.
 *
 * Only what exists today. A message table listing settings and voice names
 * before those windows exist would be translations of a UI nobody can reach,
 * and every one of them would be wrong by the time it appeared.
 */
import type { ByPronoun } from '../pronoun'
import type { Remedy } from '../auth'
import type { IdleKey } from '../companion'
import type { CatalogProblem, WebSearchMode } from '../delegation'
import type { KeepDays } from '../policy'
import type { Eagerness, Listening } from '../sound'
import type { ThemeId } from '../theme'

/**
 * The settings groups, in the order the navigation shows them.
 *
 * Here rather than in the renderer because two message tables are keyed by it.
 * `panes` and `paneAbout` each wrote the seven names out by hand, so adding a
 * group meant remembering three places -- and the two disagreeing gives a pane
 * a title with no description, or the reverse, which nothing catches.
 */
export const PANE_KEYS = [
  // FIRST, because it decides what every other pane is about.
  'personas',
  'kept',
  // Sound, the screen, the shortcuts and the credential, in ONE pane.
  //
  // They were four, and each was a heading over one or two controls -- one of
  // them a slider, one of them two buttons, one of them not built. Four clicks
  // to see four things that are all the same answer to the same question: what
  // this computer provides. The persona half made this move first, for the
  // same reason (see the `personas` case in `settings/main.ts`).
  'setup',
  'about',
] as const
export type PaneKey = (typeof PANE_KEYS)[number]

/**
 * The two halves of this window, and which groups belong to each.
 *
 * Here rather than in the renderer because the labels are translated, and
 * derived from one list so a group cannot be added to the navigation without
 * a heading, or given a heading and never drawn.
 *
 * The split is not decoration. It is the question the whole persona feature
 * turns on -- would two characters have to disagree about this? -- made
 * visible, so somebody hunting for a setting knows which half to read before
 * they start. Her colour is hers; her size is this screen's.
 */
export const PANE_GROUPS = [
  { key: 'hers', panes: ['personas', 'kept'] },
  { key: 'machine', panes: ['setup', 'about'] },
] as const satisfies ReadonlyArray<{ readonly key: string; readonly panes: readonly PaneKey[] }>

export type PaneGroupKey = (typeof PANE_GROUPS)[number]['key']

/**
 * The setup pane's sections, in the order it stacks them.
 *
 * A LIST, not four keys of a record, because the order is a decision and a
 * record has none: sorted by what blocks what. Nothing below the credential
 * works until the credential does, and the last two are tuning somebody comes
 * back to rather than setup they do once. Held here so the order is one
 * declaration that a test can read, instead of a literal in the renderer that
 * drifts from the table beside it.
 */
export const SETUP_SECTIONS = [
  'auth',
  'delegation',
  'sound',
  'presence',
  'shortcuts',
  'screen',
] as const
export type SetupSection = (typeof SETUP_SECTIONS)[number]

export interface Messages {
  readonly codex: {
    readonly title: string
    /** Why she cannot talk, one line per status. */
    readonly notInstalled: ByPronoun
    readonly unusable: string
    readonly timedOut: string
    readonly loggedOut: string
    readonly stale: string
    readonly unreadable: string
    /** What to do about it. Keyed by `Remedy`. */
    /**
     * DERIVED from `Remedy`, not restated.
     *
     * Written out, a remedy removed upstream left an orphaned translation in
     * every locale and a remedy added left none -- neither of which anything
     * catches. Keying by the union makes both a compile error.
     */
    readonly remedy: Readonly<Record<Remedy, string>>
    readonly checkAgain: string
    readonly later: string
    /** Shown after a re-check that still fails, so the button does not look dead. */
    readonly stillNotReady: string
  }
  readonly tray: {
    readonly tooltip: string
    readonly show: string
    readonly hide: string
    /** Wake her. Shown while she is asleep. */
    readonly wake: ByPronoun
    /** Send her to sleep. Shown while she is awake. */
    readonly sleep: ByPronoun
    /** Non-clickable status line. The ONLY place the microphone is visible. */
    readonly listening: string
    readonly notListening: string
    /**
     * Whether what is said is being written down. Always shown, in both states.
     *
     * No pronoun, and that is the correction rather than a simplification: a
     * transcript holds BOTH sides, so a sentence naming only her understated
     * what is on disk. Wording that discloses less than the app stores is the
     * one kind of wrong this line cannot be.
     */
    readonly keepingText: string
    readonly keepingNothing: string
    readonly waking: string
    readonly sayingGoodbye: string
    /**
     * Shown only when she cannot reach a voice.
     *
     * The dialog is dismissable, so without a line here "she cannot talk" becomes
     * invisible the moment somebody clicks Later -- and a companion who has
     * silently stopped listening is the state this whole route exists to avoid.
     */
    readonly cannotSpeak: ByPronoun
    /** Takes the application name, so the platform's own naming survives. */
    readonly quit: string
    /** Opens the settings window. */
    readonly settings: string
    /**
     * The submenu of characters. Shown only when there is more than one.
     *
     * `ByPronoun`, like everything else here that is a sentence about her. It
     * was a plain string saying "Who she is", which the tray then showed to
     * somebody who had chosen `it` -- the same defect the settings navigation
     * had, on a surface nobody thought to look at.
     */
    readonly personas: ByPronoun
  }
  /**
   * The settings sheet.
   *
   * Anything a person READS as a sentence about her is `ByPronoun` rather than
   * `string`, and that is not decoration. (No count written here: it said nine
   * while the interface held nineteen.) The window that CHOOSES her pronoun was itself written in
   * she/her throughout -- "Who she is", "Ask her for" -- so somebody selecting
   * `he` or `they` watched the tray menu update while the sheet they were
   * standing in went on calling her she. The one screen where the setting is
   * visible was the one screen that ignored it.
   *
   * `sizeHint` additionally carries `{width}`/`{height}`, filled from
   * `avatar-layout`. Her dimensions were written into the copy of every locale,
   * so retuning the base size silently made every translation wrong.
   */
  readonly settings: {
    readonly title: string
    readonly identity: ByPronoun
    readonly name: string
    readonly nameHint: ByPronoun
    readonly addressUser: string
    readonly addressUserHint: ByPronoun
    readonly pronoun: ByPronoun
    readonly pronounHint: string
    /** The pronoun options, each written as that pronoun. Never translated ACROSS forms. */
    readonly pronounLabel: ByPronoun
    readonly size: string
    readonly colour: ByPronoun
    readonly colourHint: string
    /** One per theme. Colour names are chosen per language, never transliterated. */
    readonly themeName: Readonly<Record<ThemeId, string>>
    readonly sizeHint: ByPronoun
    readonly voiceSection: string
    readonly voice: string
    readonly voiceHint: string
    readonly greeting: string
    readonly farewell: string
    readonly instruction: ByPronoun
    readonly verbatim: string
    readonly verbatimHint: ByPronoun
    /**
     * One title per group, keyed by `PANE_KEYS`.
     *
     * Named after what you are looking for rather than after the code that
     * implements it: somebody hunting for the wake key looks for "Keys", not
     * for "Shortcuts (global accelerators)".
     *
     * The count is not written down here on purpose. It said "six" while the
     * list held seven, which is what a hand-maintained number does.
     */
    readonly panes: Readonly<Record<Exclude<PaneKey, 'personas'>, string>> & {
      /**
       * The ONE title that is a sentence about her rather than a noun.
       *
       * `Sound` and `Shortcuts` are the same words whoever she is; "Who she
       * is" is not, and it was a plain string -- so the navigation went on
       * saying "Who she is" beside a pane whose every field said "it". The
       * window where the pronoun is CHOSEN was ignoring it in the one label
       * that names her, which is the same defect this file has now had twice.
       */
      readonly personas: ByPronoun
    }
    /** One heading per half of the navigation. See `PANE_GROUPS`. */
    readonly paneGroups: Readonly<Record<Exclude<PaneGroupKey, 'hers'>, string>> & {
      /** Possessive, so it varies: her / his / their / its. */
      readonly hers: ByPronoun
    }
    /**
     * The headings INSIDE the setup pane, in the order it stacks them.
     *
     * Plain strings, not pronoun tables: a microphone and a keystroke are the
     * same words whoever is being worn, and the pane they are in belongs to
     * the machine half precisely because two personas cannot disagree about
     * any of it.
     */
    readonly sections: Readonly<Record<SetupSection, string>>
    /** One line under each pane title, saying what the pane is for. */
    readonly paneAbout: Readonly<Record<Exclude<PaneKey, 'about'>, ByPronoun>> & {
      /**
       * The one that is NOT `ByPronoun`, and the type says so.
       *
       * The About pane describes the application, not her -- no sentence in it
       * refers to her at all -- so a pronoun table there would be three
       * identical strings per locale pretending to be a choice.
       */
      readonly about: string
    }
    /**
     * What an unbuilt pane says.
     *
     * Every empty surface says WHICH kind of empty it is — an unbuilt feature,
     * not a setting you have failed to fill in. A pane that renders blank is
     * indistinguishable from one that failed to load, and the second is the
     * reading a user will reach for.
     */
    /** The shelf. */
    readonly personaAdd: string
    readonly personaDelete: string
    /** Discard every edit to the built-in. Shown only when there are some. */
    readonly personaRestore: string
    /** Open the worn persona's package folder. The only authoring surface. */
    readonly personaReveal: string
    readonly personaDeleteConfirm: string
    readonly personaDeleteCancel: string
    readonly personaBuiltIn: string
    readonly personaActive: string
    readonly personaWear: string
    readonly personaHowEditing: ByPronoun
    /** The sound section. See `panes/sound.ts` for why the first one exists. */
    readonly soundListening: ByPronoun
    readonly soundListeningHint: ByPronoun
    readonly soundListen: Readonly<Record<Listening, string>>
    /** What the measurement heard, under `auto`. See `audio/loopback.ts`. */
    readonly soundHeardNothing: ByPronoun
    readonly soundHeardEcho: ByPronoun
    readonly soundHeardClear: ByPronoun
    /** Earphones are the better setup, and the pane says so once. */
    readonly soundPrefer: ByPronoun
    readonly soundEcho: string
    readonly soundEchoOn: string
    readonly soundEchoOff: string
    readonly soundEchoHint: string
    readonly soundTurn: ByPronoun
    /** Plain: the sentence is about YOUR pause, and names nobody. */
    readonly soundTurnHint: string
    readonly soundEagerness: Readonly<Record<Eagerness, string>>
    readonly soundNextWake: ByPronoun
    /** What each shortcut does, beside the chord that does it. */
    readonly keyToggleVisible: ByPronoun
    readonly keyToggleAwake: ByPronoun
    /** The delegation key. An authorisation, not a shortcut for convenience. */
    readonly keyAskWorkspace: ByPronoun
    /** Shown in place of a chord another application already owns. */
    readonly keyTaken: string
    /** Shown in the button while it is listening for a chord. */
    readonly keyPress: string
    /** The Auth group. */
    readonly authSource: string
    readonly authCodex: string
    readonly authApiKey: string
    readonly authKeyPlaceholder: string
    readonly authKeySave: string
    readonly authKeyClear: string
    readonly authNoKeychain: string
    readonly authKeyPrivate: ByPronoun
    readonly authCheck: string
    readonly authChecking: string
    readonly authUnchecked: string
    readonly authWorks: string
    readonly authNoKey: string
    readonly authRejected: string
    readonly authUnavailable: string
    readonly authUnreachable: string
    readonly authStored: string
    /** What Codex turned out to be holding. Never the raw mode name. */
    readonly authModeSubscription: string
    readonly authModeKey: string
    readonly authKeyLabel: string
    /**
     * The Delegation group.
     *
     * The STATUS half of this section has no strings of its own: it renders
     * `messages.codex`, which already carries a line per verdict and a command
     * per `Remedy`. A second vocabulary for the same four states is two things
     * to keep in step, and they would drift on the first wording change.
     */
    readonly delegationAbout: ByPronoun
    readonly delegationModel: string
    /** The `null` choice. A first-class option, not an absence. */
    readonly delegationFollowCodex: string
    readonly delegationEffort: string
    /** Said when changing model moved the effort, because silence reads as a bug. */
    readonly delegationEffortMoved: string
    /**
     * Why the list is empty. DERIVED from `CatalogProblem`.
     *
     * `absent` is not a fault: Codex writes the cache when it first runs.
     */
    readonly delegationNoModels: Readonly<Record<CatalogProblem, string>>
    readonly delegationTrigger: string
    readonly delegationTriggerHotkey: string
    readonly delegationTriggerAnytime: string
    /** How long she waits, with nobody talking, before saying goodbye. */
    readonly idleLabel: ByPronoun
    readonly idleHint: ByPronoun
    /**
     * One per `IdleChoice`, keyed by `IdleKey`.
     *
     * A RECORD over the derived key type, so adding a duration to
     * `IDLE_CHOICES` is a compile error in every locale until it is translated
     * -- the property that makes these interfaces worth having.
     */
    readonly idleChoice: Readonly<Record<IdleKey, string>>
    /** What "never" costs: an open microphone and a session that keeps billing. */
    readonly idleNever: ByPronoun
    /** What `anytime` costs, said plainly rather than implied by its name. */
    readonly delegationTriggerAnytimeCost: ByPronoun
    /**
     * What `hotkey` permits BEYOND its own label.
     *
     * An answer renews the press for a minute so a follow-up needs no second
     * one, which "only after the shortcut" does not describe. See
     * `codex/authorisation.ts`.
     */
    readonly delegationTriggerHotkeyFollowUp: ByPronoun
    readonly delegationTrust: string
    readonly delegationTrustAbout: string
    /** Nothing to add the entry to. Codex has never been configured here. */
    readonly delegationTrustNoConfig: string
    readonly delegationTrustFailed: string
    /** Asked for, but Codex's configuration does not show it. */
    readonly delegationTrustLost: string
    /** Their entry, which removal deliberately will not touch. */
    readonly delegationTrustTheirs: string
    readonly delegationSearch: string
    readonly delegationSearchHint: string
    /** DERIVED from `WebSearchMode`, so a mode cannot be added untranslated. */
    readonly delegationSearchMode: Readonly<Record<WebSearchMode, string>>
    /**
     * Puts an edited prompt back to the built-in.
     *
     * NOT `personaRestore`, which is a different action a few rows away --
     * that one restores the built-in PERSONA. Sharing the string put two
     * buttons reading "Restore" in one pane, doing different things, which is
     * worse than the duplicate wording it was meant to avoid.
     */
    readonly useDefault: string
    readonly delegationPrompt: string
    readonly delegationPromptHint: string
    /**
     * The spoken-output rules, which reach every persona.
     *
     * NOT `ByPronoun`, and the type says so. The label names the rules rather
     * than her -- "what every persona is told" reads identically whoever is
     * worn -- and `index.test.ts` refuses a pronoun table whose three entries
     * are the same words. The HINT below does describe her, so that one is.
     */
    /** The one prompt that belongs to a single character. */
    readonly personaStyle: string
    readonly personaStyleHint: ByPronoun
    readonly spokenRules: string
    readonly spokenRulesHint: ByPronoun
    /** Said once, under the list: how to change one. */
    readonly keysHow: string
    /** The "what is kept" pane. See `panes/kept.ts` for the two halves. */
    readonly keptHers: ByPronoun
    readonly keptMachine: string
    readonly keptWriting: ByPronoun
    /** Plain: it describes the FILE, and names nobody. */
    readonly keptWritingHint: string
    readonly keptOn: string
    readonly keptOff: string
    readonly keptHowLong: string
    readonly keptHowLongHint: string
    /** DERIVED from `KEEP_DAYS`, so a duration cannot be added untranslated. */
    readonly keptDays: Readonly<Record<KeepDays, string>>
    readonly keptForever: string
    readonly keptNothing: string
    readonly keptForget: string
    readonly keptForgetConfirm: string
    readonly keptWhere: string
    readonly keptSize: string
    readonly keptPlain: string
    readonly keptForgetAll: string
    readonly keptForgetAllConfirm: string
    /** Asked by MAIN, natively, before the machine-wide delete runs. */
    readonly keptForgetAllDetail: string
    /** The list of conversations, and one conversation opened. */
    readonly keptConversations: ByPronoun
    readonly keptTurnCount: string
    readonly keptStillOpen: string
    readonly keptBack: string
    readonly keptForgetOne: string
    readonly keptSearch: string
    readonly keptSearchNothing: string
    readonly keptSearchScope: ByPronoun
    /** Her notes, deleted separately from her conversations. */
    readonly keptNotes: ByPronoun
    readonly keptNotesNone: string
    readonly keptForgetNotes: string
    /** Moving history between machines, and between characters. */
    readonly keptExport: string
    readonly keptImport: string
    readonly keptImportGo: string
    readonly keptImportStop: string
    readonly keptImportCross: string
    /** Shown as `{from}` when the archive does not say where it came from. */
    readonly keptImportUnknown: string
    /** `{from}` is a persona id and `{to}` a name; neither is translated. */
    readonly keptImportDetail: string
    /** `{added}` and `{already}` are counts. */
    readonly keptImported: string
    readonly keptImportNothing: string
    /**
     * `{conflicts}` is a count.
     *
     * Its own sentence rather than a generic failure: "some could not be
     * added" with no number and no reason is indistinguishable from the import
     * having half-worked for unknown causes.
     */
    readonly keptImportConflicts: string
    readonly version: string
    readonly repository: string
    readonly author: string
    readonly homepage: string
    /** Said on a link, so it is clear the click leaves the app. */
    readonly opensInBrowser: string
    /**
     * Shown when the persona could not be written.
     *
     * A STABLE localised sentence, not the exception. `could not be saved:
     * EACCES: permission denied, open '/Users/someone/Library/.../persona.json'`
     * went straight into the window: a filesystem path and an errno, in English,
     * in a list of validation problems, for a reader who can do nothing with
     * either. The detail belongs in the log, where it is useful.
     */
    readonly saveFailed: string
    /**
     * Why a save was refused, keyed by `SaveProblem`.
     *
     * `{field}`, `{allowed}`, `{limit}` and `{action}` are filled in by the
     * window. Everything inside the braces is an identifier or a number and is
     * NOT translated -- a field name is a name. A message that drops a
     * placeholder present in another locale is caught by `index.test.ts`.
     */
    readonly problem: {
      readonly notPermitted: string
      readonly unknownValue: string
      readonly fieldNotText: string
      readonly fieldEmpty: string
      readonly fieldNotObject: string
      /** A LIST was required. Distinct from `fieldNotObject` — see `not-list`. */
      readonly fieldNotList: string
      readonly fieldMalformed: string
      readonly unknownField: string
      readonly fieldNotAVersion: string
      readonly fromTheFuture: string
      readonly personaFolderUnreadable: string
      readonly personaUnreadable: string
      readonly personaMalformed: string
      readonly personaInvalid: string
      readonly personaDuplicateId: string
      readonly personaReservedId: string
      readonly personaTwoFaces: string
      readonly personaActiveMissing: string
      readonly personaTooMany: string
      readonly personaLegacyUnreadable: string
      readonly personaLegacyMalformed: string
      readonly personaLegacyInvalid: string
      readonly personaLegacyBlocked: string
      readonly fieldTooLong: string
      readonly keyEmpty: string
      readonly keyWhitespace: string
      readonly keyPrefix: string
      readonly keyShort: string
      readonly keyLong: string
      readonly keyNoKeychain: string
      readonly keyWriteFailed: string
      readonly shortcutUnusable: string
      readonly shortcutClash: string
    }
  }
}
