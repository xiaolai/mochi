import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PERSONA, SPOKEN_OUTPUT_RULES } from '@shared/persona'
import { DEFAULT_SOUND } from '@shared/sound'
import { ALONE } from '@shared/utterance'
import { openVoiceSession, readQuestion } from './session'

/**
 * The open path, tested against fakes, because the only thing that can go wrong
 * here that matters is a microphone nobody stops.
 *
 * `getUserMedia` CANNOT be cancelled. Aborting an attempt does not withdraw the
 * permission prompt or the capture that follows it, so the stream routinely
 * arrives after the caller has given up -- opening spans two 30s network calls
 * against a 15s wake timeout, so this is the ordinary case rather than a
 * pathological one. Everything below exists to hold that one ordering.
 */

interface FakeTrack {
  kind: string
  enabled: boolean
  stopped: boolean
  label: string
  getSettings: () => Record<string, unknown>
  stop: () => void
  clone: () => FakeTrack
}

function track(kind = 'audio'): FakeTrack {
  const t: FakeTrack = {
    kind,
    enabled: true,
    stopped: false,
    label: 'fake mic',
    getSettings: () => ({ echoCancellation: true, noiseSuppression: true, sampleRate: 48_000 }),
    stop: () => {
      t.stopped = true
    },
    // Copies the state AS IT IS, which is what the real one does and is the
    // whole reason the bug below was possible.
    clone: () => ({ ...t, clone: t.clone }),
  }
  return t
}

function stream(tracks: FakeTrack[]): unknown {
  return {
    getTracks: () => tracks,
    getAudioTracks: () => tracks.filter((t) => t.kind === 'audio'),
  }
}

/**
 * Server frames the session is listening for, by test.
 *
 * The fake data channel used to drop every listener on the floor, so the
 * inbound message handler -- which decides when an utterance ENDED -- had never
 * been executed by a test at all. Two defects lived in it: a drained buffer
 * reported as `played` for a cancelled utterance, and `output_audio_buffer.
 * cleared` not being treated as terminal. Both were found by reading.
 */
let onServerFrame: ((event: unknown) => void) | null = null

/** Push a frame at the session as though the server had sent it. */
function serverSays(frame: Record<string, unknown>): void {
  if (onServerFrame === null) throw new Error('nothing is listening to the channel')
  onServerFrame({ data: JSON.stringify(frame) })
}

/** Lets a test make the transport refuse, which `RTCDataChannel` really does. */
const channelState = { throwOnSend: false }

/** A peer that negotiates instantly and records nothing else. */
function fakePeer(sent?: string[]): unknown {
  const listeners = new Map<string, Array<(event: unknown) => void>>()
  return {
    connectionState: 'new',
    addEventListener: (name: string, fn: (event: unknown) => void) => {
      const list = listeners.get(name) ?? []
      list.push(fn)
      listeners.set(name, list)
    },
    createDataChannel: () => ({
      addEventListener: (name: string, fn: (event: unknown) => void) => {
        if (name === 'message') onServerFrame = fn
      },
      close: () => {},
      // Open only when a test is recording what crosses it. The others rely on
      // a channel that never opens, which is the state their races happen in.
      readyState: sent === undefined ? 'connecting' : 'open',
      send: (raw: string) => {
        if (channelState.throwOnSend) throw new Error('the transport is closing')
        sent?.push(raw)
      },
    }),
    addTrack: () => ({}),
    createOffer: () => Promise.resolve({ type: 'offer', sdp: 'v=0\r\n' }),
    setLocalDescription: () => Promise.resolve(),
    setRemoteDescription: () => Promise.resolve(),
    close: () => {},
    localDescription: { type: 'offer', sdp: 'v=0\r\n' },
  }
}

afterEach(() => {
  onServerFrame = null
  channelState.throwOnSend = false
  vi.restoreAllMocks()
  // `vi.stubGlobal`, not assignment: `navigator` is an accessor with no setter
  // on globalThis under Node 24, so `Object.assign` throws rather than stubbing.
  vi.unstubAllGlobals()
})

/**
 * Install the globals `openVoiceSession` reaches for.
 *
 * `media` is a promise the test resolves by hand — that control is the entire
 * point, because the defect only exists in the window between an abort and a
 * late-arriving stream.
 */
