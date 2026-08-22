import { parseServerFrame } from '@shared/realtime/frames'
import { transcriptionConfig } from '@shared/transcription'
import { isPrivateFrame, type SessionConfig } from '@shared/ipc'
import type { FaceSpec } from '@shared/avatar-spec'
import { createPending, type Spoken } from './pending'

/**
 * The live session: her ears, her voice, and the wire between them.
 *
 * This has to live in the renderer because `RTCPeerConnection` and
 * `getUserMedia` do. **Nothing else is here.** Which capability runs, whether a
 * call has been answered, when to reconnect — all of that is main's, because all
 * of it is a decision about what this machine does on somebody's behalf. v1 made
 * those decisions here, in the process holding the peer and the microphone,
 * which is the process that should have the least authority.
 *
 * ## Four things carried over from v1 that were paid for
 *
 * They are not obvious and each one cost a real bug:
 *
 * 1. **AEC is asked for explicitly.** Echo cancellation is the whole reason this
 *    app is Electron rather than a system webview, and it is requested as a
 *    constraint rather than assumed — `getSettings()` reports what the device
 *    actually did, and the two differ.
 * 2. **The mint and the microphone are SETTLED, not raced.** `Promise.all`
 *    rejects on the first failure, so a mint that failed while the permission
 *    prompt was still up left a live capture with no reference to stop it.
 * 3. **Media is released on every teardown, above the "already closed" guard.**
 *    `getUserMedia` cannot be cancelled: the capture arrives even if nobody is
 *    waiting for it any more, so `media` is routinely assigned *after* the first
 *    teardown has run. Stopping an already-stopped track is a no-op; the
 *    ordering requirement was not.
 * 4. **The microphone starts disabled.** The track must be in the offer, so it
 *    is added immediately — but it started *enabled*, and she transmitted while
 *    every surface in the app still reported the microphone closed.
 */

export type SessionState =
  'opening' | 'listening' | 'closed' | { readonly failed: string } | { readonly expired: true }

export interface Session {
  /** Whether this persona asked for her words to be shown. Off by default. */
  readonly bubble: boolean
  /** How she looks, resolved and validated in main. See `SessionConfig.face`. */
  readonly face: FaceSpec
  /** How many things main could not do. See `SessionConfig.problems`. */
  readonly problems: number
  /** Which side of her the bubble was asked to sit on. See `SessionConfig`. */
  readonly bubbleSide: string
  /** Whether she was left asleep. See `SessionConfig`. */
  readonly asleep: boolean
  /**
   * A standing grant changed while this session was up.
   *
   * Re-sends the WHOLE `session.update`, not a patch of the two fields that
   * moved. A partial update is a bet on which fields the service treats as
   * unset, and losing that bet silently would drop her voice or her turn
   * detection mid-conversation — §21's lock makes the first of those a
   * reconnect rather than a nuisance.
   *
   * No turn is requested. She reads the change when she next answers, which is
   * what "takes effect on her next turn" means; asking for one while she is
   * speaking is refused intermittently (§1).
   */
  mayDo(change: { readonly instructions: string; readonly tools: readonly unknown[] }): void
  /** Open the microphone. Off until this is called — see point 4 above. */
  listen(on: boolean): void
  /** Idempotent, and the only path that releases anything. */
  close(): void
}

