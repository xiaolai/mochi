import { existsSync, mkdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
/**
 * Composition only.
 *
 * The previous codebase's equivalent was 1,428 lines with thirteen module-level
 * mutable variables and three hand-maintained paths for refreshing the same
 * views. The rule is that this file wires things together and holds no
 * behaviour; the state kernel arrives with the second setting, because with one
 * boolean a store would be ceremony rather than structure.
 */

import { BrowserWindow, Tray, app, ipcMain, screen, shell } from 'electron'
import {
  IPC,
  type JsonValue,
  logSaveProblem,
  type Appearance,
  type SettingsSnapshot,
  type VoiceReport,
} from '@shared/ipc'
import { MOCHI, type FaceSpec } from '@shared/avatar-spec'
import { applyTheme } from '@shared/theme'
import { DEFAULT_LOCALE, resolveLocale, type LocaleTag } from '@shared/i18n'
import { createCompanionWindow } from './windows/companion'
import { layoutFor } from '@shared/avatar-layout'
import {
  DEFAULT_PREFERENCES,
  PREFERENCES_FILE,
  loadPreferences,
  quarantinePreferences,
  savePreferences,
  type Preferences,
} from './store/preferences'
import { applyContentSecurityPolicy } from './windows/csp'
import { applyTrayModel, createTray, destroyTray, type TrayModel } from './surfaces/tray'
import { avatarsRoot, resolveFaceFor, seedAvatars } from './store/avatars'
import { forgetMemory, recall } from './store/memory'
import { capabilityFor } from './capability/for-persona'
import { packageFolder } from './store/artifact'
import { readPolicy, writePolicy } from './store/policy'
import type { Policy } from '@shared/policy'
import type { Capability, SessionView } from './capability/capability'
import { TRANSCRIPTS_FILE, createTranscripts, type Transcripts } from './store/transcripts'
import { promptForCodex } from './codex/prompt'
import { createAvailability } from './voice/availability'
import { APP_USER_MODEL_ID } from './app-id'
import { startLifecycle, type Lifecycle } from './companion/lifecycle'
import { createLiveTranscript } from './companion/live-transcript'
import { DEFAULT_SETTINGS } from '@shared/companion'
import { translateReport } from './companion/report'
import { keepReachable, recentre, resizeAboutCentre } from './companion/bounds'
import { createVoiceBroker, type VoiceBroker } from './voice/broker'
import { resolveCredential } from './voice/credential'
import { apiKeyState, canStoreSecrets, readApiKey } from './voice/key-store'
import { parseDragStart, startDrag, stopDrag } from './surfaces/drag'
import { unregisterShortcuts } from './surfaces/shortcuts'
import { claimShortcuts as claimShortcutsFor, claimedShortcuts } from './surfaces/keys'
import { applyMediaPolicy } from './windows/permissions'
import { about } from './about'
import { buildSnapshot } from './settings/view'
import { registerSettingsChannels } from './settings/channels'
import { codexHome, gatherDelegationFacts, unknownDelegation } from './codex/facts'
import { trustWorkspace, untrustWorkspace } from './codex/trust'
import {
  authoriseDelegation,
  clearAuthorisation,
  isAuthorised,
  renewAuthorisation,
  takeAuthorisation,
} from './codex/authorisation'
import { cancelDelegation, delegate, isDelegating, type DelegationOutcome } from './codex/delegate'
import { checkCodex } from './codex/status'
import { isLocated, locateCodex } from './codex/locate'
import { spawnCodex } from './codex/spawn'
import type { CodexStatus } from './codex/status'
import type { DelegationSettings, DelegationView } from '@shared/delegation'
import { switchPersona } from './persona-switch'
import {
  DEFAULT_PERSONA,
  SPOKEN_OUTPUT_RULES,
  farewellFor,
  greetingFor,
  sessionRulesFor,
  type Persona,
  type PersonaLoadProblem,
} from '@shared/persona'
import {
  activePersona,
  deletePersona,
  migrateLooseFiles,
  personasRoot,
  discardWrite,
  copyPersonaTo,
  loadPersonas,
  editsFrom,
  readEdits,
  restoreBuiltIn as restoreBuiltInEdits,
  migrateLegacyPersona,
  savePersonaTo,
  type PersonaCatalog,
} from './store/personas'
import { closeSettings, openSettings, settingsWindow } from './windows/settings'

/** One day, for the retention cutoff. Named so the arithmetic reads. */
const DAY_MS = 24 * 60 * 60 * 1000

let win: BrowserWindow | null = null
let tray: Tray | null = null
/**
 * The face she is wearing.
 *
 * Re-resolved on every PERSONA SWITCH, and at no other time.
 *
 * The rule it still obeys: a FILE changing under a running app must not give
 * two windows two different mochis, so the avatars folder is never re-read on
 * its own. A switch is not that -- it is an explicit choice this process makes
 * and pushes to both surfaces in one step. "Restart to change your avatar"
 * remains true of editing the file; it is not true of changing character.
 */
let face: FaceSpec = MOCHI
/**
 * Main owns the locale; every surface is a view of it.
 *
 * Resolved from the OS for now -- there is no setting to change it until there
 * is a settings window. `app.getLocale()` is only meaningful once the app is
 * ready, which is why this is not resolved at module scope.
 */
let locale: LocaleTag = DEFAULT_LOCALE
let lifecycle: Lifecycle | null = null
/** Mint, exchange, validate, queue. See `voice/broker.ts` for why it is not here. */
let broker: VoiceBroker | null = null
/**
 * Hand a renderer report to the lifecycle.
 *
 * The mapping itself is in `companion/report.ts`, where a test can reach it --
 * the attempt is passed through unchanged and the lifecycle drops what does not
 * match.
 */
function onVoiceReport(report: VoiceReport): void {
  // The attempt is checked HERE, for every report, before any of them branch.
  //
  // It used to be checked only by `lifecycle.report()` -- and `said` and
  // `utteranceEnded` return before reaching it. So a line of speech from an
  // attempt that had already been retired was stored against the LIVE session,
  // under whichever persona is worn now, and handed to the live capability as
  // though somebody had just said it. "next" from a dead session advanced the
  // current drill.
  //
  // Utterance ids are minted monotonically and could not have collided, so the
  // outcome path was safe -- but only by an invariant held in another file.
  // One check at ingress is the difference between "safe" and "safe as long as
  // nobody changes how ids are minted".
  if (lifecycle === null || report.attempt !== lifecycle.attempt) {
    console.warn(`[voice] ignoring ${report.kind} from attempt ${String(report.attempt)}`)
    return
  }
  // Written HERE rather than in the renderer, which is the least trusted
  // process in this app. `parseVoiceReport` has already bounded and stripped
  // the text by the time it arrives.
  if (report.kind === 'said') {
    live.say(report.who, report.text)
    // Forwarded, not interpreted. Whether "next" means anything is the
    // capability's question, not this file's.
    if (report.who === 'you') capability?.onUserSaid?.(report.text, sessionView())
    return
  }
  if (report.kind === 'ready' && armWhenReady) {
    armWhenReady = false
    // SPENT ONLY IF THE PRESS IS STILL GOOD.
    //
    // Waking can take as long as the wake timeout allows, and the press has its
    // own minute. Arming a session for an authorisation that has already
    // expired tells her to call a tool that `runDelegation` will then refuse,
    // which is the confusing failure this whole path exists to avoid.
    if (isAuthorised()) {
      broker?.send({ kind: 'armWorkspace', attempt: report.attempt })
      console.log('[keys] askWorkspace armed after waking')
    } else {
      console.log('[keys] askWorkspace expired while she was waking — not arming')
    }
  }
  if (report.kind === 'workspaceAsked') {
    runDelegation(report.attempt, report.callId, report.question)
    return
  }
  if (report.kind === 'utteranceEnded') {
    capability?.onUtteranceEnded?.({ id: report.utterance, outcome: report.outcome }, sessionView())
    return
  }
  const { event, log } = translateReport(report)
  if (log !== null) console.error(log)
  lifecycle?.report(event, report.attempt)
}

/**
 * Run a detached promise without letting a rejection escape.
 *
 * Both Codex dialog chains used to be bare `.then(settle)`, so a rejected
 * dialog promise -- a window closing underneath it, for one -- became an
 * unhandled rejection with nothing naming where it came from.
 */
function detach(work: Promise<void>, label: string): void {
  void work.catch((error: unknown) => console.error(`[${label}]`, error))
}

/** Run something against her window, if she still has one. */
function withWindow(run: (win: BrowserWindow) => void): void {
  const target = liveWindow()
  if (target) run(target)
}

function liveWindow(): BrowserWindow | null {
  return win && !win.isDestroyed() ? win : null
}

/**
 * What every surface should currently be showing.
 *
 * One literal, not two. It was written out at creation and again on every
 * refresh, and the two had already drifted apart on `visible` -- which is a
 * field with history, so `visible` stays a parameter rather than being derived
 * here. At creation she has just been constructed and shown; afterwards only
 * the window can say.
 */
function trayModel(visible: boolean): TrayModel {
  return {
    visible,
    keys: claimedShortcuts(),
    locale,
    pronoun: persona.pronoun,
    personas: [...catalog.personas.values()].map(({ id, name }) => ({ id, name })),
    activePersonaId: persona.id,
    // The EFFECTIVE answer, not the stored one: whether a conversation is
    // open is what decides whether the next thing said reaches the disk, so
    // reading the policy here instead would show "writing" during a
    // conversation that started before the switch was turned on. The answer
    // has to be the one that is true right now, somewhere always visible.
    keepingText: live.writing(),
    // What we currently BELIEVE, not an optimistic null. `null` means ready,
    // and passing that literally told the tray she was ready while the
    // credential check had not started -- Wake was enabled for as long as the
    // probe took, and pressing it opened a session with no bearer.
    voice: availability.remedy(),
    repairing: availability.repairing(),
    phase: lifecycle?.phase ?? 'asleep',
    micOpen: lifecycle?.micOpen ?? false,
  }
}

function refreshTray(): void {
  if (tray) applyTrayModel(tray, trayModel(liveWindow()?.isVisible() ?? false), handlers)
}

function toggleVisible(): void {
  const target = liveWindow()
  if (!target) return
  // `showInactive`, never `show`: a companion must not interrupt whatever you
  // were typing into.
  if (target.isVisible()) target.hide()
  else target.showInactive()
  refreshTray()
}

/**
 * The persona in force.
 *
 * Module state like `locale` and `voice` beside it, and read through a function
 * everywhere rather than captured: the lifecycle was handed `DEFAULT_PERSONA`
 * directly, so editing the persona would have changed the settings window and
 * nothing else until a restart.
 */
let persona: Persona = DEFAULT_PERSONA
/**
 * Every persona on the machine, read once at startup.
 *
 * Read ONCE, like the avatars folder and for the same reason: a file
 * changing under a running app would give two windows two different
 * characters. Switching among what was validated at startup is a choice this
 * process makes and pushes to both surfaces in one tick, which is the thing
 * that rule permits.
 */
let catalog: PersonaCatalog = {
  personas: new Map(),
  sources: new Map(),
  problems: [],
  carriedPolicies: new Map(),
}
/**
 * Retention that belongs to somebody and is not on disk yet.
 *
 * Separate from the catalog and never rebuilt with it. A catalog reload drops
 * everything it knows, and the manifest these came out of has already been
 * written without the fields -- so holding them only in the catalog meant the
 * first save after a failed migration silently turned an opt-out back into
 * keeping. `policyNow` retries the write and clears the entry on success.
 */
const carriedPolicies = new Map<string, Policy>()
/**
 * Whether this installation has run before, from the preferences file.
 *
 * True by default so nothing behaves as a first launch by accident -- the one
 * launch where migrating a manifest can only serve a package placed from
 * outside is the one where this is false.
 */
let ranBefore = true
/**
 * What the migration could not do, kept apart from the catalog's own problems.
 *
 * The catalog is re-read after every save, and a re-read cannot rediscover
 * that `persona.json` was unreadable at launch -- so folding this in with
 * `catalog.problems` meant the warning vanished from an open settings window
 * the first time somebody saved anything, while the broken file sat there
 * still unmigrated. It is a fact about this RUN, so it lives for this run.
 */
let migrationProblems: readonly PersonaLoadProblem[] = []
/**
 * Her history. Opened once, closed on quit.
 *
 * One connection for the process: two pointed at one file is how a desktop app
 * gets `SQLITE_BUSY` from itself.
 */
let history: Transcripts | null = null
/** The session row the live conversation is being written into. */
/**
 * The conversation being written down, and the only thing holding its handle.
 *
 * A module rather than a `number | null` because six call sites used to open,
 * close and null that variable by hand, each of them through a store call that
 * can throw. See `companion/live-transcript.ts` for what that cost.
 */
const live = createLiveTranscript(() => history)
/**
 * Whether the last phase seen was `awake`, so entering it can be told from
 * being in it.
 *
 * Tracked rather than inferred from "is a conversation open". That inference
 * held only while retention was on: with it OFF nothing is ever open, so every
 * update in the awake phase read as a fresh wake and re-ran the prune and
 * `onWake` -- a capability told repeatedly that a conversation had just begun.
 */
let wasAwake = false
let preferences: Preferences = DEFAULT_PREFERENCES
/**
 * What Codex was last seen to offer. Refreshed off the repaint path.
 *
 * Starts as "not read yet" rather than as an empty-but-fine answer, so the pane
 * cannot briefly claim a working Codex it has not looked at. See
 * `codex/facts.ts`.
 */
let delegationFacts: DelegationView = unknownDelegation(DEFAULT_PREFERENCES.delegation)
/**
 * Whether THIS process ever got as far as owning anything.
 *
 * False in a second instance, which fails the single-instance lock and quits
 * without loading preferences, creating a window or claiming a tray.
 */
let started = false

/**
 * How much is on disk, and where.
 *
 * Counted rather than tracked. A running total kept beside the store is a
 * second copy of a fact the store already has, and this is read only when the
 * settings window asks -- which is rare enough that the query is cheaper than
 * the bookkeeping would be.
 *
 * The byte count is the FILE, not her share of it: SQLite does not give a
 * per-persona size and inventing one from row counts would be a number that
 * looks precise and is not. It belongs to the machine for exactly that reason.
 */
function keptFacts(): SettingsSnapshot['kept'] {
  const where = join(app.getPath('userData'), TRANSCRIPTS_FILE)
  let bytes = 0
  // The write-ahead log and its index too. The connection stays open for the
  // life of the app, so recent conversations live in `-wal` and have not been
  // checkpointed into the main file yet: counting only `transcripts.db` shows
  // a number that barely moves while somebody talks, and understates what is
  // actually on their disk. What matters is the occupancy, and the sidecars
  // are part of it.
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      bytes += statSync(`${where}${suffix}`).size
    } catch (error: unknown) {
      // ENOENT ONLY. Absent until the first conversation is written, and
      // `-shm`/`-wal` go away on a clean close, so contributing zero is the
      // truth for that case and a lie for every other: a permissions problem
      // presented as "nothing is stored", on the pane whose job is to say what
      // is on the user's disk and offer to delete it.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn(`[settings] could not measure ${where}${suffix}:`, error)
      }
    }
  }
  const sessions = history?.sessions(persona.id) ?? []
  return {
    sessions: sessions.length,
    turns: sessions.reduce((total, one) => total + one.turns, 0),
    bytes,
    where,
  }
}