function install(media: Promise<unknown>, sent?: string[]): void {
  vi.stubGlobal('RTCPeerConnection', function RTC(this: unknown) {
    return fakePeer(sent)
  })
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: () => media } })
  vi.stubGlobal('window', {
    mochi: {
      // Resolves immediately: the race under test is on the OTHER promise, so
      // the key must never be what keeps `allSettled` waiting.
      mintKey: () => Promise.resolve({ ok: true, value: 'key' }),
      exchangeSdp: () => Promise.resolve({ ok: true, answer: 'v=0\r\n' }),
    },
  })
}

const noopCallbacks = {
  onReady: () => {},
  onFailed: () => {},
  onLost: () => {},
  onUserSpoke: () => {},
  onWorkspaceAsked: () => {},
  onSaid: () => {},
  onRemoteStream: () => {},
  onLocalStream: () => {},
  onUtteranceEnded: () => {},
}

describe('openVoiceSession', () => {
  it('stops a microphone that arrives AFTER the attempt was abandoned', async () => {
    // The whole reason this file exists.
    //
    // `shutdown()` is idempotent, and it used to early-return on `closed`
    // before releasing anything. Abort fires while `getUserMedia` is pending,
    // so the first shutdown runs with `media` still null and sets `closed`;
    // the stream then resolves, is adopted, and the second shutdown returns at
    // the guard without touching it. The capture stayed open for the life of
    // the process while every surface in the app reported the microphone shut
    // -- which is precisely the state `tray.ts` says must be unreachable.
    const mic = track()
    let grant: (value: unknown) => void = () => {}
    const pending = new Promise<unknown>((resolve) => {
      grant = resolve
    })
    install(pending)

    const controller = new AbortController()
    const opening = openVoiceSession(
      DEFAULT_PERSONA,
      '',
      SPOKEN_OUTPUT_RULES,
      DEFAULT_SOUND,
      false,
      1,
      noopCallbacks,
      controller.signal,
    )

    // Give up first, THEN let the microphone arrive. This order is the bug.
    controller.abort()
    grant(stream([mic]))

    await expect(opening).rejects.toThrow(/abandoned/)
    expect(mic.stopped, 'a live microphone was left running with no reference to it').toBe(true)
  })

  it('stops every track, not only the audio one it picked out', async () => {
    // A constraint of `audio: {...}` should not return video, but the release
    // path must not depend on the browser honouring that -- it iterates
    // `getTracks()` rather than the single track it kept a handle on.
    const audio = track('audio')
    const video = track('video')
    let grant: (value: unknown) => void = () => {}
    const pending = new Promise<unknown>((resolve) => {
      grant = resolve
    })
    install(pending)

    const controller = new AbortController()
    const opening = openVoiceSession(
      DEFAULT_PERSONA,
      '',
      SPOKEN_OUTPUT_RULES,
      DEFAULT_SOUND,
      false,
      2,
      noopCallbacks,
      controller.signal,
    )
    controller.abort()
    grant(stream([audio, video]))

    await expect(opening).rejects.toThrow()
    expect(audio.stopped).toBe(true)
    expect(video.stopped).toBe(true)
  })
})

/**
 * A negotiated session with an open channel, recording both directions.
 *
 * Four tests needed the same eight lines of setup; the fifth would have been
 * where they drifted apart.
 */
async function live(): Promise<{
  session: Awaited<ReturnType<typeof openVoiceSession>>
  sent: string[]
  ended: { id: number; outcome: string }[]
  channel: { throwOnSend: boolean }
}> {
  const ended: { id: number; outcome: string }[] = []
  const sent: string[] = []
  const mic = track()
  install(Promise.resolve(stream([mic])), sent)
  vi.stubGlobal('MediaStream', function Fake(this: unknown, t: FakeTrack[]) {
    return { getTracks: () => t, getAudioTracks: () => t }
  })
  const session = await openVoiceSession(
    DEFAULT_PERSONA,
    '',
    SPOKEN_OUTPUT_RULES,
    DEFAULT_SOUND,
    true,
    1,
    {
      ...noopCallbacks,
      onUtteranceEnded: (id: number, outcome: string) => ended.push({ id, outcome }),
    },
    new AbortController().signal,
  )
  return { session, sent, ended, channel: channelState }
}

