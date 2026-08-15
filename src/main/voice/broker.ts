/**
 * Everything main knows about running a voice session, kept out of `index.ts`.
 *
 * This module exists for a recorded reason: the previous
 * codebase's `main/index.ts` reached 1,428 lines and thirteen module-level
 * mutable variables, and that file is the single largest reason this repository
 * was started again. Adding the voice protocol to it took it from 400 lines to
 * nearly 600 along with a key store, a command queue and a readiness flag —
 * the same accretion, in the same file, for the same reason each individual
 * piece looked too small to move.
 *
 * So the boundary is drawn while it is still cheap. What lives here is the
 * brokerage: minting a key for an attempt, spending it on that attempt's offer,
 * validating reports, and holding commands until a renderer exists to receive
 * them. What stays in `index.ts` is composition — deciding that these parts are
 * connected to each other at all.
 */

import { ipcMain, type BrowserWindow, type WebContents } from 'electron'
import {
  IPC,
  parseVoiceReport,
  type AttemptId,
  type MintReply,
  type SdpReply,
  type VoiceCommand,
  type VoiceReport,
} from '@shared/ipc'
import { describeProblem, exchangeSdp, mintEphemeralKey } from './credential'
import type { CredentialResult } from './credential'

/**
 * Ceiling on an offer before it is forwarded upstream.
 *
 * Generous — a real offer with a full ICE candidate list is a few kilobytes —
 * and the point is only that there IS one. This is untrusted text from the
 * renderer, spending a one-time key on its way out.
 */
/**
 * How long a minted key may sit unexchanged.
 *
 * The renderer exchanges within a second or two of minting; anything past this
 * is an attempt that died in the gap. Generous enough that a slow machine is
 * never punished, short enough that a crashed renderer does not leave a live
 * credential in memory for the rest of the session.
 */
const KEY_TTL_MS = 60_000

/**
 * How many commands may wait for a renderer that has not subscribed.
 *
 * Deep enough for the real case — a wake arriving during the renderer's first
 * paint is one or two commands — and shallow enough that a renderer which
 * never arrives cannot accumulate personas until the process ends.
 */
const MAX_PENDING = 8

const MAX_SDP_BYTES = 64 * 1024

export interface VoiceBrokerDeps {
  /** The window allowed to speak to us, or null when there is not one. */
  readonly target: () => BrowserWindow | null
  /** Whether an IPC event came from that window's main frame. */
  readonly isFromCompanion: (event: { readonly senderFrame: unknown }) => boolean
  /** A validated report, for the lifecycle. */
  readonly onReport: (report: VoiceReport) => void
  /** The attempt currently in force, so a superseded mint can be discarded. */
  readonly currentAttempt: () => AttemptId
  /**
   * The bearer to mint with, resolved by main.
   *
   * Injected rather than read here, because WHICH credential is a preference
   * main owns — and because a stored API key must not be reachable from a
   * module that handles IPC from the renderer. This file sees a bearer for as
   * long as it takes to mint an ephemeral key, and no path back to where it
   * came from.
   */
  readonly credential: () => Promise<CredentialResult>
}

export interface VoiceBroker {
  /** Send a command, or hold it until a renderer is listening. */
  send(command: VoiceCommand): void
  /** Wire the handlers. Call once. */
  register(): void
}