/**
 * The worn persona's behaviour, and the session it may drive.
 *
 * This file no longer knows what a drill is. It resolves a capability, hands
 * it a view of the live session, and forwards three events. The behaviour
 * itself lives in `capability/`, which is the point: a second one costs a
 * branch in `capabilityFor` and nothing here.
 */
let capability: Capability | null = null

/** Re-resolve when the worn persona changes. Null is an ordinary companion. */
function refreshCapability(): void {
  capability = capabilityFor(app.getPath('userData'), persona.id, catalog.sources)
  if (capability !== null) console.log(`[capability] ${persona.id} -> ${capability.name}`)
}

/**
 * What a capability may ask of the session, bounded to the LIVE attempt.
 *
 * Built fresh per event rather than held, so a behaviour that kept a reference
 * could not speak into a session that has since closed. `say` answers null
 * when there is nothing to speak into, which is ordinary rather than
 * exceptional: an event can arrive after the attempt it belongs to is gone.
 */
function sessionView(): SessionView {
  // CAPTURED, not read at call time.
  //
  // The comment above promises a view that cannot speak into a session that
  // has since closed, and reading `lifecycle.attempt` inside each method broke
  // that promise in the exact case it was written for: a capability holding a
  // view across a close addressed whatever attempt was current when it finally
  // spoke, which is a different conversation. Freezing the number is what
  // makes "built fresh per event" mean anything.
  const mine = lifecycle?.attempt
  /** Live means the same attempt AND a phase that can still hear it. */
  const live = (): boolean =>
    mine !== undefined &&
    lifecycle?.attempt === mine &&
    (lifecycle.phase === 'awake' || lifecycle.phase === 'farewell')
  return {
    say: (instructions, isolation) => {
      // `phase` too, not just the number. Asleep, the attempt is whatever the
      // last session left behind, so a `say` returned a real utterance id for
      // a session that does not exist -- and the caller waited forever for an
      // outcome that could never arrive.
      if (!live() || broker === null || mine === undefined) return null
      const utterance = lifecycle!.nextUtterance()
      broker.send({ kind: 'speak', attempt: mine, utterance, instructions, isolation })
      return utterance
    },
    stop: (utterance) => {
      if (!live() || mine === undefined) return
      broker?.send({ kind: 'silence', attempt: mine, utterance })
    },
  }
}

function appearance(): Appearance {
  return { face: themedFace(), sizePercent: preferences.sizePercent }
}

/**
 * Her shape from the avatars folder, her colours from the persona's theme.
 *
 * The folder is still read ONCE at startup, and that rule is unchanged: a file
 * changing under a running app would give two windows two different mochis.
 * A theme is not that — it is a deliberate choice made in a window this process
 * owns, applied to both surfaces in the same tick. Shape is what must not be
 * swapped underneath her; colour can be.
 */
function themedFace(): FaceSpec {
  return applyTheme(face, persona.theme)
}

/** Her size and the window around it, from one calculation. */
function layout(): ReturnType<typeof layoutFor> {
  return layoutFor(face, preferences.sizePercent)
}
/** Where the settings renderer lives. Captured at start, used on demand. */
let rendererOrigin: string | null = null

/**
 * Whether she can speak, and the repair route when she cannot.
 *
 * Its own module because three of this file's mutable variables belonged to it
 * and to nothing else, and because they are not independent flags -- see
 * `voice/availability.ts`. This composition root had reached fifteen such
 * variables; the predecessor died at thirteen.
 */
const availability = createAvailability({
  source: () => preferences.credentialSource,
  keyStored: () => apiKeyState(app.getPath('userData')).set,
  onChange: () => refreshTray(),
  // `pronoun` as well as `locale`. Omitting it fell back to the default, so the
  // one dialog that says she cannot speak went on saying "she" after the user
  // had chosen otherwise.
  promptRepair: async (status, check) => {
    await promptForCodex(status, { locale, pronoun: persona.pronoun, check })
  },
  openKeySettings: () => showSettings(rendererOrigin),
})

/**
 * What is actually being enforced for whoever is worn.
 *
 * The carried value FIRST, and it is almost always absent: `carriedPolicies`
 * holds an entry only when a manifest's retention could not be written to its
 * own file, in which case the file does not exist and `readPolicy` would
 * answer with the default -- keep. That would turn a stored opt-out into
 * recording because a disk write failed, which is the one direction this must
 * never fail in. Every other read of the policy in this file goes through
 * here, so neither reads it a different WAY -- which is all one function can
 * buy. It is not an instant: the pane reads when a window asks and the session
 * reads at the wake, so a change between those two is visible to the second
 * and not the first, and the pane is repainted from a fresh snapshot when it
 * lands.
 */
function policyNow(): Policy {
  const held = carriedPolicies.get(persona.id)
  if (held === undefined) return readPolicy(app.getPath('userData'), persona.id)
  // Retried on every read, so this heals the moment the disk allows it. A
  // carried value that only lived in the catalog was lost the next time the
  // catalog was rebuilt -- which saving that very persona does -- and the
  // manifest it came from no longer carries the field, so the opt-out was
  // gone for good on the first save after a failed migration.
  try {
    writePolicy(app.getPath('userData'), persona.id, held)
    carriedPolicies.delete(persona.id)
  } catch {
    // Still unwritable. Her choice is still hers for this run.
  }
  return held
}

