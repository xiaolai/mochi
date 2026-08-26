import { join } from 'node:path'
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  powerMonitor,
  screen,
  shell,
} from 'electron'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { BUBBLE_SIDES, PERSONA_LIMITS, RECOMMENDED_VOICES, VOICE_NAMES } from '@shared/persona'
import { BUILT_IN_ID } from '@shared/parse-persona'
import { greetingFor, PROMPT_SLOTS } from '@shared/instructions'
import { createRegistry } from '@shared/capability/registry'
import { grantOutcome } from './grant-outcome'
import { listener } from './ipc/listen'
import { migrateBubbleSide as runBubbleSideMigration } from './migrations/bubble-side'
import { shutDown as shutDown_ } from './shutdown'
import { running } from '../capabilities/ask-workspace/capability'
import { createMintSlot } from './voice/mint-slot'
import { reported } from './voice/reported'
import { createNextSession } from './voice/next-session'
import { renderTools } from './tools-sent'
import { promptsFor } from '@shared/prompts'
import {
  promptRows,
  readPromptOverrides,
  resolvePrompts,
  writePromptOverride,
  type Prompts,
} from './store/prompts'
import {
  REVEALABLE,
  type GrantChange,
  type PersonaAction,
  type PersonaChange,
  type Revealable,
  type SettingsView,
  type SettingsWrite,
} from '@shared/ipc'
import { type HistoryExport, type ShelfView } from '@shared/history-window'
import type { Pronoun } from '@shared/pronoun'
import { CAPABILITIES } from '../capabilities'
import { createLedger, type AnswerFrame } from './capability/ledger'
import { handleCall } from './capability/dispatch'
import { describeProblem, exchangeSdp, mintEphemeralKey, readBearer } from './voice/credential'
import { activePersona, copyPersonaTo, loadPersonas, savePersonaTo } from './store/personas'
import { personasRoot } from './store/persona-files'
import { deletePersona, discardWrite, sweepDeletions } from './store/delete-persona'
import { readEdits, restoreBuiltIn } from './store/her-edits'
import { migrateLegacyPersona, migrateLooseFiles } from './store/migrate-personas'
import type { PersonaCatalog } from './store/personas'
import { keepsFor, writePolicy } from './store/policy'
import type { Policy } from '@shared/policy'
import { checkPrompt, promptFile, readPrompt, seedPrompt, writePrompt } from './store/prompt'
import {
  readResting,
  readWebSearch,
  readWorkspace,
  readProfile,
  writeWorkspace,
  writeWebSearch,
  writeProfile,
  isProfileName,
  WORKSPACE_DIR,
  guardStopAt,
  readWornPersonaId,
  writeResting,
  writeWornPersonaId,
  readSleepAfterMinutes,
  writeSleepAfterMinutes,
  readHaloWhen,
  writeHaloWhen,
  readShoulderChip,
  writeShoulderChip,
  readTranscriptionLanguages,
  writeTranscriptionLanguages,
  writeHerPlace,
  type Resting,
} from './store/worn'
import { readGrants, writeGrant } from './store/grants'
import { claimShortcuts, releaseShortcuts, type ShortcutOutcome } from './shortcuts'
import { MOST_LANGUAGES, OFFERED_LANGUAGES, TRANSCRIPTION_MODEL } from '@shared/transcription'
import { SHORTCUTS } from '@shared/shortcuts'
import { allowsCapability, isGrant, withheldGuidance, GRANT_SPECS } from '@shared/grants'
import { avatarsRoot, seedAvatars, resolveFaceFor } from './store/avatars'
import { setAsideV1 } from './store/inherited'
import { problems } from './problems'
import { leftoverCapabilities, legacyCapabilitiesRoot } from './capability/legacy'
import type { CapabilityDeps } from '../capabilities/kind'
import { EMOTIONS } from '@shared/avatar'
import type { Forgotten, SettingsCodex } from '@shared/ipc'
import {
  codexHome,
  profileFile,
  profileFor,
  seedProfile,
} from '../capabilities/ask-workspace/profile'
import { createTray, trayMenuTemplate, type TrayHandle, type TrayModel } from './tray'
import { parseGrip, startDrag, stopDrag } from './drag'
import {
  FEET_FROM_TOP,
  WINDOW_W,
  herPositionFrom,
  originHolding,
  windowFitting,
  type Pad,
} from '@shared/avatar-layout'
import type { FaceSpec } from '@shared/avatar-spec'
import { installLogStamp, runName } from '@shared/log'

/*
  A wall clock on every line, before anything has a chance to print one.

  FIRST, ahead of every other statement in this module: `installLogStamp`
  rewrites `console.log`/`warn`/`error`, and a line printed before it runs is a
  line with no clock on it. The capability count a few lines down was exactly
  that line.

  Two processes interleave on one stream and neither used to stamp anything, so
  `[memory] codex exited with 1` and `[voice] taken at teardown` could not be
  ordered against each other — reading a real conversation meant inferring order
  from position, which is a guess dressed as evidence. `shared/log.ts` carries
  the rest of the argument, including why this wraps the console rather than
  offering a helper nobody remembers to call at midnight.
*/
installLogStamp()
console.log(`[main] run ${runName(new Date())}`)

/**
 * Her body before the renderer has said where it is — the same nominal one the
 * window was first positioned against.
 */
const NOMINAL_BODY = { left: (WINDOW_W - 94) / 2, top: FEET_FROM_TOP - 73, width: 94, height: 73 }
import {
  applyHearing,
  applyLookup,
  applyScreen,
  folderFor,
  listGrants,
  listKeys,
  listLookup,
  listScreen,
  listAvatars,
  listCapabilities,
  listPersonas,
  refuse,
} from './settings'
import { applyChange } from './store/persona-change'
import { packageFolder } from './store/personas'
import { boundedForgetSet, createTranscripts, type Transcripts } from './store/transcripts'
import { type SessionToken } from './store/turn-row'
import { noteUsed, readUsage } from './store/usage'
import { whatSheMayDo } from './what-she-may-do'
import { createConversation, type Conversation } from './store/conversation'
import { previousNote, recall, recallState, remember } from './store/memory'
import { createCompanionWindow, showHistoryWindow } from './window'
import { checkCodexNow, codexForWindow } from './codex/ready'
import { codexPathNow } from './codex/ready'
import { carryGrantsForward } from './store/grants'
import { legacyGrants } from './store/worn'
import { WITHHELD_GRANTS } from '@shared/grants'
import { registerForgetKept } from './ipc/forget-kept'

// The same string as `appId` in `electron-builder.yml`. Two spellings of an
// application's identity is how a notification arrives attributed to nothing and
// a taskbar grows a second entry for the app that is already running.
const APP_USER_MODEL_ID = 'com.mochi.companion'

app.setAppUserModelId(APP_USER_MODEL_ID)

/**
 * ONE of her, and this is what makes several claims in this repository true.
 *
 * Every store here is read-change-write with no lock — `preferences.json` says
 * so in its own header, `usage.json` follows it, and `transcripts.ts` states
 * flatly that "this one is the only writer". None of those is a property of the
 * code; they are all properties of there being one process. Two instances and a
 * permission revoked in one is silently restored by the other's next write.
 *
 * Refused BEFORE any window exists, so a second launch costs nothing and
 * changes nothing. `app.quit()` rather than an error: launching her twice is an
 * ordinary thing to do by accident, and the answer is the copy already running.
 */
if (!app.requestSingleInstanceLock()) {
  console.log('[main] another mochi is already running; leaving it to her')
  app.quit()
}

/**
 * A second launch asks the first one to show herself.
 *
 * Without this the second copy quits and nothing happens, which from the
 * outside is a launch that did nothing at all — she is a tray application with
 * a transparent window, so "already running" is not visibly different from
 * "did not start".
 */
app.on('second-instance', () => {
  if (companion === null || companion.isDestroyed()) return
  setHidden(false)
  companion.showInactive()
})

// `LSUIElement` in `electron-builder.yml` covers the packaged bundle; this covers
// `pnpm dev`, where there is no plist to read. Both are needed, and they are not
// redundant: the plist stops a Dock icon existing before this line runs, and this
// line is the only thing keeping it hidden in development.
if (process.platform === 'darwin') {
  app.setActivationPolicy('accessory')
}

/**
 * Everything that went wrong, kept where somebody can be shown it.
 *
 * Each `console.error` below has a companion line here. The console is for
 * whoever launched this from a terminal; a packaged app has no console, and
 * every one of these paths falls back to something that works — so from the
 * outside a rejected file is indistinguishable from the app ignoring it.
 */

/**
 * What she can do, decided at build time.
 *
 * No directory is read and nothing is merged: `src/capabilities/index.ts` globs
 * the folders into a static map, so a manifest that reaches this line has a
 * handler beside it by construction. See that file for why the plugin system in
 * a fork-and-build project is the build system.
 */
const registry = createRegistry(CAPABILITIES.manifests)

console.log(
  `[capability] ${registry.tools.length} available: ${registry.tools.map((t) => t.name).join(', ')}`,
)

/** The one window, and the only thing frames can be sent through. */
let companion: BrowserWindow | null = null

/**
 * The menu bar item — the only way to quit, and the only surface that is
 * always there. Null until the app is ready, since a `Tray` cannot exist
 * before then.
 */
let tray: TrayHandle | null = null

/**
 * Who she is and who she could be, read fresh on every rebuild.
 *
 * Not held: the persona shelf is files on disk and somebody may add one while
 * this is running, so a cached list would be stale the first time it mattered.
 */
function menuModel(): TrayModel {
  const userData = app.getPath('userData')
  const catalog = catalogue(userData)
  return {
    personas: [...catalog.personas.values()].map((one) => ({ id: one.id, name: one.name })),
    wornId: activePersona(catalog, readWornPersonaId(userData)).persona.id,
    pronoun: activePersona(catalog, readWornPersonaId(userData)).persona.pronoun,
    bubble: {
      ...bubbleSides,
      asked: activePersona(catalog, readWornPersonaId(userData)).persona.bubbleSide,
    },
    resting,
    listening,
    keys: {
      rest: claimed.find((one) => one.id === 'rest')?.refused === null ? SHORTCUTS.rest : null,
      hide: claimed.find((one) => one.id === 'hide')?.refused === null ? SHORTCUTS.hide : null,
    },
  }
}

/**
 * Whether she is asleep, and whether she is hidden.
 *
 * Held rather than read per menu build: these change from three places — the
 * key, the menu and a click on her — and every one of them has to be reflected
 * in the other two on the same tick.
 */
let resting: Resting = { asleep: false, hidden: false }

/** What the two global keys actually got. See `shortcuts.ts`. */
let claimed: readonly ShortcutOutcome[] = []

/**
 * One frame to her window, or nothing if there is no window to send it to.
 *
 * Every private frame in this file went out through its own null check and two
 * of them omitted the `isDestroyed` half — which throws rather than being
 * ignored, out of a listener where nothing catches it.
 */
/**
 * Where a one-way channel's failure goes.
 *
 * A hoisted `function`, not a `const`: these listeners register at module
 * evaluation from top to bottom, and a const declared after the first of them
 * is in its temporal dead zone. The first attempt at this was an arrow
 * function and `tsc` said so twelve times.
 */
function ipcProblem(channel: string, detail: string): void {
  problems.note('ipc', channel, detail)
}

/**
 * Every one-way renderer channel, with the guard `ipcMain.on` cannot give it.
 *
 * `handle` returns a promise, so a throw inside one becomes a rejection the
 * caller sees. `on` has nowhere to put one: the listener runs from Electron's
 * event loop with no frame above it. Eleven of these twelve were unguarded.
 */
const listenTo = listener(ipcProblem)

function tellCompanion(frame: Record<string, unknown>): void {
  if (companion === null || companion.isDestroyed()) return
  companion.webContents.send('voice:send', frame)
}

/**
 * Send her to sleep, or wake her. One implementation, three ways to ask.
 *
 * Asleep is about her ATTENTION — the microphone closes and her eyes shut — and
 * is deliberately not the same thing as hidden, which is about the screen.
 *
 * ## Resting CLOSES THE SESSION. It used to mute a track.
 *
 * `session.listen(false)` sets `micTrack.enabled = false` and stops there: the
 * peer, the data channel, the remote audio element and the hourly reconnect
 * (§53) all carried on. So a machine left running overnight opened a session an
 * hour, all night, into an empty room — and greeted it every time, because a
 * reconnect is a NEW session and `greeted` is per session.
 *
 * That is three costs for a state whose whole meaning is that she is not
 * participating: a live connection to the service, an open credential, and her
 * voice in an empty room. Resting now tears the session down, and waking opens
 * a new one — which is not a new mechanism, it is the reconnect path that
 * already runs every hour.
 *
 * **The microphone is released by the same act**, which is the property worth
 * keeping in mind: `close()` stops the tracks, so the operating system's own
 * recording indicator goes out. A mute never did that, and "asleep" with the
 * system microphone light on is the app disagreeing with the platform about
 * something a person can see.
 */
/**
 * How long to wait for the renderer to say it has finished sending.
 *
 * Generous, because the cost of being early is a conversation that starts
 * itself behind her closed eyes, and the cost of being late is a stored
 * `ended_at` a few seconds past the truth.
 */
const FLUSH_GRACE_MS = 3000

let awaitingFlush: NodeJS.Timeout | null = null

/**
 * End the conversation once the renderer has sent everything it owes.
 *
 * ## Why sleep ends it at all
 *
 * It did not, before. Rest was written, her window was told and the peer was
 * closed, and the archive session stayed open until the next wake or until
 * quit -- so a conversation slept at 10:00 and quit at 18:00 was stored as
 * eight hours long and the archive listed it that way. Every deletion control
 * shows that number, and a confirmation that misstates what it is about to
 * delete is worse than none.
 *
 * ## Why it waits
 *
 * A turn she was cut off in is flushed by the renderer's shutdown, over an
 * asynchronous channel. Ending on the way out of `setAsleep` ends the
 * conversation first and lets the late turn open a NEW one while she is
 * resting. So main asks, and waits to be told.
 *
 * The grace period is the answer to a renderer that died before it could say
 * anything: without it the conversation would stay open exactly as before, with
 * a mechanism in place that looks like it fixed the problem.
 */
function endWhenFlushed(): void {
  if (awaitingFlush !== null) clearTimeout(awaitingFlush)
  awaitingFlush = setTimeout(() => {
    awaitingFlush = null
    if (shutDown) return
    console.warn('[rest] her window never said it had finished; ending the conversation anyway')
    conversation().end()
  }, FLUSH_GRACE_MS)
  // Never a reason to hold the app open. If everything else is done, the
  // shutdown coordinator ends the conversation anyway, and sooner.
  awaitingFlush.unref()
}

/**
 * The acknowledgement arrived, or something that looks like one did.
 *
 * Ignored unless a close is actually outstanding. `shutdown` runs on every
 * teardown path and may run twice, and a second acknowledgement arriving after
 * she has woken would otherwise end the conversation she is having now.
 */
function conversationFlushed(): void {
  if (awaitingFlush === null) return
  clearTimeout(awaitingFlush)
  awaitingFlush = null
  conversation().end()
}

/**
 * The catalogue, WITH the built-in's edits applied.
 *
 * ## The defect this replaces
 *
 * There were sixteen calls to `loadPersonas` in this file and every one of them
 * passed `{}` for the edits. `readEdits` had no caller at all. So renaming the
 * built-in Mochi, or re-theming her, wrote `edits.json` and then ignored it on
 * every subsequent load -- written, stored, never read, which is this
 * repository's recurring defect stated exactly.
 *
 * Sixteen call sites passing the same literal is the mechanism that allowed it:
 * there was no single place where "load the characters" meant "load the
 * characters". One function is the fix; the seventeenth call site is the reason
 * it is enforced by a test rather than by intention.
 *
 * An unreadable edits file is reported and does not stop the load -- her
 * defaults are a working character, and refusing to start because a rename
 * could not be read would be a worse failure than starting un-renamed.
 */