export interface SessionCallbacks {
  readonly onState: (state: SessionState) => void
  /** Her voice, handed straight out. Nothing here decides what it means. */
  readonly onRemote: (stream: MediaStream) => void
  /**
   * The MICROPHONE, handed out for the same reason.
   *
   * §62 measured the service taking 1026ms to say the user stopped talking, and
   * `eagerness` not moving it. The microphone knows in a fraction of that, and
   * the gap is the whole of the dead window — so the face gets the stream and
   * decides locally, rather than waiting to be told something it can hear.
   */
  readonly onMicrophone: (stream: MediaStream) => void
  /** The session announced its own deadline. Main schedules the reconnect. */
  readonly onExpiry: (expiresAt: number) => void
  /**
   * One fragment of what she is generating, for the bubble.
   *
   * Handed straight out rather than reported to main: it is neither a decision
   * nor something to file, it is what to paint. Generation runs ahead of her
   * audio at both ends — §19 measured it FINISHING 2.1–7.9s earlier, §56
   * measured it STARTING 0–320ms earlier — so this is not a signal about what
   * she has actually said aloud, and the bubble's fade rule comes from the
   * analyser instead.
   *
   * `responseId` travels with it because the bubble needs a boundary between
   * one utterance and the next, and §56 is why that boundary cannot come from
   * `output_audio_buffer.started`.
   */
  readonly onSaying: (delta: string, responseId: string) => void
  /**
   * Her voice for this response has begun.
   *
   * `output_audio_buffer.started` is WebRTC-only and carries `response_id`,
   * which makes it the one signal that says whose sound is starting. The
   * analyser knows there is sound; it cannot know whose, and §57 needs the
   * difference to pace a subtitle against the right utterance.
   */
  readonly onSpeaks: (responseId: string) => void
  /**
   * Her audio for this response finished — naturally, or because she was cut off.
   *
   * The two arrive as different frames and the difference is load-bearing: only
   * a natural end means she said everything that was generated, which is the one
   * fact the pacing can calibrate itself against. Barge-in is routine here
   * (§17), so conflating them would poison the estimate constantly.
   */
  readonly onFinished: (id: string, interrupted: boolean) => void
  /** Where the cursor had reached. Read at the barge-in; see `settle`. */
  readonly heard: () => { text: string; at: number; itemId: string | null }
}

const CHANNEL = 'oai-events'