/** Everything the settings window needs, from wherever it currently lives. */
function snapshot(): SettingsSnapshot {
  return buildSnapshot({
    persona,
    // Read from disk each time rather than cached. It is one small file, this
    // runs when a window opens, and a cached copy is the thing that would
    // disagree with what main is actually enforcing.
    policy: policyNow(),
    memory: recall(app.getPath('userData'), persona.id),
    // Ids and names only. The window lists them and asks main to switch; it
    // has no use for whole personas it is not editing.
    personas: [...catalog.personas.values()].map(({ id, name }) => ({ id, name })),
    // Computed from the CATALOG rather than from a flag set when she is
    // saved: a flag would go stale the moment somebody edited the file by
    // hand, and this is what decides whether the undo is offered at all.
    builtInEdited:
      Object.keys(editsFrom(catalog.personas.get(DEFAULT_PERSONA.id) ?? DEFAULT_PERSONA)).length >
      0,
    personaProblems: [...migrationProblems, ...catalog.problems],
    face: themedFace(),
    locale,
    version: app.getVersion(),
    about: about(),
    sizePercent: preferences.sizePercent,
    shortcuts: preferences.shortcuts,
    sound: preferences.sound,
    idleMs: preferences.idleMs,
    // From the LIFECYCLE, not from the preferences: this is what was heard,
    // not what was chosen. Null while asleep, which is honest -- nothing has
    // listened.
    loopbackHeard: lifecycle?.loopback ?? null,
    kept: keptFacts(),
    claimed: claimedShortcuts(),
    credentialSource: preferences.credentialSource,
    key: apiKeyState(app.getPath('userData')),
    canStoreKey: canStoreSecrets(),
    // The CACHED answer, always. Gathering it reads two files and may spawn
    // Codex, and this function runs on every repaint -- see `codex/facts.ts`.
    // The stored half is taken from preferences directly so a save shows
    // immediately rather than after the next refresh lands.
    delegation: { ...delegationFacts, settings: preferences.delegation },
    // The built-in travels too, so the box can offer it as a placeholder rather
    // than presenting it as something the user typed.
    spokenRules: { stored: preferences.spokenRules, builtIn: SPOKEN_OUTPUT_RULES },
  })
}

/**
 * Open the settings window, and go and find out what Codex offers.
 *
 * Every route to the window goes through here. Reading the model cache and the
 * trust state is I/O, so it cannot happen inside `snapshot()`, which runs on
 * every repaint -- which means something has to ask, and "something" has to be
 * every opener rather than one of them. The first version wired the refresh to
 * the trust toggle alone, so the pane showed an unreadable Codex and an empty
 * model list until somebody flipped a switch that was itself explained by the
 * missing information.
 */
function showSettings(origin: string | null): void {
  openSettings(origin)
  refreshDelegationFacts()
}

/**
 * The delegation settings with an unusable model dropped.
 *
 * `null` means "follow my Codex", which is always valid -- so falling back to it
 * is strictly better than sending a model the current credential cannot reach.
 * The effort goes with it, because a depth without a model would be applied to
 * whichever model Codex itself picks.
 */
function usableDelegation(): DelegationSettings {
  const chosen = preferences.delegation
  if (chosen.model === null) {
    // FOLLOWING still has a model, and the effort still has to fit it.
    //
    // This returned immediately, on the reading that "no model chosen" means
    // nothing to check. It does not: Codex runs whatever its own config names,
    // and a globally configured effort that model has since dropped went
    // straight onto the command line. Same failure as the explicit case below,
    // reached by the branch that skipped the check.
    const followed =
      chosen.effort === null
        ? undefined
        : delegationFacts.catalog.models.find(
            (model) => model.slug === delegationFacts.codexDefault.model,
          )
    if (
      chosen.effort !== null &&
      followed !== undefined &&
      followed.efforts.length > 0 &&
      !followed.efforts.includes(chosen.effort)
    ) {
      return { ...chosen, effort: null }
    }
    return chosen
  }
  const known = delegationFacts.catalog.models.find((model) => model.slug === chosen.model)
  const unreachable =
    known !== undefined && !known.inApi && preferences.credentialSource === 'apikey'
  if (unreachable) return { ...chosen, model: null, effort: null }
  // The EFFORT too, at the point of use. The pane stops offering a level a
  // model has dropped, but the stored value survives -- so the display said
  // "follow Codex" while the command line still carried the stale level and the
  // run failed for a reason nothing on screen could explain.
  if (
    chosen.effort !== null &&
    known !== undefined &&
    known.efforts.length > 0 &&
    !known.efforts.includes(chosen.effort)
  ) {
    return { ...chosen, effort: null }
  }
  return chosen
}

/**
 * What she is told, for the session about to open.
 *
 * The speech rules always; the delegation rules ONLY when a delegation could
 * really run. Telling her about a tool she cannot reach produces the failure
 * this project has had in both directions -- offering to check something and
 * then going silent, or declining a question she could have answered.
 *
 * `readiness` is the cached answer rather than a fresh probe: this is on the
 * path to opening a session, and `checkCodex` spawns a process. A stale `ready`
 * costs her one sentence about a lookup that then reports it could not run,
 * which is a far smaller failure than a wake that takes twenty seconds.
 *
 * An EDITED block replaces the speech rules only. The delegation half is not
 * offered for editing, because it describes what the machinery does rather than
 * how she should sound -- and a user who deleted it would get a companion that
 * has the tool and has not been told.
 */
function sessionRules(): string {
  const canLookUp =
    delegationFacts.readiness === 'ready' && preferences.delegation.webSearch !== 'disabled'
  // Assembled by `sessionRulesFor`, not here. This line used to be a template
  // literal joining the two blocks with a SPACE, which put "do not promise to
  // find out later" and "you can look things up" in the same paragraph twelve
  // words apart -- two instructions in conflict with nothing to say which won.
  return sessionRulesFor(preferences.spokenRules ?? SPOKEN_OUTPUT_RULES, canLookUp)
}

/** The workspace a delegation reads. Fixed, and not configurable. */
function delegationWorkspace(): string {
  return join(app.getPath('userData'), 'workspace')
}

/**
 * Re-read what Codex offers, then tell the window.
 *
 * Fire and forget on purpose: nothing waits for it, and a failure leaves the
 * previous answer in place rather than blanking the pane. Called when the
 * settings window opens and after anything that could change the answer.
 */
let delegationGeneration = 0

function refreshDelegationFacts(status: CodexStatus | null = null): void {
  // Claimed before the probe starts, so the comparison below names THIS call.
  const mine = (delegationGeneration += 1)
  void gatherDelegationFacts({
    home: codexHome(),
    workspace: delegationWorkspace(),
    settings: preferences.delegation,
    status,
  })
    .then((facts) => {
      // ONLY THE NEWEST WINS. Two refreshes can be in flight -- a settings
      // window opening while a trust change is still probing -- and they take
      // different amounts of time, so the older one could land last and
      // reinstate the trust, credential or model list it had read before the
      // change. Silently, and only sometimes.
      if (mine !== delegationGeneration) return
      delegationFacts = facts
      settingsWindow()?.webContents.send(IPC.settingsChanged, snapshot())
    })
    .catch((error: unknown) => {
      // Keep whatever was last known. `gatherDelegationFacts` reports its own
      // failures as values, so reaching here means something unforeseen -- and
      // replacing a usable pane with an empty one would be the worse answer.
      //
      // LOGGED, though. The comment says "unforeseen" and then swallowed it,
      // so the one case worth knowing about produced a pane quietly showing
      // stale facts and no trace anywhere of why.
      console.error('[codex] the delegation facts could not be refreshed:', error)
    })
}

const handlers = {
  onToggleVisible: toggleVisible,
  onFixVoice: () => detach(availability.repair(), 'codex'),
  onToggleAwake: toggleAwake,
  onOpenSettings: () => showSettings(rendererOrigin),
  onSwitchPersona: (id: string) => {
    switchPersonaTo(id)
  },
  onQuit: () => app.quit(),
}

/**
 * Wake her, or say why she cannot be woken.
 *
 * The gate lives HERE rather than in the tray menu. The tray disabled its own
 * Wake item when there was no route to a voice, and the global shortcut called
 * `lifecycle.toggle()` directly -- so the keyboard could start a session the
 * menu had greyed out, which then failed at the first word with no dialog and
 * no explanation.
 *
 * Sleeping is never gated. Only waking needs a credential, and refusing to let
 * somebody stop a session because the credential went stale mid-conversation
 * would be the wrong half to block.
 */
function toggleAwake(): void {
  if (lifecycle === null) return
  if (lifecycle.phase === 'asleep' && availability.remedy() !== null) {
    // Not silence. A shortcut that does nothing is indistinguishable from one
    // that is not registered, so this opens the same repair route the tray's
    // own item offers.
    console.warn('[keys] refused to wake: there is no route to a voice')
    detach(availability.repair(), 'codex')
    return
  }
  lifecycle.toggle()
}

/**
 * The catalog, always carrying the built-in's chosen colour.
 *
 * One function rather than six `loadPersonas(...)` calls, because the theme
 * argument is the kind that is right five times and forgotten once -- and the
 * once would show up as her quietly reverting to factory green on whichever
 * path missed it, which reads as "the setting does not work" rather than as a
 * dropped argument.
 */
function readCatalog(): PersonaCatalog {
  const userData = app.getPath('userData')
  // Her overlay is read on every catalog read rather than cached, for the same
  // reason the catalog itself is re-read rather than patched: two copies of
  // "what she is" have to be kept in step by hand, and this runs once per save.
  const { edits, problem } = readEdits(userData)
  if (problem !== null)
    console.warn(`[persona] the built-in's edits ${problem}; using the original`)
  const loaded = loadPersonas(userData, edits, ranBefore)
  // MERGED, never replaced. Every path that changes a persona rebuilds the
  // catalog, and a carried policy that lived only in the newest one would be
  // dropped by the very next save -- see `carriedPolicies`. Entries are
  // removed by `policyNow` once the write finally lands, not by a reload.
  for (const [id, held] of loaded.carriedPolicies) {
    if (!carriedPolicies.has(id)) carriedPolicies.set(id, held)
  }
  return loaded
}

/**
 * The catalog, the migration, and whichever persona was last worn.
 *
 * ORDER matters. The catalog is read first so the migration can see what is
 * already there -- it recognises its own previous work by content, which is
 * what makes running it twice a no-op rather than a duplicate import. When it
 * imports something the catalog is re-read, because that persona is now real
 * and may be the one to activate.
 */
