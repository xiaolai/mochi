import { join } from 'node:path'
import { app, BrowserWindow, clipboard, ipcMain, shell } from 'electron'
import { existsSync, mkdirSync } from 'node:fs'
import { greetingFor, instructionsFor, VOICE_NAMES } from '@shared/persona'
import { createRegistry } from '@shared/capability/registry'
import { heardPortion } from './heard'
import { whenToReconnect } from '@shared/realtime/reconnect'
import {
  REVEALABLE,
  type PersonaChange,
  type Revealable,
  type SettingsView,
  type SettingsWrite,
  type VoiceReport,
} from '@shared/ipc'
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
import { activePersona, loadPersonas, personasRoot, savePersonaTo } from './store/personas'
import { readPolicy } from './store/policy'
import { readWornPersonaId, writeWornPersonaId } from './store/worn'
import { avatarsRoot, seedAvatars, resolveFaceFor } from './store/avatars'
import { setAsideV1 } from './store/inherited'
import { createProblems } from './problems'
import { createTray, type TrayHandle } from './tray'
import { discoverInstalled, type Installed } from './capability/installed'
import {
  applyChange,
  folderFor,
  listAvatars,
  listCapabilities,
  listPersonas,
  refuse,
} from './settings'
import { packageFolder } from './store/personas'
import { createTranscripts, type Transcripts } from './store/transcripts'
import { createConversation, type Conversation } from './store/conversation'
import { recall } from './store/memory'
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

/**
 * Everything that went wrong, kept where somebody can be shown it.
 *
 * Each `console.error` below has a companion line here. The console is for
 * whoever launched this from a terminal; a packaged app has no console, and
 * every one of these paths falls back to something that works — so from the
 * outside a rejected file is indistinguishable from the app ignoring it.
 */
const problems = createProblems()

const loaded = loadCapabilities(builtinCapabilities())
for (const problem of loaded.problems) {
  // Loud. A capability that failed to load is a thing she can no longer do, and
  // silence here presents as her declining to do it.
  console.error(`[capability] ${problem.folder}: ${problem.kind}`)
  problems.note('capability', problem.folder, problem.kind)
}
const registry = createRegistry(loaded.manifests, [])
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
 * What is in the user's capabilities folder, read once at startup.
 *
 * Once rather than per session: unlike the persona and the note, nothing here
 * can take effect until a sandbox exists, so re-reading it mid-run would only
 * change what is REPORTED — and a report that changes without the app
 * restarting is a report nobody can act on.
 */
let installed: Installed = { root: '', manifests: [], problems: [] }

const ledger = createLedger({
  registry,
  send: (frame: AnswerFrame) => companion?.webContents.send('voice:send', frame),
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
      problems.note('capability', name, String(error))
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
    capabilities: listCapabilities(registry, installed),
    folders: {
      avatars: folderFor(userData, 'avatars'),
      personas: folderFor(userData, 'personas'),
      capabilities: folderFor(userData, 'capabilities'),
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
     * What somebody installed: found, named, and not run.
     *
     * W2's first step. The registry is the thing that refuses — see
     * `execution-unavailable` — so this cannot become "we forgot to pass them
     * along and it worked by accident". What happens here is only the telling.
     *
     * Reported through `problems` because that is the surface for "something
     * you put in a folder did not take effect", which is exactly this. A folder
     * nobody has created produces nothing, because a person with no
     * capabilities installed has not made a mistake.
     */
    installed = discoverInstalled(app.getPath('userData'))
    for (const problem of installed.problems) {
      console.error(`[capability] installed/${problem.folder}: ${problem.kind}`)
      problems.note('capability', problem.folder, problem.kind)
    }
    for (const manifest of installed.manifests) {
      console.log(`[capability] installed/${manifest.name}: found, NOT run`)
      problems.note(
        'capability',
        manifest.name,
        'found in your capabilities folder, and not run — this build has no sandbox for ' +
          'third-party capability code, so she is not told it exists either',
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
    tray = createTray(
      () => {
        const userData = app.getPath('userData')
        const catalog = loadPersonas(userData, {}, existsSync(personasRoot(userData)))
        return {
          personas: [...catalog.personas.values()].map((one) => ({ id: one.id, name: one.name })),
          wornId: activePersona(catalog, readWornPersonaId(userData)).persona.id,
        }
      },
      {
        onConversations: () => {
          showHistoryWindow()
        },
        onSettings: () => {
          showSettingsWindow()
        },
        onWear: (id) => {
          const written = wearPersona(id)
          // The menu has already drawn the radio as moved. Saying nothing when
          // the write failed would leave it lying about what is on disk.
          if (!written.ok) console.error(`[tray] could not wear ${id}: ${written.why}`)
          tray?.refresh()
        },
        onQuit: () => {
          app.quit()
        },
      },
    )

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