describe('what a driven session asks for', () => {
  it('sends a response that cannot see the conversation', async () => {
    // Observed: the person asked how to spell the previous word, got silence,
    // then said "next". The drill asked for a sentence using "scrutinise" and
    // the model answered the PENDING QUESTION with the new word -- spelling it
    // instead of using it. The word was marked covered and never practised.
    //
    // `instructions` said "do not say anything else" and lost to a human turn.
    // The fix is not louder wording; it is a response with nothing to blend.
    const sent: string[] = []
    const mic = track()
    install(Promise.resolve(stream([mic])), sent)
    vi.stubGlobal('MediaStream', function Fake(this: unknown, t: FakeTrack[]) {
      return { getTracks: () => t, getAudioTracks: () => t }
    })

    const session = await openVoiceSession(
      DEFAULT_PERSONA,
      '',
      SPOKEN_OUTPUT_RULES,
      DEFAULT_SOUND,
      true,
      1,
      noopCallbacks,
      new AbortController().signal,
    )
    session.speak(1, 'Use the word "candid" in a sentence.', ALONE)

    const created = sent.map((raw) => JSON.parse(raw) as Record<string, unknown>)
    const response = created.find((one) => one['type'] === 'response.create')
    expect(response, 'no response.create was sent').toBeDefined()
    const body = response!['response'] as Record<string, unknown>
    expect(body['conversation'], 'the drill can see the conversation').toBe('none')
    expect(body['input'], 'the drill was given context to blend with').toEqual([])
    expect(body['instructions']).toContain('candid')
  })

  it('ends the utterance when the audio buffer is cleared', async () => {
    // The case the first cancellation fix missed, and the COMMON one rather
    // than an edge.
    //
    // `response.done` arrives seconds before her audio drains -- 7.9s, measured
    // on an eight-second item -- so an interruption almost always reaches a
    // response the server has already marked `completed`. Cancelling one is
    // refused, and the `response.done` that would have said `cancelled` went by
    // long ago saying `completed`. If the clear is not terminal, the utterance
    // never ends: the caller holds a pending item and the drill stops offering.
    const { session, ended } = await live()
    session.speak(1, 'Use "candid" in a sentence.', ALONE)
    serverSays({ type: 'response.created', response: { id: 'resp_abc' } })
    // Audio began. Sent because a real session always sends it BEFORE
    // `response.done` -- measured at +7631ms against +8360ms on a live turn --
    // and because "she is still audible" is not expressible without it. The
    // fixture omitted it while asserting audibility, which only became a
    // difference once a completed turn that produced NO audio had to be told
    // apart from this one.
    serverSays({ type: 'output_audio_buffer.started' })
    // Generation finished. NOT terminal -- she is still audible for seconds.
    serverSays({ type: 'response.done', response: { status: 'completed' } })
    expect(ended, 'generation finishing is not her finishing').toEqual([])

    session.silence(1)
    serverSays({ type: 'output_audio_buffer.cleared' })
    expect(ended).toEqual([{ id: 1, outcome: 'cancelled' }])
  })

  /**
   * A turn that completes having produced no audio at all.
   *
   * Exactly this shape was recorded on a live session: an
   * `ask_workspace` turn whose output list held a function call and nothing
   * else, with no `output_audio_buffer.started` between
   * `response.output_item.added` and `response.done`. Tools stay declared for
   * every response, so a `speak()` turn can take it too.
   *
   * The terminal audio events are what normally free the slot, and neither is
   * coming. Before this, `sounding` stayed occupied forever and the `speak`
   * gate refused every later utterance — she would simply never speak again,
   * with nothing in the log naming why.
   */
  it('ends an utterance that completed without ever sounding', async () => {
    const { session, ended } = await live()
    session.speak(1, 'Use "candid" in a sentence.', ALONE)
    serverSays({ type: 'response.created', response: { id: 'resp_mute' } })
    serverSays({ type: 'response.done', response: { status: 'completed' } })
    expect(ended, 'a turn with no audio left the slot occupied').toEqual([
      { id: 1, outcome: 'failed' },
    ])

    // And the slot is genuinely free again — the failure this guards against
    // is not the lost utterance, it is every one after it.
    session.speak(2, 'Again.', ALONE)
    expect(ended, 'the next utterance was refused by a stale slot').toEqual([
      { id: 1, outcome: 'failed' },
    ])
  })

  /**
   * `askForTurn` — which delivers the workspace acknowledgement and answer —
   * sets `responding` without occupying `sounding`. A `speak` landing in that
   * window used to pass the gate, get refused by the service with
   * `conversation_already_has_active_response`, and never resolve.
   */
  it('refuses a speak while a workspace turn is in flight', async () => {
    const { session, ended } = await live()
    session.acknowledgeWorkspace()
    session.speak(7, 'Something else.', ALONE)
    expect(ended, 'speak was sent into an active response').toEqual([{ id: 7, outcome: 'failed' }])
  })

  /**
   * `onUtteranceEnded` promises PLAYBACK, not protocol.
   *
   * `response.done` arrives seconds before the buffer drains, so reporting a
   * failed or cancelled response the moment the protocol says so hands the
   * caller an ended utterance while she is still audibly mid-word — and the
   * caller's whole job is to speak next.
   */
  it('holds a failed outcome until her audio actually drains', async () => {
    const { session, ended } = await live()
    session.speak(1, 'Use "candid" in a sentence.', ALONE)
    serverSays({ type: 'response.created', response: { id: 'resp_abc' } })
    serverSays({ type: 'output_audio_buffer.started' })
    serverSays({ type: 'response.done', response: { status: 'failed' } })
    expect(ended, 'ended her while she was still sounding').toEqual([])

    serverSays({ type: 'output_audio_buffer.stopped' })
    // `failed`, not the `played` the drained buffer would otherwise report.
    expect(ended).toEqual([{ id: 1, outcome: 'failed' }])
  })

  /**
   * A refused `response.create` comes back as an `error` frame with no
   * response, no `response.done` and no audio. `responding` is set at send
   * time, so nothing was ever going to clear it: the session looked busy
   * forever and refused every later turn.
   */
  it('clears the request the service refused, and frees the session', async () => {
    const { session, sent, ended } = await live()
    session.speak(3, 'Say something.', ALONE)
    const request = sent
      .map((raw) => JSON.parse(raw) as Record<string, unknown>)
      .find((one) => one['type'] === 'response.create')
    expect(request?.['event_id'], 'the request went out unnamed').toEqual(expect.any(String))

    serverSays({
      type: 'error',
      error: { type: 'invalid_request_error', event_id: request!['event_id'] },
    })
    expect(ended, 'the refused utterance was never resolved').toEqual([
      { id: 3, outcome: 'failed' },
    ])

    // And the session accepts work again rather than refusing forever.
    session.speak(4, 'Try again.', ALONE)
    expect(ended).toEqual([{ id: 3, outcome: 'failed' }])
  })

  /**
   * A turn requested by `askForTurn` carries no utterance. Ending whichever
   * one happens to be sounding would be two things writing to one slot, which
   * is a bug this file already has scars from.
   */
  it('does not end an unrelated utterance when a turn request is refused', async () => {
    const { session, sent, ended } = await live()
    const before = sent.length
    session.acknowledgeWorkspace()
    const request = sent
      .slice(before)
      .map((raw) => JSON.parse(raw) as Record<string, unknown>)
      .find((one) => one['type'] === 'response.create')

    serverSays({ type: 'error', error: { event_id: request!['event_id'] } })
    expect(ended).toEqual([])
    // The session is free again, so the next utterance is accepted.
    session.speak(9, 'Now speak.', ALONE)
    expect(ended, 'the session stayed busy after a refused turn').toEqual([])
  })

  /**
   * `RTCDataChannel.send()` throws — a closing transport, a message past the
   * SCTP limit — and the slot is claimed BEFORE the frame goes out, because a
   * response exists from the moment it is requested. A throw therefore left
   * `sounding` and `responding` set with nothing on the way to clear them: the
   * same permanent silence, reached from the send side.
   */
  it('releases the slot when the frame cannot be sent', async () => {
    const { session, ended, channel } = await live()
    channel.throwOnSend = true
    session.speak(5, 'Say something.', ALONE)
    expect(ended, 'a frame that never left was never resolved').toEqual([
      { id: 5, outcome: 'failed' },
    ])

    // And the session still works once the transport recovers.
    channel.throwOnSend = false
    session.speak(6, 'Again.', ALONE)
    expect(ended).toEqual([{ id: 5, outcome: 'failed' }])
  })

  it('cancels by NAME, and clears the audio already sent', async () => {
    // A bare `response.cancel` cancels "an in-progress response in the default
    // conversation", and every drill utterance is `conversation: 'none'` --
    // which is not that conversation. The cancel matched nothing at all.
    const { session, sent } = await live()
    session.speak(1, 'Use "candid" in a sentence.', ALONE)
    serverSays({ type: 'response.created', response: { id: 'resp_abc' } })
    session.silence(1)

    const frames = sent.map((raw) => JSON.parse(raw) as Record<string, unknown>)
    const cancel = frames.find((one) => one['type'] === 'response.cancel')
    expect(cancel, 'no cancel was sent').toBeDefined()
    expect(cancel!['response_id'], 'an unnamed cancel goes to the wrong conversation').toBe(
      'resp_abc',
    )
    // Cancelling stops GENERATION; audio already handed to the peer keeps
    // playing until the buffer is cleared.
    expect(frames.some((one) => one['type'] === 'output_audio_buffer.clear')).toBe(true)
  })

  it('never calls a cancelled utterance "played"', async () => {
    // If clearing the buffer also drains it, `output_audio_buffer.stopped` can
    // still arrive after a cancel. Reporting that as `played` would mark an
    // item practised that she was cut off in the middle of -- the exact failure
    // the outcome protocol exists to prevent.
    const { session, ended } = await live()
    session.speak(1, 'Use "candid" in a sentence.', ALONE)
    serverSays({ type: 'response.created', response: { id: 'resp_abc' } })
    session.silence(1)
    serverSays({ type: 'output_audio_buffer.stopped' })
    expect(ended).toEqual([{ id: 1, outcome: 'cancelled' }])
  })

  it('defers a cancel that arrives before the response has been named', async () => {
    // `silence()` can land between `response.create` and `response.created`.
    // Sending an unnamed cancel then would target the default conversation and
    // miss; dropping it would leave the caller waiting on an utterance it has
    // already given up on.
    const { session, sent } = await live()
    session.speak(1, 'Use "candid" in a sentence.', ALONE)
    session.silence(1)
    expect(
      sent.some(
        (raw) => (JSON.parse(raw) as Record<string, unknown>)['type'] === 'response.cancel',
      ),
      'an unnamed cancel was sent anyway',
    ).toBe(false)

    serverSays({ type: 'response.created', response: { id: 'resp_late' } })
    const cancel = sent
      .map((raw) => JSON.parse(raw) as Record<string, unknown>)
      .find((one) => one['type'] === 'response.cancel')
    expect(cancel, 'the deferred cancel never went out').toBeDefined()
    expect(cancel!['response_id']).toBe('resp_late')
  })

  it('refuses a second utterance while one is still sounding', async () => {
    // `sounding` is one slot and no server frame carries our id, so a second
    // request would rebind it and hand the FIRST one's
    // `output_audio_buffer.stopped` to the SECOND -- committing an item nobody
    // heard while the one she said stays unseen. The service refuses a
    // concurrent response anyway, and its error frame names no utterance, so
    // the caller would wait forever for an outcome that cannot arrive.
    //
    // Callers serialise. This is here so that they must.
    const ended: { id: number; outcome: string }[] = []
    const sent: string[] = []
    const mic = track()
    install(Promise.resolve(stream([mic])), sent)
    vi.stubGlobal('MediaStream', function Fake(this: unknown, t: FakeTrack[]) {
      return { getTracks: () => t, getAudioTracks: () => t }
    })

    const session = await openVoiceSession(
      DEFAULT_PERSONA,
      '',
      SPOKEN_OUTPUT_RULES,
      DEFAULT_SOUND,
      true,
      1,
      {
        ...noopCallbacks,
        onUtteranceEnded: (id: number, outcome: string) => ended.push({ id, outcome }),
      },
      new AbortController().signal,
    )
    session.speak(1, 'Use "ephemeral" in a sentence.', ALONE)
    session.speak(2, 'Use "candid" in a sentence.', ALONE)

    const creates = sent
      .map((raw) => JSON.parse(raw) as Record<string, unknown>)
      .filter((one) => one['type'] === 'response.create')
    expect(creates, 'a second response was stacked on the first').toHaveLength(1)
    expect(ended, 'the refused utterance was dropped without an outcome').toEqual([
      { id: 2, outcome: 'failed' },
    ])
  })
})