/**
 * Policies that could not be written, from the last load.
 *
 * Kept here because `keeps` is asked on every turn and loading the whole
 * catalogue to answer it would read every package off disk per utterance. It is
 * refreshed by the one function that loads them, so it cannot drift from the
 * catalogue the app is actually using -- and a stale entry is harmless anyway,
 * because `keepsFor` prefers the policy store whenever it has an answer.
 */
let carriedPolicies: ReadonlyMap<string, Policy> = new Map()

function catalogue(userData: string): PersonaCatalog {
  const { edits, problem } = readEdits(userData)
  if (problem !== null) {
    console.error(`[persona] her own edits could not be read: ${problem}`)
    problems.note('persona', null, `her own edits could not be read: ${problem}`)
  }
  const loaded = loadPersonas(userData, edits, existsSync(personasRoot(userData)))
  carriedPolicies = loaded.carriedPolicies
  return loaded
}

function setAsleep(asleep: boolean): void {
  if (asleep === resting.asleep) return
  resting = { ...resting, asleep }
  writeResting(app.getPath('userData'), { asleep })
  // Her eyes, first and unconditionally. The session frame below is about the
  // connection; this is about what is on screen, and it must not wait on one.
  tellCompanion({ type: '__mochi_asleep__', asleep })
  if (asleep) {
    // Nothing to reconnect TO. Left standing, the timer fires an hour later and
    // opens a session behind her closed eyes — the exact thing this change is
    // removing.
    nextSession.cancel()
    // She is going to sleep, so the next open IS a wake and she may greet.
    // Nothing is being replaced any more; if she is woken, that is a wake.
    reconnecting = false
    stopIdleSleep()
    tellCompanion({ type: '__mochi_close__' })
    endWhenFlushed()
  } else {
    /*
      A close still waiting to be acknowledged is abandoned, not honoured.

      She can be woken inside the grace period -- by the key, the tray, or a
      click -- and the timer would then end the conversation she is having NOW,
      seconds after it began. The turns it was waiting for either arrived
      already or died with the old session; neither is worth ending a live
      conversation over.
    */
    if (awaitingFlush !== null) {
      clearTimeout(awaitingFlush)
      awaitingFlush = null
    }
    // The same frame the hourly reconnect sends. One open path, not two.
    tellCompanion({ type: '__mochi_reconnect__' })
    armIdleSleep()
  }
  console.log(`[rest] ${asleep ? 'asleep' : 'awake'}`)
  tray?.refresh()
}

/**
 * She rests on her own after a while with nothing said.
 *
 * ## Why a timer rather than letting the hour run out
 *
 * The session expires after an hour and reconnects (§53), so "do nothing" is
 * not the same as "stop" — it is a connection held open indefinitely, renewing
 * itself, on a companion nobody is talking to. The timeout is what makes the
 * idle case end rather than renew.
 *
 * ## What counts as activity
 *
 * A turn filed to the archive, either party's. That is the one signal in this
 * process that means somebody is actually in a conversation with her — the
 * session opening does not, because opening is what this timer is measuring the
 * silence after, and a frame from the service does not, because a reconnect
 * produces plenty of those with nobody in the room.
 *
 * The timer is not armed while she is already resting: `setAsleep` is a no-op
 * for a value that has not changed, so a stray fire would be harmless, but an
 * hourly timer that exists for no reason is a thing somebody has to reason
 * about later.
 */
let idleTimer: NodeJS.Timeout | null = null

function stopIdleSleep(): void {
  if (idleTimer !== null) clearTimeout(idleTimer)
  idleTimer = null
}

function armIdleSleep(): void {
  stopIdleSleep()
  if (resting.asleep) return
  const minutes = readSleepAfterMinutes(app.getPath('userData'))
  // Zero is the opt-out, and it is checked here rather than turned into a very
  // long timer: "never" and "in a thousand hours" are different promises.
  if (minutes === 0) return
  idleTimer = setTimeout(() => {
    idleTimer = null
    console.log(`[rest] ${String(minutes)} minutes with nothing said`)
    setAsleep(true)
  }, minutes * 60_000)
}

/** Somebody said something. Whatever silence was being counted starts again. */
function stirred(): void {
  armIdleSleep()
}

/**
 * Take her off the screen, or bring her back.
 *
 * The session stays up and she keeps listening: this is about the corner of the
 * display, not about her attention. Hiding a window she is not in would be a
 * different feature and a worse one — you would lose her mid-sentence.
 */
function setHidden(hidden: boolean): void {
  if (hidden === resting.hidden) return
  resting = { ...resting, hidden }
  writeResting(app.getPath('userData'), { hidden })
  if (companion === null) return
  if (hidden) companion.hide()
  // `showInactive`, not `show`: bringing her back should not take focus from
  // whatever somebody is typing into. She is furniture appearing, not an app
  // demanding attention.
  else companion.showInactive()
  console.log(`[rest] ${hidden ? 'hidden' : 'shown'}`)
  tray?.refresh()
}

/**
 * Whether the microphone is open right now, as her window last reported it.
 *
 * Held rather than derived: main knows whether she is ASLEEP, which is not the
 * same question — a session that failed to negotiate leaves her awake with no
 * device at all, and a menu bar marking itself in that state would be the same
 * lie the halo used to tell.
 */
let listening = false

function setListening(on: boolean): void {
  if (on === listening) return
  listening = on
  // Only on the transition. The report arrives on every `listen()`, and
  // rewriting the menu bar title with the value it already has is work per
  // frame for an answer that moves when somebody speaks to her or walks away.
  tray?.refresh()
}

/**
 * Which sides the bubble can currently go on, as last reported by the renderer.
 *
 * Held rather than asked for, because the menu is built the moment somebody
 * clicks the icon and the renderer cannot be questioned synchronously. It goes
 * stale only between her being dragged and the next frame, and a stale entry
 * costs nothing: a side that no longer fits is not honoured either way.
 */
let bubbleSides: { available: readonly string[]; using: string } = {
  /*
    ALL of them until her window says otherwise, never one invented.

    This was `['above']`, and it was not a default so much as a fabrication: the
    renderer only reported sides while it was drawing a bubble, so a character
    with the bubble switched off never reported at all — and the tray menu spent
    the whole session offering a single side that nothing had computed, on a
    machine where three of the four fitted.

    A placeholder cannot be right, so the question is which way it should be
    wrong. Too MANY is recoverable: `auto` already declines to honour a side
    that does not fit, and the menu marks what was asked rather than what was
    used, so an extra entry for the frame before the first report costs nothing.
    Too few hides real choices behind an answer that looks considered.
  */
  available: [...BUBBLE_SIDES].filter((one) => one !== 'auto'),
  using: 'above',
}

listenTo('companion:sides', (_event, value: unknown) => {
  if (typeof value !== 'object' || value === null) return
  const said = value as { available?: unknown; using?: unknown }
  if (!Array.isArray(said.available) || typeof said.using !== 'string') return
  bubbleSides = {
    available: said.available.filter((one): one is string => typeof one === 'string'),
    using: said.using,
  }
  // Said out loud on the main side too, because this is the value the tray menu
  // is built from and the renderer's own line explains how it was reached. Two
  // lines rather than one: a list that never arrives looks identical to a list
  // that arrived and was ignored, and only the pair tells them apart.
  console.log(`[bubble] main has ${bubbleSides.available.join(',') || 'none'}`)
  // The menu is rebuilt on demand, but a menu already open is a snapshot — and
  // this is the value it snapshots.
  tray?.refresh()
})

/**
 * What the menu does, shared by the menu bar item and the right-click on her.
 *
 * ONE set, deliberately. Two summonings of the same menu is a feature; two
 * DEFINITIONS of it is how the item you added to one goes missing from the
 * other, and neither is obviously the wrong one when somebody notices.
 */
const menuHandlers = {
  onOpen: () => {
    showHistoryWindow()
  },
  onWear: (id: string) => {
    const written = wearPersona(id)
    // The menu has already drawn the radio as moved. Saying nothing when the
    // write failed would leave it lying about what is on disk.
    if (!written.ok) console.error(`[menu] could not wear ${id}: ${written.why}`)
    tray?.refresh()
  },
  onRest: () => {
    setAsleep(!resting.asleep)
  },
  onHide: () => {
    setHidden(!resting.hidden)
  },
  onBubbleSide: (side: string) => {
    const written = setBubbleSide(side)
    // The menu has already drawn the radio as moved. Saying nothing when the
    // write failed would leave it lying about what is on disk — the same
    // reasoning `onWear` above gives.
    if (!written.ok) console.error(`[menu] could not set the bubble side: ${written.why}`)
  },
  onQuit: () => {
    app.quit()
  },
}

/**
 * Which side the bubble sits on. ONE implementation, because two ask.
 *
 * The tray offers it as an action and the settings window as a control — v1's
 * standing rule, carried over. It answers WHETHER IT LANDED rather than
 * swallowing the failure: the tray only needs to log one, but a settings window
 * reporting success over a write that did not happen is the exact failure that
 * window exists to remove.
 */
/**
 * Put her words on a side, on HER file rather than on the machine's.
 *
 * Still one writer, which is what makes two entry points safe — the tray menu
 * and her sheet both arrive here. What changed is where it lands: this used to
 * write `bubbleSide` into `preferences.json`, which meant the setting followed
 * the desk rather than the character, and left half a feature on a different
 * tab from the switch that turns it on.
 *
 * `applyChange` does the validating, exactly as it does when the same field is
 * edited on her sheet. A second grammar for one field is how the two come to
 * disagree about what a side is.
 */

function setBubbleSide(side: string): SettingsWrite {
  const userData = app.getPath('userData')
  const catalog = catalogue(userData)
  const worn = activePersona(catalog, readWornPersonaId(userData)).persona
  const changed = applyChange(worn, { id: worn.id, bubbleSide: side }, [])
  if (!changed.ok) return refuse(changed.why)
  try {
    savePersonaTo(userData, catalog, changed.persona)
  } catch (error: unknown) {
    problems.note('persona', worn.id, `the bubble side could not be saved: ${String(error)}`)
    return refuse(String(error))
  }
  // Straight to the renderer as well as to disk: the file is read on the next
  // session, and somebody who picked a side wants to see it move now.
  //
  // GUARDED, and separately from the write. `webContents.send` throws on a
  // destroyed window, and outside the guard that throw came out of the settings
  // handler as a rejected invoke — reporting a failure for a setting that was
  // saved. It IS saved; she simply moves her words on the next session.
  try {
    if (companion !== null && !companion.isDestroyed()) {
      companion.webContents.send('voice:send', { type: '__mochi_bubble_side__', side })
    }
  } catch (error: unknown) {
    console.error('[settings] the bubble side was saved but she was not told:', error)
  }
  tray?.refresh()
  return { ok: true }
}

/**
 * Right-clicking her pops the same menu the menu bar item does.
 *
 * A real `NSMenu` through `Menu.popup`, not a drawing on her canvas: the system
 * gives keyboard navigation, the correct appearance in both themes, the ⌘Q
 * glyph, and dismissal behaviour nobody has to reimplement. Her canvas can draw
 * a speech bubble; it has no business drawing a menu.
 *
 * The renderer only asks when the pointer is on her painted pixels, which is
 * also the only time the window is accepting the mouse at all — so a right
 * click on the empty part of her window still reaches the desktop behind, and
 * this needs no hit region of its own.
 */
/**
 * She was grabbed. Main moves her from here — see `drag.ts` for why the cursor
 * is polled rather than followed through the renderer.
 *
 * The grip is normalised against the window's real bounds rather than trusted:
 * it arrives from a page, and it is SUBTRACTED from the cursor, so an offset of
 * four thousand would put her origin four thousand pixels left of the pointer
 * on the very first tick.
 */
/**
 * Where she is inside her window. Believed only as far as it is checked.
 *
 * It comes from a page and it decides the drag clamp, so a nonsense box would
 * let her be dragged off the display and never come back. The fallback is the
 * nominal body the window was first placed against — wrong for a resized
 * avatar, and wrong in the direction that keeps her reachable.
 */
let herBody = NOMINAL_BODY
/** The last size logged, so the line above is one per change rather than per frame. */
let fitted = { width: 0, height: 0 }

/**
 * How far into her window she is standing.
 *
 * Normally `FEET_FROM_TOP`. It shrinks when she is dragged against the top of
 * the display, because macOS will not lift the window any further and she rises
 * inside it instead — see `dragTo`. Held here because main is what moves her.
 */
let herFeet: number = FEET_FROM_TOP

/**
 * Both of these arrive from the renderer, so both are untrusted numbers.
 *
 * Finite and non-negative, because every one of them becomes a window
 * coordinate: `NaN` reaches `setBounds` as a silent no-op and a negative pad
 * would place her outside her own window with nothing to say so.
 */
function readSides(
  value: unknown,
  keys: readonly string[],
  /**
   * Sizes and insets cannot be negative; SCREEN COORDINATES can — a second
   * display left of the primary one has negative x, and refusing those would
   * silently drop every fit over there.
   */
  allowNegative = false,
): Record<string, number> | null {
  if (typeof value !== 'object' || value === null) return null
  const found = value as Record<string, unknown>
  const out: Record<string, number> = {}
  for (const key of keys) {
    const one = found[key]
    if (typeof one !== 'number' || !Number.isFinite(one)) return null
    if (!allowNegative && one < 0) return null
    out[key] = one
  }
  return out
}

function readBody(
  value: unknown,
): { left: number; top: number; width: number; height: number } | null {
  const read = readSides(value, ['left', 'top', 'width', 'height'])
  // A zero-sized body would make the clamp meaningless in both directions.
  if (read === null || (read['width'] ?? 0) <= 0 || (read['height'] ?? 0) <= 0) return null
  return {
    left: read['left'] ?? 0,
    top: read['top'] ?? 0,
    width: read['width'] ?? 0,
    height: read['height'] ?? 0,
  }
}

function readPad(value: unknown): Pad | null {
  const read = readSides(value, ['left', 'top', 'right', 'bottom'])
  if (read === null) return null
  return {
    left: read['left'] ?? 0,
    top: read['top'] ?? 0,
    right: read['right'] ?? 0,
    bottom: read['bottom'] ?? 0,
  }
}

listenTo('companion:body', (_event, value: unknown) => {
  const body = readBody(value)
  if (body === null) return
  herBody = body
})

/**
 * Resize her window to fit what the renderer is about to draw, WITHOUT moving her.
 *
 * A window grows from its origin, so resizing naively would slide her across the
 * desktop every time she started speaking. `originHolding` puts the new origin
 * where her body lands on the same screen pixels it was already on — which is
 * the whole reason the renderer sends its new body in the same message: main
 * needs the OLD one to know where she is now and the NEW one to know where she
 * will be inside the resized window, and reading them from two messages would
 * mean a frame where it had one of each.
 */
/**
 * Show her, once, at the size she is going to be.
 *
 * ## Why not `ready-to-show`, which is where this used to live
 *
 * macOS clamps a window onto the display the first time it is shown. Her window
 * is 980x560 with her body 443px in from its left edge, so putting her in a
 * corner requires it to hang off two edges — and the first `show()` dragged it
 * back by exactly the overhang, 377 left and 178 up. Measured against this
 * configuration; `window.ts` carries the trace.
 *
 * Once she is visible the clamp stops applying, so the window can grow over the
 * display edge again for a bubble. It is only the FIRST show that has to happen
 * at a size that fits.
 *
 * ## And not while she is hidden
 *
 * `resting.hidden` is a state somebody chose, and it survives a relaunch. This
 * used to be unconditional, so quitting while she was hidden and relaunching put
 * her back on screen — a preference undone by the one act that should preserve
 * it.
 */
let shown = false

