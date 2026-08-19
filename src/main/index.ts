import { join } from 'node:path'
import { app, BrowserWindow, clipboard, ipcMain, Menu, shell } from 'electron'
import { existsSync, mkdirSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { BUILT_IN_ID, greetingFor, instructionsFor, VOICE_NAMES } from '@shared/persona'
import { createRegistry } from '@shared/capability/registry'
import { heardPortion } from './heard'
import { whenToReconnect } from '@shared/realtime/reconnect'
import {
  REVEALABLE,
  type PersonaAction,
  type PersonaChange,
  type Revealable,
  type SettingsView,
  type SettingsWrite,
  type VoiceReport,
} from '@shared/ipc'
import { CAPABILITIES } from '../capabilities'
import { createLedger, type AnswerFrame } from './capability/ledger'
import { handleCall } from './capability/dispatch'
import {
  describeProblem,
  exchangeSdp,
  mintEphemeralKey,
  readBearer,
  type Minted,
} from './voice/credential'
import {
  activePersona,
  copyPersonaTo,
  deletePersona,
  discardWrite,
  loadPersonas,
  migrateLegacyPersona,
  migrateLooseFiles,
  personasRoot,
  restoreBuiltIn,
  savePersonaTo,
  sweepDeletions,
} from './store/personas'
import { readPolicy } from './store/policy'
import {
  readBubbleSide,
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
  writeBubbleSide,
  writeResting,
  writeWornPersonaId,
  type BubbleSide,
  type Resting,
} from './store/worn'
import { claimShortcuts, releaseShortcuts, type ShortcutOutcome } from './shortcuts'
import { SHORTCUTS } from '@shared/shortcuts'
import { avatarsRoot, seedAvatars, resolveFaceFor } from './store/avatars'
import { setAsideV1 } from './store/inherited'
import { createProblems } from './problems'
import { leftoverCapabilities, legacyCapabilitiesRoot } from './capability/legacy'
import type { CapabilityDeps } from '../capabilities/kind'
import { isLocated, locateCodex } from '../capabilities/ask-workspace/locate'
import {
  codexHome,
  profileFile,
  profileFor,
  seedProfile,
} from '../capabilities/ask-workspace/profile'
import { createTray, trayMenuTemplate, type TrayHandle, type TrayModel } from './tray'
import { parseGrip, startDrag, stopDrag } from './drag'
import { FEET_FROM_TOP, WINDOW_W } from '@shared/avatar-layout'

/**
 * Her body before the renderer has said where it is — the same nominal one the
 * window was first positioned against.
 */
const NOMINAL_BODY = { left: (WINDOW_W - 94) / 2, top: FEET_FROM_TOP - 73, width: 94, height: 73 }
import {
  applyChange,
  applyLookup,
  folderFor,
  listLookup,
  listAvatars,
  listCapabilities,
  listPersonas,
  refuse,
} from './settings'
import { packageFolder } from './store/personas'
import { createTranscripts, type Transcripts } from './store/transcripts'
import { createConversation, type Conversation } from './store/conversation'
import { previousNote, recall, recallState, remember } from './store/memory'
import { createCompanionWindow, showHistoryWindow, showSettingsWindow } from './window'

// The same string as `appId` in `electron-builder.yml`. Two spellings of an
// application's identity is how a notification arrives attributed to nothing and
// a taskbar grows a second entry for the app that is already running.
const APP_USER_MODEL_ID = 'com.mochi.companion'

app.setAppUserModelId(APP_USER_MODEL_ID)

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
const problems = createProblems()

/**
 * What she can do, decided at build time.
 *
 * No directory is read and nothing is merged: `src/capabilities/index.ts` globs
 * the folders into a static map, so a manifest that reaches this line has a
 * handler beside it by construction. See that file for why the plugin system in
 * a fork-and-build project is the build system.
 */
const registry = createRegistry(CAPABILITIES.manifests)

/**
 * Where the Codex CLI is, found once and remembered.
 *
 * Resolved rather than shelled out to — see `ask-workspace/locate.ts` for why, and for the
 * machine on the fleet where every shell-based lookup reports it missing. Null
 * means genuinely absent, which she says out loud rather than answering from
 * memory.
 */
let codexPath: string | null = null

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
  const catalog = loadPersonas(userData, {}, existsSync(personasRoot(userData)))
  return {
    personas: [...catalog.personas.values()].map((one) => ({ id: one.id, name: one.name })),
    wornId: activePersona(catalog, readWornPersonaId(userData)).persona.id,
    bubble: { ...bubbleSides, asked: readBubbleSide(userData) },
    resting,
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
 * Send her to sleep, or wake her. One implementation, three ways to ask.
 *
 * Asleep is about her ATTENTION — the microphone closes and her eyes shut — and
 * is deliberately not the same thing as hidden, which is about the screen.
 */
function setAsleep(asleep: boolean): void {
  if (asleep === resting.asleep) return
  resting = { ...resting, asleep }
  writeResting(app.getPath('userData'), { asleep })
  companion?.webContents.send('voice:send', { type: '__mochi_asleep__', asleep })
  console.log(`[rest] ${asleep ? 'asleep' : 'awake'}`)
  tray?.refresh()
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
 * Which sides the bubble can currently go on, as last reported by the renderer.
 *
 * Held rather than asked for, because the menu is built the moment somebody
 * clicks the icon and the renderer cannot be questioned synchronously. It goes
 * stale only between her being dragged and the next frame, and a stale entry
 * costs nothing: a side that no longer fits is not honoured either way.
 */
let bubbleSides: { available: readonly string[]; using: string } = {
  available: ['above'],
  using: 'above',
}

ipcMain.on('companion:sides', (_event, value: unknown) => {
  if (typeof value !== 'object' || value === null) return
  const said = value as { available?: unknown; using?: unknown }
  if (!Array.isArray(said.available) || typeof said.using !== 'string') return
  bubbleSides = {
    available: said.available.filter((one): one is string => typeof one === 'string'),
    using: said.using,
  }
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
  onConversations: () => {
    showHistoryWindow()
  },
  onSettings: () => {
    showSettingsWindow()
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
    try {
      writeBubbleSide(app.getPath('userData'), side as BubbleSide)
    } catch (error: unknown) {
      console.error(`[menu] could not set the bubble side: ${String(error)}`)
      return
    }
    // Straight to the renderer as well as to disk: the file is read on the next
    // session, and somebody who picked a side wants to see it move now.
    companion?.webContents.send('voice:send', { type: '__mochi_bubble_side__', side })
    tray?.refresh()
  },
  onQuit: () => {
    app.quit()
  },
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

/**
 * How far into her window she is standing.
 *
 * Normally `FEET_FROM_TOP`. It shrinks when she is dragged against the top of
 * the display, because macOS will not lift the window any further and she rises
 * inside it instead — see `dragTo`. Held here because main is what moves her.
 */
let herFeet: number = FEET_FROM_TOP

ipcMain.on('companion:body', (_event, value: unknown) => {
  if (typeof value !== 'object' || value === null) return
  const box = value as Record<string, unknown>
  const read = (key: string): number | null => {
    const found = box[key]
    return typeof found === 'number' && Number.isFinite(found) && found >= 0 ? found : null
  }
  const left = read('left')
  const top = read('top')
  const width = read('width')
  const height = read('height')
  // A zero-sized body would make the clamp meaningless in both directions.
  if (left === null || top === null || width === null || height === null) return
  if (width <= 0 || height <= 0) return
  herBody = { left, top, width, height }
})

ipcMain.on('companion:grab', (_event, value: unknown) => {
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
    FEET_FROM_TOP,
  )
})

ipcMain.on('companion:drop', () => {
  stopDrag()
})

ipcMain.on('companion:wake', () => {
  setAsleep(false)
})

ipcMain.on('companion:menu', () => {
  if (companion === null) return
  Menu.buildFromTemplate(trayMenuTemplate(menuModel(), menuHandlers, app.getName())).popup({
    window: companion,
  })
})

const ledger = createLedger({
  registry,
  // `isDestroyed` as well as null. A window that has been closed is still a
  // non-null `BrowserWindow`, and `send` on its `webContents` throws — which
  // used to come back out of the `voice:call` listener. Nothing is lost by
  // skipping it: there is no conversation left on the other side.
  send: (frame: AnswerFrame) => {
    if (companion === null || companion.isDestroyed()) return
    companion.webContents.send('voice:send', frame)
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
  companion?.webContents.send('voice:send', { type: '__mochi_problems__', count })
})

/**
 * The archive, opened once and lazily.
 *
 * Lazily because `app.getPath('userData')` is not answerable before the app is
 * ready, and once because `node:sqlite` is a file handle — a second connection
 * to the same database is a second writer, and this one is the only writer.
 */
let archive: Transcripts | null = null
let talk: Conversation | null = null

function conversation(): Conversation {
  if (talk === null) {
    const userData = app.getPath('userData')
    archive ??= createTranscripts(userData)
    talk = createConversation({
      transcripts: archive,
      // Read per turn, inside the module. Turning saving off has to take effect
      // on the next thing said, not on the next wake.
      keeps: (personaId) => readPolicy(userData, personaId).keeps,
      log: (text) => console.log(`[archive] ${text}`),
    })
  }
  return talk
}

/** Who is worn right now. Read by the handlers, which search only her archive. */
let wearing: string | null = null

/**
 * The archive, opened if it is not already.
 *
 * `conversation()` opens it as a side effect of starting a conversation, which
 * is fine while the only reader is a live session. The conversations window can
 * be opened before she has ever spoken, so it needs a way in that does not
 * begin one.
 */
function transcripts(): Transcripts {
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
const capabilityDeps: CapabilityDeps = {
  userData: () => app.getPath('userData'),
  wearing: () => wearing,
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
    const catalog = loadPersonas(userData, {}, existsSync(personasRoot(userData)))
    const ids = new Set(catalog.personas.keys())
    if (wearing !== null) ids.delete(wearing)
    return ids
  },
  codexPath: () => codexPath,
  workspace: () => readWorkspace(app.getPath('userData')),
  guardStopAt: () => {
    const userData = app.getPath('userData')
    return guardStopAt(userData, readWorkspace(userData))
  },
  webSearch: () => readWebSearch(app.getPath('userData')),
  codexProfile: currentProfile,
  now: () => Date.now(),
}

/** Held so a second open replaces the first rather than racing it. */
let minted: Minted | null = null
let reconnectTimer: NodeJS.Timeout | null = null

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
  minted = result.value
  console.log(`[voice] minted for ${minted.model}`)
  // The KEY does not go back. The renderer gets only what it needs to know that
  // the mint worked; `voice:sdp` is where the key is actually used, in main.
  return { ok: true, key: '', model: minted.model }
})

ipcMain.handle('voice:sdp', async (_event, offer: unknown) => {
  if (typeof offer !== 'string' || offer.length === 0) return { ok: false, why: 'no offer' }
  if (minted === null) return { ok: false, why: 'no session has been minted' }
  const answered = await exchangeSdp({ offer, minted })
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
  const userData = app.getPath('userData')
  // Whether this installation has run before decides whether a one-time
  // retention migration may run at all — a permissive default there would let a
  // hand-placed package choose somebody's retention on a first launch.
  const ranBefore = existsSync(personasRoot(userData))
  const catalog = loadPersonas(userData, {}, ranBefore)
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
  wearing = resolved.persona.id

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
  console.log(
    `[persona] ${resolved.persona.name} (${resolved.persona.id}), voice ${resolved.persona.voice}, note ${note.length} chars, bubble ${resolved.persona.bubble ? 'on' : 'off'}`,
  )
  return {
    instructions: instructionsFor(resolved.persona, note),
    voice: resolved.persona.voice,
    bubble: resolved.persona.bubble,
    greeting: greetingFor(resolved.persona),
    face: avatar.face,
    problems: problems.count(),
    bubbleSide: readBubbleSide(userData),
    asleep: resting.asleep,
    tools: registry.tools,
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
ipcMain.on('voice:call', (_event, name: unknown, callId: unknown, args: unknown) => {
  if (typeof name !== 'string' || typeof callId !== 'string') return
  handleCall(
    {
      capabilities: CAPABILITIES.byName,
      deps: capabilityDeps,
      ledger,
      note: (capability, detail) => problems.note('capability', capability, detail),
      log: (line) => console.log(line),
      warn: (line, error) => {
        if (error === undefined) console.error(line)
        else console.error(line, error)
      },
    },
    { name, callId, args },
  )
})

ipcMain.on('voice:report', (_event, report: unknown) => {
  const event = report as VoiceReport
  if (event?.kind === 'expiry') {
    const schedule = whenToReconnect({ expiresAt: event.expiresAt, now: Date.now() })
    if (reconnectTimer !== null) clearTimeout(reconnectTimer)
    if (schedule.kind === 'unusable') {
      // Never silently "then never reconnect": the session still dies in an hour.
      console.error(`[voice] cannot schedule a reconnect: ${schedule.why}`)
      problems.note('voice', null, `cannot schedule a reconnect: ${schedule.why}`)
      return
    }
    const ms = schedule.kind === 'in' ? schedule.ms : 0
    console.log(
      `[voice] session expires in ${event.expiresAt - Date.now() / 1000}s; reconnect in ${Math.round(ms / 1000)}s`,
    )
    reconnectTimer = setTimeout(() => {
      console.log('[voice] reconnect due')
      companion?.webContents.send('voice:send', { type: '__mochi_reconnect__' })
    }, ms)
    return
  }
  if (event?.kind === 'heard') {
    console.log(`[voice] heard: ${event.transcript}`)
    conversation().file('you', event.transcript)
    return
  }
  if (event?.kind === 'said') {
    if (event.heard === null) {
      // She finished: everything generated was spoken.
      console.log(`[voice] said: ${event.transcript}`)
      conversation().file('her', event.transcript)
      return
    }
    const heard = heardPortion(event.transcript, event.heard.at)
    console.log(
      `[voice] said (cut): ${heard.length} of ${event.transcript.length} chars — "${heard.slice(-48)}"`,
    )
    // The interruption's timestamp, not this frame's: the transcript can arrive
    // 16 seconds late, which would file her fragment AFTER the user turn that
    // cut it off and reverse the archive's order.
    conversation().file('her', heard, { cut: true, at: event.heard.interruptedAt })
    return
  }
  if (event?.kind === 'pointer') {
    // The window is a square of empty pixels with a mochi somewhere in it.
    // Without this the invisible corners swallow clicks, and the failure is
    // silent — nothing looks wrong, the click just goes nowhere.
    //
    // `forward: true` on the ignore case so `mousemove` keeps arriving; without
    // it she becomes blind the moment she becomes click-through, and can never
    // report that the cursor came back.
    companion?.setIgnoreMouseEvents(!event.onHer, { forward: true })
    return
  }
  if (event?.kind === 'state') console.log(`[voice] ${event.state}`)
  if (event?.kind === 'note') console.log(`[voice] ${event.text}`)
})

/**
 * The conversations window: open it, and answer what it asks.
 *
 * **Every handler here reads `wearing`, and none of them takes a persona.**
 * That is the whole security property: the window holds opaque tokens that
 * authorise nothing, so a compromised page can ask for hers and only hers. It
 * is the same rule `voice:config` follows — who she is, is main's to know.
 *
 * `wearing` is null until the first session configures itself. Answering empty
 * then is right and is not an error state: nothing is being worn, so there is
 * no "her" whose conversations these would be.
 */
ipcMain.on('clipboard:write', (_event, text: unknown) => {
  // Checked, not trusted: this comes from a renderer, and `writeText` will take
  // whatever it is given. Bounded because the clipboard is shared with every
  // other application on the machine.
  if (typeof text !== 'string' || text === '') return
  clipboard.writeText(text.slice(0, 100_000))
  console.log(`[clipboard] ${text.length} chars`)
})

ipcMain.on('history:open', () => {
  showHistoryWindow()
})

ipcMain.handle('history:list', () => {
  const persona = wearing
  if (persona === null) return { persona: '', conversations: [] }
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
  const persona = wearing
  // Checked here, not trusted from the page. A token is a string; anything else
  // is a caller that built the wrong object, and passing it through would reach
  // the query layer with a shape it never agreed to take.
  if (persona === null || typeof token !== 'string') return []
  return transcripts()
    .turns(persona, token)
    .map((one) => ({ at: one.at, who: one.who, text: one.text, cut: one.cut }))
})

ipcMain.handle('history:problems', () => problems.all())

ipcMain.on('history:settings', () => {
  showSettingsWindow()
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
  const catalog = loadPersonas(userData, {}, existsSync(personasRoot(userData)))
  const worn = activePersona(catalog, readWornPersonaId(userData))
  return {
    wornId: worn.persona.id,
    personas: listPersonas(catalog),
    avatars: listAvatars(avatarsRoot(userData)),
    voices: [...VOICE_NAMES],
    capabilities: listCapabilities(registry),
    note: {
      text: recall(userData, worn.persona.id),
      previous: previousNote(userData, worn.persona.id),
    },
    lookup: listLookup({
      workspace: readWorkspace(userData),
      defaultWorkspace: join(userData, WORKSPACE_DIR),
      webSearch: readWebSearch(userData),
      profile: currentProfile(),
      profilePath: (() => {
        const name = currentProfile()
        return name === null ? null : profileFile(codexHome(process.env, app.getPath('home')), name)
      })(),
    }),
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
  const catalog = loadPersonas(userData, {}, existsSync(personasRoot(userData)))
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

ipcMain.handle('settings:wear', (_event, id: unknown): SettingsWrite => wearPersona(id))

/**
 * Change a persona, field by field, and write her back where she came from.
 *
 * `applyChange` decides what may be touched — a spread would have let a page
 * set `id`, which keys her memory — and `savePersonaTo` decides WHERE it lands:
 * an overlay for the built-in, the package itself for everyone else. Neither
 * decision is the renderer's, and neither is made twice.
 */
ipcMain.handle('settings:save', (_event, change: unknown): SettingsWrite => {
  if (typeof change !== 'object' || change === null) return refuse('That is not a change.')
  const asked = change as PersonaChange
  if (typeof asked.id !== 'string') return refuse('That change does not name a persona.')

  const userData = app.getPath('userData')
  const catalog = loadPersonas(userData, {}, existsSync(personasRoot(userData)))
  const persona = catalog.personas.get(asked.id)
  if (persona === undefined) return refuse(`There is no persona called ${asked.id}.`)

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
ipcMain.handle('settings:memory', (_event, action: unknown): SettingsWrite => {
  if (typeof action !== 'object' || action === null) return refuse('That is not something to do.')
  const kind = (action as { kind?: unknown }).kind
  if (kind !== 'restore' && kind !== 'clear') return refuse('That is not something to do.')

  const userData = app.getPath('userData')
  const catalog = loadPersonas(userData, {}, existsSync(personasRoot(userData)))
  const worn = activePersona(catalog, readWornPersonaId(userData)).persona.id

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
 * Make a persona, copy one, remove one, or put the built-in back.
 *
 * The id is DERIVED here from the name, never taken from the page —
 * `copyPersonaTo` derives it against the ids already taken and the ones a
 * pending deletion still reserves. An id chosen by a renderer would be a
 * renderer choosing whose memory and whose conversations a new character
 * inherits, which is the whole reason `deriveId` is told about tombstones.
 */
ipcMain.handle('settings:persona', (_event, action: unknown): SettingsWrite => {
  if (typeof action !== 'object' || action === null) return refuse('That is not something to do.')
  const asked = action as PersonaAction
  const userData = app.getPath('userData')
  const catalog = loadPersonas(userData, {}, existsSync(personasRoot(userData)))

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

ipcMain.on('settings:reveal', (_event, what: unknown) => {
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

ipcMain.handle('history:search', (_event, query: unknown) => {
  const persona = wearing
  if (persona === null || typeof query !== 'string') return []
  return transcripts()
    .search(persona, query)
    .map((one) => ({ token: one.token, at: one.at, who: one.who, text: one.text }))
})

void app.whenReady().then(
  () => {
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

    companion = createCompanionWindow()

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
      const catalog = loadPersonas(userData, {}, existsSync(personasRoot(userData)))
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

    void locateCodex({
      platform: process.platform,
      env: process.env,
      home: app.getPath('home'),
      exists: async (path) => {
        try {
          const info = await stat(path)
          return info.isFile()
        } catch {
          return false
        }
      },
      list: async (directory) => {
        try {
          return await readdir(directory)
        } catch {
          return []
        }
      },
    }).then((found) => {
      if (isLocated(found)) {
        codexPath = found.path
        console.log(`[codex] ${found.path}`)
        return
      }
      // Loud, and reported. Without the CLI she cannot look anything up, and
      // the failure otherwise presents as her declining to help.
      console.error(`[codex] not found; looked in ${String(found.searched.length)} places`)
      problems.note(
        'codex',
        null,
        'the Codex CLI could not be found, so she cannot look anything up',
      )
    }, undefined)

    tray = createTray(menuModel, menuHandlers)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) companion = createCompanionWindow()
    })
  },
  (error: unknown) => {
    // Fail loud. A main process that dies quietly during startup looks exactly
    // like one that is still working on it.
    console.error('[main] startup failed', error)
    app.exit(1)
  },
)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// The last chance to close the conversation cleanly. `before-quit` rather than
// `will-quit`, because the database has to still be usable when it runs.
app.on('before-quit', () => conversation().end())

/**
 * Give the keys back.
 *
 * A global shortcut outlives the window that wanted it. Without this a relaunch
 * during development finds its own keys already taken — by itself, from the
 * previous run — and reports them as refused.
 */
app.on('will-quit', releaseShortcuts)
