/**
 * Her, on the desktop. The renderer's composition root.
 *
 * ## What it actually owns
 *
 * The header here used to say "three jobs: run the frame loop, tell main
 * whether the cursor is on her, and turn a press into a drag". That stopped
 * being true several features ago, and a module description that undercounts
 * its own responsibilities is worse than none: it is the document somebody
 * reads before deciding where a new one belongs. Honestly, it is:
 *
 * 1. the frame loop, and the rig it drives
 * 2. cursor hit-testing and click-through, and press-to-drag
 * 3. phase presentation — how she holds herself asleep, waking, awake
 * 4. voice-session orchestration: open, supersede, tear down
 * 5. playback of her stream, and metering the level for the mouth
 * 6. edge detection on that level, reported to main as voiceStarted/Stopped
 *
 * ## Why it is still one file
 *
 * Items 4 to 6 share eight pieces of mutable state — the current attempt, the
 * session, the meter, the speaker, whether she is audible — and every one of
 * them is about attempt supersession, which is exactly the thing that goes
 * wrong when it is split across modules that each hold half the answer. The
 * shape that fixes this is a `VoiceController` owning that state behind
 * `handle(command)`, `frame(dt)` and `dispose()`, and it should be a deliberate
 * change with its own tests rather than a move performed during an audit sweep.
 *
 * Everything about how she LOOKS is already in `rig/`, and stays there.
 */

import type { Appearance, CompanionBridge, VoiceCommand, VoiceReport } from '@shared/ipc'
import type { Phase } from '@shared/companion'
import { POSTURE, WAKE_IMPULSE } from '@shared/posture'
import { MochiAvatar } from './rig/mochi'
import { EnvelopeMouth } from './rig/mouth'
import { createAudioMeter, type AudioMeter } from './audio/meter'
import { createLoopbackDetector } from './audio/loopback'
import { playStream, type Speaker } from './audio/speaker'
import { openVoiceSession, type VoiceSession } from './audio/session'

declare global {
  interface Window {
    readonly mochi: CompanionBridge
  }
}

const element = document.getElementById('stage')
if (!(element instanceof HTMLCanvasElement)) throw new Error('no canvas')
// Rebound with an explicit type rather than relying on the narrowing above:
// this module has a top-level await, and the closures below are analysed
// without it.
const canvas: HTMLCanvasElement = element
const context = canvas.getContext('2d')
if (!context) throw new Error('could not acquire a 2D drawing context')

// Whose face, asked before anything is drawn.
//
// Main owns the filesystem and has already validated this against the schema,
// so what arrives is renderable or is the built-in -- there is no third
// outcome, which is why nothing here re-checks it. A user avatar is data that
// crossed a boundary, never code that ran.
//
// SUBSCRIBED before the read, for the same reason the settings window is: a
// resize landing between the request and the subscription reaches nobody, and
// nothing re-broadcasts. The rig does not exist yet, so the newest percentage
// is held and applied to it once it does -- later than the read's answer, and
// therefore correct.
/**
 * The newest appearance that arrived before the rig existed.
 *
 * A box rather than a bare `let`. TypeScript's flow analysis does not follow
 * the assignment inside the subscription below, so a plain variable is narrowed
 * to `null` at the point it is read -- and to `never` inside the guard. The old
 * code did not notice because it passed the value straight to a `number`
 * parameter, which `never` satisfies silently.
 */
const buffered: { value: Appearance | null } = { value: null }
let ready = false

/**
 * The newest phase that arrived before the rig existed, for the same reason.
 *
 * `onPhase` was subscribed AFTER the appearance read, so a phase change during
 * those milliseconds reached nobody and nothing re-broadcasts — she would sit
 * in the asleep posture through a session that had already started. Main sends
 * a phase the moment the lifecycle moves, and the lifecycle can move before
 * this window has finished its first read.
 */
const bufferedPhase: { value: Phase | null; live: boolean } = { value: null, live: false }
window.mochi.onPhase((next) => {
  // Recorded ALWAYS, applied only once the first posture has been set. Gating
  // on the appearance flag instead would leave a gap: that flag is set several
  // statements before the first `wear`, and a phase landing in between would be
  // applied and then overwritten by the initial `asleep`.
  bufferedPhase.value = next
  if (bufferedPhase.live) wear(next)
})

