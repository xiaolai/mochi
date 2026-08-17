import { join } from 'node:path'
import { app, BrowserWindow, ipcMain } from 'electron'
import { existsSync } from 'node:fs'
import { instructionsFor } from '@shared/persona'
import { createRegistry } from '@shared/capability/registry'
import { whenToReconnect } from '@shared/realtime/reconnect'
import type { VoiceReport } from '@shared/ipc'
import { loadCapabilities } from './capability/load'
import { createLedger, type AnswerFrame } from './capability/ledger'
import { builtinHandlers, handlerFor } from './capability/handlers'
import {
  describeProblem,
  exchangeSdp,
  mintEphemeralKey,
  readBearer,
  type Minted,
} from './voice/credential'
import { activePersona, loadPersonas, personasRoot } from './store/personas'
import { readPolicy } from './store/policy'
import { readWornPersonaId } from './store/worn'
import { createTranscripts, type Transcripts } from './store/transcripts'
import { createConversation, type Conversation } from './store/conversation'
import { recall } from './store/memory'
import { createCompanionWindow } from './window'

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
 * Where the shipped capabilities live.
 *
 * `extraResources` in `electron-builder.yml` puts them beside the bundle rather
 * than inside the asar, because they are read through `process.resourcesPath`
 * and that path cannot reach into an archive.
 */
function builtinCapabilities(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'capabilities')
    : join(app.getAppPath(), 'resources', 'capabilities')
}

const loaded = loadCapabilities(builtinCapabilities())
for (const problem of loaded.problems) {
  // Loud. A capability that failed to load is a thing she can no longer do, and
  // silence here presents as her declining to do it.
  console.error(`[capability] ${problem.folder}: ${problem.kind}`)
}
const registry = createRegistry(loaded.manifests, [])
console.log(
  `[capability] ${registry.tools.length} available: ${registry.tools.map((t) => t.name).join(', ')}`,
)

/** The one window, and the only thing frames can be sent through. */
let companion: BrowserWindow | null = null

const ledger = createLedger({
  registry,
  send: (frame: AnswerFrame) => companion?.webContents.send('voice:send', frame),
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

const handlers = builtinHandlers({
  // Functions, not values: the store opens lazily and the persona changes on
  // every session, so a handler asking at call time gets the current answer
  // rather than whatever was true when this file was evaluated.
  transcripts: () => archive,
  wearing: () => wearing,
})

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
  }
  // Which persona was last worn, remembered across restarts. Getting this wrong
  // is not cosmetic: the archive is scoped per persona, so defaulting to the
  // built-in on an installation whose history is under another name shows her
  // an empty memory and presents as "recall does not work".
  const resolved = activePersona(catalog, readWornPersonaId(userData))
  if (resolved.problem !== null) console.error(`[persona] ${resolved.problem.kind}`)

  // A new session is a new conversation. Ending the previous one here rather
  // than on teardown covers the reconnect path too, which is the common case:
  // §53 measured a session lasting exactly an hour, so this happens hourly.
  // A new session is a new conversation. Doing it here rather than on teardown
  // covers the reconnect path too, which is the common case: §53 measured a
  // session lasting exactly an hour, so this happens hourly.
  conversation().wear(resolved.persona.id)
  wearing = resolved.persona.id

  const note = recall(userData, resolved.persona.id)
  console.log(
    `[persona] ${resolved.persona.name} (${resolved.persona.id}), voice ${resolved.persona.voice}, note ${note.length} chars`,
  )
  return {
    instructions: instructionsFor(resolved.persona, note),
    voice: resolved.persona.voice,
    tools: registry.tools,
  }
})

/**
 * She called something. This is the only place that decides what runs.
 *
 * Nothing implements the three shipped capabilities yet, so every call is
 * ANSWERED with that fact rather than left hanging — an unanswered call leaves
 * the conversation waiting for a frame that is not coming, for the rest of the
 * session, and she has no way to say so.
 */
ipcMain.on('voice:call', (_event, name: unknown, callId: unknown, args: unknown) => {
  if (typeof name !== 'string' || typeof callId !== 'string') return
  const arrival = ledger.arrived({ name, callId, args })
  if (arrival.kind !== 'accepted') {
    console.log(`[capability] ${name}: ${arrival.kind}`)
    return
  }
  console.log(`[capability] ${name}(${JSON.stringify(arrival.args)})`)

  // Every path answers. A handler that throws is still a call that must be
  // settled — an unanswered one sits in the conversation for the rest of the
  // session and she has no way to mention it.
  void (async () => {
    try {
      const output = await handlerFor(handlers, name)(arrival.args)
      ledger.answer(callId, output)
      console.log(`[capability] ${name} -> ${JSON.stringify(output).slice(0, 120)}`)
    } catch (error: unknown) {
      console.error(`[capability] ${name} threw:`, error)
      ledger.answer(callId, {
        status: 'unavailable',
        guidance: 'That did not work just now. Say so plainly rather than guessing at a result.',
      })
    }
  })()
})

ipcMain.on('voice:report', (_event, report: unknown) => {
  const event = report as VoiceReport
  if (event?.kind === 'expiry') {
    const schedule = whenToReconnect({ expiresAt: event.expiresAt, now: Date.now() })
    if (reconnectTimer !== null) clearTimeout(reconnectTimer)
    if (schedule.kind === 'unusable') {
      // Never silently "then never reconnect": the session still dies in an hour.
      console.error(`[voice] cannot schedule a reconnect: ${schedule.why}`)
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
    console.log(`[voice] said: ${event.transcript}`)
    conversation().file('her', event.transcript)
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

void app.whenReady().then(
  () => {
    companion = createCompanionWindow()

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