function loadStoredPersonas(): void {
  const userData = app.getPath('userData')
  // Loose `<name>.json` files become packages before anything is read, so the
  // loader only ever knows one shape. Two shapes in a loader is how one of
  // them rots unnoticed.
  const moved = migrateLooseFiles(userData)
  catalog = readCatalog()
  const migrated = migrateLegacyPersona(userData, catalog)
  // Held before the catalog is re-read, because the legacy file it came from
  // has already been retired -- so a value dropped here has no second source.
  // BOTH branches carry. `already` is the retry path -- the launch after a
  // migration whose policy write failed -- and reading it from `imported` alone
  // meant the retry retired the legacy file and dropped the value it was
  // retrying for.
  if ((migrated.kind === 'imported' || migrated.kind === 'already') && migrated.carried !== null) {
    carriedPolicies.set(migrated.id, migrated.carried)
  }
  if (migrated.kind === 'imported' || migrated.kind === 'already') {
    catalog = readCatalog()
  }
  // A legacy persona that could not be moved is REPORTED, not swallowed. It
  // used to look identical to "there was nothing to move", so an upgrading
  // user simply lost their character with nothing anywhere to say why.
  migrationProblems = [...moved, ...(migrated.kind === 'failed' ? [migrated.problem] : [])]
  // Only a FRESH import selects itself. `already` means the legacy file merely
  // outlived its retirement -- treating that as an import would reselect the
  // migrated persona on every launch and silently overrule whatever the user
  // has chosen since.
  if (migrated.kind === 'imported') {
    console.log(`[persona] moved the old persona.json into the catalog as ${migrated.id}`)
    // Anything else would greet an upgrading user as somebody they did not write.
    preferences = { ...preferences, activePersonaId: migrated.id }
    persistPreferencesSoon()
  }
  for (const problem of [...migrationProblems, ...catalog.problems]) {
    console.warn(`[persona] ${logLoadProblem(problem)}`)
  }
  const resolved = activePersona(catalog, preferences.activePersonaId)
  persona = resolved.persona
  refreshCapability()
  if (resolved.problem !== null) console.warn(`[persona] ${logLoadProblem(resolved.problem)}`)
}

/**
 * One load problem as a line of ENGLISH, for LOGS ONLY.
 *
 * Never for a window -- `describeLoadProblem` does that, from the message
 * tables, in the user's language. This exists for the same reason
 * `logSaveProblem` does: a diagnostic still has to say something, and a
 * structured value dropped into a template literal renders `[object Object]`,
 * which is a log line that survives review and says nothing.
 */
function logLoadProblem(problem: PersonaLoadProblem): string {
  switch (problem.kind) {
    case 'folder-unreadable':
      return 'the personas folder could not be listed'
    case 'unreadable':
      return `${problem.source} could not be read`
    case 'malformed':
      return `${problem.source} is not valid JSON`
    case 'invalid':
      return `${problem.source}: ${problem.problems.map(logSaveProblem).join('; ')}`
    case 'duplicate-id':
      return `${problem.sources.join(', ')} all claim the id ${problem.id}; none was loaded`
    case 'two-faces':
      return `${problem.source} both carries a face and names one`
    case 'reserved-id':
      return `${problem.source} claims ${problem.id}, which belongs to the built-in`
    case 'active-missing':
      return `the remembered persona ${problem.id} is gone; wearing the built-in`
    case 'too-many':
      return `${String(problem.found)} persona files; only ${String(problem.limit)} were read`
    case 'legacy-unreadable':
      return 'the old persona.json could not be read; it was left in place'
    case 'legacy-malformed':
      return 'the old persona.json is not valid JSON; it was left in place'
    case 'legacy-blocked':
      return `the old persona.json could not be moved: ${problem.source} is already there`
    case 'legacy-invalid':
      return `the old persona.json is not a persona: ${problem.problems.map(logSaveProblem).join('; ')}`
  }
}

/**
 * Become somebody else.
 *
 * The transaction itself lives in `persona-switch.ts`, where a test can reach
 * it -- this file cannot be imported by one. What is left here is the wiring:
 * which functions perform each effect. Every ordering rule, every failure
 * interpretation, and the guarantee that one dead surface does not silence the
 * others are that module's, and are tested there.
 */
function switchPersonaTo(id: string): boolean {
  const outcome = switchPersona(
    {
      find: (wanted) => catalog.personas.get(wanted) ?? null,
      current: () => persona,
      remember: (wanted) => {
        const before = preferences
        preferences = { ...preferences, activePersonaId: wanted }
        if (flushPreferences()) return true
        preferences = before
        console.error('[persona] refusing to switch: the remembered persona could not be written')
        return false
      },
      adopt: (next) => {
        persona = next
        refreshCapability()
        loadFaceFor(next)
      },
      // The session ENDS rather than being reconfigured. `session.update` can
      // change instructions mid-flight, but it cannot change `voice` once
      // audio has played, and it leaves the whole conversation history in
      // place -- so the new character would wake up carrying the old one's
      // turns.
      endSession: () => lifecycle?.sleepNow(),
      // Her window before her picture: a face with different proportions
      // inside a window still sized for the previous one is clipped.
      showCompanion: () => resizeCompanion({ tellSettings: false }),
      tellSettings: () => {
        settingsWindow()?.webContents.send(IPC.settingsChanged, snapshot())
      },
      refreshTray,
      warn: (what, error) => console.warn(`[persona] ${what} failed during a switch:`, error),
    },
    id,
  )
  return outcome.kind === 'switched' || outcome.kind === 'already'
}

/**
 * Resize her window to match her size, keeping her where she is.
 *
 * Anchored on the CENTRE rather than the origin. Growing from the top-left
 * corner walks her down and to the right every time the slider moves, which
 * reads as the window running away from you.
 */
function resizeCompanion({ tellSettings }: { tellSettings: boolean }): void {
  const target = liveWindow()
  // Each surface is told INDEPENDENTLY. This used to return here, which also
  // skipped the settings broadcast below -- so with the companion hidden, a
  // persona switch refreshed the tray and left an open settings window showing
  // the previous character indefinitely. One window being absent is not a
  // reason to withhold an update from a different window.
  if (target !== null) {
    resizeAboutCentre(target, layout())
    // To the COMPANION, on the companion's channel. This used to send the
    // settings snapshot to the companion, which does not listen for it -- a
    // dead message to one window while the window that needed telling was not
    // told. The rig positions her from the layout, so a resized window with a
    // stale percentage draws her at the old size inside the new frame.
    target.webContents.send(IPC.appearanceChanged, appearance())
  }
  // The settings window is told only when it is not the one that asked.
  //
  // Its slider is live, so the only caller today sends this once per animation
  // frame while somebody drags -- and a full snapshot means building the auth
  // view, the About block, every shortcut's display string, and the locale
  // list, then structured-cloning the lot across a process boundary. The
  // receiving window compares it against the last one and discards it, because
  // the size is the single field it deliberately ignores. Sixty times a second.
  //
  // A parameter rather than a deletion: a second caller that changes her size
  // from somewhere else WOULD need to move that slider, and this way it has to
  // say so.
  if (tellSettings) settingsWindow()?.webContents.send(IPC.settingsChanged, snapshot())
}

/**
 * Write the preferences, once the dragging stops.
 *
 * A debounce that can lose the last value is a bug, not a saving — so
 * `flushPreferences` exists and the quit path calls it. Without that, closing
 * the app within the debounce window silently discards the size you just set,
 * which presents as "it forgot".
 */
let preferencesTimer: NodeJS.Timeout | null = null
const PREFERENCES_DEBOUNCE_MS = 400

function persistPreferencesSoon(): void {
  if (preferencesTimer) clearTimeout(preferencesTimer)
  preferencesTimer = setTimeout(flushPreferences, PREFERENCES_DEBOUNCE_MS)
}

/**
 * Write them now. Says whether it worked.
 *
 * It used to say nothing. The failure went to the log and the function
 * returned normally, so every caller carried on as though the file had been
 * written -- including `saveShortcuts`, whose `try/catch` rollback was
 * therefore unreachable code guarding against an exception that could not
 * happen. A full disk left the new keys registered, the file holding the old
 * ones, and the window reporting success.
 */
/**
 * Set when a file we could not read also could not be moved out of the way.
 *
 * The one condition under which writing is worse than not writing: the bytes on
 * disk are the user's whole configuration, this build cannot read them, and
 * nothing has been able to preserve a copy. Every write from here would replace
 * them with defaults.
 */
let preferencesSealed = false

function flushPreferences(): boolean {
  if (preferencesTimer) {
    clearTimeout(preferencesTimer)
    preferencesTimer = null
  }
  // Refused, and reported as a failure rather than a success. A caller that
  // rolls back on `false` -- `saveShortcuts` does -- must not be told the write
  // landed when the file was deliberately left alone.
  if (preferencesSealed) {
    console.warn('[settings] not writing preferences: the unreadable file could not be preserved')
    return false
  }
  try {
    savePreferences(app.getPath('userData'), preferences)
    return true
  } catch (error: unknown) {
    // The DETAIL goes to the log -- an errno and an absolute path are neither
    // translated nor actionable -- and the boolean goes to the caller, which
    // is the half that was missing.
    console.error('[settings] could not write preferences:', error)
    return false
  }
}

/**
 * Only her own main frame may drive these channels.
 *
 * Every one of them is privileged -- move the window, stop it being
 * click-through. Without the check any frame the renderer later loaded could
 * reach them.
 */
function isFromCompanion(event: { readonly senderFrame: unknown }): boolean {
  const target = liveWindow()
  return target !== null && event.senderFrame === target.webContents.mainFrame
}

/**
 * Whether a message came from the SETTINGS window's main frame.
 *
 * Separate from `isFromCompanion` and checked on both settings channels. The
 * two windows share one preload file and are told apart only by their role
 * argument -- which decides what the RENDERER can see, not what main will
 * answer. Without a guard here the companion could read and rewrite the
 * persona over a channel its own bridge does not expose, which is the kind of
 * gap that only ever shows up once something else has already gone wrong.
 */