window.mochi.onAppearance((next) => {
  // The WHOLE appearance, not its size. This held `next.sizePercent` alone, so
  // a theme chosen while the first read was in flight was dropped: she kept
  // her old colour until something else changed, or until a restart. The same
  // mistake the live handler below already records having made once.
  buffered.value = next
  // The flag also keeps `avatar` out of its temporal dead zone: there is an
  // `await` between this subscription and the declaration below, so a message
  // arriving in that gap would otherwise throw a ReferenceError inside an IPC
  // handler -- where nothing is watching for one.
  if (!ready) return
  // Her size can change while she is awake. The window resizes in main and the
  // new percentage arrives here; without this the window would grow and she
  // would not, or the reverse.
  wearAppearance(next)
  fit()
})

/**
 * Put an appearance on her. Both fields, always.
 *
 * One function because the pair was written twice -- here and at the initial
 * read below -- and the first copy once read only the size, so a theme chosen
 * while that read was in flight was dropped and she kept her old colour until
 * something else changed. A field added tomorrow has one place to be added.
 */
function wearAppearance(next: Appearance): void {
  avatar.setSizePercent(next.sizePercent)
  avatar.setFace(next.face)
}

const appearance = await window.mochi.getAppearance()
const avatar = new MochiAvatar(context, {
  face: appearance.face,
  // The SAME number main sized the window from. Not derived from the canvas:
  // deriving it here would mean recomputing main's answer from main's rounded
  // output, so the two would agree to within a rounding error rather than by
  // construction — and the ground line would sit a fraction of a pixel off.
  size: appearance.sizePercent,
})

// Anything that arrived while the read was in flight wins: it is newer than
// the answer the read is carrying.
ready = true
if (buffered.value !== null) wearAppearance(buffered.value)

function fit(): void {
  const dpr = window.devicePixelRatio || 1
  const { clientWidth, clientHeight } = canvas
  canvas.width = Math.round(clientWidth * dpr)
  canvas.height = Math.round(clientHeight * dpr)
  avatar.resize(clientWidth, clientHeight, dpr)
}
fit()
window.addEventListener('resize', fit)

/**
 * Whether the window is currently taking mouse events.
 *
 * Tracked so the IPC only fires on a CHANGE. Sending it per mousemove would be
 * a message and a `setIgnoreMouseEvents` call at pointer rate, for an answer
 * that is the same as the previous one almost every time.
 */
let interactive = false
function setInteractive(next: boolean): void {
  if (next === interactive) return
  interactive = next
  window.mochi.setInteractive(next)
}

let dragging = false

window.addEventListener('mousemove', (event) => {
  avatar.lookAt(event.clientX / canvas.clientWidth, event.clientY / canvas.clientHeight)
  // While dragging she must keep taking events even as the cursor leaves her
  // outline, or the drag drops the moment the pointer outruns the window.
  if (!dragging) setInteractive(avatar.hitTest(event.clientX, event.clientY))
})

// She only knows the cursor left because the window stops forwarding moves, so
// the gaze has to be recentred explicitly rather than waiting for a move that
// will not come.
window.addEventListener('mouseleave', () => {
  avatar.lookAt(0.5, 0.5)
  if (!dragging) setInteractive(false)
})

window.addEventListener('mousedown', (event) => {
  // Primary button only. A right-click was starting a drag AND eating the
  // context menu that a tray-less companion will eventually want.
  if (event.button !== 0) return
  if (!avatar.hitTest(event.clientX, event.clientY)) return
  avatar.poke()
  dragging = true
  window.mochi.dragStart({ offsetX: event.clientX, offsetY: event.clientY })
})

// On `window`, not on the canvas: the pointer is routinely outside the window
// when the button comes up, and a listener scoped to the element would never
// hear it -- leaving her stuck to the cursor.
function endDrag(at: { x: number; y: number } | null): void {
  if (!dragging) return
  dragging = false
  window.mochi.dragEnd()
  // Interactivity is RECOMPUTED, not left where the drag put it. While dragging
  // she takes every event wherever the cursor is; releasing outside her outline
  // used to leave the whole transparent window swallowing clicks until the next
  // mousemove happened to arrive over it.
  //
  // RECOMPUTED means hit-tested, which this did not do -- it said `false`
  // unconditionally, and the comment above described a behaviour the line below
  // did not have. Releasing ON her therefore made the window click-through
  // while the cursor was still over her, so the very next click, if the pointer
  // had not moved, went to whatever was behind her.
  //
  // `null` where there are no coordinates to test: a blur or a cancelled
  // gesture ends the drag from somewhere that is not a place on screen, and
  // guessing one would be worse than closing the window to events.
  setInteractive(at !== null && avatar.hitTest(at.x, at.y))
}