export async function openSession(callbacks: SessionCallbacks): Promise<Session> {
  const peer = new RTCPeerConnection()
  let media: MediaStream | null = null
  let micTrack: MediaStreamTrack | null = null
  let closed = false
  /** How to stop listening for main's frames. See `MochiApi.onSend`. */
  let stopListening: (() => void) | null = null
  /**
   * The timer that says the configuration never landed. See `confirmed` below.
   *
   * Declared HERE, with the rest of the mutable state, rather than beside the
   * essay that explains it: `shutdown` clears it, `shutdown` is defined above
   * that essay, and a `let` read before its declaration throws. Nothing reaches
   * it early today — but the one path that would is the teardown, and this
   * file's own header is three points about teardown ordering that each cost a
   * real bug. An ordering argument is not worth making twice.
   */
  let confirming: ReturnType<typeof setTimeout> | null = null

  function shutdown(): void {
    // Above the guard, with the tracks and for the same reason: a session that
    // died inside the confirmation window would otherwise report itself
    // unconfigured seconds after it was gone, which is a false alarm about a
    // session nobody is in.
    confirmed()
    // A turn she began and was cut off in, whose transcript never arrived, is
    // still a fact. Filed as an empty `cut` marker rather than lost.
    for (const spoken of pending.flush()) file(spoken)
    /*
      AFTER the flush and on the SAME channel, which is what makes it an
      acknowledgement rather than a guess. Main holds the conversation open
      until this arrives; see `VoiceReport`'s `flushed`.

      Sent on every teardown including the failure paths, because "nothing more
      is coming" is true of those too -- and main waiting out its grace period
      for a session that has already died is a delay with no purpose.
    */
    window.mochi.report({ kind: 'flushed' })

    // OFF the channel, and above the guard for the same reason the tracks are:
    // this runs on every teardown including the failure paths, and a
    // subscription that outlived its session held that session's peer and data
    // channel for the life of the window — once an hour, for ever.
    stopListening?.()
    stopListening = null

    // ABOVE the guard, and that order is the whole point — see point 3.
    for (const track of media?.getTracks() ?? []) track.stop()
    media = null
    micTrack = null
    if (closed) return
    closed = true
    try {
      peer.close()
    } catch {
      /* already gone */
    }
    callbacks.onState('closed')
  }

  function fail(why: string): never {
    shutdown()
    callbacks.onState({ failed: why })
    throw new Error(why)
  }

  const pending = createPending()

  function file(spoken: Spoken | null): void {
    if (spoken === null) return
    if (spoken.interruptedAt === null) {
      window.mochi.report({ kind: 'said', transcript: spoken.transcript, heard: null })
      return
    }
    // The estimate is read HERE, at the barge-in — the cursor keeps no history,
    // and by the time the transcript arrives she has long stopped.
    const heard = callbacks.heard()
    window.mochi.report({
      kind: 'said',
      transcript: spoken.transcript,
      // Observations only. Main decides how much of it is remembered.
      heard: { at: heard.at, interruptedAt: spoken.interruptedAt },
    })
  }

  /** Frame types already announced this session — see the `other` case below. */
  const announced = new Set<string>()
  /** She greets once per session, not once per `session.updated`. */
  let greeted = false

  /**
   * Proof that the configuration actually landed, rather than the hope of it.
   *
   * §24 §3 measured what she runs on when it does not: transcription off, noise
   * reduction off, `server_vad` rather than `semantic_vad`, and a voice that is
   * not hers — and NO instructions, so no name, no manner, no memory of
   * anybody. AGENTS.md rule 16 is exactly this, and the service echoes
   * `session.updated` on success, so the difference is observable and was
   * simply not being observed.
   *
   * One rejected field takes the WHOLE update with it, which is what makes this
   * worth an assertion rather than a comment: every field in that object is a
   * thing the service could stop accepting, and the symptom of losing them all
   * is a companion who is subtly not herself. Silence here is the loudest thing
   * this session can report.
   *
   * The FIRST update only. A later one — a standing grant changing mid-call —
   * fails back onto the configuration already in force, which is wrong but not
   * unrecognisable.
   */
  /** Well beyond any observed round trip; §24 attributed errors within six. */
  const CONFIRM_MS = 5_000

  function confirmed(): void {
    if (confirming === null) return
    clearTimeout(confirming)
    confirming = null
  }

  callbacks.onState('opening')

  // BEFORE the offer, or it is not in it.
  const channel = peer.createDataChannel(CHANNEL)
  const put = (frame: unknown): void => {
    if (channel.readyState === 'open') channel.send(JSON.stringify(frame))
  }

  peer.addEventListener('track', (event) => {
    // `streams` can be empty for a track negotiated without one, and ignoring
    // that case discards a good audio track and presents as silence.
    callbacks.onRemote(event.streams[0] ?? new MediaStream([event.track]))
  })

  peer.addEventListener('connectionstatechange', () => {
    if (peer.connectionState === 'failed') {
      // RELEASED first. Reporting a failure while the capture is still running
      // is the worst of both: the window says she is gone and the microphone
      // light says she is not. `shutdown` announces `closed` on its way out, so
      // the failure is reported after it and is what stays on screen — the same
      // order `fail` uses, for the same reason.
      shutdown()
      callbacks.onState({ failed: 'the peer connection failed' })
    }
  })

  channel.addEventListener('message', (event: MessageEvent<string>) => {
    const frame = parseServerFrame(event.data)
    switch (frame.kind) {
      case 'session-created':
        window.mochi.report({ kind: 'expiry', expiresAt: frame.expiresAt })
        callbacks.onExpiry(frame.expiresAt)
        callbacks.onState('listening')
        break
      case 'tool-call':
        // Forwarded by name. This is the whole of the renderer's involvement in
        // a capability: it does not decide which one runs, or whether it may.
        window.mochi.call(frame.name, frame.callId, frame.args)
        break
      case 'heard':
        // The log records the CONVERSATION now, not only the connection. The
        // first run of this session logged five lines, every one of them about
        // the wire, and could not have said whether she heard anything at all.
        window.mochi.report({ kind: 'heard', transcript: frame.transcript })
        break
      case 'saying':
        callbacks.onSaying(frame.delta, frame.responseId)
        break
      case 'said':
        file(pending.said(frame.itemId, frame.transcript))
        break
      case 'truncated': {
        const spoken = pending.truncated(frame.itemId, Date.now())
        callbacks.onFinished(frame.itemId, true)
        file(spoken)
        break
      }
      case 'audio-buffer':
        /**
         * `started` marks when HER VOICE for this response begins — and that,
         * precisely, is all it is used for.
         *
         * It is not the boundary between one utterance's text and the next.
         * That was tried: §56 measured the first transcript delta landing
         * 0–320ms ahead of `.started`, which for a one-word reply is the whole
         * utterance, so clearing here showed a suffix or nothing at all.
         *
         * As an anchor for "whose sound is this", it is exact and it is the only
         * such signal — the analyser hears sound but cannot attribute it.
         */
        if (frame.phase === 'started') callbacks.onSpeaks(frame.responseId)
        else if (frame.phase === 'stopped') callbacks.onFinished(frame.responseId, false)
        // `cleared` is handled by the `truncated` frame instead, which is the
        // one carrying the item id the archive needs.
        break
      case 'session-expired':
        // Not a failure. An hour passed (§53), and main already has a timer.
        callbacks.onState({ expired: true })
        break
      case 'error':
        window.mochi.report({
          kind: 'note',
          text: `server error: ${frame.code ?? 'unknown'} ${frame.message ?? ''}`,
        })
        break
      case 'malformed':
        // Loud. A known frame whose fields are not what was observed means the
        // service changed, and the alternative is tool calls quietly vanishing.
        window.mochi.report({
          kind: 'note',
          text: `MALFORMED ${frame.type}: missing ${frame.missing.join(', ')}`,
        })
        break
      case 'other':
        // The configuration landed. FIRST in this branch and separate from the
        // greeting below, because it is true whether or not she may speak: a
        // session where `speak_first` is withheld is still a configured one,
        // and hanging this off the greeting would report every such session as
        // unconfigured.
        if (frame.type === 'session.updated') confirmed()
        /**
         * The greeting, and it waits for `session.updated` on purpose.
         *
         * v1 put the rule in a comment and the reason is exact: *an item queued
         * against a session that has not been told what it is would be read
         * under the service's defaults*.
         *
         * Firing on `session.created` — which is what this did first —
         * **produced two utterances in one wake**, observed. Why there were two
         * rather than one mis-read one is not established, so nothing here
         * claims it; `session.updated` is the first moment the configuration is
         * known to have landed, and on it the same wake produces one.
         *
         * No turn is requested beyond this one: `conversation: 'none'` keeps
         * the greeting out of the transcript she will later be asked to
         * remember. It is the app opening its mouth, not a turn.
         */
        //
        // A null greeting means she may not speak first — 5b's second grant —
        // and then the turn is not requested at all rather than requested with
        // nothing to say. `greeted` is still set, so restoring the grant does
        // not make her greet somebody she has been talking to for ten minutes.
        if (frame.type === 'session.updated' && !greeted) {
          greeted = true
          const greeting = config.greeting
          if (greeting !== null) {
            put({
              type: 'response.create',
              response: { conversation: 'none', instructions: greeting },
            })
          }
        }
        // Once per type per session. The service sends well over a dozen kinds
        // and most are noise, but a type nobody here has seen is either
        // something worth acting on or a change worth knowing about — and
        // neither is visible if it is silently ignored. §33's lesson in its
        // current form: the log recorded the CONNECTION and not the
        // CONVERSATION, so nothing in it could say whether she heard anything.
        if (!announced.has(frame.type)) {
          announced.add(frame.type)
          window.mochi.report({
            kind: 'note',
            text: `first ${frame.type}  keys=[${frame.keys.join(', ')}]`,
          })
        }
        break
      default:
        break
    }
  })

  /**
   * Main hands back the ledger's answers; the channel is here, so it puts them.
   *
   * **Only the answers.** `voice:send` is also how main sends this renderer its
   * PRIVATE control frames — the reconnect, the problem count, asleep, her
   * stance, the bubble's side, the standing grants — and every one of them was
   * being written straight out to the service as well. The newest of them
   * carries her whole assembled prompt and her tool list, so this stopped being
   * a stray unknown event the service shrugs at and became a leak.
   *
   * Filtered HERE rather than by giving the private frames a channel of their
   * own: `companion/main.ts` reads them off this same subscription, and a
   * second channel is the shape v1's 45 message kinds grew out of. The prefix
   * is the contract, and it is one nothing on the wire can collide with.
   */
  stopListening = window.mochi.onSend((frame) => {
    if (isPrivateFrame(frame)) return
    put(frame)
  })

  /**
   * The config FIRST, and it is the only thing that is ordered.
   *
   * It used to settle alongside the mint and the microphone, which was right
   * while nothing depended on it. One thing does now: **whether she is allowed
   * a microphone at all.** Capturing and then disabling the track is not the
   * same as not capturing — the device opens, and on macOS the indicator
   * lights. A switch marked "Hear you" that leaves the microphone light on is a
   * switch nobody believes, whatever the track is doing.
   *
   * The cost is one IPC round trip before the other two start. It reads files
   * in main and answers in about a millisecond, against `getUserMedia`'s
   * hundreds and a network mint — so this is ordering, not latency.
   *
   * Fetched here rather than when the channel opens for the original reason,
   * which still holds: `session.created` used to arrive before the round trip
   * came back, and for that window she was configured with the model's
   * defaults — no name, no manner.
   */
  let config: SessionConfig
  try {
    config = await window.mochi.config()
  } catch (error: unknown) {
    fail(`could not read the persona: ${String(error)}`)
  }

  // SETTLED, not raced — see point 2.
  const [minted, captured] = await Promise.allSettled([
    window.mochi.open(),
    /*
      ALWAYS asked for now, and a refusal is a failure.

      It used to be conditional on the `microphone` grant, which could leave her
      awake with no device and a `recvonly` transceiver — able to speak and
      unable to hear. That switch is gone (`@shared/grants` records why) and the
      permission it duplicated belongs to macOS, which answers this call. So a
      refusal is what it looks like: the session cannot do its job, and it says
      so rather than opening a deaf one.
    */
    navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    }),
  ])
  /**
   * The capture is held FIRST, before anything can fail.
   *
   * Point 3 above is the rule and this is the line that keeps it: `fail()` runs
   * `shutdown()`, and `shutdown()` can only stop tracks it has a reference to.
   * A check that ran before this line left the microphone capturing with
   * nothing in this process able to reach it, for the life of the window.
   */
  if (captured.status === 'fulfilled') media = captured.value
  if (captured.status === 'rejected') fail(`the microphone was refused: ${String(captured.reason)}`)
  if (minted.status === 'rejected') fail(`could not open a session: ${String(minted.reason)}`)
  if (minted.status === 'fulfilled' && !minted.value.ok) fail(minted.value.why)

  micTrack = media?.getAudioTracks()[0] ?? null
  // A device that opened and produced nothing. `getUserMedia` resolving with no
  // audio track is not a permission answer — it is a device fault, and the
  // session cannot run on it.
  if (micTrack === null || media === null) fail('the microphone produced no audio track')

  {
    const granted = micTrack.getSettings()
    // What the device ACTUALLY did, not what was asked for. The two differ, and
    // echo cancellation silently absent is §17 arriving as "she interrupts
    // herself".
    window.mochi.report({
      kind: 'note',
      text: `mic "${micTrack.label}" aec=${String(granted.echoCancellation)} rate=${String(granted.sampleRate)}`,
    })
    // Disabled until `listen(true)` — see point 4.
    micTrack.enabled = false
    peer.addTrack(micTrack, media)
    callbacks.onMicrophone(media)
  }

  /**
   * Negotiation, and every way it can end goes through `fail`.
   *
   * Four awaits here can reject — the offer, the local description, the SDP
   * exchange over IPC, and the remote description — and none of them used to.
   * A rejection came straight out of `openSession`, so the caller showed the
   * error and this function's own teardown never ran: the peer stayed open and
   * the microphone stayed live, which is exactly the case point 3 exists for.
   */
  try {
    await peer.setLocalDescription(await peer.createOffer())
    const offer = peer.localDescription?.sdp
    if (offer === undefined) throw new Error('no local description')

    const answered = await window.mochi.sdp(offer)
    if (!answered.ok) throw new Error(answered.why)
    if (closed) throw new Error('the session was abandoned while opening')
    await peer.setRemoteDescription({ type: 'answer', sdp: answered.answer })
  } catch (error: unknown) {
    // `fail` throws, so this does not fall through — and it releases the media
    // and the peer on the way past, which is the whole point of routing here.
    fail(error instanceof Error ? error.message : String(error))
  }

  /**
   * What she is, in one frame. ONE builder, because it is sent twice.
   *
   * The second send is a standing grant changing mid-conversation (5b), and it
   * has to carry every field this one does: a `session.update` naming only what
   * moved is a bet on which fields the service leaves alone, and the one that
   * must not be lost is the voice — §21 locks it after her first audio, so
   * getting it back would be a reconnect.
   */
  let mayDo: { instructions: string; tools: readonly unknown[] } = {
    instructions: config.instructions,
    tools: config.tools,
  }
  function sessionUpdate(): unknown {
    return {
      type: 'session.update',
      session: {
        type: 'realtime',
        // Without this she is whatever the model is by default: no name, no
        // manner, no memory of anybody. Every session before this one ran so.
        instructions: mayDo.instructions,
        output_modalities: ['audio'],
        audio: {
          // Locked after her first audio output, so a persona switch is a
          // reconnect rather than an update (§21).
          output: { voice: config.voice },
          input: {
            // §17: her own voice through a speaker reads as somebody taking a
            // turn without this, and `semantic_vad` lets the model decide what
            // a turn is rather than an energy threshold deciding for it.
            noise_reduction: { type: 'far_field' },
            turn_detection: { type: 'semantic_vad' },
            // Resolved in main, because the languages are somebody's setting.
            // The empty-means-omit rule is `transcriptionConfig`'s, which is
            // where it can be tested — nothing can construct this file.
            transcription: transcriptionConfig(config.transcription),
          },
        },
        tools: mayDo.tools,
        tool_choice: 'auto',
      },
    }
  }

  // Sent the instant the channel opens, with everything already in hand.
  channel.addEventListener('open', () => {
    put(sessionUpdate())
    confirming = setTimeout(() => {
      confirming = null
      window.mochi.report({
        kind: 'note',
        text:
          'NOT CONFIGURED: no session.updated came back, so she is running on the ' +
          "service's defaults — no instructions, no voice of hers, server_vad. " +
          'An `error` frame above says which field was refused.',
      })
    }, CONFIRM_MS)
  })

  return {
    bubble: config.bubble,
    face: config.face,
    problems: config.problems,
    bubbleSide: config.bubbleSide,
    asleep: config.asleep,
    mayDo(change) {
      mayDo = { instructions: change.instructions, tools: change.tools }
      put(sessionUpdate())
    },
    listen(on: boolean) {
      // Nothing to enable after `shutdown`, which stops the track and clears
      // it. Reported as muted rather than not at all, so the log never claims
      // she is listening — this used to also cover a session that was never
      // allowed a device, which cannot happen now that opening one is not
      // optional.
      if (micTrack === null) {
        window.mochi.report({ kind: 'state', state: 'muted' })
        return
      }
      micTrack.enabled = on
      window.mochi.report({ kind: 'state', state: on ? 'listening' : 'muted' })
    },
    close: shutdown,
  }
}
