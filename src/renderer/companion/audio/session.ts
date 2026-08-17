import { parseServerFrame } from '@shared/realtime/frames'

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
}

const CHANNEL = 'oai-events'

export async function openSession(callbacks: SessionCallbacks): Promise<Session> {
  const peer = new RTCPeerConnection()
  let media: MediaStream | null = null
  let micTrack: MediaStreamTrack | null = null
  let closed = false

  function shutdown(): void {
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

  /** Frame types already announced this session — see the `other` case below. */
  const announced = new Set<string>()

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
        window.mochi.report({ kind: 'note', text: `heard: ${frame.transcript}` })
        break
      case 'said':
        window.mochi.report({ kind: 'note', text: `said: ${frame.transcript}` })
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
    listen(on: boolean) {
      if (micTrack !== null) micTrack.enabled = on
      window.mochi.report({ kind: 'state', state: on ? 'listening' : 'muted' })
    },
    close: shutdown,
  }
}