window.addEventListener('mouseup', (event) => {
  endDrag({ x: event.clientX, y: event.clientY })
})

// Every other way a press can end without a `mouseup` reaching this document.
//
// The listener is on `window` because the pointer is routinely outside the
// window when the button comes up -- but that only covers releases the page
// still hears. Alt-tabbing mid-drag, a system dialog stealing focus, or the
// OS cancelling the gesture deliver no `mouseup` at all, and `dragging` then
// stayed true forever: she followed the cursor with no button held, and the
// window went on eating clicks meant for whatever was behind her.
window.addEventListener('blur', () => {
  endDrag(null)
})
window.addEventListener('pointercancel', () => {
  endDrag(null)
})
// A move with no button held is proof the release already happened elsewhere.
// This one HAS coordinates, and they are current, so she can be left
// interactive when the cursor is on her.
window.addEventListener('mousemove', (event) => {
  if (dragging && event.buttons === 0) endDrag({ x: event.clientX, y: event.clientY })
})

/**
 * How she holds herself in each phase.
 *
 * The TABLE moved to `@shared/posture`, and the move is the point: the website
 * draws its pictures with this same rig, and while the mapping lived in a
 * `switch` here — in a module that touches `window` at load — nothing outside
 * this renderer could read it. So the site picked expressions by hand and
 * showed two faces the app never wears. One table, walked by both.
 *
 * What stays here is the part that is NOT posture. `poke` is an impulse: it
 * decays within about a second, so it belongs to the moment of the transition
 * rather than to the phase.
 *
 * Note what is absent from both: nothing here moves the MOUTH. An avatar that
 * mouths during the dial is lying about whether anything is being said, and the
 * reason `EnvelopeMouth` is the single writer is so that cannot happen by
 * accident.
 */
function wear(phase: Phase): void {
  avatar.setEmotion(POSTURE[phase])
  if (phase === 'waking') avatar.poke(WAKE_IMPULSE)
}

// The buffered phase if one arrived during startup, else asleep. Applied here
// rather than in the subscription because `wear` reads the rig, which does not
// exist until the await above has resolved.
bufferedPhase.live = true
wear(bufferedPhase.value ?? 'asleep')

/**
 * The session, and the tap that turns her voice into a mouth.
 *
 * Main owns WHEN; this owns HOW. Everything below reacts to a command rather
 * than deciding anything, which is what keeps the lifecycle testable on a
 * number line in a process with no audio in it.
 */
const mouth = new EnvelopeMouth(avatar)
let session: VoiceSession | null = null
let meter: AudioMeter | null = null
/**
 * The microphone, metered alongside her own voice.
 *
 * Two envelopes are the whole measurement: whether the microphone rises and
 * falls WITH her is what separates her echo from somebody answering her. See
 * `audio/loopback.ts`.
 */
let micMeter: AudioMeter | null = null
const loopback = createLoopbackDetector()
/** The last loopback verdict sent, so only CHANGES cross the bridge. */
let sentLoopback: boolean | null = null
/** What makes her audible. Separate from the meter, which only listens. */
let speaker: Speaker | null = null
/**
 * The open this renderer is currently serving.
 *
 * `-1` means none. Every callback and every promise continuation below is
 * gated on it, because an open that main has given up on keeps running: its
 * two network calls are bounded at 30s each against a 15s wake timeout. Before
 * this, `teardown()` could not cancel a pending open at all -- `session` is
 * only assigned when the promise resolves -- so a superseded attempt kept its
 * microphone, reported `ready` against its replacement, and on resolution
 * installed itself as the live session.
 */
let attempt = -1
/** How a pending open is abandoned. Aborting releases its microphone at once. */
let opening: AbortController | null = null
/**
 * Whether she is audible RIGHT NOW, from the analyser.
 *
 * Not from `response.done`, which fires ~2.1s before her audio finishes
 * playing. The farewell waits on this, so getting it from the wire would cut
 * her off mid-goodbye every time.
 */
let audible = false
/**
 * How long she has been quiet, in milliseconds. One silent frame mid-word is a
 * gap, not an ending.
 *
 * Milliseconds rather than frames. The debounce was a frame count against an
 * assumed 60Hz, so on a 120Hz display it lasted half as long as intended and
 * under background throttling it could last many seconds -- and the farewell
 * waits on this, so getting it wrong cuts her off or hangs the goodbye.
 */
