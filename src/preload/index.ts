/**
 * The bridge, and there is only ever ONE preload file.
 *
 * Not because two would be untidy: rollup lifts the shared modules of two
 * entries into a chunk, and a sandboxed preload may not `require` a relative
 * path -- so both windows end up with no bridge at all. Types, unit tests and
 * the build all stay green; it is visible only by running the thing. When a
 * second window arrives its role comes from `additionalArguments`, never from a
 * second file.
 */

import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC,
  ROLE_FLAG,
  roleFromArgv,
  type AttemptId,
  type Appearance,
  type CompanionBridge,
  type DragStartPayload,
  type SettingsBridge,
  type SettingsSnapshot,
  type VoiceCommand,
  type VoiceReport,
} from '@shared/ipc'
import type { Persona } from '@shared/persona'
import type { Phase } from '@shared/companion'

/**
 * One channel subscription, so four of them cannot drift apart.
 *
 * Each of these was the same five lines with a different channel and payload
 * type: wrap the listener, `on`, return a closure that removes exactly that
 * wrapper. Two different wrong teardowns compile and look right, and they fail
 * in OPPOSITE directions -- which is why they are worth naming separately:
 *
 * - `removeAllListeners(channel)` removes too much. It tears down every other
 *   subscriber on that channel as well, so unsubscribing one thing silently
 *   stops another that has nothing to do with it.
 * - `removeListener(channel, listener)` removes too little. `on` was given
 *   `handler`, not `listener`, so this matches nothing and leaks one listener
 *   per subscribe.
 *
 * Written once, it is either right everywhere or wrong everywhere.
 */
function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: unknown, payload: T): void => listener(payload)
  ipcRenderer.on(channel, handler)
  // The SAME `handler`, not the caller's `listener` -- `removeListener` compares
  // by identity and the wrapper is what was registered.
  return () => ipcRenderer.removeListener(channel, handler)
}

/**
 * Ceilings applied on this side of the bridge.
 *
 * Main enforces its own and those are the authoritative ones — a compromised
 * renderer can reach `ipcRenderer` only through what is exposed here, but a
 * bug on this side must never be the only thing standing between it and main.
 * These exist so the cost of being refused is paid by the sender.
 */
const MAX_OFFER = 64 * 1024
const MAX_REASON = 300

const bridge: CompanionBridge = {
  setInteractive: (interactive: boolean) => ipcRenderer.send(IPC.setInteractive, interactive),
  dragStart: (payload: DragStartPayload) => ipcRenderer.send(IPC.dragStart, payload),
  dragEnd: () => ipcRenderer.send(IPC.dragEnd),
  getAppearance: () => ipcRenderer.invoke(IPC.getAppearance),
  onAppearance: (listener) => subscribe<Appearance>(IPC.appearanceChanged, listener),
  mintKey: (attempt: AttemptId) => ipcRenderer.invoke(IPC.mintKey, attempt),
  exchangeSdp: (attempt: AttemptId, offer: string) =>
    // Bounded HERE as well as in main, and the duplication is the point: main's
    // check happens after the string has been structured-cloned across the
    // bridge and into the main process, so an unbounded offer costs that
    // serialisation before anything rejects it. Refusing early keeps a
    // renderer from spending main's memory to be told no.
    offer.length > MAX_OFFER
      ? Promise.resolve({ ok: false as const, reason: 'offer too large' })
      : ipcRenderer.invoke(IPC.exchangeSdp, attempt, offer),
  ready: () => ipcRenderer.send(IPC.rendererReady),
  // Trimmed before it crosses, for the same reason. Main validates and bounds
  // it again -- this side is not a security boundary, it is the cheap half.
  reportVoice: (report: VoiceReport) =>
    ipcRenderer.send(IPC.voiceEvent, {
      ...report,
      ...('reason' in report && typeof report.reason === 'string'
        ? { reason: report.reason.slice(0, MAX_REASON) }
        : {}),
    }),
  onVoiceCommand: (listener) => subscribe<VoiceCommand>(IPC.voiceCommand, listener),
  onPhase: (listener) => subscribe<Phase>(IPC.phaseChanged, listener),
}