/** Channels her OWN window may drive. Every one of them is privileged. */
function registerCompanionIpc(): void {
  ipcMain.on(IPC.setInteractive, (event, interactive: unknown) => {
    if (!isFromCompanion(event) || typeof interactive !== 'boolean') return
    // `forward` stays true in both states: a click-through window still needs
    // mousemove, or the renderer can never learn the cursor came back.
    liveWindow()?.setIgnoreMouseEvents(!interactive, { forward: true })
  })
  ipcMain.on(IPC.dragStart, (event, payload: unknown) => {
    if (!isFromCompanion(event)) return
    const target = liveWindow()
    if (!target) return
    const offset = parseDragStart(payload, target.getBounds())
    if (offset) startDrag(offset, liveWindow)
  })
  ipcMain.on(IPC.dragEnd, (event) => {
    if (isFromCompanion(event)) stopDrag()
  })
  ipcMain.handle(IPC.getAppearance, (event) => {
    if (!isFromCompanion(event)) throw new Error('unauthorized sender')
    return appearance()
  })
}

function registerIpc(): void {
  /**
   * The key is minted here and STAYS here.
   *
   * The renderer learns only whether it worked. That is what keeps
   * `api.openai.com` out of the companion's `connect-src`, and it matters
   * because that same window loads a face out of a user-writable folder.
   *
   * This block sat above `getAppearance`, which mints nothing and returns a
   * face and a size — the same kind of drift as the display-clamp comment that
   * described a function this file did not contain.
   */
  broker = createVoiceBroker({
    target: liveWindow,
    isFromCompanion,
    onReport: onVoiceReport,
    // -1 when there is no lifecycle yet, which matches no attempt.
    // -1 whenever there is no LIVE session, not merely when there is no
    // lifecycle. The attempt counter keeps its value while she is asleep --
    // including the number minted by closing a session, and 0 before the first
    // wake -- so returning it unconditionally let the least-trusted process
    // mint an ephemeral key and exchange SDP with no user-authorised session
    // anywhere. A wake is what authorises a credential; being asleep is not a
    // state in which one should be obtainable.
    currentAttempt: () =>
      lifecycle !== null && lifecycle.phase !== 'asleep' ? lifecycle.attempt : -1,
    credential: () =>
      resolveCredential(preferences.credentialSource, readApiKey(app.getPath('userData'))),
  })
  broker.register()
  // The settings channels own their own module. `state` is a façade over this
  // file's two mutable bindings, so a handler replacing the persona replaces
  // the one the tray and the next snapshot read.
  registerSettingsChannels({
    state: {
      get persona() {
        return persona
      },
      set persona(next) {
        persona = next
        refreshCapability()
      },
      get preferences() {
        return preferences
      },
      set preferences(next) {
        preferences = next
      },
    },
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
    // The composition root owns both paths: Codex's home and our workspace.
    setTrust: async (trusted: boolean) => {
      // A timestamp, so the backup this makes is distinguishable from the last
      // one. Passed in rather than read inside `trust.ts`, which stays testable
      // without freezing a clock.
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      const home = codexHome()
      return trusted
        ? await trustWorkspace(home, delegationWorkspace(), stamp)
        : await untrustWorkspace(home, delegationWorkspace(), stamp)
    },
    refreshDelegation: () => {
      refreshDelegationFacts()
    },
    switchPersona: switchPersonaTo,
    addPersona: () => {
      // A COPY of whoever is active, not a blank sheet. A persona is mostly
      // prose; an empty style beside an empty greeting is a form nobody can
      // tell from a broken one, and the first thing anybody would do is paste
      // the previous one back in.
      //
      // `copyPersonaTo` is the only thing in the app that mints an id, and it
      // derives it from the new NAME -- so the copy needs one of its own or it
      // lands on `-2`, which reads as a mistake rather than a choice.
      const written = copyPersonaTo(app.getPath('userData'), catalog, persona, `${persona.name} 2`)
      const { id } = written
      catalog = readCatalog()
      // Worn immediately. Adding a persona you are then not looking at is an
      // action with no visible result, and this app has one notion of "which
      // persona".
      if (!switchPersonaTo(id)) {
        // THE PACKAGE GOES WITH THE FAILURE. Reporting "could not be worn" and
        // leaving a complete persona on disk means she is not there now and is
        // there on the next launch -- an action that failed and half happened,
        // which is the shape nobody can undo because nobody knows about it.
        discardWrite(app.getPath('userData'), written.source)
        catalog = readCatalog()
        throw new Error(`the new persona ${id} could not be worn`)
      }
      return id
    },
    removePersona: (id) => {
      // Off her FIRST. Deleting the file underneath the active persona would
      // leave main holding somebody with no source, so the next save would
      // recreate her -- and the tray would still be offering her.
      const wasActive = id === persona.id
      if (wasActive && !switchPersonaTo(DEFAULT_PERSONA.id)) {
        throw new Error('could not step off the persona being removed')
      }
      if (history === null) throw new Error('the transcript store is not open')
      try {
        deletePersona(app.getPath('userData'), catalog, id, history)
      } catch (error: unknown) {
        // PUT HER BACK ON. Stepping off first is right -- deleting the files
        // under the worn persona leaves main holding somebody with no source --
        // but a failed delete then reported failure while having permanently
        // changed who is worn and written that choice to preferences. The user
        // pressed Delete, was told it did not work, and found themselves
        // wearing somebody else.
        if (wasActive) switchPersonaTo(id)
        throw error
      }
      // Her carried retention goes with her, like everything else filed under
      // her id. Left behind, it is a dead entry that the NEXT persona to take
      // this id inherits -- `deriveId` reuses a freed name -- so a stranger's
      // opt-out would be applied to somebody who never made it, and written to
      // disk by the first `policyNow()` that reads it.
      carriedPolicies.delete(id)
      catalog = readCatalog()
      refreshTray()
    },
    savePolicy: (policy) => {
      // Written BEFORE anything reads it again, and a failure throws rather
      // than being swallowed: when the effective answer cannot be established,
      // nothing is stored -- so the channel has to be able to
      // tell the user it did not take.
      writePolicy(app.getPath('userData'), persona.id, policy)
      // The carried value is SPENT the moment a real one exists.
      //
      // It is a stand-in for a choice that could not be stored, and one has
      // just been stored. Leaving it made the next `policyNow()` -- which the
      // settings snapshot calls immediately after this -- write the stale
      // carried value straight back over what the user just chose. Turning
      // retention off and watching it turn itself back on, from the code whose
      // whole purpose is to protect that setting.
      carriedPolicies.delete(persona.id)
      // The live session follows immediately. Turning storage off during a
      // conversation and having the rest of it written down anyway is the
      // one outcome this switch exists to prevent, and waiting for the next
      // wake would produce exactly that.
      if (!policy.keeps) live.end()
      else if (lifecycle?.phase === 'awake') live.begin(persona.id)
    },
    listSessions: () => history?.sessions(persona.id) ?? [],
    readSession: (token) => history?.turns(persona.id, token) ?? [],
    searchTranscripts: (query) => history?.search(persona.id, query) ?? [],
    forgetSession: (token) => {
      if (history === null) throw new Error('the transcript store is not open')
      // The LIVE conversation, if that is the one going. `say` would otherwise
      // keep writing into a row that no longer exists. Asked by NAME rather
      // than by looking for the row with no end -- an imported archive can
      // carry one of those, and releasing the handle for somebody else's
      // conversation would stop recording this one with nothing saying so.
      // DELETE FIRST, release second.
      //
      // Releasing first and then throwing left the conversation on disk with
      // recording silently stopped for the rest of the session -- the one
      // outcome worse than either half, because the user sees the row still
      // there and assumes nothing happened. The delete is synchronous, so
      // "it threw" and "it did not delete" are the same statement.
      const forgotten = history.forgetSession(persona.id, token)
      // Only once the row is actually gone. `say` would otherwise keep writing
      // into a row that no longer exists. Asked by NAME rather than by looking
      // for the row with no end -- an imported archive can carry one of those,
      // and releasing the handle for somebody else's conversation would stop
      // recording this one with nothing saying so.
      if (forgotten && live.which() === token) live.release()
      return forgotten
    },
    exportTranscripts: () => {
      if (history === null) throw new Error('the transcript store is not open')
      return history.exportFor(persona.id)
    },
    importTranscripts: (archive) => {
      if (history === null) throw new Error('the transcript store is not open')
      const result = history.importInto(persona.id, archive)
      return result.ok
        ? {
            kind: 'done' as const,
            sessions: result.sessions,
            turns: result.turns,
            skipped: result.skipped,
            conflicts: result.conflicts,
          }
        : { kind: 'refused' as const, problems: [{ kind: 'save-failed' as const }] }
    },
    forgetMemory: () => {
      // Her NOTES only. These are three separate actions so
      // that clearing what she remembers is not a way to lose the
      // conversations, nor the reverse.
      forgetMemory(app.getPath('userData'), persona.id)
    },
    forgetTranscripts: (personaId) => {
      if (history === null) throw new Error('the transcript store is not open')
      // Deleted first, for the reason `forgetSession` above gives. Releasing
      // first and failing left every row intact while recording had stopped.
      history.forget(personaId)
      // The LIVE session too, if it is hers. Forgetting the rows while a
      // session id still points at one of them would write the next turn into
      // a session that no longer exists -- and the foreign key would take the
      // whole conversation down with it.
      if (personaId === persona.id) live.release()
    },
    revealPackage: async () => {
      const userData = app.getPath('userData')
      // Her own folder if she has one, otherwise the one named after her id.
      // The built-in falls into the second case until something writes there,
      // and she is exactly who somebody wants to hand an artifact to.
      // The SAME resolution the face and artifact loaders use, rather than a
      // third inline copy of it.
      const folder = join(
        personasRoot(userData),
        packageFolder(persona.id, catalog.sources) ?? persona.id,
      )
      mkdirSync(folder, { recursive: true })
      // `openPath`, not `showItemInFolder`: the folder IS the thing being
      // opened, and revealing it inside its parent would show a list of every
      // persona rather than the one being edited.
      const failed = await shell.openPath(folder)
      if (failed !== '') throw new Error(failed)
    },
    forgetEverything: () => {
      if (history === null) throw new Error('the transcript store is not open')
      // The whole file, not a loop over the catalog. Rows outlive the
      // persona they were filed under -- a package deleted by hand, one that
      // stopped parsing, one refused as a duplicate id -- and none of those
      // appear in `catalog.personas` to be iterated. This button says "every
      // persona"; iterating the loaded ones made that false in precisely the
      // cases somebody presses it for.
      // Same order as the two above: a thrown delete must not leave the data
      // intact and the recording stopped.
      history.forgetEverything()
      live.release()
    },
    restoreBuiltIn: () => {
      restoreBuiltInEdits(app.getPath('userData'))
      catalog = readCatalog()
      // Re-dressed HERE, not left to the next save. She may be the persona
      // being worn, and main's copy of her is what every surface is drawn
      // from -- so a restore that updated only the catalog would put the
      // original in the shelf and leave the edited one on screen.
      if (persona.id === DEFAULT_PERSONA.id) {
        persona = catalog.personas.get(DEFAULT_PERSONA.id) ?? DEFAULT_PERSONA
        refreshCapability()
        // Her FACE too, and the window around it. The overlay being discarded
        // can have changed `avatarId`, and `appearance()` reads a face loaded
        // once at startup -- so a restore updated who she is while leaving the
        // discarded geometry on screen, which is the one thing the button is
        // visibly about.
        loadFaceFor(persona)
        resizeCompanion({ tellSettings: true })
      }
      refreshTray()
    },
    writeToCatalog: (next) => {
      const { id, source } = savePersonaTo(app.getPath('userData'), catalog, next)
      const forked = id !== next.id
      // The catalog is REREAD, not patched. A patched copy and the files on
      // disk are two things that have to be kept in step by hand, and this
      // runs once per save -- cheap enough that correctness wins outright.
      catalog = readCatalog()
      // A fork changes which persona is active, so the remembered id has to
      // move with it or the next launch reopens the built-in and the copy
      // looks like it was never made.
      if (preferences.activePersonaId !== id) {
        const before = preferences
        preferences = { ...preferences, activePersonaId: id }
        // THROWS on a refused write, so the handler reports `save-failed`
        // rather than adopting a fork the disk does not know about. Ignoring
        // the answer here reproduced, in the save path, exactly the defect
        // `switchPersonaTo` was just fixed for: the window said saved, and the
        // edit reversed at the next launch.
        if (!flushPreferences()) {
          preferences = before
          // The FILE goes back too. Rolling back only the in-memory preference
          // left the fork on disk: the save reported failure, an extra persona
          // appeared in the list anyway, and retrying derived yet another id.
          // Only a fork is removed -- an ordinary edit overwrote a file that
          // was already somebody's, and deleting that would turn a failed save
          // into data loss.
          if (forked) discardWrite(app.getPath('userData'), source)
          catalog = readCatalog()
          throw new Error('the active persona could not be remembered')
        }
      }
      return id
    },
  })
  registerCompanionIpc()
}