function showHerOnce(why: string): void {
  if (shown) return
  if (companion === null || companion.isDestroyed()) return
  shown = true
  if (resting.hidden) {
    console.log('[window] she was left hidden; not showing her')
    return
  }
  // `showInactive`, so a launch does not steal focus from whatever somebody is
  // typing into. She is furniture appearing, not an app demanding attention.
  companion.showInactive()
  const at = companion.getBounds()
  console.log(`[window] shown on ${why}: ${at.width}x${at.height} at ${at.x},${at.y}`)
}

/**
 * The backstop, because a renderer that never fits must not leave her invisible.
 *
 * The fit is the ONLY thing that shows her now, so a renderer that fails to boot
 * — a bundle that did not build, a throw before the first frame — would be an
 * app running with nothing on screen and no way to tell it from one that
 * launched fine. Generous rather than tight: the ordinary path shows her the
 * moment the first fit lands, a few hundred milliseconds in, so nothing waits
 * for this timer unless something is already wrong.
 */
const SHOW_ANYWAY_MS = 4000

listenTo('companion:fit', (_event, value: unknown) => {
  if (companion === null || companion.isDestroyed()) return
  const request = value as { pad?: unknown; body?: unknown; was?: unknown } | null
  if (typeof request !== 'object' || request === null) return
  const pad = readPad(request.pad)
  const body = readBody(request.body)
  if (pad === null || body === null) return

  /*
    Where she is, from the half each process actually holds.

    This added the last offset main had been TOLD to the window's current bounds
    — two facts from different messages, and `companion:body` writes that offset
    too, so an offset computed against one window size could be paired with
    another. Measured putting her 443px from a corner she had been 4px from.

    The answer was to have the renderer send her screen position, both halves
    read in one of its frames. The offset half was sound; the position half was
    `window.screenX`, which is a cached rect Chromium does not reliably refresh
    for a frameless transparent window moved by `setPosition` — it reported `0`
    for a window sitting at 1957,1058, shown, on screen. So the fit moved her to
    443,267 on every launch and she never came back to where she was left.

    Now the renderer sends only the offset, which is the layout it is drawing and
    cannot be wrong about, and `getBounds()` is read HERE, in the same handler.
    One moment, two facts, and neither process is guessing at the other's.
  */
  const was = readSides(request.was, ['left', 'top'], true)
  if (was === null) return
  /*
    The renderer's reading, unless it CANNOT have one yet.

    `at` is `window.screenX + herOffset`, read in one renderer frame. A window
    that has never been shown has no screen position to report: Chromium answers
    `screenX = 0`, honestly, because the widget has not been placed. Main had
    already moved the window by then — `setPosition` works on a hidden window —
    so the renderer's `0` and main's real origin described different windows,
    and main believed the renderer.

    That is how she stopped coming back to where she was left. Dropped at
    2400,1325 and stored correctly, restored correctly to a window origin of
    1957,1058, and then moved to 443,267 by the first fit — `fullPad`'s own
    offsets from an origin of zero, which is exactly what an unshown window
    reports. The position was never lost; it was overwritten a second later by
    something that had no business being sure.

    `isVisible()` is the condition, and it is not a threshold. There is no
    "close enough" here: either the renderer has a screen position or it does
    not, and main knows which because main is what shows the window.
  */
  const herOnScreen = herPositionFrom(companion.getBounds(), {
    left: was['left'] ?? 0,
    top: was['top'] ?? 0,
  })
  const size = windowFitting(body, pad)
  const origin = originHolding(herOnScreen, pad)
  herBody = body
  companion.setBounds({ x: origin.x, y: origin.y, width: size.width, height: size.height })
  showHerOnce('the first fit')
  /*
    A fit must never MOVE her, and this says so out loud rather than trusting it.

    Resizing her window is only acceptable because she stays put; a version of
    this that silently moved her shipped, and the symptom — she is not near the
    corner any more — reads as a layout opinion rather than as a defect. One
    subtraction, once per fit, and it names the thing that went wrong.
  */
  const landed = { x: origin.x + body.left, y: origin.y + body.top }
  const moved = Math.max(Math.abs(landed.x - herOnScreen.x), Math.abs(landed.y - herOnScreen.y))
  if (moved > 1) {
    console.log(
      `[window] FIT MOVED HER by ${moved.toFixed(1)}px — was ${herOnScreen.x},${herOnScreen.y}, ` +
        `landed ${landed.x},${landed.y}; pad ${pad.left},${pad.top} body ${body.left},${body.top}`,
    )
  }
  // Logged once per SIZE, not per request: the renderer asks on any frame the
  // answer changes, and a line per frame would bury everything else. Same
  // measurements as the creation line above, so the two can be read together.
  if (size.width !== fitted.width || size.height !== fitted.height) {
    fitted = size
    const work = screen.getPrimaryDisplay().workArea
    console.log(
      `[window] fitted to ${size.width}x${size.height} at ${origin.x},${origin.y}; ` +
        `her right edge ${work.x + work.width - (origin.x + body.left + body.width)}px ` +
        `and her feet ${work.y + work.height - (origin.y + body.top + body.height)}px from the corner`,
    )
  }
})

listenTo('companion:grab', (_event, value: unknown) => {
  if (companion === null) return
  const grip = parseGrip(value, companion.getBounds())
  if (grip === null) return
  startDrag(
    grip,
    () => companion,
    () => herBody,
    (feet) => {
      if (feet === herFeet) return
      herFeet = feet
      // Straight through on the frame it changes. She is being dragged, so a
      // stance that arrived a frame late would show as her jumping.
      companion?.webContents.send('voice:send', { type: '__mochi_stance__', feetFromTop: feet })
    },
    /*
      Where her feet ARE, not where they were when the window was a fixed size.

      This passed `FEET_FROM_TOP` — 340 — which was her stance in a 980x560
      window and is nonsense in one that fits her: she stands 99px into a 140px
      window, so every drag put the origin 241px too high and she appeared that
      far up and away from the corner she was being dragged into.

      Derived from `herBody`, so it is right in BOTH windows without a branch:
      267 + 73.32 is 340 while a bubble is up and the window is the big one, and
      26 + 73.32 is 99 while it is not.
    */
    herBody.top + herBody.height,
  )
})

listenTo('companion:drop', () => {
  stopDrag()
  /**
   * Where she was left, written down.
   *
   * On the DROP rather than on every tick: the drag repositions the window
   * sixty times a second, and a write per frame is sixty file writes a second
   * for an answer only the last of which is wanted.
   *
   * HER body on screen, not the window's origin. Her window is resized on every
   * bubble and `originHolding` exists so those resizes do not move her — so the
   * window's origin means a different thing depending on whether she happened
   * to be speaking, and her body's corner is the fact that stays still. Her
   * size travels with it because turning it back into an origin needs the pad
   * above her, which is `FEET_FROM_TOP` minus her height.
   */
  if (companion === null || companion.isDestroyed()) return
  const bounds = companion.getBounds()
  try {
    writeHerPlace(app.getPath('userData'), {
      x: Math.round(bounds.x + herBody.left),
      y: Math.round(bounds.y + herBody.top),
      width: Math.round(herBody.width),
      height: Math.round(herBody.height),
    })
  } catch (error: unknown) {
    // Not fatal — she is where somebody put her for this run — but silence
    // would present as "dragging her does not stick", with nothing to look at.
    console.error('[window] could not remember where she was left:', error)
  }
})

listenTo('companion:wake', () => {
  setAsleep(false)
})

listenTo('companion:menu', () => {
  if (companion === null) return
  Menu.buildFromTemplate(trayMenuTemplate(menuModel(), menuHandlers, app.getName())).popup({
    window: companion,
  })
})

const ledger = createLedger({
  registry,
  now: () => Date.now(),
  /**
   * The durable half of "last used", which the autonomy panel draws.
   *
   * `app.getPath('userData')` rather than a captured value, for the reason
   * every dependency in `capabilityDeps` is a function: this module is
   * evaluated before the app is ready.
   *
   * A call the grant WITHHOLDS is not a use, and this is the line that decides
   * it. The ledger records arrivals — a lookup that failed after twenty seconds
   * is still a use, which is why it does not wait for the answer — but a call
   * refused because somebody switched the capability off never ran at all, and
   * a panel saying "last used two minutes ago" beside a switch that has been
   * off for a week is exactly the claim 5b's acceptance forbids. Reachable
   * whenever she holds a tool list from before the switch moved.
   */
  used: (name, at) => {
    const userData = app.getPath('userData')
    /*
      The LIVE persona, not whoever is worn now.

      The two diverge on purpose after a shelf switch — the comment above says
      so — and authorising against `wornId()` meant a session belonging to the
      old character was checked against the new character's permissions. No
      live persona is no authority at all, so it fails closed.
    */
    const live = sessionPersona
    if (live === null) return
    if (!allowsCapability(readGrants(userData, live, legacyGrants(userData)), name)) return
    try {
      noteUsed(userData, name, at)
    } catch (error: unknown) {
      // Where somebody can read it. The ledger guards this call so a failed
      // bookkeeping write can never cost the answer — but a failure that only
      // reached the console would leave the panel saying "Never used" about a
      // capability she had just run, with nothing anywhere to explain it.
      console.error(`[usage] could not record that ${name} was used:`, error)
      problems.note('capability', name, `its use could not be recorded: ${String(error)}`)
    }
  },
  // `isDestroyed` as well as null. A window that has been closed is still a
  // non-null `BrowserWindow`, and `send` on its `webContents` throws — which
  // used to come back out of the `voice:call` listener. Nothing is lost by
  // skipping it: there is no conversation left on the other side.
  send: (frame: AnswerFrame) => {
    if (companion === null || companion.isDestroyed()) return
    companion.webContents.send('voice:send', frame)
  },
  /**
   * Something is still running, so the bead keeps travelling her halo.
   *
   * A COUNT crossing rather than a boolean, and the renderer reduces it: two
   * lookups in flight is one indicator, and the frame that settles the first of
   * them must not turn it off. Sending the number is what makes that the
   * receiver's arithmetic instead of this side's memory of what it last sent.
   */
  working: (outstanding: number) => {
    tellCompanion({ type: '__mochi_working__', outstanding })
  },
})

/**
 * Keep the shoulder badge true after the door has closed.
 *
 * `session.problems` answers the count once, when the config is asked for. Half
 * of these happen later — a capability that threw mid-conversation, a reconnect
 * that could not be scheduled — and those are exactly the ones that present as
 * her quietly declining to do something.
 *
 * A private frame on `voice:send`, following `__mochi_reconnect__`: the channel
 * already crosses in this direction, and a channel per lifecycle event is the
 * shape v1's 45 message kinds grew out of.
 */
problems.watch((count) => {
  /**
   * GUARDED, because this is what reporting a failure runs through.
   *
   * `webContents.send` throws on a destroyed window, and `?.` checks null and
   * nothing else. Every `problems.note` in this file is inside a `catch` that
   * is trying to report something else going wrong — so a throw from here came
   * out of that catch and took the handler with it, and an IPC handler that
   * returns nothing is a settings window told nothing at all. `dispatch.ts`
   * makes the same argument about its observers, in the same words.
   */
  try {
    if (companion === null || companion.isDestroyed()) return
    companion.webContents.send('voice:send', { type: '__mochi_problems__', count })
  } catch (error: unknown) {
    console.error('[problems] the count could not be sent:', error)
  }
})

/**
 * The archive, opened once and lazily.
 *
 * Lazily because `app.getPath('userData')` is not answerable before the app is
 * ready, and once because `node:sqlite` is a file handle — a second connection
 * to the same database is a second writer, and this one is the only writer.
 */
let archive: Transcripts | null = null

/** Whether the archive has been put down for good. See `shutDownCleanly`. */
let shutDown = false
let talk: Conversation | null = null

function conversation(): Conversation {
  if (talk === null) {
    const userData = app.getPath('userData')
    // Through `transcripts()`, not its own `archive ??=`. Two places opening
    // the archive is two places that have to remember it must not be opened
    // during a quit -- and the second one would not have.
    talk = createConversation({
      transcripts: transcripts(),
      // Read per turn, inside the module. Turning saving off has to take effect
      // on the next thing said, not on the next wake.
      keeps: (personaId) => keepsFor(userData, personaId, carriedPolicies),
      log: (text) => console.log(`[archive] ${text}`),
    })
  }
  return talk
}

/**
 * Who the LIVE SESSION is, set when it configures itself.
 *
 * Deliberately NOT the same question as "who is worn", and the difference is
 * load-bearing now that the shelf can switch character mid-conversation. A
 * capability writes to whoever is actually speaking: `remember_this` filing a
 * note under a character the session was never configured as would put it in a
 * stranger's memory, and the note would be in the wrong place for ever.
 *
 * The archive reads use `wornId()` instead — see there.
 */
let sessionPersona: string | null = null

/**
 * How the worn character looks, resolved from her avatar file.
 *
 * ONE reader, because three surfaces ask: her own window, the shelf, and the
 * settings window — and the last two only want it to take her colour from. Two
 * derivations of "what does she look like" would be two accents.
 */
/**
 * Which words the worn character takes.
 *
 * Its own read rather than a field threaded through `wornFace`, because the two
 * callers want different things and neither wants both: the shelf already has
 * the persona in hand, settings has only a path.
 */
function wornPronoun(userData: string): Pronoun {
  const catalog = catalogue(userData)
  return activePersona(catalog, readWornPersonaId(userData)).persona.pronoun
}

function wornFace(userData: string): FaceSpec {
  const catalog = catalogue(userData)
  const worn = activePersona(catalog, readWornPersonaId(userData)).persona
  return resolveFaceFor(
    avatarsRoot(userData),
    packageFolder(worn.id, catalog.sources),
    worn.avatarId,
    worn.theme,
    worn.size,
  ).face
}

/**
 * Who is WORN, read from disk every time.
 *
 * Not `sessionPersona`, and not held. The shelf can change who is worn while a
 * session is up, and its conversations pane has to follow on the same click —
 * a list scoped to whoever the last session configured itself as would show one
 * character's card selected beside another character's conversations.
 *
 * Always answers somebody: `activePersona` falls back to the built-in, so the
 * archive is readable before she has ever spoken. That is what lets the window
 * be opened on a fresh install without an empty pane that means nothing.
 */
function wornId(): string {
  const userData = app.getPath('userData')
  const catalog = catalogue(userData)
  return activePersona(catalog, readWornPersonaId(userData)).persona.id
}

/**
 * The archive, opened if it is not already.
 *
 * `conversation()` opens it as a side effect of starting a conversation, which
 * is fine while the only reader is a live session. The conversations window can
 * be opened before she has ever spoken, so it needs a way in that does not
 * begin one.
 */
function transcripts(): Transcripts {
  /*
    Never AFTER the shutdown coordinator has run.

    `shutDownCleanly` closes the archive and drops the handle, and `??=` would
    quietly build a new one -- opening the database, registering its path, and
    starting a fresh write-ahead log during a quit that is already underway.
    The handle would then never be closed, because the coordinator only runs
    once, so the last thing the app did before exiting would be to leave an
    unflushed log behind. The failure it is meant to prevent, caused by it.

    Loud rather than silent: nothing should want the archive at this point, so
    something asking is a bug worth seeing rather than serving.
  */
  if (shutDown) throw new Error('the archive is closed; the app is quitting')
  const userData = app.getPath('userData')
  archive ??= createTranscripts(userData)
  return archive
}

/**
 * Which Codex profile a lookup layers right now.
 *
 * ONE implementation, because two things ask: the capability that runs the
 * lookup, and the window that shows what it will do. A window that computed
 * this differently would be showing somebody a setting that is not the one in
 * force, which is worse than showing nothing.
 */
function currentProfile(): string | null {
  return profileFor(
    codexHome(process.env, app.getPath('home')),
    readProfile(app.getPath('userData')),
    (path) => existsSync(path),
  )
}