export function createVoiceBroker(deps: VoiceBrokerDeps): VoiceBroker {
  /**
   * Minted keys, filed by the attempt that asked for one.
   *
   * A map rather than one slot, because opening can outlive the wake timeout:
   * two network calls bounded at 30s each against a 15s deadline means a retry
   * regularly overlaps the attempt it replaced. With a single slot the second
   * mint overwrote the first, and whichever exchange arrived first consumed
   * whatever key happened to be sitting there — so one attempt used another's
   * key and the other was told none had been minted.
   *
   * Never the renderer's: it asks main to mint, then hands main an offer, and
   * the key joins the two here without ever crossing.
   */
  const keys = new Map<AttemptId, string>()

  /**
   * Commands issued before the renderer subscribed.
   *
   * Registering a listener is not instantaneous: the renderer awaits its face
   * first, and a wake inside that window reached nobody — the lifecycle then
   * sat in `waking` until it timed out, over a session never asked for.
   */
  let pending: VoiceCommand[] = []
  let ready = false
  /**
   * Attempts with a mint in flight.
   *
   * The map of minted keys cannot answer this: it is only populated once the
   * network call returns, so between the request and the reply there is
   * nothing recording that one is already running.
   */
  const minting = new Set<AttemptId>()
  /**
   * The highest attempt whose key has already been spent.
   *
   * A high-water mark rather than a set of used ids, because attempts only
   * ever increase — so this is O(1) and cannot grow without bound, which a set
   * of every attempt ever made would.
   *
   * Without it the guards had a hole the verify pass found: `exchangeSdp`
   * deletes the key it consumes, so `keys.has(attempt)` goes false again while
   * the attempt is still current, and the same renderer could mint for it
   * again. Loop that and the single-flight guard buys nothing.
   */
  let spent = -1
  /** Timers that drop unexchanged keys. Cleared when a key is consumed. */
  const expiries = new Map<AttemptId, NodeJS.Timeout>()

  /**
   * Renderers this process has already attached the reload watchers to.
   *
   * By `webContents`, not by window: a reload keeps the window and replaces
   * the document, and a recreated companion brings a new `webContents` that
   * needs watching again. A `WeakSet` so a gone renderer is not held here.
   */
  const watched = new WeakSet<WebContents>()

  /**
   * Clear `ready` when the document that set it goes away.
   *
   * Called from `send`, on the window it is about to use, rather than once
   * during `register()`. That is not a preference: `register()` runs inside
   * `prepare()`, and the companion window is not created until `start()` --
   * so the single call there always found `null` and returned. These
   * listeners had never been attached, in any run, since the day they were
   * written. `ready` was therefore still set-once-never-cleared, which is the
   * exact bug the comment below describes as fixed.
   *
   * Idempotent, so calling it on every send costs a `WeakSet` lookup.
   */
  function watchReload(window: BrowserWindow): void {
    const contents = window.webContents
    if (watched.has(contents)) return
    watched.add(contents)
    // A reload retires the subscription that `ready` records. Without this,
    // after a renderer reload -- or a crash and recreate -- main goes on
    // sending to a document that never subscribed, and the commands vanish
    // instead of queueing.
    contents.on('did-start-navigation', (_e, _url, isInPlace, isMainFrame) => {
      if (isMainFrame && !isInPlace) ready = false
    })
    contents.on('render-process-gone', () => {
      ready = false
    })
  }

  function send(command: VoiceCommand): void {
    const window = deps.target()
    if (window !== null) watchReload(window)
    if (!ready || window === null) {
      // BOUNDED, and the oldest goes first.
      //
      // A renderer that never becomes ready -- one that failed to load, or a
      // window that went away -- left this growing for the life of the
      // process, and the commands in it carry the whole persona, so it is not
      // a small leak. Keeping the newest is the right end to keep: these are
      // instructions about what she should be doing NOW, and a wake from four
      // minutes ago is not worth replaying.
      pending.push(command)
      while (pending.length > MAX_PENDING) pending.shift()
      return
    }
    window.webContents.send(IPC.voiceCommand, command)
  }

  function register(): void {
    ipcMain.handle(IPC.mintKey, async (event, attempt: unknown): Promise<MintReply> => {
      if (!deps.isFromCompanion(event)) throw new Error('unauthorized sender')
      if (typeof attempt !== 'number' || !Number.isSafeInteger(attempt)) {
        return { ok: false, reason: 'bad attempt' }
      }

      // GATED BEFORE the credential is spent, not after.
      //
      // The attempt check used to sit below the mint, which stopped a
      // superseded key being FILED and did nothing to stop it being minted. A
      // compromised renderer -- the threat this whole split exists for, since
      // that window loads a face out of a user-writable folder -- could call
      // this in a loop and have main spend the credential every time. Each call
      // is a real request against her subscription or the user's API key.
      //
      // `-1` is the sentinel for "no lifecycle yet". It compares equal to
      // `currentAttempt()` before anything has woken her, so without this an
      // idle app answers mints.
      if (attempt < 0 || attempt !== deps.currentAttempt()) {
        return { ok: false, reason: 'attempt superseded' }
      }
      // One mint per attempt. Without this, N calls with the same live attempt
      // are N network mints; the map only ever keeps the last.
      // One key per attempt, for the life of that attempt -- not one at a
      // time. `spent` is what makes it once: a consumed key removes itself
      // from `keys`, so without the mark an exchanged attempt looks unminted.
      if (attempt <= spent) return { ok: false, reason: 'attempt already used' }
      if (keys.has(attempt) || minting.has(attempt)) {
        return { ok: false, reason: 'already minting' }
      }
      minting.add(attempt)
      // `finally`, not a delete on each exit path.
      //
      // The per-path version missed the one that matters: a THROW. The bounded
      // reader added downstream can reject, which escapes `mintEphemeralKey`,
      // and the slot was then never released -- so that attempt could never
      // mint again and the wake failed for the rest of the session. A guard
      // whose release is optional is a deadlock waiting for an exception.
      try {
        return await mintFor(attempt)
      } finally {
        minting.delete(attempt)
      }
    })

    async function mintFor(attempt: AttemptId): Promise<MintReply> {
      // Read through the caller, not from disk here: WHICH credential is a
      // preference main owns, and the stored key must not be reachable from a
      // module the renderer can reach through IPC.
      const found = await deps.credential()
      if (!found.ok) {
        // Names WHICH problem. "No credential" used to cover an expired login,
        // which is the one case a user can fix in ten seconds if told.
        const reason = describeProblem(found.problem)
        console.error(`[voice] ${reason}`)
        return { ok: false, reason }
      }

      console.log(`[voice] minting with the ${found.credential.source} credential`)
      const minted = await mintEphemeralKey(found.credential)
      if (!minted.ok) {
        console.error(`[voice] ${minted.reason}`)
        return { ok: false, reason: minted.reason }
      }
      // The attempt can be abandoned WHILE its key is being minted — that call
      // is the slow one. Filing a key nobody will exchange leaves a live secret
      // in a map with no owner, so drop it here instead.
      if (attempt !== deps.currentAttempt()) {
        console.warn(`[voice] discarding a key minted for superseded attempt ${attempt}`)
        return { ok: false, reason: 'attempt superseded' }
      }
      keys.set(attempt, minted.key)
      // An ephemeral key that nobody exchanges is still a live secret sitting
      // in a map. The renderer is meant to exchange within a second or two;
      // when it crashes between the two calls, or the user quits in the gap,
      // nothing removes it and it stays for the life of the process. The
      // upstream key expires on its own, but holding it past its use is the
      // thing this file exists not to do.
      const expiry = setTimeout(() => {
        if (keys.delete(attempt)) {
          console.warn(`[voice] discarded an unexchanged key for attempt ${String(attempt)}`)
        }
        expiries.delete(attempt)
        // RETIRED, not merely forgotten. Dropping the key without advancing the
        // mark puts the attempt back in the state it was in before it minted,
        // so the same renderer could mint for it again -- reopening exactly the
        // hole the mark was added to close.
        spent = Math.max(spent, attempt)
      }, KEY_TTL_MS)
      // Never hold the process open for a secret we are trying to forget.
      expiry.unref()
      expiries.set(attempt, expiry)
      return { ok: true }
    }

    ipcMain.handle(
      IPC.exchangeSdp,
      async (event, attempt: unknown, offer: unknown): Promise<SdpReply> => {
        if (!deps.isFromCompanion(event)) throw new Error('unauthorized sender')
        if (typeof attempt !== 'number' || !Number.isSafeInteger(attempt)) {
          return { ok: false, reason: 'bad attempt' }
        }
        if (typeof offer !== 'string') return { ok: false, reason: 'no offer' }
        // Bounded and shaped BEFORE the key is spent. An offer is a text
        // document from the least trusted process here, and the previous check
        // accepted any non-empty string — including whitespace and an unbounded
        // payload — consuming a one-time key to forward it.
        // The SAME currency check minting makes. Without it a superseded
        // attempt could still spend its retained key and open an upstream
        // session nobody is listening to -- billed, and invisible.
        if (attempt < 0 || attempt !== deps.currentAttempt()) {
          return { ok: false, reason: 'attempt superseded' }
        }
        if (offer.length > MAX_SDP_BYTES) return { ok: false, reason: 'offer too large' }
        if (!/^v=0(\r\n|\n)/.test(offer)) return { ok: false, reason: 'not an SDP offer' }

        // Taken, not read: an ephemeral key is one attempt's, and holding it
        // past its use turns a short-lived secret into a long-lived one.
        const key = keys.get(attempt)
        keys.delete(attempt)
        if (key === undefined) return { ok: false, reason: 'no ephemeral key was minted' }
        // Marked spent as the key is taken, so no second key can be minted for
        // this attempt even though it is still the current one.
        spent = Math.max(spent, attempt)
        const expiry = expiries.get(attempt)
        if (expiry !== undefined) {
          clearTimeout(expiry)
          expiries.delete(attempt)
        }
        const result = await exchangeSdp(offer, key)
        if (!result.ok) console.error(`[voice] ${result.reason}`)
        return result
      },
    )

    ipcMain.on(IPC.voiceEvent, (event, payload: unknown) => {
      if (!deps.isFromCompanion(event)) return
      const report = parseVoiceReport(payload)
      // Dropped and named. Casting this straight to a VoiceReport meant a null
      // threw inside the handler and any object of the right shape could drive
      // the lifecycle.
      if (report === null) return console.warn('[voice] discarding a malformed report')
      deps.onReport(report)
    })

    ipcMain.on(IPC.rendererReady, (event) => {
      if (!deps.isFromCompanion(event)) return
      ready = true
      const queued = pending
      pending = []
      if (queued.length > 0) {
        console.log(`[voice] renderer ready; flushing ${queued.length} command(s)`)
      }
      for (const command of queued) send(command)
    })
  }

  return { send, register }
}