/**
 * Read the avatars folder, loudly.
 *
 * Every rejected file is reported by name and reason. An avatar that silently
 * did not load presents as "the app ignored my file", which is the least
 * debuggable outcome this feature has -- and the only clue a designer would
 * otherwise get is that she looks exactly as she did before.
 */
function loadFaceFor(who: Persona): void {
  const root = avatarsRoot(app.getPath('userData'))
  seedAvatars(root)
  // NAMED by the persona rather than "the first valid one alphabetically".
  // Which face she wears is a property of the character, so two personas can
  // look different -- and a persona that names nothing wears the built-in.
  // Her OWN face first, if the package carries one. That is what a package is
  // for -- a single file could only ever point at something living elsewhere.
  // `packageFolder`, not `sources` alone. The built-in deliberately has no
  // `sources` entry -- that absence is how the catalog says "nothing to write
  // to" -- so consulting the map by itself meant her package face could never
  // be found. The artifact loader already resolves her by her reserved id;
  // this used a second, narrower rule for the same question, and the visible
  // symptom was a `face.json` placed in the folder the app itself offers to
  // open, being ignored without a word.
  const folder = packageFolder(who.id, catalog.sources)
  const resolved = resolveFaceFor(
    root,
    folder === null ? null : join(personasRoot(app.getPath('userData')), folder),
    who.avatarId,
  )
  for (const problem of resolved.problems) {
    console.error(`[avatar] ${problem.file}: ${problem.reason}`)
  }
  face = resolved.face
  console.log(`[avatar] ${who.id} is wearing ${resolved.source ?? 'the built-in mochi'}`)
}

/**
 * A press that arrived before there was a session to put it in.
 *
 * Spent on the first `ready` after it is set, so pressing the key while she is
 * asleep does what somebody pressing it plainly means: wake her, and ask.
 */
let armWhenReady = false

/**
 * Drop a held press, because the wake it was waiting for is not coming.
 *
 * `armWhenReady` is a bare boolean with no owner, so a wake that failed, was
 * cancelled, or was superseded left it set -- and the NEXT session to become
 * ready, possibly minutes later and started for an unrelated reason, was armed
 * by a keypress nobody had made for it. Cleared wherever a wake stops being in
 * progress; the authorisation itself is spent by `command`'s close handler.
 */
function dropHeldPress(why: string): void {
  if (!armWhenReady) return
  armWhenReady = false
  console.log(`[keys] askWorkspace dropped: ${why}`)
}

/**
 * Answer an `ask_workspace` call: authorise it, run it, deliver the result.
 *
 * Every path here ENDS IN A DELIVERY. A tool call that is never answered sits
 * in the conversation unresolved for the rest of the session, so a refusal is
 * delivered exactly like an answer -- as a `function_call_output` on the same
 * `call_id`, with a reason she can put into her own words.
 *
 * The payload is DATA, not prose to relay. She is told what happened in fields
 * and phrases it herself; the only free text that ever reaches it is `spoken`,
 * which `--output-schema` constrains to a sentence. That matters because the
 * text originates in files a user dropped into a directory -- a measured
 * payload reached the field she reads aloud, which is why the
 * guard inside `delegate` runs first.
 */
function runDelegation(attempt: number, callId: string, question: string): void {
  const answer = (payload: JsonValue): void => {
    broker?.send({ kind: 'workspaceAnswer', attempt, callId, payload })
  }

  // BEFORE the authorisation is spent, and before any state moves.
  //
  // `delegate` would refuse this itself, but only after this function has
  // already claimed the working hold and announced the lookup -- and its
  // refusal arrives in about a millisecond, so the `finally` below then clears
  // a hold the FIRST, still-running delegation is relying on. She says goodbye
  // with the real answer in flight. Reachable whenever two calls can overlap,
  // which under the `anytime` trigger needs no user action at all.
  //
  // Synchronous, and that is what makes it airtight rather than merely likely
  // to help: `delegate` claims its own flag before its first `await`, and
  // everything between this check and that claim is synchronous, so two calls
  // cannot interleave in the gap.
  if (isDelegating()) {
    console.log('[delegate] refused: one is already running')
    answer({ status: 'already-working' })
    return
  }
  // Checked BEFORE the authorisation is spent. Taking it first meant a
  // malformed tool call -- the model's mistake, not the user's -- burned a
  // valid keypress and left the next real question unauthorised.
  if (question.trim() === '') {
    console.log('[delegate] refused: the tool call carried no question')
    answer({ status: 'no-question' })
    return
  }
  // The keypress, or the setting that says one is not needed. Spent here, so
  // one press covers one run -- see `codex/authorisation.ts`.
  const basis = takeAuthorisation(preferences.delegation.trigger)
  if (basis === null) {
    // Logged, because this path is INVISIBLE otherwise: no process starts, the
    // answer goes back inside a millisecond, and the only trace is whatever she
    // improvises from the tag. A live session produced "I'm not authorized to
    // dig into more specifics from that source", which sends the user looking
    // at the source rather than at the key they did not press again.
    console.log('[delegate] refused: no authorisation (the press was already spent, or expired)')
    answer({ status: 'not-authorised', hint: 'press the shortcut first' })
    return
  }

  // Holds the idle timeout open for the duration. Without it she says goodbye
  // after ninety seconds of the silence her own errand caused, and the answer
  // lands in a session that no longer exists (a run takes 20-56s and is
  // allowed three minutes).
  lifecycle?.setWorking(true)
  refreshTray()
  // AFTER every refusal above, and before the run. A lookup that was refused
  // must not be announced as started -- and the refusals are all fast paths, so
  // announcing first would put "I'm looking it up" and "I can't" in that order,
  // a millisecond apart.
  //
  // Not gated on the outcome either, because the outcome is up to a minute
  // away: the whole point is that she says something in the meantime.
  broker?.send({ kind: 'workspaceStarted', attempt })
  detach(
    delegate(question, {
      workspace: delegationWorkspace(),
      userData: app.getPath('userData'),
      // The stored choice, CHECKED against what this credential can reach.
      //
      // Hiding an unreachable model in the pane is cosmetic: the value stays in
      // preferences and was still handed to Codex, which then fails for a
      // reason nobody can see. The gate belongs where the command line is
      // built, not where it is displayed.
      settings: usableDelegation(),
      status: async () => await checkCodex(),
      codexPath: async () => {
        const found = await locateCodex({
          platform: process.platform,
          env: process.env,
          home: homedir(),
          exists: (path) => existsSync(path),
        })
        return isLocated(found) ? found.path : null
      },
      run: spawnCodex,
    })
      .then((outcome) => {
        // The long form, LOGGED and nowhere else.
        //
        // `detail` is the only place the prompt's "say which one the answer
        // came from" actually lands -- `spoken` is a sentence or two and
        // routinely drops the source. Until M10 gives it a screen it was parsed
        // and then discarded, which made "did she read a file, search the web,
        // or recall it?" unanswerable after the fact: stdout is ignored and the
        // answer file is removed in a `finally`.
        //
        // Main's console rather than the payload: this text originates in files
        // somebody dropped into a directory, and the payload goes to OpenAI.
        if (outcome.kind === 'answered') {
          // METADATA ONLY. Not one character of the answer reaches this line.
          //
          // Two versions were wrong before this one. The first logged
          // `outcome.detail` whole -- up to 256 KB of whatever Codex read out
          // of the workspace, copied into a log with none of the protections
          // the workspace has. The second logged a 200-character prefix, which
          // bounded the VOLUME and not the SENSITIVITY: the opening of a file
          // is still the contents of a file.
          //
          // What this logging exists to answer is "did she search the web, or
          // answer from what she read?" -- and that is a question about the
          // SHAPE of the answer, not its text. A length and whether a URL was
          // cited settle it while emitting nothing quotable.
          console.log(
            `[delegate] answered — detail ${String(outcome.detail.length)} chars, cites a url: ${String(/https?:\/\//i.test(outcome.detail))}`,
          )
          // The follow-up window. ONLY here -- see `renewAuthorisation` for why
          // an answer may renew and a refusal may not.
          //
          // The BASIS travels, so a run admitted under `anytime` cannot mint a
          // press: renewing one meant switching the trigger back to `hotkey`
          // inherited a free read nobody pressed a key for.
          renewAuthorisation(basis)
          if (basis === 'press') {
            console.log('[delegate] answered — a follow-up needs no second press for a minute')
          }
        }
        // Every other outcome, by TAG. Two of them -- `not-authorised` above
        // and `busy` -- return in about a millisecond, and a millisecond of
        // silence followed by her improvising an explanation is what a real
        // session looked like: she rendered `not-authorised` as "I'm not
        // authorized to dig into more specifics from that source", which reads
        // as the SOURCE refusing her rather than as an unpressed key.
        else console.log(`[delegate] ${outcome.kind}`)
        answer(payloadFor(outcome))
      })
      .finally(() => {
        // `finally`, so a rejection cannot leave the flag on. A `working` that
        // never clears is the "sometimes she just does not sleep" failure.
        lifecycle?.setWorking(false)
        refreshTray()
      }),
    'delegation',
  )
}