/**
 * Everything a capability may ask main for.
 *
 * FUNCTIONS, not values, and every one of them: the store opens lazily, the
 * persona changes on every session and the workspace is a setting somebody can
 * edit while she is running — so a handler asking at call time gets the current
 * answer rather than whatever was true when this file was evaluated.
 *
 * This object is also the reason nothing under `src/capabilities/` imports this
 * file. A capability reaching back into main is how a bundle ends up with a
 * module that is undefined at load.
 */
/**
 * The prompt catalogue as it currently stands, defaults plus your overrides.
 *
 * A function rather than a value: the file is hand-editable and every other
 * reader in this process re-reads on use for that reason. An unreadable file
 * falls back to the defaults and SAYS so — running the shipped wording over
 * somebody's edited prompts silently is the app disagreeing with the screen
 * that shows them.
 */
/**
 * The overrides on disk, or none when the file cannot be read.
 *
 * `promptsNow` has already reported the failure; this is the same fallback in
 * the same state, so the pane shows what she is actually being sent rather than
 * what the unreadable file was supposed to say.
 */
function overridesOrDefaults(userData: string): Readonly<Record<string, string>> {
  const read = readPromptOverrides(userData)
  return read.ok ? read.overrides : {}
}

function promptsNow(): Prompts {
  const read = readPromptOverrides(app.getPath('userData'))
  if (!read.ok) {
    console.error(`[prompts] ${read.why}; running on the defaults`)
    problems.note('prompts', null, `your edited prompts could not be read (${read.why})`)
    return resolvePrompts(promptsFor(CAPABILITIES.manifests), {})
  }
  return resolvePrompts(promptsFor(CAPABILITIES.manifests), read.overrides)
}

const capabilityDeps: CapabilityDeps = {
  /*
    Read at CALL time, not captured at session open.

    Every other reader in this file follows the same rule — `webSearch`,
    `workspace`, `codexPath` are all thunks — and it is what makes an edit land
    on the next lookup rather than on the next wake.
  */
  prompt: (key) => promptsNow()(key),
  userData: () => app.getPath('userData'),
  wearing: () => sessionPersona,
  /**
   * Which faces the character SHE IS SPEAKING AS uses — not the worn one.
   *
   * `moods.test.ts` calls this a join: the wire enum is built by `narrowFaces`
   * from a persona's `faces`, and the handler checks this. Two answers to
   * "which faces", and they have to be the same answer.
   *
   * They were not. The enum goes out at `voice:config`, built for the character
   * the session is configured as; this read `wornId()` from disk. The shelf can
   * change who is worn while a session is up, and after that she was OFFERED a
   * face from her own enum and REFUSED it by the handler — which reads to her
   * as the tool being broken, and to a log as her calling it wrong. The same
   * divergence `grant-outcome.ts` describes, one process further in.
   *
   * `sessionPersona` is what the enum was built from, so `sessionPersona` is
   * what validates it. Falls back to worn when no session is up, which is the
   * case the tests exercise and the only one where the two cannot disagree.
   *
   * Still read from disk per call: a persona's faces can be edited inside one
   * session, and `set_expression` is called a handful of times at most.
   */
  facesSheMayWear: () => {
    const userData = app.getPath('userData')
    const catalog = catalogue(userData)
    return activePersona(catalog, sessionPersona ?? readWornPersonaId(userData)).persona.faces
  },
  /**
   * The one dep that reaches the renderer, and it carries a single value.
   *
   * False when there is no window to draw in — she is between sessions, or the
   * window has gone — so the handler can say her face could not be changed
   * rather than reporting a face nobody can see. A general frame-sender here
   * would let any capability push anything into her window; this is the whole
   * hole, and it is one enum wide.
   */
  wearExpression: (face) => {
    if (companion === null || companion.isDestroyed()) return false
    companion.webContents.send('voice:send', { type: '__mochi_face__', face })
    return true
  },
  transcripts: () => archive,
  /**
   * Read per call rather than held, because the shelf is files on disk and
   * somebody may add a persona while this is running. `remember_this` is called
   * a handful of times in a conversation at most, so the read is not on any
   * path that matters.
   *
   * The WORN one is removed: `entryProblem` refuses a note naming another
   * character's storage, and including her own id refused ordinary sentences
   * about her own name.
   */
  otherPersonaIds: () => {
    const userData = app.getPath('userData')
    const catalog = catalogue(userData)
    const ids = new Set(catalog.personas.keys())
    if (sessionPersona !== null) ids.delete(sessionPersona)
    return ids
  },
  codexPath: codexPathNow,
  workspace: () => readWorkspace(app.getPath('userData')),
  guardStopAt: () => {
    const userData = app.getPath('userData')
    return guardStopAt(userData, readWorkspace(userData))
  },
  webSearch: () => readWebSearch(app.getPath('userData')),
  codexProfile: currentProfile,
  now: () => Date.now(),
}

/**
 * Which minted credential a given `voice:sdp` may use.
 *
 * A slot with IDENTITY rather than a bare binding. This was `let minted` and
 * `voice:sdp` read whatever was in it, so a second open landing mid-handshake
 * handed its credential to the first renderer. See `voice/mint-slot.ts`.
 */
const mint = createMintSlot()

/**
 * When she opens her next session — and the guarantee that she opens one.
 *
 * This was a bare `reconnectTimer` armed in exactly one place: the `expiry`
 * report, which rides `session.created`. A session dying before its first
 * frame therefore scheduled nothing at all, silently. See
 * `voice/next-session.ts`.
 */
/**
 * Whether the NEXT session to be configured is replacing one rather than
 * starting one.
 *
 * One-shot: set when the reconnect fires, and cleared by the `voice:config`
 * that reads it. A flag left set until she slept would also silence the
 * greeting of a character somebody wore AFTER a reconnect — a new character
 * saying nothing because an unrelated session was replaced an hour earlier.
 * Scoped to the single open it describes, every other open greets normally
 * without having to be enumerated here.
 */
let reconnecting = false

const nextSession = createNextSession({
  reconnect: () => {
    reconnecting = true
    tellCompanion({ type: '__mochi_reconnect__' })
  },
  awake: () => !resting.asleep,
  note: (why) => {
    console.error(`[voice] ${why}`)
    problems.note('voice', null, why)
  },
})

ipcMain.handle('voice:open', async () => {
  const bearer = readBearer()
  if (!bearer.ok) {
    const why = describeProblem(bearer.problem)
    console.error(`[voice] ${why}`)
    return { ok: false, why }
  }
  const result = await mintEphemeralKey({ bearer: bearer.value })
  if (!result.ok) {
    const why = describeProblem(result.problem)
    console.error(`[voice] ${why}`)
    return { ok: false, why }
  }
  /*
    Armed BEFORE the session has produced a single frame.

    This is the whole of C3. `expires_at` rides `session.created`, so every
    way a session can die during the handshake -- ICE, the data channel, the
    network going away -- used to leave no timer at all and nothing in the log,
    because nothing had happened. A floor set here is replaced by the precise
    schedule the moment a deadline actually arrives.
  */
  nextSession.opened()
  /*
    The ledger is told too, and it is NOT reset.

    A deferred call is a promise to come back, and `ask_workspace` has three
    minutes to keep it -- long enough for the hourly reconnect to replace the
    session underneath it. `call_id` is scoped to a session, so an answer
    delivered into the new one addresses a call it never issued.

    The records stay, so `undelivered()` still names what she promised and did
    not return with. Clearing them would make the ledger report a clean sheet
    for a broken promise.
  */
  ledger.opened()
  const session = mint.hold(result.value)
  console.log(`[voice] minted for ${result.value.model}`)
  // The KEY does not go back. The renderer gets the token identifying this
  // negotiation and nothing else; `voice:sdp` is where the key is used, in
  // main. The token is not a secret -- it is an identity, and it is what stops
  // a superseded renderer using a credential that is not its own.
  return { ok: true, session, model: result.value.model }
})

ipcMain.handle('voice:sdp', async (_event, offer: unknown, session: unknown) => {
  if (typeof offer !== 'string' || offer.length === 0) return { ok: false, why: 'no offer' }
  const claimed = mint.claim(session)
  if (!claimed.ok) {
    // Loud, because the superseded case is invisible from the renderer: its
    // negotiation simply stops working and the reason is in another process.
    console.error(`[voice] sdp refused: ${claimed.why}`)
    return { ok: false, why: claimed.why }
  }
  const answered = await exchangeSdp({ offer, minted: claimed.value })
  if (!answered.ok) {
    const why = describeProblem(answered.problem)
    console.error(`[voice] ${why}`)
    return { ok: false, why }
  }
  return { ok: true, answer: answered.value }
})

/**
 * Who she is, what she sounds like, what she may call.
 *
 * Read fresh on every session rather than cached at startup. A session is
 * opened on every wake and again on every reconnect (§53), so this is the
 * natural moment to pick up a persona edit or a changed note — and a cache here
 * would mean her character updated only on restart.
 *
 * `instructionsFor` takes the note as a REQUIRED argument. An omitted one is
 * amnesia about the person, which is the failure this project is least able to
 * notice, so it is not defaulted and not skipped.
 */
ipcMain.handle('voice:config', () => {
  // CONSUMED here, whatever else this read goes on to decide. See
  // `reconnecting`: the flag describes exactly one open.
  const replacing = reconnecting
  reconnecting = false
  const userData = app.getPath('userData')
  // Whether this installation has run before decides whether a one-time
  // retention migration may run at all — a permissive default there would let a
  // hand-placed package choose somebody's retention on a first launch.
  const catalog = catalogue(userData)
  for (const problem of catalog.problems) {
    console.error(`[persona] ${problem.kind}`)
    problems.note('persona', null, problem.kind)
  }
  // Which persona was last worn, remembered across restarts. Getting this wrong
  // is not cosmetic: the archive is scoped per persona, so defaulting to the
  // built-in on an installation whose history is under another name shows her
  // an empty memory and presents as "recall does not work".
  const resolved = activePersona(catalog, readWornPersonaId(userData))
  if (resolved.problem !== null) {
    console.error(`[persona] ${resolved.problem.kind}`)
    problems.note('persona', resolved.persona.id, resolved.problem.kind)
  }

  // A new session is a new conversation. Ending the previous one here rather
  // than on teardown covers the reconnect path too, which is the common case:
  // §53 measured a session lasting exactly an hour, so this happens hourly.
  // A new session is a new conversation. Doing it here rather than on teardown
  // covers the reconnect path too, which is the common case: §53 measured a
  // session lasting exactly an hour, so this happens hourly.
  conversation().wear(resolved.persona.id)
  sessionPersona = resolved.persona.id

  /**
   * Her face, from the folder the user can actually edit.
   *
   * `store/avatars.ts` and `parseFaceSpec` have existed and been tested since
   * before this session; nothing had ever called them, so every mochi rendered
   * from the built-in constant and "user-authored appearance" was a directory
   * with no reader. `seedAvatars` writes the folder, an example and a README on
   * first run, because a plugin format nobody can see the shape of is not one.
   */
  const avatars = avatarsRoot(userData)
  seedAvatars(avatars)
  const avatar = resolveFaceFor(
    avatars,
    packageFolder(resolved.persona.id, catalog.sources),
    resolved.persona.avatarId,
    resolved.persona.theme,
    resolved.persona.size,
  )
  // LOUD, and per file. An avatar that silently did not load presents as "the
  // app ignored my file", which the store's own comment calls the least
  // debuggable outcome this feature can have.
  for (const problem of avatar.problems) {
    console.error(`[avatar] ${problem.file}: ${problem.reason}`)
    problems.note('avatar', problem.file, problem.reason)
  }
  console.log(`[avatar] ${avatar.source ?? 'built-in'}`)

  const note = recall(userData, resolved.persona.id)
  /**
   * What she may do — and whether that answer could be read at all.
   *
   * An unreadable `preferences.json` withholds everything, which is the right
   * direction for a permission and the wrong thing to do in silence: she would
   * simply stop hearing, and nothing on screen would say why. This is the one
   * place with a `problems` sink to hand, and it runs on every wake.
   */
  /*
    HER file, not the one global setting.

    This read was left on `readGrantsState` when permissions became per
    character, so the session she actually runs with carried whatever the old
    global blob said — a character whose `speak_first` had been withheld would
    still greet, and the tools offered reflected the wrong policy entirely. The
    per-character reader withholds on its own when a file cannot be read, so
    the fail-closed direction is the same; what changes is whose answer it is.
  */
  const grants = readGrants(userData, resolved.persona.id, legacyGrants(userData))
  if (grants === WITHHELD_GRANTS) {
    console.error(`[grants] ${resolved.persona.id}'s permissions could not be read; withholding`)
    problems.note(
      'settings',
      null,
      'her permissions file could not be read, so every permission is withheld until it can be ' +
        '— she cannot greet you, look anything up, or keep a note',
    )
  }
  const mayDo = whatSheMayDo(
    resolved.persona,
    note,
    grants,
    registry.tools,
    readPrompt(userData),
    transcripts()?.kept.collections(resolved.persona.id) ?? [],
  )
  console.log(
    `[persona] ${resolved.persona.name} (${resolved.persona.id}), voice ${resolved.persona.voice}, note ${note.length} chars, bubble ${resolved.persona.bubble ? 'on' : 'off'}`,
  )
  const off = GRANT_SPECS.filter((spec) => !grants[spec.id]).map((spec) => spec.id)
  console.log(`[grants] withheld: ${off.length === 0 ? 'none' : off.join(', ')}`)
  return {
    instructions: mayDo.instructions,
    voice: resolved.persona.voice,
    bubble: resolved.persona.bubble,
    /*
      Null rather than an empty instruction: the renderer must not ask for the
      turn at all, and "say nothing on waking" is a decision made here.

      TWO reasons for that null now, and they are not the same reason. The grant
      is a permission somebody withheld; rest is a state she is in. Only the
      first was consulted, so a session opened while she was resting greeted the
      room out loud — with her eyes shut, because `blink: 1` is held for the
      whole of `asleep`. That is reachable on every hourly reconnect (§53), and
      the fix belongs here rather than in the renderer: whether she may speak
      first is a decision, and decisions are main's.

      `setAsleep` now closes the session outright, so this is nearly unreachable
      — and it stays, because "nearly" is not a guarantee and because the two
      conditions are genuinely independent.
    */
    /*
      A GREETING IS FOR A WAKE, and a reconnect is not one.

      The renderer's `greeted` flag is per SESSION, and the hourly reconnect
      (§53) opens a new one -- so she greeted again, every hour, somebody she
      had been mid-conversation with all along. The renderer cannot tell the
      two apart: from inside a session an open is an open. Main can, because
      main is what sends `__mochi_reconnect__`.

      Decided here for the reason `heard.ts` gives for everything else on this
      boundary: whether she speaks first is a decision, and decisions are
      main's.
    */
    greeting:
      grants.speak_first && !resting.asleep && !replacing ? greetingFor(resolved.persona) : null,
    face: avatar.face,
    problems: problems.count(),
    bubbleSide: resolved.persona.bubbleSide,
    asleep: resting.asleep,
    tools: mayDo.tools,
    /*
      Read here, on the same pass as everything else, because it is read from
      the same file at the same moment — the argument `bubbleSide` and `asleep`
      already make. An empty list means send no hint and let the model detect;
      see `readTranscriptionLanguages`.
    */
    transcription: {
      model: TRANSCRIPTION_MODEL,
      languages: readTranscriptionLanguages(userData),
    },
  }
})

/**
 * She called something.
 *
 * The listener is the boundary check and nothing else; `handleCall` decides
 * what runs and guarantees a frame on every path. That guarantee lives in its
 * own module because it is the one an inline listener cannot be tested for —
 * see the note there, and `ledger.ts` on why a dropped call is the failure
 * that passes every at-most-once test ever written.
 */