describe('the microphone the analyser listens to', () => {
  it('is a clone that is enabled, not the muted one that goes to the peer', async () => {
    // The track sent to the peer is muted before the offer, so the app can
    // decide when she is heard. The analyser reads a CLONE -- and `clone()`
    // copies the state as it is, one line after that muting, so the clone is
    // born silent unless something enables it.
    //
    // Nothing about that failure is visible: she talks, the gate closes, and
    // no log anywhere says a measurement never happened. The auto setting just
    // never decides, and falls back to assuming echo forever.
    const mic = track()
    install(Promise.resolve(stream([mic])))
    // The real one wraps whatever it is handed; only the tracks matter here.
    vi.stubGlobal('MediaStream', function Fake(this: unknown, tracks: FakeTrack[]) {
      return { getTracks: () => tracks, getAudioTracks: () => tracks }
    })

    let analysed: { getAudioTracks: () => FakeTrack[] } | null = null
    await openVoiceSession(
      DEFAULT_PERSONA,
      '',
      SPOKEN_OUTPUT_RULES,
      DEFAULT_SOUND,
      false,
      1,
      {
        ...noopCallbacks,
        onLocalStream: (given) => {
          analysed = given as unknown as { getAudioTracks: () => FakeTrack[] }
        },
      },
      new AbortController().signal,
    )

    const heard = (analysed as { getAudioTracks: () => FakeTrack[] } | null)?.getAudioTracks()[0]
    expect(heard, 'the analyser was never handed a microphone').toBeDefined()
    expect(heard?.enabled, 'the analyser listens to a muted track').toBe(true)
    // And the one that goes to the peer is still the muted original.
    expect(mic.enabled).toBe(false)
  })
})

