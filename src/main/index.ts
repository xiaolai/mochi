import { join } from 'node:path'
import { app, BrowserWindow, ipcMain } from 'electron'
import { createRegistry } from '@shared/capability/registry'
import { whenToReconnect } from '@shared/realtime/reconnect'
import type { VoiceReport } from '@shared/ipc'
import { loadCapabilities } from './capability/load'
import { createLedger, type AnswerFrame } from './capability/ledger'
import {
  describeProblem,
  exchangeSdp,
  mintEphemeralKey,
  readBearer,
  type Minted,
} from './voice/credential'
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

ipcMain.handle('voice:tools', () => registry.tools)

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
  ledger.answer(callId, {
    error: `${name} is declared but not built yet in this version`,
  })
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