listenTo('voice:call', (_event, name: unknown, callId: unknown, args: unknown) => {
  if (typeof name !== 'string' || typeof callId !== 'string') return
  handleCall(
    {
      capabilities: CAPABILITIES.byName,
      deps: capabilityDeps,
      ledger,
      /*
        A late answer landed, so ask her to say it.

        Main decides THAT she should; the renderer decides WHEN, because "is she
        making sound right now" is a fact about the audio it holds. A private
        frame rather than a `response.create` from here for exactly that reason
        — see `audio/nudge.ts` for the measured behaviour it is working around.
      */
      volunteer: () => {
        tellCompanion({ type: '__mochi_volunteer__' })
      },
      note: (capability, detail) => problems.note('capability', capability, detail),
      /**
       * Read PER CALL, not held. The switch is in a window somebody can open
       * mid-conversation, and a snapshot taken when this listener was
       * registered would honour a grant that has since been taken away.
       */
      withheld: (capability) => {
        // Same rule as `used` above: the session's own character decides, and
        // no live character withholds rather than guessing.
        const live = sessionPersona
        if (live === null) return withheldGuidance(capability)
        const at = app.getPath('userData')
        return allowsCapability(readGrants(at, live, legacyGrants(at)), capability)
          ? null
          : withheldGuidance(capability)
      },
      log: (line) => console.log(line),
      warn: (line, error) => {
        if (error === undefined) console.error(line)
        else console.error(line, error)
      },
    },
    { name, callId, args },
  )
})

listenTo('voice:report', (_event, report: unknown) => {
  /*
    The registration is here and the decision is in `voice/reported.ts`.

    That module is the only inbound path from the least trusted process that
    reaches SQLite, the idle clock and the reconnect schedule at once, and it
    reads twelve things from this file while writing none of them -- a router
    over read-only dependencies, which is a function rather than a piece of the
    wiring. Lifting it also made its guards directly testable: `index.ts` cannot
    be imported outside Electron, so they were asserted on source text before.
  */
  reported(report, {
    conversation,
    conversationFlushed,
    stirred,
    nextSession,
    clickThrough: (through) => companion?.setIgnoreMouseEvents(through, { forward: true }),
    setListening,
    note: (why) => problems.note('voice', null, why),
    log: (line) => {
      console.log(line)
    },
  })
})

/**
 * The shelf: open it, and answer what it asks.
 *
 * **Every transcript handler here reads `wornId()`, and none of them takes a
 * persona.** That is the whole security property, and it survived the window
 * growing character cards: the page holds opaque tokens that authorise nothing,
 * so a compromised one can ask for the worn character's conversations and
 * nobody else's. Clicking a card WEARS somebody, which is a write main checks,
 * rather than naming somebody to a query.
 *
 * `wornId()` reads from disk rather than from the live session, so the list
 * follows a character switch on the same click — and answers before she has
 * ever spoken, which is when this window is most likely to be opened first.
 */
listenTo('clipboard:write', (_event, text: unknown) => {
  // Checked, not trusted: this comes from a renderer, and `writeText` will take
  // whatever it is given. Bounded because the clipboard is shared with every
  // other application on the machine.
  if (typeof text !== 'string' || text === '') return
  clipboard.writeText(text.slice(0, 100_000))
  console.log(`[clipboard] ${text.length} chars`)
})

listenTo('history:open', () => {
  showHistoryWindow()
})

ipcMain.handle('history:list', () => {
  const persona = wornId()
  return {
    persona,
    conversations: transcripts()
      .sessions(persona)
      .map((one) => ({
        token: one.token,
        startedAt: one.startedAt,
        endedAt: one.endedAt,
        turns: one.turns,
      })),
  }
})

ipcMain.handle('history:turns', (_event, token: unknown) => {
  const persona = wornId()
  // Checked here, not trusted from the page. A token is a string; anything else
  // is a caller that built the wrong object, and passing it through would reach
  // the query layer with a shape it never agreed to take.
  if (typeof token !== 'string') return []
  return transcripts()
    .turns(persona, token)
    .map((one) => ({ at: one.at, who: one.who, text: one.text, cut: one.cut }))
})

ipcMain.handle('history:problems', () => problems.all())

/**
 * Everything she has, written where the person says.
 *
 * `exportFor` has existed and been tested since the store was written with no
 * way out of the application. Memory is meant to stay "inspectable and
 * deletable" — the settings window covers the note, and this is the other half:
 * the conversations, in a shape somebody else could read.
 *
 * The PATH is chosen in main, through the system save panel. A renderer that
 * named the destination would be a renderer able to write a file anywhere with
 * this application's authority, which is the same rule `settings:reveal`
 * follows for reading.
 */
ipcMain.handle('history:export', async (): Promise<HistoryExport> => {
  const persona = wornId()
  const suggested = `mochi-${persona}-${new Date().toISOString().slice(0, 10)}.json`
  const chosen = await dialog.showSaveDialog({
    title: 'Export conversations',
    defaultPath: suggested,
    filters: [{ name: 'JSON', extensions: ['json'] }],
  })
  // Dismissing the panel is not a failure and must not be reported as one.
  if (chosen.canceled || chosen.filePath === undefined) return { ok: false, cancelled: true }

  /*
    READ AFTER THE DIALOG, not before it.

    The snapshot used to be taken on the way in, and a save panel is open for
    as long as somebody takes to pick a folder. The shelf is still live behind
    it: delete a conversation during that time and the export written
    afterwards still contained it.

    That is not a stale read, it is a privacy failure. Somebody who deletes a
    conversation and then exports has said twice what they want, and the file
    they end up with is the one artefact they are most likely to send
    somewhere.

    Read here the conversations are whatever they are at the moment of writing,
    which is the only moment the file can honestly claim to describe.
  */
  const archive = transcripts().exportFor(persona)

  try {
    // Not `writeJsonAtomically`: that is for files this app will read back, and
    // its temp-file dance belongs inside our own directories rather than
    // wherever somebody pointed a save panel.
    writeFileSync(chosen.filePath, JSON.stringify(archive, null, 2), 'utf8')
  } catch (error: unknown) {
    console.error('[archive] could not export:', error)
    problems.note('archive', chosen.filePath, `the export could not be written: ${String(error)}`)
    return { ok: false, cancelled: false, why: String(error) }
  }
  console.log(`[archive] exported ${archive.sessions.length} conversations to ${chosen.filePath}`)
  return { ok: true, path: chosen.filePath, conversations: archive.sessions.length }
})

/**
 * Everything the settings window draws, answered in one call.
 *
 * Read fresh, like `voice:config`, and for the same reason: the files under
 * `Application Support` are the truth and somebody may have edited one by hand
 * between opening this window and looking at it. A cached answer would make
 * this window the second place a persona lives.
 */
ipcMain.handle('settings:read', (): SettingsView => {
  const userData = app.getPath('userData')
  return {
    // Her colour, for the window to derive its accent from. Resolved the same
    // way `voice:config` does, so the settings window and her own window are
    // never two answers to what she looks like.
    face: wornFace(userData),
    // Read the same way her face is, and from the same persona, so this window
    // and her own can never disagree about who is worn.
    pronoun: wornPronoun(userData),
    capabilities: listCapabilities(registry),
    grants: listGrants(readGrants(userData, wornId(), legacyGrants(userData)), readUsage(userData)),
    lookup: listLookup({
      workspace: readWorkspace(userData),
      defaultWorkspace: join(userData, WORKSPACE_DIR),
      webSearch: readWebSearch(userData),
      profile: currentProfile(),
      profilePath: (() => {
        const name = currentProfile()
        return name === null ? null : profileFile(codexHome(process.env, app.getPath('home')), name)
      })(),
      // Seven states rather than "was a file found": the one that actually
      // fails is a token Codex is content with and this app cannot use.
      codex: codexForWindow(),
    }),
    screen: listScreen({
      halo: readHaloWhen(userData),
      shoulderChip: readShoulderChip(userData),
      sleepAfterMinutes: readSleepAfterMinutes(userData),
    }),
    hearing: {
      languages: readTranscriptionLanguages(userData),
      // The list main will ACCEPT, sent rather than imported by the window, so
      // the pane cannot offer a language this build would refuse.
      choices: OFFERED_LANGUAGES,
      most: MOST_LANGUAGES,
    },
    /*
      The whole catalogue, resolved against what is on disk.

      An unreadable overrides file has already been reported by `promptsNow`;
      here it falls back to the defaults, which is what the app is actually
      sending in that state — the pane must show what she gets, not what the
      file was supposed to say.
    */
    prompts: promptRows(promptsFor(CAPABILITIES.manifests), overridesOrDefaults(userData)),
    keys: listKeys(claimed),
    about: {
      name: app.getName(),
      version: app.getVersion(),
      electron: process.versions.electron,
      userData,
    },
    folders: {
      avatars: folderFor(userData, 'avatars'),
      personas: folderFor(userData, 'personas'),
    },
  }
})

/**
 * Wear somebody. Checked against the catalog, not against the character set.
 *
 * This is not cosmetic: the archive is scoped per persona, so wearing the wrong
 * one presents as her memory being empty. An id that no persona holds is
 * refused rather than remembered — the alternative is a preferences file that
 * every future launch has to reject.
 */
/**
 * Wear somebody. ONE implementation, because there are two ways to ask.
 *
 * The tray offers it as an action and the settings window as a control — v1's
 * standing rule, carried over: the tray is actions, the window is
 * configuration. Two entry points onto one setting is exactly how v1's own note
 * says a project ends up with two refresh paths that drift, so they share this
 * function and both refresh the tray afterwards.
 */
function wearPersona(id: unknown): SettingsWrite {
  if (typeof id !== 'string') return refuse('That is not a persona.')
  const userData = app.getPath('userData')
  const catalog = catalogue(userData)
  if (!catalog.personas.has(id)) return refuse(`There is no persona called ${id}.`)
  try {
    writeWornPersonaId(userData, id)
  } catch (error: unknown) {
    problems.note('persona', id, `could not be worn: ${String(error)}`)
    return refuse(String(error))
  }
  console.log(`[persona] now wearing ${id}`)
  tray?.refresh()
  return { ok: true }
}

/**
 * Rewrite one catalogued prompt, or reset it.
 *
 * `null` resets, and it DELETES the override rather than writing the default
 * back — see `store/prompts.ts`. A key that is not in the catalogue is refused
 * rather than stored: the file is a map, and an unknown key would sit in it for
 * ever answering a question nothing asks.
 */
ipcMain.handle('settings:prompt', (_event, key: unknown, text: unknown): SettingsWrite => {
  if (typeof key !== 'string') return { ok: false, why: 'That does not name a prompt.' }
  if (text !== null && typeof text !== 'string') {
    return { ok: false, why: 'A prompt has to be text.' }
  }
  const specs = promptsFor(CAPABILITIES.manifests)
  if (!specs.some((spec) => spec.key === key)) {
    return { ok: false, why: 'This build has no prompt by that name.' }
  }
  try {
    writePromptOverride(app.getPath('userData'), specs, key, text)
  } catch (error: unknown) {
    return { ok: false, why: String(error) }
  }
  return { ok: true }
})

ipcMain.handle('shelf:wear', (_event, id: unknown): SettingsWrite => wearPersona(id))

/**
 * Everything the shelf's character half draws, answered in one call.
 *
 * Read fresh, like `settings:read` and `voice:config` and for the same reason:
 * the files under `Application Support` are the truth and somebody may have
 * edited one by hand. `assembled` is `whatSheMayDo`'s output rather than a
 * second rendering of the prompt — 1b's card is literally that string, and a
 * card that re-assembled it would be the place the two quietly diverge.
 */
ipcMain.handle('shelf:read', (): ShelfView => {
  const userData = app.getPath('userData')
  const catalog = catalogue(userData)
  const worn = activePersona(catalog, readWornPersonaId(userData)).persona
  const note = recall(userData, worn.id)
  // Read once and used twice: the pane shows the document it edits AND the
  // string that document produces, and reading it twice would let the two
  // disagree by whatever happened between them.
  const prompt = readPrompt(userData)
  /*
    ONE call, and both halves of its answer are drawn.

    `assembled` is `whatSheMayDo(...).instructions`; the tool list is the other
    half of the same return. Calling it twice — once per half — is the shape
    `assembled`'s own comment warns about, one level along: the two renderings
    would drift the first time anything between them changed.
  */
  // Empty when she has kept nothing: the sheet renders no section, and the
  // prompt carries no index.
  const kept = transcripts()?.kept.collections(worn.id) ?? []
  const mayDo = whatSheMayDo(
    worn,
    note,
    readGrants(userData, worn.id, legacyGrants(userData)),
    registry.tools,
    prompt,
    kept,
  )
  return {
    kept,
    face: resolveFaceFor(
      avatarsRoot(userData),
      packageFolder(worn.id, catalog.sources),
      worn.avatarId,
      worn.theme,
      worn.size,
    ).face,
    pronoun: worn.pronoun,
    // Her state, for the strip across the top. `resting` is held in this
    // process because three things change it.
    state: {
      asleep: resting.asleep,
      restKey: claimed.find((one) => one.id === 'rest')?.refused === null ? SHORTCUTS.rest : null,
    },
    wornId: worn.id,
    characters: listPersonas(
      catalog,
      (one) =>
        resolveFaceFor(
          avatarsRoot(userData),
          packageFolder(one.id, catalog.sources),
          one.avatarId,
          one.theme,
          one.size,
        ).face,
      (id) => keepsFor(userData, id, carriedPolicies),
    ),
    avatars: listAvatars(avatarsRoot(userData)),
    voices: [...VOICE_NAMES],
    recommendedVoices: [...RECOMMENDED_VOICES],
    // Where it actually RESOLVED to, not where it was asked to look. A line
    // showing the requested name for a file that fell back to the built-in is
    // the "the app ignored my file" failure with a label on it.
    faceSource: resolveFaceFor(
      avatarsRoot(userData),
      packageFolder(worn.id, catalog.sources),
      worn.avatarId,
      worn.theme,
      worn.size,
    ).source,
    assembled: mayDo.instructions,
    // The other half of the same answer. Rendered here rather than in the
    // window because the window must not re-derive what goes on the wire.
    toolsSent: renderTools(mayDo.tools),
    prompt: { text: prompt, path: promptFile(userData), slots: [...PROMPT_SLOTS] },
    note: { text: note, previous: previousNote(userData, worn.id) },
  }
})

/**
 * Change a persona, field by field, and write her back where she came from.
 *
 * `applyChange` decides what may be touched — a spread would have let a page
 * set `id`, which keys her memory — and `savePersonaTo` decides WHERE it lands:
 * an overlay for the built-in, the package itself for everyone else. Neither
 * decision is the renderer's, and neither is made twice.
 */
ipcMain.handle('shelf:save', (_event, change: unknown): SettingsWrite => {
  if (typeof change !== 'object' || change === null) return refuse('That is not a change.')
  const asked = change as PersonaChange
  if (typeof asked.id !== 'string') return refuse('That change does not name a persona.')

  const userData = app.getPath('userData')
  const catalog = catalogue(userData)
  const persona = catalog.personas.get(asked.id)
  if (persona === undefined) return refuse(`There is no persona called ${asked.id}.`)

  /*
    Written FIRST and separately, because it does not live on her manifest.

    A retention choice on a persona file would mean a package could arrive
    having decided that whoever installs it is never recorded, in a field
    nobody reads before installing. It lives in the policy store, filed under
    her id, and `Policy`'s own comments carry the rest of that argument.

    Before the manifest write, so that a manifest write which fails cannot
    leave the switch showing one thing and the store holding another. The
    reverse order fails the safer way round only for a change that carries
    both, and this one usually carries only the switch.
  */
  if (typeof asked.keeps === 'boolean') {
    try {
      writePolicy(userData, asked.id, { keeps: asked.keeps })
      console.log(`[policy] ${asked.id} keeps: ${String(asked.keeps)}`)
    } catch (error: unknown) {
      problems.note(
        'persona',
        asked.id,
        `the saving setting could not be written: ${String(error)}`,
      )
      return refuse(String(error))
    }
  }

  const avatars = listAvatars(avatarsRoot(userData))
    .map((one) => one.id)
    .filter((one): one is string => one !== null)
  const changed = applyChange(persona, asked, avatars)
  if (!changed.ok) return refuse(changed.why)

  try {
    const written = savePersonaTo(userData, catalog, changed.persona)
    console.log(`[persona] ${asked.id} saved to ${written.source}`)
  } catch (error: unknown) {
    // Loud, and reported where somebody will see it. A save that silently did
    // not land is the failure this whole window exists to remove.
    console.error(`[persona] could not save ${asked.id}:`, error)
    problems.note('persona', asked.id, `could not be saved: ${String(error)}`)
    return refuse(String(error))
  }
  return { ok: true }
})