/**
 * The tool-call argument parser, which reads MODEL OUTPUT.
 *
 * `arguments` arrives as a JSON string produced by the model, so its shape is
 * not ours to assume. An empty question is returned rather than thrown on,
 * because main still has to answer the call -- a `function_call` left without a
 * `function_call_output` stays unresolved in the conversation for the rest of
 * the session.
 */
describe('readQuestion', () => {
  it('reads the question out of the arguments string', () => {
    expect(readQuestion(JSON.stringify({ question: 'what changed?' }))).toBe('what changed?')
  })

  it.each([
    ['not json at all', 'unparseable'],
    ['[1,2]', 'an array'],
    ['"a string"', 'a bare string'],
    ['{}', 'no question field'],
    ['{"question":42}', 'a question that is not text'],
  ])('returns empty for %s (%s) rather than throwing', (args) => {
    expect(readQuestion(args)).toBe('')
  })

  it.each([[undefined], [null], [42], [{ question: 'x' }]])(
    'returns empty when arguments is not a string: %s',
    (args) => {
      expect(readQuestion(args)).toBe('')
    },
  )
})

/**
 * The press has to reach HER, which is the defect this closes.
 *
 * A keypress recorded only in main told her nothing, so she had no reason to
 * call the tool, the authorisation expired unused, and the key looked exactly
 * like one no application had claimed. Reported from a real session: the user
 * pressed it, asked a question, and she answered from memory with no TOOL CALL
 * line anywhere in the log.
 *
 * These drive the REAL session object. An earlier version of this block built
 * the JSON inside the test and asserted its shape, which proved only that the
 * test could write JSON -- the same "assert against the fake" mistake that let
 * a dead SIGKILL escalation pass a whole audit round.
 */
