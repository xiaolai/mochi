import { parseServerFrame } from '@shared/realtime/frames'
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
  /** Open the microphone. Off until this is called — see point 4 above. */
  listen(on: boolean): void
  /** Idempotent, and the only path that releases anything. */
  close(): void
}

export interface SessionCallbacks {
  readonly onState: (state: SessionState) => void
  /** Her voice, handed straight out. Nothing here decides what it means. */
  readonly onRemote: (stream: MediaStream) => void
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

  function shutdown(): void {
    // A turn she began and was cut off in, whose transcript never arrived, is
    // still a fact. Filed as an empty `cut` marker rather than lost.
    for (const spoken of pending.flush()) file(spoken)

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
        if (frame.type === 'session.updated' && !greeted) {
          greeted = true
          put({
            type: 'response.create',
            response: { conversation: 'none', instructions: config.greeting },
          })
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

  // Main hands back the ledger's answers; the channel is here, so it puts them.
  window.mochi.onSend((frame) => put(frame))

  // SETTLED, not raced — see point 2.
  //
  // The config is fetched HERE rather than when the channel opens, and the
  // difference is a race the first run showed in its own log: `session.created`
  // arrived before the IPC round trip came back, so for that window she was
  // configured with the model's defaults — no name, no manner. It depends on
  // nothing the channel provides, so there is no reason to wait for it.
  const [minted, captured, configured] = await Promise.allSettled([
    window.mochi.open(),
    navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    }),
    window.mochi.config(),
  ])
  if (configured.status === 'rejected')
    fail(`could not read the persona: ${String(configured.reason)}`)
  const config = configured.value

  // A late stream is stopped wherever this ends, including on the failure paths.
  if (captured.status === 'fulfilled') media = captured.value
  if (captured.status === 'rejected') fail(`the microphone was refused: ${String(captured.reason)}`)
  if (minted.status === 'rejected') fail(`could not open a session: ${String(minted.reason)}`)
  if (minted.status === 'fulfilled' && !minted.value.ok) fail(minted.value.why)

  micTrack = media?.getAudioTracks()[0] ?? null
  if (micTrack === null || media === null) fail('the microphone produced no audio track')

  const granted = micTrack.getSettings()
  // What the device ACTUALLY did, not what was asked for. The two differ, and
  // echo cancellation silently absent is §17 arriving as "she interrupts herself".
  window.mochi.report({
    kind: 'note',
    text: `mic "${micTrack.label}" aec=${String(granted.echoCancellation)} rate=${String(granted.sampleRate)}`,
  })
  // Disabled until `listen(true)` — see point 4.
  micTrack.enabled = false
  peer.addTrack(micTrack, media)

  await peer.setLocalDescription(await peer.createOffer())
  const offer = peer.localDescription?.sdp
  if (offer === undefined) fail('no local description')

  const answered = await window.mochi.sdp(offer)
  if (!answered.ok) fail(answered.why)
  if (closed) fail('the session was abandoned while opening')
  await peer.setRemoteDescription({ type: 'answer', sdp: answered.answer })

  // Sent the instant the channel opens, with everything already in hand.
  channel.addEventListener('open', () => {
    put({
      type: 'session.update',
      session: {
        type: 'realtime',
        // Without this she is whatever the model is by default: no name, no
        // manner, no memory of anybody. Every session before this one ran so.
        instructions: config.instructions,
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
            transcription: { model: 'whisper-1' },
          },
        },
        tools: config.tools,
        tool_choice: 'auto',
      },
    })
  })

  return {
    bubble: config.bubble,
    face: config.face,
    listen(on: boolean) {
      if (micTrack !== null) micTrack.enabled = on
      window.mochi.report({ kind: 'state', state: on ? 'listening' : 'muted' })
    },
    close: shutdown,
  }
}