/**
 * Open a folder in the system file manager. A KIND, never a path.
 *
 * `folderFor` is the only place a name becomes a location. A channel that took
 * the path instead would be a file browser running with this application's
 * authority, reachable from a page.
 */
/**
 * Change how a lookup runs. Checked here, then written one field at a time.
 *
 * `applyLookup` decides what is acceptable and this decides what that means on
 * disk — the same split as `applyChange` and `savePersonaTo`. Each writer is
 * the one that already owns its own validation, so nothing here re-states a
 * rule that lives in the store.
 */
ipcMain.handle('settings:lookup', (_event, change: unknown): SettingsWrite => {
  if (typeof change !== 'object' || change === null) return refuse('That is not a change.')
  const asked = applyLookup(change, isProfileName)
  if (!asked.ok) return refuse(asked.why)

  const userData = app.getPath('userData')
  try {
    if (asked.change.workspace !== undefined) writeWorkspace(userData, asked.change.workspace)
    if (asked.change.webSearch !== undefined) {
      writeWebSearch(userData, asked.change.webSearch)
    }
    if (asked.change.profile !== undefined) writeProfile(userData, asked.change.profile)
  } catch (error: unknown) {
    // Loud, and reported where somebody will see it. A setting that silently
    // did not land is the failure this window exists to remove.
    console.error('[settings] could not change the lookup:', error)
    problems.note('settings', null, `a lookup setting could not be saved: ${String(error)}`)
    return refuse(String(error))
  }
  console.log(`[settings] lookup changed: ${Object.keys(asked.change).join(', ')}`)
  return { ok: true }
})

/**
 * Undo the last change to her note, or clear it.
 *
 * BOTH go through `remember`, which keeps the version being replaced one deep —
 * so clearing is itself undoable, and restoring can be undone by restoring
 * again. Neither deletes the file: `forgetMemory` exists for when a persona is
 * deleted, and using it here would take away the undo along with the note.
 *
 * `remember` THROWS rather than overwrite a note it could not read, so a corrupt
 * file is reported here instead of being silently replaced by an empty one.
 */
registerForgetKept({ worn: wornId, store: transcripts })

ipcMain.handle('shelf:memory', (_event, action: unknown): SettingsWrite => {
  if (typeof action !== 'object' || action === null) return refuse('That is not something to do.')
  const kind = (action as { kind?: unknown }).kind
  if (kind !== 'restore' && kind !== 'clear') return refuse('That is not something to do.')

  const userData = app.getPath('userData')
  const catalog = catalogue(userData)
  const worn = activePersona(catalog, readWornPersonaId(userData)).persona.id
  /**
   * The character the page was SHOWING when the button was pressed.
   *
   * Not used to choose whose note is written — that is the worn one, decided
   * here, like everything else on this bridge. It is used to REFUSE when the
   * two disagree, which they do for one window: a character switch is a write
   * and a re-read, and the old sheet stays on screen and clickable while that
   * is in flight. Forgetting a note somebody was not looking at is the one
   * mistake here that cannot be undone by pressing undo.
   */
  const shown = (action as { id?: unknown }).id
  if (typeof shown !== 'string') return refuse('That does not name a character.')
  if (shown !== worn) {
    return refuse('That was for a different character — she has changed since. Have another look.')
  }

  if (kind === 'restore') {
    const previous = previousNote(userData, worn)
    // Null means nothing has ever been rewritten — there is no version to go
    // back to, which is different from going back to an empty one.
    if (previous === null) return refuse('There is no earlier version of her notes to go back to.')
    try {
      remember(userData, worn, previous)
    } catch (error: unknown) {
      console.error(`[memory] could not restore ${worn}:`, error)
      problems.note('memory', worn, `the earlier notes could not be put back: ${String(error)}`)
      return refuse(String(error))
    }
    console.log(`[memory] ${worn} restored to the previous version`)
    return { ok: true }
  }

  // Clearing an already-empty note would rotate the one useful undo away, since
  // `remember` treats an unchanged write as nothing to do — but a note that is
  // already empty and readable has nothing to clear either, so say so.
  const held = recallState(userData, worn)
  if (!held.ok) return refuse(`Her notes could not be read, so they were left alone: ${held.why}`)
  if (held.notes === '') return refuse('There is nothing in her notes to forget.')
  try {
    remember(userData, worn, '')
  } catch (error: unknown) {
    console.error(`[memory] could not clear ${worn}:`, error)
    problems.note('memory', worn, `the notes could not be cleared: ${String(error)}`)
    return refuse(String(error))
  }
  console.log(`[memory] ${worn} cleared`)
  return { ok: true }
})

/**
 * One turn's words, onto the clipboard.
 *
 * ## Why this is not `navigator.clipboard`
 *
 * The browser's async clipboard REFUSES an unfocused document —
 * `NotAllowedError: Document is not focused` — which was reproduced from a
 * harness in two runs out of three. In practice a click focuses the window
 * first, so the browser path works; the point is that it does not have to be
 * true, and a copy button whose failure depends on which window happened to be
 * frontmost is one nobody can diagnose. Electron's own `clipboard` has no such
 * rule because it is not subject to a page's permission model.
 *
 * ## Bounded, and only a string
 *
 * A turn is bounded by what the archive stores, but this takes whatever a page
 * sends, so it is checked here rather than trusted: `PERSONA_LIMITS.memory` is
 * the same 20k ceiling every other free-text field on this bridge is held to,
 * and it exists so a page cannot hand the system clipboard something the size
 * of a file.
 *
 * WRITE-ONLY. There is deliberately no read: handing back words this window is
 * already displaying is a different thing from taking whatever somebody copied
 * out of their password manager a moment ago.
 */
ipcMain.handle('shelf:copy', (_event, text: unknown): SettingsWrite => {
  if (typeof text !== 'string') return refuse('That is not something to copy.')
  if (text === '') return refuse('There is nothing to copy.')
  if (text.length > PERSONA_LIMITS.memory) return refuse('That is too long to copy.')
  clipboard.writeText(text)
  return { ok: true }
})

/**
 * Make a persona, copy one, remove one, or put the built-in back.
 *
 * The id is DERIVED here from the name, never taken from the page —
 * `copyPersonaTo` derives it against the ids already taken and the ones a
 * pending deletion still reserves. An id chosen by a renderer would be a
 * renderer choosing whose memory and whose conversations a new character
 * inherits, which is the whole reason `deriveId` is told about tombstones.
 */
ipcMain.handle('shelf:persona', (_event, action: unknown): SettingsWrite => {
  if (typeof action !== 'object' || action === null) return refuse('That is not something to do.')
  const asked = action as PersonaAction
  const userData = app.getPath('userData')
  const catalog = catalogue(userData)

  if (asked.kind === 'restore-built-in') {
    try {
      restoreBuiltIn(userData)
    } catch (error: unknown) {
      console.error('[persona] could not restore the built-in:', error)
      problems.note('persona', BUILT_IN_ID, `could not be restored: ${String(error)}`)
      return refuse(String(error))
    }
    console.log('[persona] the built-in is back as she ships')
    tray?.refresh()
    return { ok: true }
  }

  if (asked.kind === 'delete') {
    if (typeof asked.id !== 'string') return refuse('That does not name a persona.')
    const persona = catalog.personas.get(asked.id)
    if (persona === undefined) return refuse(`There is no persona called ${asked.id}.`)
    // The built-in has no file to remove. Refused with a sentence rather than
    // left to throw one, and pointed at the thing somebody actually wants.
    if (catalog.sources.get(asked.id) === undefined) {
      return refuse('The built-in cannot be deleted. Put her back as she ships instead.')
    }
    try {
      deletePersona(userData, catalog, asked.id, transcripts())
    } catch (error: unknown) {
      console.error(`[persona] could not delete ${asked.id}:`, error)
      problems.note('persona', asked.id, `could not be deleted: ${String(error)}`)
      return refuse(String(error))
    }
    // Wearing somebody who has just been deleted resolves to the built-in with
    // a problem attached. Saying so explicitly is better than falling back and
    // reporting it as a fault.
    if (readWornPersonaId(userData) === asked.id) {
      try {
        writeWornPersonaId(userData, BUILT_IN_ID)
      } catch (error: unknown) {
        problems.note('persona', BUILT_IN_ID, `could not be worn after a delete: ${String(error)}`)
      }
    }
    /**
     * She was deleted while her own session was still up.
     *
     * `sessionPersona` is what a capability writes under, so leaving it
     * pointing at a deleted id let `remember_this` recreate her memory file and
     * the archive recreate her conversations — under an id `deriveId` has
     * already released, so the next character named the same thing inherits a
     * stranger's notes. That is the exact fault `deletePersona`'s ordering and
     * `forgetPolicy`'s tombstones exist to prevent, arriving from the one
     * direction they do not cover.
     */
    if (sessionPersona === asked.id) {
      conversation().end()
      sessionPersona = null
      console.log(`[persona] ${asked.id} was live; the session is no longer filed under her`)
    }
    console.log(`[persona] ${asked.id} deleted`)
    tray?.refresh()
    return { ok: true }
  }

  if (asked.kind !== 'create' && asked.kind !== 'duplicate') {
    return refuse('That is not something to do.')
  }
  if (typeof asked.name !== 'string' || asked.name.trim() === '') {
    return refuse('A new persona needs a name.')
  }
  // `create` starts from the built-in, `duplicate` from whoever is worn. Both
  // are the same operation on a different source, which is why there is one
  // function rather than two.
  const from =
    asked.kind === 'duplicate'
      ? activePersona(catalog, readWornPersonaId(userData)).persona
      : catalog.personas.get(BUILT_IN_ID)
  if (from === undefined) return refuse('There is nothing to copy from.')

  let written
  try {
    written = copyPersonaTo(userData, catalog, from, asked.name)
  } catch (error: unknown) {
    console.error(`[persona] could not create ${asked.name}:`, error)
    problems.note('persona', asked.name, `could not be created: ${String(error)}`)
    return refuse(String(error))
  }

  // Wear her, because that is why somebody made her. If THAT fails the fork is
  // rolled back — `discardWrite` exists for exactly this and says so: the file
  // did not exist a moment ago, so removing it restores what was there rather
  // than destroying anything. Leaving it would put a persona nobody asked for
  // on the shelf and report failure at the same time.
  try {
    writeWornPersonaId(userData, written.id)
  } catch (error: unknown) {
    discardWrite(userData, written.source)
    console.error(`[persona] could not wear the new ${written.id}, rolled back:`, error)
    return refuse(String(error))
  }
  console.log(`[persona] ${written.id} created from ${from.id}, and worn`)
  tray?.refresh()
  return { ok: true }
})

/**
 * Allow her something, or take it away.
 *
 * ## It takes effect on her NEXT TURN, not on her next wake
 *
 * A standing switch that only applied at the next session would be a switch
 * that does nothing while somebody is looking at it — and the moment somebody
 * reaches for it is usually the middle of a conversation. So the live session
 * is re-configured here: the same `session.update` the renderer sends at the
 * door, with the new tool list and the new instructions, which is the one
 * mechanism this app already relies on rather than a new one.
 *
 * **No turn is requested.** `ledger.ts` records why at length: `response.create`
 * while she is speaking is refused, and refused intermittently. She reads the
 * change when she next answers, which is exactly what "on her next turn" means.
 *
 * Every grant left is a TOOL, which is what makes one mechanism enough. The
 * microphone used to travel separately in this frame because it was the track
 * rather than a tool, and only the renderer held it; `@shared/grants` records
 * why that switch is gone.
 */
ipcMain.handle('settings:grant', (_event, change: unknown): SettingsWrite => {
  if (typeof change !== 'object' || change === null) return refuse('That is not a change.')
  const asked = change as GrantChange
  if (!isGrant(asked.id)) return refuse('There is no such permission.')
  if (typeof asked.allowed !== 'boolean') return refuse('That is not a yes or a no.')

  const userData = app.getPath('userData')
  // Held, because the answer below depends on WHICH character this was written
  // for -- and `wornId()` reads from disk on every call, so asking twice can
  // give two answers if the shelf moves in between.
  const writtenFor = wornId()
  try {
    writeGrant(userData, writtenFor, asked.id, asked.allowed, legacyGrants(userData))
  } catch (error: unknown) {
    // Loud, and where somebody will see it. A permission that silently did not
    // change is the worst failure this window can have: the switch says one
    // thing and she goes on doing the other.
    console.error(`[grants] could not change ${asked.id}:`, error)
    problems.note('settings', asked.id, `a permission could not be saved: ${String(error)}`)
    return refuse(String(error))
  }
  console.log(`[grants] ${asked.id} ${asked.allowed ? 'allowed' : 'withheld'}`)
  /**
   * Told, or said so. The permission is on disk either way.
   *
   * A window reporting "in force now" over a frame that never went out would be
   * lying about the one thing this panel promises. So the answer carries what
   * actually happened: saved, and whether she knows yet.
   */
  let told: boolean
  try {
    told = tellTheSession()
  } catch (error: unknown) {
    console.error('[grants] saved, but the live session could not be told:', error)
    problems.note('settings', asked.id, `saved, but she was not told: ${String(error)}`)
    told = false
  }
  /*
    The answer is a DECISION, and it has two persona ids in it.

    This used to be `if (!told && sessionPersona !== null)`, which misses the
    case that matters: the shelf can change who is worn while a session is up,
    so the grant is written for the newly worn character while dispatch goes on
    consulting the one the session was configured as. The frame is delivered,
    `told` is true, and the capability keeps running -- and the window said the
    change was in force. See `grant-outcome.ts`.
  */
  const outcome = grantOutcome({ writtenFor, live: sessionPersona, told })
  if (!outcome.ok) return refuse(outcome.why)
  return { ok: true }
})

/**
 * Tell the live session what changed, if there is one.
 *
 * Best effort by construction: there may be no window, no session, or she may
 * be asleep — and in every one of those cases the next `voice:config` reads the
 * grants fresh, so nothing is lost. What must not happen is a change that
 * reaches disk and never reaches her, and the private frame is what covers the
 * one case where that could occur.
 */
function tellTheSession(): boolean {
  if (companion === null || companion.isDestroyed()) return false
  const userData = app.getPath('userData')
  /**
   * The persona the LIVE SESSION was configured as — not whoever is worn.
   *
   * They are different the moment somebody switches character on the shelf,
   * because a switch takes effect on the next wake. Rebuilding from the worn
   * one installed the NEW character's prompt and the new character's private
   * note into the OLD character's live session, which is a leak rather than a
   * mismatch: her notes are per character on purpose.
   */
  const live = sessionPersona
  if (live === null) return false
  const catalog = catalogue(userData)
  const persona = catalog.personas.get(live)
  // She was deleted while her own session was up. There is nothing to re-tell,
  // and the next wake resolves somebody who exists.
  if (persona === undefined) return false
  const grants = readGrants(userData, persona.id, legacyGrants(userData))
  const mayDo = whatSheMayDo(
    persona,
    recall(userData, live),
    grants,
    registry.tools,
    readPrompt(userData),
    transcripts()?.kept.collections(persona.id) ?? [],
  )
  companion.webContents.send('voice:send', {
    type: '__mochi_grants__',
    instructions: mayDo.instructions,
    tools: mayDo.tools,
  })
  return true
}