describe('the delegation wire', () => {
  it('arms with an item and never asks for a turn', async () => {
    const { session, sent } = await live()
    const before = sent.length
    session.armWorkspace()

    const created = sent.slice(before).map((raw) => JSON.parse(raw) as Record<string, unknown>)
    const item = created.find((one) => one['type'] === 'conversation.item.create')
    expect(item, 'nothing was queued for her next turn').toBeDefined()
    // §1 E: an item alone is read on her NEXT turn, which is the request the
    // user is about to speak. §1 D: asking for a turn while she is speaking is
    // rejected outright, and a press can land mid-sentence.
    expect(created.some((one) => one['type'] === 'response.create')).toBe(false)
    expect(JSON.stringify(item)).toContain('ask_workspace')
  })

  it('answers a tool call on its own call_id', async () => {
    const { session, sent } = await live()
    const before = sent.length
    session.answerWorkspace('call_abc', { status: 'ok', answer: 'Two files.' })

    const created = sent.slice(before).map((raw) => JSON.parse(raw) as Record<string, unknown>)
    const item = created.find((one) => one['type'] === 'conversation.item.create')
    const payload = (item as { item?: { type?: string; call_id?: string } } | undefined)?.item
    expect(payload?.type).toBe('function_call_output')
    // The ORIGINAL id: reuse is what makes her complete what she promised
    // rather than correct herself (§1).
    expect(payload?.call_id).toBe('call_abc')
  })

  /**
   * Queue-and-wait is correct; queue-and-never-ask is not.
   *
   * Measured on a live session: she held the answer for 47 seconds and only
   * delivered it after the user prompted her, having already promised to report
   * back. From the outside that is the app having hung.
   */
  it('asks for the turn that delivers the answer when she is not talking', async () => {
    const { session, sent } = await live()
    const before = sent.length
    session.answerWorkspace('call_abc', { status: 'ok', answer: 'Two files.' })

    const created = sent.slice(before).map((raw) => JSON.parse(raw) as Record<string, unknown>)
    expect(
      created.some((one) => one['type'] === 'response.create'),
      'the answer was queued and never asked for',
    ).toBe(true)
  })

  /**
   * The acknowledgement is the OPPOSITE of the arm on both counts.
   *
   * Measured on a live session: the turn carrying the tool call produced no
   * audio at all -- `response.output_item.added`, `response.function_call_
   * arguments.done`, `response.done`, and no `output_audio_buffer.started`
   * anywhere between them -- and then fifty-six seconds passed with the run in
   * flight and her saying nothing. The user's first signal that anything was
   * happening was asking why nothing had happened.
   *
   * The tool description already asks her to say she is looking. That is a
   * REQUEST made of a model, and this is the mechanism.
   */
  it('asks for a turn to say the lookup has started', async () => {
    const { session, sent } = await live()
    const before = sent.length
    session.acknowledgeWorkspace()

    const created = sent.slice(before).map((raw) => JSON.parse(raw) as Record<string, unknown>)
    const item = created.find((one) => one['type'] === 'conversation.item.create')
    expect(item, 'nothing told her the lookup had started').toBeDefined()
    // Unlike `armWorkspace`: no user utterance is coming to carry this one.
    expect(
      created.some((one) => one['type'] === 'response.create'),
      'the acknowledgement was queued and never asked for',
    ).toBe(true)
  })

  /**
   * §1 D: a turn asked for while one is active is refused outright. The
   * acknowledgement is sent the instant main spawns Codex, which is a moment
   * chosen by a keypress rather than by the conversation -- so it lands mid-turn
   * routinely, not rarely.
   */
  it('defers the acknowledgement while she is speaking, then sends it', async () => {
    const { session, sent } = await live()
    serverSays({ type: 'response.created', response: { id: 'resp_busy' } })
    serverSays({ type: 'output_audio_buffer.started' })

    const before = sent.length
    session.acknowledgeWorkspace()
    const during = sent.slice(before).map((raw) => JSON.parse(raw) as Record<string, unknown>)
    // Asserted FIRST, so "no turn was requested" cannot pass because nothing
    // was sent at all. A dropped acknowledgement and a deferred one look
    // identical from the `response.create` count alone.
    expect(
      during.some((one) => one['type'] === 'conversation.item.create'),
      'the acknowledgement was never queued, so the deferral below proves nothing',
    ).toBe(true)
    expect(
      during.some((one) => one['type'] === 'response.create'),
      'a turn was requested into an active response, which the service rejects',
    ).toBe(false)

    serverSays({ type: 'response.done', response: { status: 'completed' } })
    serverSays({ type: 'output_audio_buffer.stopped' })
    const after = sent.slice(before).map((raw) => JSON.parse(raw) as Record<string, unknown>)
    expect(
      after.some((one) => one['type'] === 'response.create'),
      'the debt was never serviced, so she never said she was looking',
    ).toBe(true)
  })
})