let quietMs = 0
const QUIET_MS_TO_END = 500
/** Frame timestamp of the previous render, for a real delta. */
let lastFrameAt: number | null = null
/**
 * Ceiling on one frame's delta.
 *
 * A backgrounded window resumes with a gap of seconds; feeding that to the
 * envelope would decay its references in one step and recalibrate her mouth.
 */
const MAX_FRAME_SECONDS = 0.1

function teardown(): void {
  // Retire the number FIRST. Everything still in flight for the old attempt
  // checks it, so invalidating before disposing is what stops a callback that
  // fires during teardown from acting on the state being torn down.
  attempt = -1
  // Before the disposals: an open still in flight owns a microphone that
  // `session` does not yet point at, and aborting is the only way to reach it.
  opening?.abort()
  opening = null
  session?.close()
  session = null
  meter?.dispose()
  meter = null
  micMeter?.dispose()
  micMeter = null
  loopback.reset()
  sentLoopback = null
  speaker?.dispose()
  speaker = null
  mouth.end()
  audible = false
  quietMs = 0
}

window.mochi.onVoiceCommand((command) => {
  // Anything but `open` addressed to an attempt we are no longer serving is a
  // message for a session that is gone.
  if (command.kind !== 'open' && command.attempt !== attempt) return

  switch (command.kind) {
    case 'open':
      openSession(command)
      break
    case 'close':
      teardown()
      break
    case 'speak':
      session?.speak(command.utterance, command.instructions, command.isolation)
      break
    case 'silence':
      session?.silence(command.utterance)
      break
    case 'mic':
      session?.setMicEnabled(command.open)
      break
    case 'armWorkspace':
      session?.armWorkspace()
      break
    case 'workspaceStarted':
      session?.acknowledgeWorkspace()
      break
    case 'workspaceAnswer':
      // Delivered whenever it arrives. If the session has gone the answer goes
      // with it -- see `answerWorkspace`, which logs rather than throws.
      session?.answerWorkspace(command.callId, command.payload)
      break
  }
})

/**
 * Open a session, and make sure a superseded one cannot come back.
 *
 * Lifted out of the command handler, which was 83 lines coordinating the
 * session, the speaker, the meter, the abort controller and the attempt
 * number all at once -- so the supersession rule, which is the only thing in
 * here that is subtle, was one `if` among forty lines of wiring. Every
 * callback below asks `current()` before it touches anything, because the
 * attempt can be replaced WHILE it opens.
 */
function openSession(command: Extract<VoiceCommand, { kind: 'open' }>): void {
  teardown()
  const mine = command.attempt
  attempt = mine
  const controller = new AbortController()
  opening = controller
  /** True only while this attempt is still the one being served. */
  const current = (): boolean => attempt === mine
  let reported = false
  const report = (r: VoiceReport): void => {
    if (!current()) return
    reported = true
    window.mochi.reportVoice(r)
  }

  openVoiceSession(
    command.persona,
    command.memory,
    command.spokenRules,
    command.sound,
    command.driven,
    mine,
    {
      onReady: () => report({ kind: 'ready', attempt: mine }),
      onFailed: (reason) => {
        if (!current()) return
        report({ kind: 'openFailed', attempt: mine, reason })
        teardown()
      },
      onLost: (reason) => {
        if (!current()) return
        report({ kind: 'sessionLost', attempt: mine, reason })
        teardown()
      },
      onUserSpoke: () => report({ kind: 'userSpoke', attempt: mine }),
      // Handed straight to main, which owns the workspace, the guard and the
      // authorisation. The renderer decides nothing about it.
      onWorkspaceAsked: (callId, question) =>
        report({ kind: 'workspaceAsked', attempt: mine, callId, question }),
      onUtteranceEnded: (utterance, outcome) =>
        report({ kind: 'utteranceEnded', attempt: mine, utterance, outcome }),
      onSaid: (who, text) => report({ kind: 'said', attempt: mine, who, text }),
      onRemoteStream: (stream) => {
        if (!current()) return
        // TRANSACTIONAL, because a half-built pair is worse than neither.
        //
        // Both constructors can throw synchronously -- `AudioContext` is a
        // limited resource and `createMediaStreamSource` rejects a stream the
        // page is not allowed to read -- and this runs inside an async WebRTC
        // callback, so the exception escaped with nobody to catch it. The old
        // speaker and meter were already disposed by then, so she could end up
        // audible with no metering at all: no mouth movement, no voice-edge
        // detection, and therefore no microphone gating either, with the
        // session reported as perfectly healthy.
        //
        // Play it, THEN tap it. Both, every time -- an earlier version did
        // only the second and she was inaudible while her mouth moved
        // correctly, which is the hardest kind of bug to see.
        let nextSpeaker: Speaker | null = null
        let nextMeter: AudioMeter | null = null
        try {
          nextSpeaker = playStream(stream, (reason) =>
            report({ kind: 'sessionLost', attempt: mine, reason }),
          )
          nextMeter = createAudioMeter(stream)
        } catch (error: unknown) {
          // Neither is adopted, so nothing below can half-use them.
          nextSpeaker?.dispose()
          nextMeter?.dispose()
          console.error('[companion] could not attach to her audio:', error)
          report({ kind: 'sessionLost', attempt: mine, reason: 'her audio could not be attached' })
          return
        }
        speaker?.dispose()
        speaker = nextSpeaker
        meter?.dispose()
        meter = nextMeter
      },
      onLocalStream: (stream) => {
        micMeter?.dispose()
        micMeter = createAudioMeter(stream)
        // A fresh session is a fresh room as far as this is concerned: the
        // devices may have changed while she was asleep.
        loopback.reset()
        sentLoopback = null
      },
    },
    controller.signal,
  )
    .then((opened) => {
      // The attempt can be superseded WHILE it opens. Installing it now
      // would resurrect a microphone nobody asked for, so close it instead.
      if (!current()) return opened.close()
      session = opened
    })
    .catch((error: unknown) => {
      // Not blanket-swallowed. `openVoiceSession` can reject before its own
      // guarded failure path exists, and treating every rejection as
      // already-reported meant those vanished and left the lifecycle to
      // time out with nothing in the log.
      if (!current()) return
      if (!reported) {
        console.error('[voice] open rejected before reporting:', error)
        report({ kind: 'openFailed', attempt: mine, reason: String(error) })
      }
      teardown()
    })
    .finally(() => {
      // `opening` means "an open is IN FLIGHT", and a settled one is not.
      // It was left pointing at this controller forever, so the next
      // teardown aborted a signal nobody was listening to and every later
      // read of it described a state that had finished. Cleared only if it
      // is still ours: a newer attempt has already replaced it, and
      // clearing that would lose the handle to a live open.
      if (opening === controller) opening = null
    })
}