/**
 * What she looks like on the desktop — which side the bubble sits on.
 *
 * Straight through `setBubbleSide`, which is the SAME function the tray's menu
 * calls. `tray.ts` carries v1's rule that the tray is actions and the window is
 * configuration, and its own note says a setting with two entry points is how a
 * project ends up with two refresh paths that drift. One function is what makes
 * two entry points safe — and it ANSWERS, so this window is never told a write
 * landed when it did not.
 */
/**
 * Store the system prompt, and tell a live session about it.
 *
 * ## It takes effect on her NEXT WAKE, and says so
 *
 * Unlike a grant, which `tellTheSession` pushes at once because the whole point
 * of a standing switch is that it works while somebody is looking at it. The
 * prompt is different in kind: `session.update` CAN carry new instructions, and
 * replacing who she is mid-sentence is a character switch without the reconnect
 * that a character switch gets — §21 locks the voice for the same reason. So
 * this writes the file and the pane says when it lands.
 *
 * Empty is a real answer and is stored as one. The default IS empty, so
 * refusing it would make the one state a fresh install ships in unreachable
 * once anybody had typed anything.
 */
/**
 * Try an expression on, from the grid that decides which she may choose.
 *
 * ## Nothing is stored
 *
 * Not a setting — a look. It ends at the same `__mochi_face__` frame
 * `set_expression` sends, so what somebody sees here is exactly what she does
 * when she wears it herself, at the size she is on the desktop rather than at
 * 56px on a tile. The face then lives the life the tool's manifest describes:
 * it stays until she changes it or until she is asked to rest.
 *
 * ## Deliberately NOT gated on her `faces`
 *
 * The grant and the character's `faces` constrain what SHE may reach for. A
 * person clicking a tile in their own settings window is not her reaching for
 * anything — and gating this on the switch beside it would mean you could never
 * look at an expression before deciding whether to enable it, which is the one
 * thing somebody standing at that grid wants to do.
 *
 * `EMOTIONS` is still the bound. This ends at `wearExpression`, which is one
 * enum wide on purpose, and a window does not get to widen it.
 */
ipcMain.handle('shelf:wear-face', (_event, face: unknown): SettingsWrite => {
  if (typeof face !== 'string' || !(EMOTIONS as readonly string[]).includes(face)) {
    return refuse('There is no expression called that.')
  }
  if (companion === null || companion.isDestroyed()) {
    // The same answer the capability gives, for the same reason: a success
    // reported over a window that is not there is a face nobody can see.
    return refuse('She is not on screen just now, so there is nothing to put a face on.')
  }
  companion.webContents.send('voice:send', { type: '__mochi_face__', face })
  console.log(`[face] trying ${face} on from the shelf`)
  return { ok: true }
})

ipcMain.handle('shelf:prompt', (_event, text: unknown): SettingsWrite => {
  const checked = checkPrompt(text)
  if (!checked.ok) return refuse(checked.why)
  try {
    writePrompt(app.getPath('userData'), checked.text)
  } catch (error: unknown) {
    // Where somebody can see it. A Save that silently did nothing is the
    // failure this whole surface exists to avoid — they would keep typing into
    // a box that is not being kept.
    console.error('[prompt] could not be written:', error)
    problems.note(
      'settings',
      promptFile(app.getPath('userData')),
      `could not be written: ${String(error)}`,
    )
    return refuse(`That could not be saved: ${String(error)}`)
  }
  console.log(`[prompt] ${checked.text.length} chars`)
  return { ok: true }
})

ipcMain.handle('settings:screen', (_event, change: unknown): SettingsWrite => {
  if (typeof change !== 'object' || change === null) return refuse('That is not a change.')
  const asked = applyScreen(change)
  if (!asked.ok) return refuse(asked.why)

  if (asked.change.halo !== undefined) {
    const when = asked.change.halo
    try {
      writeHaloWhen(app.getPath('userData'), when)
    } catch (error: unknown) {
      return refuse(`That could not be saved: ${String(error)}`)
    }
    // Straight through to her window, because she is on screen while somebody
    // operates this control — the same argument the bubble's side makes.
    tellCompanion({ type: '__mochi_halo__', when })
    console.log(`[screen] halo drawn ${when}`)
  }

  if (asked.change.shoulderChip !== undefined) {
    const shown = asked.change.shoulderChip
    try {
      writeShoulderChip(app.getPath('userData'), shown)
    } catch (error: unknown) {
      return refuse(`That could not be saved: ${String(error)}`)
    }
    // Straight through to her window, like the halo: somebody operating this
    // switch is looking at her, and a control that waits for a relaunch to
    // disappear reads as a switch that did nothing.
    tellCompanion({ type: '__mochi_chip__', shown })
    console.log(`[screen] shoulder chip ${shown ? 'shown' : 'hidden'}`)
  }

  if (asked.change.sleepAfterMinutes !== undefined) {
    const minutes = asked.change.sleepAfterMinutes
    try {
      writeSleepAfterMinutes(app.getPath('userData'), minutes)
    } catch (error: unknown) {
      return refuse(`That could not be saved: ${String(error)}`)
    }
    // Re-armed against the NEW value rather than left to expire on the old one.
    // Without this, shortening the timeout takes effect one timeout later,
    // which is the one moment somebody is watching for it to work.
    armIdleSleep()
    console.log(`[rest] resting after ${minutes === 0 ? 'never' : `${String(minutes)} min`}`)
  }

  return { ok: true }
})

/**
 * Which languages the transcriber should expect to hear.
 *
 * NOT sent to her window, unlike the halo and the shoulder chip. Those two
 * change something already on screen; this one changes a field of
 * `session.update`, and the voice is locked after her first audio (§21) — so
 * re-sending the configuration mid-session is a reconnect, not an update. It
 * lands on her next wake, which is what `voice:config` being read fresh every
 * session already guarantees, and the window says so rather than leaving
 * somebody to wonder whether it took.
 */
ipcMain.handle('settings:hearing', (_event, change: unknown): SettingsWrite => {
  if (typeof change !== 'object' || change === null) return refuse('That is not a change.')
  const asked = applyHearing(change)
  if (!asked.ok) return refuse(asked.why)

  if (asked.change.languages !== undefined) {
    const languages = asked.change.languages
    try {
      writeTranscriptionLanguages(app.getPath('userData'), languages)
    } catch (error: unknown) {
      // Loud, and reported where somebody will see it — `settings:lookup`'s
      // reason: a setting that silently did not land is the failure this
      // window exists to remove.
      console.error('[hearing] could not save the languages:', error)
      problems.note('settings', null, `the languages could not be saved: ${String(error)}`)
      return refuse(`That could not be saved: ${String(error)}`)
    }
    console.log(
      `[hearing] expecting ${languages.length === 0 ? 'whatever she detects' : languages.join(', ')}`,
    )
  }

  return { ok: true }
})

/**
 * Ask this machine about Codex again, and answer with what it found.
 *
 * The only settings handler that is not a write, and the only one that can take
 * a second or two: it spawns `codex --version` and `codex login status`, each
 * with a deadline. `invoke` rather than a send, so the window can disable its
 * button for exactly as long as the check is outstanding.
 *
 * It exists because every remedy is applied OUTSIDE this application — install
 * the CLI, run `codex` to sign in, or let a busy machine settle — so somebody
 * who has just done one of those is standing in front of a window telling them
 * to do it, with no way to clear it but quitting the app they were told to fix
 * something for.
 *
 * No refusal path and no `SettingsWrite`: nothing is saved, so there is nothing
 * that can fail to save. A check that throws rejects, and the window says so.
 */
ipcMain.handle('settings:codex-recheck', async (): Promise<SettingsCodex> => {
  console.log('[codex] re-checking on request')
  return await checkCodexNow()
})

listenTo('settings:reveal', (_event, what: unknown) => {
  if (!(REVEALABLE as readonly unknown[]).includes(what)) {
    console.error(`[settings] refusing to reveal an unknown folder: ${String(what)}`)
    return
  }
  const folder = folderFor(app.getPath('userData'), what as Revealable)
  // Created if missing, because the answer to "where do I put one" must be a
  // folder that exists rather than a path that does not.
  mkdirSync(folder, { recursive: true })
  void shell.openPath(folder)
})

/**
 * Delete conversations, at one of three scopes.
 *
 * ## Whose, and why the page still names them
 *
 * Main deletes the WORN character's, decided here, exactly as the note actions
 * do. The id the page sends is a PRECONDITION: it says which character was on
 * screen when the button was pressed, and a disagreement is refused. A
 * character switch is a write and a re-read, and the old sheet stays clickable
 * while that is in flight -- long enough to confirm "delete all of hers" about
 * one character and have it land on another.
 *
 * This is not a security boundary and is not described as one. The same bridge
 * exposes `wear`, so a page that had been taken over could become another
 * character first and delete her archive legitimately. What this stops is
 * accidents, which is the failure that actually happens.
 *
 * ## The conversation she is in the middle of
 *
 * Deleting it is allowed. What is not allowed is leaving the open token
 * pointing at a row that no longer exists -- every turn after that is dropped
 * with only a log line, so she talks and nothing is written down and nothing
 * says so. The live token is handed back to `Conversation` to let go of.
 *
 * ## Why the answer distinguishes gone from scrubbed
 *
 * The rows go inside a transaction. The words leave the write-ahead log at the
 * next checkpoint, which a reader can hold off. Both are true at once, and a
 * screen that says "deleted" while the second is outstanding is making a
 * promise the disk has not kept.
 */
ipcMain.handle('history:forget', (_event, action: unknown): Forgotten => {
  const no = (why: string): Forgotten => ({ ok: false, gone: null, pending: false, why })
  const kind = (action as { kind?: unknown } | null)?.kind
  if (kind !== 'some' && kind !== 'hers' && kind !== 'everything') {
    return no('That is not something to delete.')
  }

  const worn = wornId()
  if (kind !== 'everything') {
    const shown = (action as { id?: unknown }).id
    if (typeof shown !== 'string') return no('That does not name a character.')
    if (shown !== worn) {
      return no('That was for a different character — she has changed since. Have another look.')
    }
  }

  const archive = transcripts()
  const live = conversation().liveToken()
  let gone: number | null = null
  try {
    if (kind === 'some') {
      const tokens = (action as { tokens?: unknown }).tokens
      if (!Array.isArray(tokens) || tokens.some((one) => typeof one !== 'string')) {
        return no('That does not name any conversations.')
      }
      // The BOUNDED set, which is what `forgetSessions` will actually delete.
      // Releasing the live conversation from the caller's unbounded list let a
      // request naming more than `MOST_AT_ONCE` restart recording while the old
      // conversation's rows were still on disk. One function answers "what was
      // deleted" for both sides now.
      const wanted = boundedForgetSet(tokens as readonly SessionToken[])
      gone = archive.forgetSessions(worn, wanted)
      if (live !== null && wanted.includes(live)) conversation().forget(live)
    } else if (kind === 'hers') {
      archive.forget(worn)
      /*
        ONLY IF THE LIVE CONVERSATION IS HERS.

        `worn` is who the shelf says is worn; the live conversation belongs to
        whoever the SESSION was configured as, and the shelf can change one
        without the other -- the same divergence `grant-outcome.ts` describes.

        Releasing unconditionally meant deleting the newly worn character's
        conversations also stopped recording the conversation somebody was
        having with the OLD one, mid-sentence, for no reason they could see.
        `forget` on a token whose rows were never deleted is not a correction,
        it is a second loss.
      */
      if (live !== null && sessionPersona === worn) conversation().forget(live)
    } else {
      // Unconditional here, and correctly so: `forgetEverything` deletes every
      // persona's rows, so whoever the live conversation belongs to, its rows
      // are among them.
      archive.forgetEverything()
      if (live !== null) conversation().forget(live)
    }
  } catch (error: unknown) {
    // Said, not swallowed. A deletion that failed and reported success is the
    // one outcome here nobody can check for themselves.
    console.error(`[transcripts] a deletion (${kind}) failed:`, error)
    problems.note('history', worn, `conversations could not be deleted: ${String(error)}`)
    return no('They could not be deleted. Nothing was removed.')
  }
  console.log(`[transcripts] deleted (${kind}): ${gone === null ? 'all matching' : String(gone)}`)
  return { ok: true, gone, pending: archive.scrubPending(), why: null }
})

ipcMain.handle('history:search', (_event, query: unknown) => {
  const persona = wornId()
  if (typeof query !== 'string') return []
  return transcripts()
    .search(persona, query)
    .map((one) => ({ token: one.token, at: one.at, who: one.who, text: one.text }))
})

/**
 * Everything that has to happen once, in order, after Electron is ready.
 *
 * Held in a `const` rather than chained straight off `whenReady()` so the
 * terminal `catch` below can be a separate statement: chaining it re-indents
 * two hundred lines of startup and turns a nine-line fix into a four-hundred-
 * line diff nobody can review.
 */