/**
 * The outcome as something she can talk about.
 *
 * Tags plus the minimum each one needs, never a sentence: what she
 * SAYS is her wording in her language, and a fixed English string relayed
 * through a voice would be neither.
 */
function payloadFor(outcome: DelegationOutcome): JsonValue {
  switch (outcome.kind) {
    case 'answered':
      return { status: 'ok', answer: outcome.spoken }
    case 'not-ready':
      return { status: 'codex-unavailable', reason: outcome.readiness, remedy: outcome.remedy }
    case 'refused':
      // The FILENAMES, and only the filenames.
      //
      // The user has to know which file to deal with, and their CONTENTS
      // emphatically do not travel -- that is the whole point of the guard. Nor
      // does the path: this payload is sent to OpenAI, and an absolute path
      // under `userData` contains the account name. `basename` is everything
      // the sentence needs and nothing the service has any business receiving.
      return {
        status: 'workspace-refused',
        files: outcome.hazards.map((hazard) => basename(hazard.path)),
      }
    case 'unreadable-workspace':
      return { status: 'workspace-unreadable' }
    case 'busy':
      return { status: 'already-working' }
    case 'cancelled':
      return { status: 'cancelled' }
    case 'timed-out':
      return { status: 'timed-out' }
    case 'failed':
      return { status: 'failed', reason: outcome.reason }
  }
}

/**
 * The delegation key.
 *
 * Pressing it while one is already running CANCELS it rather than queueing a
 * second. The alternative -- ignoring the press -- leaves somebody holding a
 * key that visibly does nothing for up to three minutes, which reads as the app
 * having hung. See `cancelDelegation`.
 *
 * The utterance that follows a press is what gets asked; W8 carries it from the
 * session. Until that lands this authorises and cancels, and nothing else.
 */
function askWorkspace(): void {
  if (isDelegating()) {
    console.log('[keys] askWorkspace pressed while one was running — cancelling it')
    cancelDelegation()
    return
  }
  authoriseDelegation()

  // ASLEEP: wake her, and arm the moment the session is ready.
  //
  // Refusing here made this the third shortcut in this file to do nothing
  // visible -- and it is the least defensible of the three, because pressing
  // "ask her to look something up" while she is asleep is not a mistake. It is
  // the ordinary way somebody would start. `toggleAwake` next door already
  // treats "cannot act yet" as a reason to open the route rather than return,
  // and this now does the same.
  if (lifecycle !== null && lifecycle.phase === 'asleep') {
    if (availability.remedy() !== null) {
      // The press is SPENT, not left lying about. It was recorded a few lines
      // above and would otherwise stay valid for a minute -- long enough to
      // authorise an unrelated tool call the user never asked for, after a wake
      // they were told had been refused.
      clearAuthorisation()
      console.warn('[keys] askWorkspace refused to wake: there is no route to a voice')
      detach(availability.repair(), 'codex')
      return
    }
    console.log('[keys] askWorkspace pressed while asleep — waking her first')
    armWhenReady = true
    lifecycle.toggle()
    return
  }

  // SWITCHED ON THE PHASE, rather than on whether an attempt number exists.
  //
  // The old guard asked `lifecycle?.attempt === undefined`, which is never true
  // while waking -- the number is minted when the session is REQUESTED, not
  // when it opens. So the "still waking" branch was unreachable and the arm was
  // sent into a session with nothing listening yet, where it was dropped.
  const phase = lifecycle?.phase
  if (phase === 'waking') {
    console.log('[keys] askWorkspace pressed while she was still waking — held')
    armWhenReady = true
    return
  }
  if (phase === 'farewell') {
    // She is on her way out with the microphone already shut, so arming the
    // session she is leaving arms nothing. The toggle brings her back -- which
    // is what the same key does next door -- and the press is spent on the
    // session that follows.
    console.log('[keys] askWorkspace pressed during the goodbye — coming back first')
    armWhenReady = true
    lifecycle?.toggle()
    return
  }
  const attempt = lifecycle?.attempt
  if (attempt === undefined || broker === null) {
    console.log('[keys] askWorkspace pressed with no session to arm — held')
    armWhenReady = true
    return
  }
  // The press has to REACH HER, or it changes nothing she can act on. This was
  // the defect: an authorisation was recorded in main and she was never told,
  // so she had no reason to call the tool and the press expired unused.
  broker.send({ kind: 'armWorkspace', attempt })
  console.log('[keys] askWorkspace armed for the next turn')
}

/** Claim the current set and repaint whatever shows them. */
function claimShortcuts(): void {
  claimShortcutsFor(preferences.shortcuts, { toggleVisible, toggleAwake, askWorkspace })
  refreshTray()
}

/**
 * Everything that must be true before a window exists.
 *
 * Ordering is the reason this is one function rather than four lines inlined:
 * the activation policy and the AppUserModelID must be set before any window,
 * the IPC handlers before the renderer can ask, and the CSP before the first
 * request is served. A policy installed after the document has loaded protects
 * nothing and reports nothing.
 */
function prepare(rendererUrl: string | null): void {
  // Accessory, so she has no Dock tile and no Cmd-Tab entry. She is furniture,
  // not an application you switch to.
  if (process.platform === 'darwin') app.setActivationPolicy('accessory')
  if (process.platform === 'win32') app.setAppUserModelId(APP_USER_MODEL_ID)

  locale = resolveLocale(app.getLocale())

  // PREFERENCES FIRST. They carry `activePersonaId`, and the catalog needs it
  // to decide who she is -- read the other way round, the resolve saw the
  // default `null`, so a machine with a chosen persona woke as the built-in
  // every single launch and the migration's own choice was overwritten by the
  // load that followed it. Nothing in the suite boots main, so both were
  // invisible behind a green gate.
  const stored = loadPreferences(app.getPath('userData'))
  preferences = stored.preferences
  // Remembered before anything reads the catalog: it decides whether the
  // one-time retention migration may run at all. See `loadPersonas`.
  ranBefore = stored.ranBefore
  // A missing file is silent; anything else is not. A permissions problem on
  // userData used to present as her size resetting on every launch, with
  // nothing anywhere to explain it.
  if (stored.problem !== null) {
    console.warn(`[settings] ${PREFERENCES_FILE} ${stored.problem} — using the defaults`)
  }
  // MOVED ASIDE before anything can write over it.
  //
  // Only when nothing in the file survived -- a field that fell back is not
  // this. The app flushes preferences on quit unconditionally, so without this
  // the launch that failed to READ somebody's settings was also the launch that
  // destroyed them, and the two are indistinguishable afterwards because the
  // evidence is what got overwritten.
  //
  // Done here rather than inside `loadPreferences` so that reading stays a read.
  if (stored.unusableFile) {
    const aside = quarantinePreferences(app.getPath('userData'))
    if (aside === null) {
      // SEALED, not merely logged. Logging that the file "may be overwritten"
      // and then overwriting it on quit is not a fix -- and the case is real:
      // the rename can fail while the write later succeeds, because a
      // permissions problem can clear in between.
      //
      // Refusing costs nothing that works. The rename failed, which means this
      // directory would not accept it; if that clears, the user's own file is
      // still there and still theirs to keep. A preference set during this run
      // is worth less than every preference they have ever set.
      preferencesSealed = true
      console.warn(
        `[settings] ${PREFERENCES_FILE} could not be read or moved aside — not writing over it`,
      )
    } else {
      console.warn(`[settings] the unreadable ${PREFERENCES_FILE} was moved to ${aside}`)
    }
  }

  // Before the window: the renderer asks for its face as soon as it runs, and a
  // handler registered afterwards would be reached by a fast renderer first.
  history = createTranscripts(app.getPath('userData'))
  loadStoredPersonas()
  loadFaceFor(persona)
  registerIpc()

  rendererOrigin = rendererUrl
  applyContentSecurityPolicy(rendererUrl)
  // Only the companion, only media, only audio. See windows/permissions.
  applyMediaPolicy(liveWindow)
}