// Only now. Subscribing is what makes commands deliverable, so telling main any
// earlier would re-open the window in which a wake reaches nobody.
window.mochi.ready()

function frame(now: number): void {
  // TWO deltas, deliberately, because they answer different questions.
  //
  // `elapsed` is how much time actually passed. `dt` is how much of it the
  // envelope integrator is willing to take in one step -- capped, because a
  // resumed tab handing it a delta of seconds makes the mouth lurch.
  //
  // The silence debounce used to run on the CAPPED figure, so it measured
  // frames rather than time: at 10fps every frame contributes 100ms of the
  // 100ms it is allowed, which happens to be right, but under any throttling
  // heavier than that -- a backgrounded window at 1fps -- 500ms of required
  // silence takes five real seconds, and `voiceStopped` arrives that late. The
  // debounce is a statement about the world, so it counts the world's time.
  const elapsed = lastFrameAt === null ? 0 : (now - lastFrameAt) / 1000
  const dt = Math.min(elapsed, MAX_FRAME_SECONDS)
  lastFrameAt = now

  if (meter !== null && attempt !== -1) {
    const hers = meter.level()
    // Sampled every frame while a session is live, including while the
    // microphone is gated shut -- the meter reads a clone that stays enabled,
    // which is the whole reason `onLocalStream` hands one over.
    if (micMeter !== null) {
      loopback.sample(hers, micMeter.level())
      const verdict = loopback.verdict()
      // Only on CHANGE. A report per frame would be sixty messages a second
      // saying the same thing.
      if (verdict !== null && verdict !== sentLoopback) {
        sentLoopback = verdict
        window.mochi.reportVoice({ kind: 'loopback', attempt, present: verdict })
      }
    }
    mouth.observe(hers, dt)
    // Edges, reported once. The envelope owns the judgement -- it compares a
    // peak against a floor it learned from this voice on this connection, so it
    // survives a quiet speaker and a noisy line, which a fixed threshold did
    // not.
    const loud = mouth.speaking
    quietMs = loud ? 0 : quietMs + elapsed * 1000
    if (loud && !audible) {
      audible = true
      window.mochi.reportVoice({ kind: 'voiceStarted', attempt })
    } else if (!loud && audible && quietMs >= QUIET_MS_TO_END) {
      audible = false
      window.mochi.reportVoice({ kind: 'voiceStopped', attempt })
    }
  }
  avatar.render(now)
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