const startup = app.whenReady().then(
  () => {
    /*
      THE OTHER HALF OF THE RECONNECT, and the one no timer can do for itself.

      `setTimeout` does not run while the machine is asleep and does not catch
      up afterwards. A laptop closed for two hours reopens with a timer that
      still believes it has forty minutes left, on a session that expired
      ninety minutes ago -- so she sits there, apparently awake, connected to
      nothing, until something else happens to open a session.

      `resumed()` re-decides against the wall clock, which is the only thing
      that knows time passed. It does nothing when no reconnect is pending, so
      opening the lid is not a way to wake her from rest.

      Registered inside `whenReady` because `powerMonitor` is not usable before
      it.
    */
    powerMonitor.on('resume', () => {
      nextSession.resumed()
    })

    /**
     * v1's leftovers, moved aside before anything reads this directory.
     *
     * The bundle id is shared, so v2 launches into v1's userData. Most of it is
     * wanted — the archive, the personas, the notes — and a short, verified
     * list is not: `store/inherited.ts` says which and why. Moved, never
     * deleted, into one dated folder.
     */
    const stamp = new Date().toISOString().slice(0, 10)
    for (const { name, to } of setAsideV1(app.getPath('userData'), stamp, (file, reason) =>
      console.error(`[inherited] could not set aside ${file}: ${reason}`),
    )) {
      console.log(`[inherited] ${name} -> ${to}/ (v1's, nothing here reads it)`)
    }

    /**
     * The old capabilities folder, if somebody filled one.
     *
     * Said ONCE, and only when there is something in it. Until 2026-08-19 a
     * capability could be dropped into `<userData>/capabilities/` — never run,
     * but read, listed and reported. Capabilities are compiled in now, and
     * deleting the feature without a word would be exactly the "the app ignored
     * my files" failure this surface exists for.
     */
    const legacyRoot = legacyCapabilitiesRoot(app.getPath('userData'))
    const leftover = leftoverCapabilities(app.getPath('userData'))
    if (!leftover.ok) {
      // Reported rather than treated as empty. A folder that cannot be listed
      // is the case where somebody's work is most likely to be sitting there
      // unreachable, and calling that "nothing there" would suppress the one
      // message this check exists to send.
      console.error(`[capability] could not look in ${legacyRoot}: ${leftover.why}`)
      problems.note('capability', legacyRoot, `could not be read: ${leftover.why}`)
    } else if (leftover.count > 0) {
      console.error(
        `[capability] ${leftover.count} left in ${legacyRoot}, which nothing loads from now`,
      )
      // `folders` is bounded and `count` is not, so a folder with hundreds in
      // it says how many there are without listing them all at somebody.
      const listed = leftover.folders.join(', ')
      const rest = leftover.count - leftover.folders.length
      problems.note(
        'capability',
        legacyRoot,
        `nothing is loaded from this folder any more — capabilities now live in the source, ` +
          `under src/capabilities/, and are compiled in. Still there: ${listed}` +
          (rest > 0 ? `, and ${rest} more` : ''),
      )
    }

    /*
      The system prompt document, put there once so somebody can find it.

      EMPTY, and seeded anyway — the same argument `seedProfile` makes: a file
      nobody can see the shape of is not one, and a folder with nothing in it
      does not tell anybody they may put something there. It sets nothing, so
      it changes nothing until it is edited, and it is never overwritten.
    */
    seedPrompt(app.getPath('userData'))

    companion = createCompanionWindow()
    /*
      The backstop. See `SHOW_ANYWAY_MS`.

      Armed at creation rather than after the load, so a renderer that never
      reaches its first frame is covered by the same timer as one that never
      sends a fit. `showHerOnce` is idempotent, so the ordinary path — the first
      fit, a few hundred milliseconds from now — simply gets there first and
      this fires into a no-op.
    */
    setTimeout(() => {
      showHerOnce('the backstop, so a renderer that never fitted cannot hide her')
    }, SHOW_ANYWAY_MS)

    /**
     * The menu bar item, created AFTER her window, because it is the way out of
     * a running application rather than a prerequisite for starting one.
     *
     * Its model is read fresh on every rebuild rather than held: the persona
     * shelf is files on disk, and somebody may add one while this is running.
     */
    /**
     * How she was left. Restored before the tray is built, so the menu's first
     * labels are true rather than corrected a tick later.
     */
    resting = readResting(app.getPath('userData'))
    if (resting.hidden) companion.hide()

    /**
     * The first session is opened by MAIN, not by the renderer.
     *
     * `companion/main.ts` ended in a bare `void open()`, so a session was
     * negotiated on every launch before anything had asked for one — including
     * a launch into a stored `asleep: true`, where the whole point of the state
     * is that she is not participating. Whether to open one is a decision about
     * what this machine does on somebody's behalf, and `session.ts`'s own header
     * says where those live: *"all of it is main's"*. The renderer holds the
     * peer and the microphone and should have the least authority over when
     * they exist.
     *
     * `did-finish-load` rather than `dom-ready`, and the difference matters:
     * this fires on the window's `load` event, which is after the module script
     * has executed, so the listener that receives this frame is already
     * registered. It also fires again on a reload, which is what makes a
     * development refresh reconnect instead of sitting there mute.
     *
     * Said out loud in both directions. A companion that never opens a session
     * looks exactly like one whose session failed, and only one of those has
     * anything to fix.
     */
    companion.webContents.on('did-finish-load', () => {
      /*
        WHETHER SHE IS ASLEEP, first, and this was missing.

        The branch below returns early when she was left resting, so on that
        launch the renderer was told the halo preference and the shoulder
        control and never told the one fact both of them are read against. It
        starts `asleep = false` and the rig starts `hearing = true`, so
        `haloFor` answered `open` — a filled ring, in her colour, meaning THE
        MICROPHONE IS LIVE — over a companion holding no session at all.

        That is the failure `halo.ts` exists to prevent, running backwards: not
        an open microphone with nothing on screen saying so, but a claim of one
        where there was none. It is also why the halo switch looked dead. The
        switch governs the RESTING hairline and nothing else, by design; on a
        launch where she had been left resting the ring being drawn was `open`,
        which the switch does not touch and must not — so it did nothing in
        either position, on exactly the launch somebody would go looking.

        One frame, before the two preferences, because they decide how a state
        is drawn and this decides which state it is.
      */
      tellCompanion({ type: '__mochi_asleep__', asleep: resting.asleep })
      // The halo preference, before she is drawn doing anything: it decides
      // whether the resting ring is painted at all, and arriving a tick late
      // means one frame of a ring somebody switched off.
      tellCompanion({
        type: '__mochi_halo__',
        when: readHaloWhen(app.getPath('userData')),
      })
      // And the shoulder control, for the same reason and at the same moment:
      // arriving a tick late is one frame of a button somebody switched off.
      tellCompanion({
        type: '__mochi_chip__',
        shown: readShoulderChip(app.getPath('userData')),
      })
      if (resting.asleep) {
        console.log('[voice] she was left resting; no session opened')
        return
      }
      console.log('[voice] opening the first session')
      tellCompanion({ type: '__mochi_reconnect__' })
      armIdleSleep()
    })

    /**
     * The two global keys.
     *
     * Claimed AFTER `resting` is read, because the handlers toggle it — and
     * every refusal is reported where somebody can see it. A key another
     * application owns is an ordinary outcome; a key that silently does nothing
     * is the bug.
     */
    claimed = claimShortcuts({
      rest: () => {
        setAsleep(!resting.asleep)
      },
      hide: () => {
        setHidden(!resting.hidden)
      },
    })
    for (const outcome of claimed) {
      if (outcome.refused === null) {
        console.log(`[keys] ${outcome.accelerator} -> ${outcome.id}`)
        continue
      }
      console.error(`[keys] ${outcome.accelerator} refused: ${outcome.refused}`)
      problems.note('keys', outcome.accelerator, `${outcome.refused} — ${outcome.id} has no key`)
    }

    /**
     * Where the Codex CLI is, looked for once and not awaited.
     *
     * Not on the critical path: `locate` stats directories, and one of them can
     * be a network mount — the reason its `exists` is async at all. She simply
     * cannot look things up for the first second, which nobody will meet.
     */
    /**
     * The Codex profile file, put there once so somebody can find it.
     *
     * Seeded rather than documented-only, for the reason `seedAvatars` exists:
     * a plugin format nobody can see the shape of is not one. It sets nothing,
     * so it changes nothing until it is edited — and it is never overwritten,
     * because once it is on disk it is the user's.
     *
     * `$CODEX_HOME` is Codex's directory. If it is not there, the CLI has never
     * run and there is nothing to configure; creating a half-populated home for
     * another application is not ours to do.
     */
    /**
     * Finish any deletion a previous run left half-done.
     *
     * `sweepDeletions`'s own comment has always said "called at startup, once
     * the transcript store is open", and nothing called it. A tombstone
     * outlives the process that wrote it, so a crash partway through a deletion
     * left a persona whose memory was gone and whose conversations were not —
     * permanently, because the only thing that finishes the job is this.
     *
     * `transcripts()` rather than `archive`, because opening it is the point:
     * the half-done part is usually the transcripts.
     */
    /**
     * v1's persona, and the shape before packages. Once, at startup.
     *
     * Both of these were written, tested, and called by nothing — and
     * `inherited.ts` quarantines `persona.json.migrated` as "the tombstone of a
     * migration that has already happened", which could never be true while
     * nothing performed one. So an upgrading user's `persona.json` sat in
     * userData untouched and unread: they got the built-in, their own character
     * was not lost but was not found either, and nothing anywhere said so.
     *
     * Loose files FIRST. It turns `<name>.json` into `<name>/persona.json`, and
     * the legacy import wants a catalog that already reflects that — otherwise
     * a name taken by a loose file looks free and the import derives an id that
     * collides on the next launch.
     */
    for (const problem of migrateLooseFiles(app.getPath('userData'))) {
      console.error(`[persona] loose file: ${problem.kind}`)
      problems.note('persona', null, `a persona file could not be moved: ${problem.kind}`)
    }
    {
      const userData = app.getPath('userData')
      const catalog = catalogue(userData)
      const migration = migrateLegacyPersona(userData, catalog)
      if (migration.kind === 'imported') {
        console.log(`[persona] v1's persona imported as ${migration.id}`)
      }
      if (migration.kind === 'failed') {
        // The file is never deleted, so this is actionable: it is the persona
        // they wrote, and saying nothing would lose a character while leaving
        // its only copy on disk.
        console.error(`[persona] v1's persona could not be imported: ${migration.problem.kind}`)
        problems.note(
          'persona',
          null,
          `the persona from the previous version could not be imported: ${migration.problem.kind}`,
        )
      }
    }

    try {
      sweepDeletions(app.getPath('userData'), transcripts())
    } catch (error: unknown) {
      // Never a reason not to start. A deletion that cannot be finished this
      // launch is finished the next one, and the tombstone is what remembers.
      console.error('[persona] could not finish an interrupted deletion:', error)
      problems.note(
        'persona',
        null,
        `an interrupted deletion could not be finished: ${String(error)}`,
      )
    }

    /*
      AFTER the v1 import and the deletion sweep, and that order is the point.

      The import can create the characters this has to write to, and the sweep
      can remove ones it would otherwise write to and resurrect. Running before
      either would migrate a catalog that is not yet the catalog.
    */
    /*
      The v1 import can hand back a retention choice it could not file, and
      until this line nothing read it.

      `migrateLegacyPersona` returns `carried` for exactly the case the policy
      store refused the write, and main used only `kind`. The choice was parked
      in her package as `pending-policy.json` and would have been picked up by
      the NEXT load -- so re-reading the catalogue here is enough, and is better
      than threading the value by hand, because it uses the durable record
      rather than a second copy of it that can disagree.

      Without it the window is one whole run: she is imported having asked not
      to be recorded, and is recorded until the app is restarted.
    */
    catalogue(app.getPath('userData'))

    try {
      runBubbleSideMigration({
        userData: () => app.getPath('userData'),
        catalogue,
        savePersona: savePersonaTo,
        log: (line) => {
          console.log(line)
        },
        warn: (line, error) => {
          if (error === undefined) console.error(line)
          else console.error(line, error)
        },
      })
      /*
        Carry the one global permissions setting forward to everybody.

        Permissions became per character in 2026-08. Without this every
        character falls back to DEFAULT_GRANTS on first launch after the
        upgrade, and whatever somebody withheld is silently regranted -- which
        is the worst direction for this particular value to fail in.

        Idempotent: a character who already has a file is skipped, so this runs
        on every launch and stops mattering once everybody is seeded.
      */
      carryGrantsForward(app.getPath('userData'), catalogue, (area, subject, said) => {
        problems.note(area, subject, said)
      })
    } catch (error: unknown) {
      // Never a reason not to start. The cost of not carrying it over is one
      // trip to a dropdown; the cost of refusing to launch is the app.
      console.error('[persona] the bubble side could not be carried over:', error)
    }

    const seeded = seedProfile(codexHome(process.env, app.getPath('home')), (path) =>
      existsSync(path),
    )
    if (seeded.kind === 'written') console.log(`[codex] profile seeded at ${seeded.path}`)
    if (seeded.kind === 'failed') {
      // Reported, not fatal. She can still look things up — the profile is how
      // somebody CONFIGURES a lookup, not what makes one possible.
      console.error(`[codex] could not seed ${seeded.path}: ${seeded.why}`)
      problems.note('codex', seeded.path, `the settings file could not be written: ${seeded.why}`)
    }

    /*
      Three questions, not one, and none of them blocks the window.

      This was a bare `locateCodex`: is there a file called `codex` somewhere on
      this machine. That is the first of the three that decide whether she can
      speak at all — installed, runs, and is its login usable BY US — and it is
      the one that fails least often. The third is the one that actually bites:
      Codex reports itself signed in while holding an expired access token,
      because it owns a refresh token and renews on its next run, and this app
      cannot renew because the JWT's `client_id` is Codex's. A machine in that
      state passed the old check and then failed with a bare 401 the moment
      somebody spoke to her.

      `void`, exactly as before: it spawns two child processes with a deadline
      each, and nothing here waits for them. `codexForWindow` answers
      `timed-out` — the one state whose remedy is "ask again" — for the second
      or two before the first answer lands, which is honest rather than
      convenient.
    */
    void checkCodexNow().then(undefined, (error: unknown) => {
      // Not fatal, and not silent. A check that threw would otherwise leave the
      // status on its "not finished yet" answer for the life of the process.
      console.error('[codex] the readiness check could not be run:', error)
      problems.note('codex', null, `Codex could not be checked: ${String(error)}`)
    })

    tray = createTray(menuModel, menuHandlers)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) companion = createCompanionWindow()
    })
  },
  (error: unknown) => {
    // Fail loud. A main process that dies quietly during startup looks exactly
    // like one that is still working on it.
    console.error('[main] startup failed', error)
    shutDownCleanly('startup failed')
    app.exit(1)
  },
)

/*
  The SECOND callback above catches `whenReady()` REJECTING. It does not catch a
  throw inside the first one — that rejects the promise `then` returns, and the
  `void` in front of it threw the result away, so two hundred lines of startup
  could fail as an unhandled rejection with the app left half-built, no message
  and no exit code.

  Terminal, so nothing after it can swallow this again.
*/
void startup.catch((error: unknown) => {
  console.error('[main] startup threw', error)
  shutDownCleanly('startup threw')
  app.exit(1)
})

/*
  THE LAST RESORT, and there was none.

  Every failure this app knows how to report goes through `problems`, and every
  one of those is a path somebody thought of. This is for the paths nobody
  thought of: an exception escaping a listener, a promise nobody awaited.

  Electron's default for an uncaught exception in main is a dialog and, for an
  unhandled rejection, a warning on a console no user is reading. Neither
  reaches `problems`, so the one class of failure with no handler was also the
  only class invisible in the app's own account of itself.

  NOT fatal. The alternative -- exiting -- turns a broken feature into a lost
  conversation, and this process holds the archive. The exception has already
  happened; the choice here is only whether anybody finds out.
*/
process.on('uncaughtException', (error: Error) => {
  console.error('[main] uncaught', error)
  problems.note('main', null, `something failed unexpectedly: ${error.message}`)
})

process.on('unhandledRejection', (reason: unknown) => {
  console.error('[main] unhandled rejection', reason)
  problems.note('main', null, `something failed unexpectedly: ${String(reason)}`)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

/**
 * Put the archive down cleanly, exactly once, however the app is ending.
 *
 * ## Why not `before-quit`, which is where the end used to live
 *
 * `before-quit` fires before windows run their unload handlers, and a window
 * can CANCEL the quit. Closing there would leave a running app holding a closed
 * database -- every later read and every later turn failing, with no way back
 * except a restart. Ending the conversation there was harmless; closing is not,
 * and the two belong together.
 *
 * `will-quit` only fires once the quit is actually going ahead. The database is
 * fully usable at that point: the process has not begun to exit, and Electron
 * waits for a synchronous handler to return.
 *
 * ## Why the exit paths call it too
 *
 * `app.exit()` emits NEITHER quit event. Both startup failure paths take it, so
 * without this the archive is never closed on the one kind of shutdown where
 * something has already gone wrong.
 *
 * ## Why `finally`
 *
 * The close is what flushes deleted text out of the write-ahead log. If ending
 * the conversation throws, skipping the close would leave that text on disk --
 * the failure ordering that matters most, and the one nobody would see.
 */
function shutDownCleanly(why: string): void {
  if (shutDown) return
  shutDown = true
  console.log(`[main] closing the archive (${why})`)
  /*
    The ORDER, and the argument for it, are in `shutdown.ts`.

    Four things end here and each can throw; run in the wrong order a failure
    in one strands the others, and every one of them leaves something running
    on a machine whose app has visibly quit. That is a sequence with a reason,
    not composition -- and it was untestable here, because `index.ts` cannot be
    imported outside Electron.
  */
  shutDown_({
    stopLookups: () => running.stopAll(),
    unanswered: () => ledger.unanswered(),
    undelivered: () => ledger.undelivered(),
    endConversation: () => {
      // Only one that EXISTS. `conversation()` builds the archive on demand,
      // and `shutDown` is already true by now -- so asking for one that was
      // never needed would throw on the way out of an app with nothing to end.
      if (talk !== null) talk.end()
    },
    closeArchive: () => {
      archive?.close()
      archive = null
    },
    note: (what, detail) => problems.note(what, null, detail),
    log: (line) => {
      console.log(line)
    },
    warn: (line, error) => {
      if (error === undefined) console.error(line)
      else console.error(line, error)
    },
  })
}

/**
 * Give the keys back.
 *
 * A global shortcut outlives the window that wanted it. Without this a relaunch
 * during development finds its own keys already taken — by itself, from the
 * previous run — and reports them as refused.
 */
app.on('will-quit', () => {
  shutDownCleanly('quit')
  releaseShortcuts()
})