const settings: SettingsBridge = {
  platform: process.platform,
  read: () => ipcRenderer.invoke(IPC.getSettings),
  savePersona: (persona: Persona) => ipcRenderer.invoke(IPC.savePersona, persona),
  saveSize: (percent: number) => ipcRenderer.invoke(IPC.saveSize, percent),
  openExternal: (url: string) => ipcRenderer.invoke(IPC.openExternal, url),
  saveShortcuts: (shortcuts) => ipcRenderer.invoke(IPC.saveShortcuts, shortcuts),
  saveAuth: (next) => ipcRenderer.invoke(IPC.saveAuth, next),
  checkAuth: () => ipcRenderer.invoke(IPC.checkAuth),
  saveTheme: (theme) => ipcRenderer.invoke(IPC.saveTheme, theme),
  saveSound: (sound) => ipcRenderer.invoke(IPC.saveSound, sound),
  saveIdle: (idleMs) => ipcRenderer.invoke(IPC.saveIdle, idleMs),
  saveDelegation: (delegation) => ipcRenderer.invoke(IPC.saveDelegation, delegation),
  saveSpokenRules: (rules: string) => ipcRenderer.invoke(IPC.saveSpokenRules, rules),
  setWorkspaceTrust: (trusted: boolean) => ipcRenderer.invoke(IPC.setWorkspaceTrust, trusted),
  switchPersona: (id) => ipcRenderer.invoke(IPC.switchPersona, id),
  addPersona: () => ipcRenderer.invoke(IPC.addPersona),
  deletePersona: (id) => ipcRenderer.invoke(IPC.deletePersona, id),
  restoreBuiltIn: () => ipcRenderer.invoke(IPC.restoreBuiltIn),
  savePolicy: (policy) => ipcRenderer.invoke(IPC.savePolicy, policy),
  listSessions: () => ipcRenderer.invoke(IPC.listSessions),
  readSession: (token: string) => ipcRenderer.invoke(IPC.readSession, token),
  searchTranscripts: (query: string) => ipcRenderer.invoke(IPC.searchTranscripts, query),
  forgetSession: (token: string) => ipcRenderer.invoke(IPC.forgetSession, token),
  exportTranscripts: () => ipcRenderer.invoke(IPC.exportTranscripts),
  importTranscripts: () => ipcRenderer.invoke(IPC.importTranscripts),
  forgetMemory: () => ipcRenderer.invoke(IPC.forgetMemory),
  forgetTranscripts: () => ipcRenderer.invoke(IPC.forgetTranscripts),
  forgetEverything: () => ipcRenderer.invoke(IPC.forgetEverything),
  revealPackage: () => ipcRenderer.invoke(IPC.revealPackage),
  onChanged: (listener) => subscribe<SettingsSnapshot>(IPC.settingsChanged, listener),
}

/**
 * One file, one decision, two surfaces.
 *
 * The settings window is NOT given the companion bridge. It has no business
 * moving her window, disabling click-through, minting an ephemeral key or
 * opening a microphone, and a bridge is authority: whatever is exposed here is
 * reachable by anything that ends up running in that renderer. A superset would
 * be less code and strictly more attack surface, for no capability anyone
 * needs.
 */
const role = roleFromArgv(process.argv)
if (role === 'settings') contextBridge.exposeInMainWorld('mochiSettings', settings)
else if (role === 'companion') contextBridge.exposeInMainWorld('mochi', bridge)
else {
  // NOTHING. A window that did not name its role gets no authority at all --
  // it used to get the companion's, which is the privileged one. Loud, because
  // the symptom otherwise is a renderer whose bridge is undefined and no
  // explanation anywhere of which of the two mistakes was made.
  console.error(
    `[preload] no window role in argv; exposing no bridge. Pass \`${ROLE_FLAG}<role>\` in additionalArguments.`,
  )
}