/** The state machine that decides when she is awake, wired to both surfaces. */
function startCompanionLifecycle(): Lifecycle {
  return startLifecycle(
    {
      // Every effect the machine emits, handed to the window that owns the
      // session. Main decides WHEN; the renderer can only do.
      // Read at the moment of opening, so a session started after a switch
      // carries HER notes rather than the previous character's.
      memory: () => recall(app.getPath('userData'), persona.id),
      spokenRules: () => sessionRules(),
      sound: () => preferences.sound,
      drives: () => capability?.drives ?? false,
      command: (command) => {
        console.log(`[lifecycle] -> ${command.kind} (attempt ${command.attempt})`)
        // A CLOSED SESSION SPENDS THE PRESS.
        //
        // The authorisation is a process-global timestamp, so a press made in
        // one conversation stayed valid for a minute across a session that
        // ended and one that replaced it -- a reconnect, a persona switch, a
        // sleep and a re-wake. The tool call it then authorised belonged to a
        // conversation the user had not been looking at when they pressed the
        // key, which is exactly the "the app reads whenever it likes" that
        // putting this on the keyboard exists to rule out.
        //
        // Not bound to the attempt at press time instead: pressing while she
        // is ASLEEP is the ordinary way to start, and there is no attempt yet.
        // Clearing on close covers that without forbidding it.
        if (command.kind === 'close') {
          clearAuthorisation()
          // The wake that press was waiting for is over, one way or another --
          // it failed, it was cancelled, or the session it opened has ended.
          // Left set, it would arm whichever session became ready next.
          dropHeldPress('the session closed before it could be armed')
        }
        broker?.send(command)
      },
      // Read through the closure, never captured: a wake after an edit must use
      // the edited persona, and the next wake is the only place a change needs to
      // take effect because every wake opens a fresh session.
      persona: () => persona,
      // A capability that drives says its own opening line through `say`, so
      // the lifecycle must not also speak one -- that would be two utterances
      // where one was wanted, and the greeting is the unwanted one.
      greeting: () => (capability?.drives === true ? null : greetingFor(persona)),
      // The same rules the session was opened with, so a goodbye asked for
      // with `UNPROMPTED` cannot lose them -- see `farewellFor`.
      farewell: () => farewellFor(persona, sessionRules()),
      onChanged: (state) => {
        // The transcript's session boundary IS the lifecycle's, so it is taken
        // from the phase rather than tracked separately -- including the close a
        // persona switch forces, which is what stops one conversation being
        // split across two characters.
        // Her first utterance, asked for the same way as every later one. After
        // the effects above, so the session is configured and the microphone
        // has been decided before anything is spoken into it.
        const entering = state.phase === 'awake' && wasAwake !== true
        wasAwake = state.phase === 'awake'
        if (entering) {
          // Only if SHE keeps text. No session means no rows: `onVoiceReport`
          // writes a turn only when there is a session to write it into, so
          // this one branch is the whole switch rather than a flag consulted
          // again at every turn -- a second place to check is a second place
          // to forget.
          // Retention is applied HERE, at the start of a conversation, rather
          // than on a timer or at quit. It is the one moment the answer is
          // certainly current -- her policy is read for the persona being worn
          // right now -- and it cannot run while she is mid-sentence.
          const policy = policyNow()
          // Caught, for the same reason nothing in `live` throws: this runs
          // AFTER the lifecycle has advanced and the microphone has been
          // decided, so a database error escaping here leaves her awake with
          // the state machine already past the point that could undo it. A
          // failed prune costs some old conversations staying longer than
          // asked; letting it out costs the wake.
          if (policy.keepDays !== null && history !== null) {
            try {
              const cutoff = Date.now() - policy.keepDays * DAY_MS
              const dropped = history.pruneBefore(persona.id, cutoff)
              if (dropped > 0) console.log(`[transcripts] pruned ${String(dropped)} old session(s)`)
            } catch (error: unknown) {
              console.error('[transcripts] could not drop her older conversations:', error)
            }
          }
          if (policy.keeps) live.begin(persona.id)
          capability?.onWake?.(sessionView())
        } else if (state.phase === 'asleep') {
          live.end()
        }
        // The renderer first. The wake reaction is the whole point and it has to
        // land before anything slower — a tray rebuild is not slow, but it is
        // not free either, and the ordering says which one matters.
        liveWindow()?.webContents.send(IPC.phaseChanged, state.phase)
        refreshTray()
      },
    },
    // Read on every step, from whatever the preferences hold NOW. This used
    // to be a value, captured here -- and this function runs once for the
    // process, so the setting the pane promises "takes effect the next time
    // she wakes" actually took effect at the next launch.
    //
    // Still not applied mid-conversation: the lifecycle reads it when a step
    // happens, and the step that matters is the wake. Moving the microphone
    // under a turn already in flight is what the pane's sentence rules out,
    // and that remains true.
    //
    // `idleMs` rides the same thunk and genuinely IS live, unlike `listening`
    // above: the tick that fires the farewell reads it each time, so
    // lengthening it while she is awake postpones the goodbye rather than
    // waiting for the next wake to matter. Which is what somebody who just
    // watched her leave too early is asking for.
    () => ({
      ...DEFAULT_SETTINGS,
      listening: preferences.sound.listening,
      idleMs: preferences.idleMs,
    }),
  )
}

/**
 * Ways to drive her that do not require a hand on a menu.
 *
 * Both exist because the surfaces they reach are otherwise unreachable by any
 * automated check: the settings window shipped BLANK and nobody noticed, every
 * gate green, because the only way to open it was to click a tray item. A
 * window that can only be opened by hand is a window that only gets tested by
 * hand. Gated on `!app.isPackaged` so neither can exist in a shipped build.
 */
function installDevelopmentHooks(rendererUrl: string | null, ready: Promise<unknown>): void {
  if (app.isPackaged) return
  if (process.env['MOCHI_OPEN_SETTINGS'] === '1') showSettings(rendererUrl)
  if (process.env['MOCHI_WAKE_ON_START'] === '1') {
    // Triggered off the window's OWN readiness, not a 1500ms guess. The guess
    // was a race dressed as a constant: too short on a cold start and the wake
    // command reached a renderer with no listener yet, too long everywhere else
    // and every run paid for it. `ready` resolves exactly when the document is
    // there to receive the command.
    detach(
      ready.then(() => lifecycle?.toggle()),
      'wake-on-start',
    )
  }
}

/**
 * The dev server's address, and ONLY in a build that has a dev server.
 *
 * `ELECTRON_RENDERER_URL` is how electron-vite tells main where to load the
 * renderer from while developing. It is an environment variable, so anything
 * that can start this app with an environment can set it -- and in a packaged
 * build it was honoured unconditionally. That is a remote page loaded into
 * the window that has the preload bridge attached: microphone, ephemeral key
 * minting, window control.
 *
 * Ignored when packaged, and required to be local when not. `app.isPackaged`
 * is the check rather than `NODE_ENV`, because the environment is exactly the
 * thing not being trusted here.
 */
function devRendererUrl(): string | null {
  const wanted = process.env['ELECTRON_RENDERER_URL']
  if (wanted === undefined || wanted === '') return null
  if (app.isPackaged) {
    console.error('[main] ignoring ELECTRON_RENDERER_URL: this is a packaged build')
    return null
  }
  let parsed: URL
  try {
    parsed = new URL(wanted)
  } catch {
    console.error('[main] ignoring ELECTRON_RENDERER_URL: not a URL')
    return null
  }
  // Loopback only, and by hostname rather than by prefix: `http://127.0.0.1.
  // evil.test/` starts with a loopback address and is not one.
  const local = ['localhost', '127.0.0.1', '[::1]', '::1']
  if (
    !local.includes(parsed.hostname) ||
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
  ) {
    console.error(
      `[main] ignoring ELECTRON_RENDERER_URL: ${parsed.origin} is not a local dev server`,
    )
    return null
  }
  return wanted
}

function start(): void {
  started = true
  const rendererUrl = devRendererUrl()
  prepare(rendererUrl)

  const companion = createCompanionWindow(rendererUrl, layout())
  win = companion.win
  companion.loaded.catch((error: unknown) => {
    // Fatal: the window is already destroyed by this point, and carrying on
    // leaves a tray icon driving nothing.
    console.error('[main] the companion window failed to load:', error)
    // `quit`, not `exit`. `app.exit` terminates without firing `before-quit`
    // or `will-quit`, so the teardown below never ran on either fatal path --
    // and that teardown is where a spawned `codex exec` is killed, the
    // preferences written, the live transcript closed and the global shortcuts
    // released. Failing to start would leave a Codex running against the
    // user's account and their last size change unwritten.
    process.exitCode = 1
    app.quit()
  })

  // Before the tray, so its first paint already shows a phase rather than a
  // default that is about to be corrected.
  lifecycle = startCompanionLifecycle()
  // `true`: the companion window is constructed without `show: false`, so it is
  // on screen by the time this runs.
  tray = createTray(trayModel(true), handlers)

  detach(availability.probeAndOffer(), 'codex')
  claimShortcuts()
  installDevelopmentHooks(rendererUrl, companion.loaded)

  // A display going away is the one way she can still end up somewhere
  // unreachable, now that dragging and resizing are both clamped. Answered
  // here rather than by a menu item somebody has to find.
  // A display GOING AWAY can strand her on coordinates that no longer exist,
  // and the centre of a screen that does exist is the only certain answer.
  screen.on('display-removed', () => withWindow(recentre))
  // A metrics change is not that. See `keepReachable`.
  screen.on('display-metrics-changed', () => withWindow(keepReachable))
  win.on('show', refreshTray)
  win.on('hide', refreshTray)
}

/**
 * One mochi, or none.
 *
 * Two copies sit on top of each other and read as one that will not respond,
 * because half the clicks go to the one behind.
 */
if (app.requestSingleInstanceLock()) {
  app.on('second-instance', () => liveWindow()?.showInactive())
  app
    .whenReady()
    .then(start)
    .catch((error: unknown) => {
      console.error('[main] initialization failed:', error)
      // Same reason as the companion's fatal path: `exit` skips `will-quit`.
      process.exitCode = 1
      app.quit()
    })
} else {
  // Said out loud before going: `pnpm dev` against a running instance otherwise
  // builds, launches, exits 0 and leaves nothing new on screen, which reads as
  // a broken build rather than as a lock working.
  console.log('[main] another mochi is already running; bringing that one forward')
  app.quit()
}

// A desktop companion outlives its window. The empty body is the POINT, not
// dead code: Electron quits when the last window closes unless something
// subscribes to this event.
app.on('window-all-closed', () => {})

app.on('will-quit', () => {
  // NOTHING here may run in a process that never started.
  //
  // `will-quit` is global: a SECOND instance, which fails the single-instance
  // lock and quits immediately, fires it too -- and `flushPreferences()` would
  // then write this process's untouched `DEFAULT_PREFERENCES` over whatever the
  // real instance had saved. Launching the app twice would silently reset her
  // size. The teardown below is equally meaningless for a process that owns
  // none of it.
  if (!started) return
  // Global shortcuts outlive the window that wanted them: unreleased, the
  // combination stays claimed for as long as the process does.
  unregisterShortcuts()
  // So does a spawned Codex. It is a child of this process, and nothing in the
  // teardown stopped it -- so quitting mid-delegation left a `codex exec`
  // running against the user's account, spending their quota on an answer
  // nobody would ever hear. FORCED, because the escalation that would follow an
  // ordinary cancellation runs on a timer this process will not live to fire.
  cancelDelegation(true)
  // A size set in the last 400ms is still only in memory.
  flushPreferences()
  // Deterministic teardown: a settings window outliving the app keeps the
  // process alive on platforms where the last window closing is what ends it.
  closeSettings()
  lifecycle?.stop()
  // The live session ENDS rather than being left open. A row with no
  // `ended_at` is indistinguishable from a conversation still in progress, so
  // an unclean quit would leave one that retention could never prune.
  live.end()
  history?.close()
  history = null
  stopDrag()
  // Through `destroyTray`, which also removes the theme listener the tray
  // installed. `tray.destroy()` left that listener holding a destroyed tray.
  destroyTray(tray)
})
