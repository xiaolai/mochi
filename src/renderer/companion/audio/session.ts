/**
 * The session, which has to live here because `RTCPeerConnection` does.
 *
 * Main owns the lifecycle and the credential; this owns the peer connection,
 * the microphone and her voice. The split is the security boundary: main hands
 * down nothing but an SDP answer, so this file — the one that also loads a face
 * out of a user-writable folder — never holds a key.
 *
 * Ported from mochi-spike, whose whole value is being the smallest thing that
 * talks. Anything it does not do is a candidate for not doing.
 *
 * ## On the size of `openVoiceSession`
 *
 * It is long — resource ownership, WebRTC negotiation, microphone acquisition,
 * protocol encoding and decoding, reconnection policy, logging, and the
 * commands it returns. That is a fair criticism and the split is NOT free: the
 * function's real subject is a teardown that must release a peer, a channel, a
 * timer and a microphone from any of a dozen exit points, several of which are
 * reachable only mid-await. `shutdown()` is correct today because every one of
 * those exits can see it; splitting the negotiation out means handing that
 * ownership across a boundary, which is precisely where the two bugs this file
 * already carries scars from came from — a microphone left live after an
 * aborted attempt, and a channel closing into a torn-down session.
 *
 * The parts that CAN leave without touching that are the protocol shapes: the
 * `session.update` body and the inbound event handling are data and a switch,
 * and neither owns anything. That is the split worth making, with its own
 * tests, rather than one performed while fixing unrelated findings.
 */

import type { AttemptId, JsonValue } from '@shared/ipc'
import type { Persona } from '@shared/persona'
import type { Sound } from '@shared/sound'
import type { Isolation, UtteranceId, UtteranceOutcome } from '@shared/utterance'
import { instructionsFor } from '@shared/persona'

export interface VoiceCallbacks {
  /** The server acknowledged our configuration. Not merely "we sent it". */
  readonly onReady: () => void
  /** Never became usable. The lifecycle treats this as a failed wake. */
  readonly onFailed: (reason: string) => void
  /**
   * Was usable and then was not.
   *
   * Distinct from `onFailed` because the state machine handles the two in
   * different phases: a failure is only meaningful while waking, so reporting a
   * mid-conversation drop as one left the app awake over a dead session.
   */
  readonly onLost: (reason: string) => void
  /** The server's turn detector heard the user. */
  readonly onUserSpoke: () => void
  /**
   * One requested utterance ended, and how.
   *
   * `played` is driven by the audio buffer emptying, not by `response.done`
   * -- measured 2.1s apart on a greeting and 7.9s apart on an eight-second
   * item, because the model generates far faster
   * than real time. A caller that advanced on the protocol event would move on
   * while she was still audible.
   */
  readonly onUtteranceEnded: (utterance: UtteranceId, outcome: UtteranceOutcome) => void
  /** Her remote track, for the analyser that drives the mouth. */
  readonly onRemoteStream: (stream: MediaStream) => void
  /**
   * The microphone, as a stream that stays live while the real one is gated.
   *
   * A CLONE of the captured track, not the track itself. Closing the
   * microphone sets `enabled = false` on what is sent to the peer, which makes
   * it produce silence -- so measuring the same track would blind the very
   * measurement that decides whether to gate it. A cloned track carries its
   * own `enabled`, so this one keeps hearing the room.
   */
  readonly onLocalStream: (stream: MediaStream) => void
  /**
   * A finished turn, as text.
   *
   * These were already arriving and already being logged; the log was the only
   * place they went. Handed up rather than stored here because the store lives
   * in main -- see `ipc.ts`.
   */
  readonly onSaid: (who: 'her' | 'you', text: string) => void
  /**
   * She asked to look something up.
   *
   * The renderer does not decide whether this may run -- it hands the call to
   * main, which owns the workspace, the guard and the authorisation. Findings
   * §2 settled that shape: the Realtime service cannot reach a local Codex, so
   * main is the middleman and the whole loop stays on this machine.
   */
  readonly onWorkspaceAsked: (callId: string, question: string) => void
}

/**
 * The `question` argument, or an empty string.
 *
 * `arguments` arrives as a JSON STRING, and it is model output: its shape is
 * not ours to assume. An empty question is passed along rather than dropped so
 * main can answer the call -- a tool call that gets no `function_call_output`
 * at all leaves the conversation holding an unanswered one for the rest of the
 * session.
 */
/**
 * What she is told when the key is pressed, and when the lookup starts.
 *
 * Named rather than inline so the two can be read side by side: they are the
 * only free text this file sends her, they must not contradict each other, and
 * both say WHAT to do rather than what to say -- her wording and her language
 * stay hers.
 */
const SYSTEM_ARM =
  'The user has just pressed the key that asks you to look something up. Their next message is that request: call the ask_workspace tool with it rather than answering from memory.'

const SYSTEM_ACKNOWLEDGE =
  'The lookup you just requested is now running and takes up to a minute. Say briefly, in your own words and in the language you are speaking, that you are looking it up now and will report back. Do not attempt to answer the question itself yet, and do not claim to have found anything.'

export function readQuestion(args: unknown): string {
  if (typeof args !== 'string') return ''
  try {
    const parsed: unknown = JSON.parse(args)
    if (typeof parsed !== 'object' || parsed === null) return ''
    const question = (parsed as { question?: unknown }).question
    return typeof question === 'string' ? question : ''
  } catch {
    return ''
  }
}

export interface VoiceSession {
  /**
   * Ask for an utterance, under a name the caller can follow it by.
   *
   * The outcome comes back later as `onUtteranceEnded`, driven by her audio
   * actually stopping rather than by the protocol reporting the response
   * complete -- those are about two seconds apart here.
   */
  speak(utterance: UtteranceId, instructions: string, isolation: Isolation): void
  /** Stop one utterance, if it is the one currently sounding. */
  silence(utterance: UtteranceId): void
  /**
   * Answer a tool call whose work has finished, however late that is.
   *
   * Queued as a `function_call_output` on the ORIGINAL `call_id`, and then a
   * turn is requested when one can be accepted. Both halves are measured, not
   * guessed:
   *
   * - Reusing the answered `call_id` makes her COMPLETE what she promised --
   *   "the result is X". Injecting the same text as a message instead made her
   *   say "Correction: …", as though she had misspoken a moment ago.
   * - Asking for a turn while a response is active is REJECTED outright, with
   *   `conversation_already_has_active_response`. A job finishes at a random
   *   moment, so that failure would be intermittent -- the hardest kind to
   *   reproduce and the easiest to ship.
   *
   * The item is therefore always queued first, and a turn is then REQUESTED --
   * immediately when nothing is in flight, otherwise deferred until the
   * response ends and the audio buffer stops or is cleared. §1 verified that a
   * queued item survives to her next turn; what it did not measure is how long
   * that takes when nobody speaks, which on a live session was 47 seconds and
   * read as a hang.
   *
   * If reusing an answered `call_id` ever stops working -- it is undocumented,
   * and §1 flags it as the most likely thing to break -- the fallback is a
   * `system` message plus `response.create`, one line away, at the cost of that
   * "Correction:" tone.
   */
  answerWorkspace(callId: string, payload: JsonValue): void
  /**
   * Tell her the next thing asked of her should be looked up.
   *
   * The item ALONE here, with no turn requested -- unlike `answerWorkspace`,
   * which has something to deliver. She reads this on her next turn, which is
   * exactly when the user finishes speaking the request, so asking for one
   * would only interrupt them.
   */
  armWorkspace(): void
  /**
   * Tell her the lookup she asked for is now running, and ask her to say so.
   *
   * The opposite choice to `armWorkspace` on both counts, for the same reason
   * each time: nobody is about to speak. A turn IS requested here, because the
   * next user utterance is not guaranteed to come -- the measured failure was a
   * fifty-six second silence in which she had emitted the tool call with no
   * audio at all and had no reason to speak again.
   *
   * Routed through `askForTurn` rather than sending `response.create` directly,
   * so it inherits the measured deferral: a turn asked
   * for while one is active is refused outright, and this one is sent at
   * whatever moment `response.done` happens to land.
   */
  acknowledgeWorkspace(): void
  setMicEnabled(enabled: boolean): void
  close(): void
}

/**
 * How long a `disconnected` peer is given to come back.
 *
 * `disconnected` is not terminal in WebRTC — it is what a network transition
 * looks like, and ICE frequently recovers from it. Treating it as fatal ended
 * sessions that would have healed in under a second.
 */
const RECONNECT_GRACE_MS = 8_000

/**
 * Open one.
 *
 * The order here is load-bearing in two places, both learned rather than
 * chosen: the data channel must exist BEFORE the offer is created or it is not
 * described in it, and the mint and the microphone are started TOGETHER because
 * neither needs anything from the other — running them in series adds a
 * permission prompt's worth of latency to a network call that is already the
 * slow part.
 *
 * `signal` is how an attempt is abandoned. Opening spans two network calls
 * bounded at 30s each against a 15s wake timeout, so the caller regularly gives
 * up while this is still running; without a way in, the abandoned attempt kept
 * its microphone and reported its outcome against whatever had replaced it.
 */
export async function openVoiceSession(
  persona: Persona,
  /** Filed under her id in main, sent with the open. See `store/memory.ts`. */
  memory: string,
  /**
   * The rules every persona is given, as this machine has them configured.
   *
   * Threaded through rather than imported: they are a PREFERENCE, and the
   * renderer has no access to preferences. Passing them is what makes the
   * setting real -- it was stored, displayed and editable while this call still
   * used the built-in constant.
   */
  spokenRules: string,
  /** What this computer does with the microphone. See `shared/sound.ts`. */
  sound: Sound,
  /** The app drives every utterance. See `VoiceCommand.driven`. */
  driven: boolean,
  attempt: AttemptId,
  callbacks: VoiceCallbacks,
  signal: AbortSignal,
): Promise<VoiceSession> {
  // Narrated, because the failures here are silent ones: a session can open,
  // connect, configure and then simply never produce audio, and without a
  // transcript there is nothing to look at. The spike's single most useful
  // feature was its log.
  const t0 = performance.now()
  const at = (): string => `+${Math.round(performance.now() - t0)}ms`
  const log = (line: string): void => console.log(`[voice ${at()}] ${line}`)

  log(`opening (attempt ${attempt})`)
  // The ONE construction outside the guarded block below, because everything
  // that guard does needs it to exist. If this throws there is nothing yet to
  // release, which is the property that makes it safe to be out here --
  // `createDataChannel` and the listener wiring that used to sit beside it did
  // NOT have that property: a synchronous throw from any of them left an open
  // peer connection and skipped the failure report entirely, so the lifecycle
  // waited on a session that had already died.
  const peer = new RTCPeerConnection()

  /**
   * Everything this session owns, so one function can release all of it.
   *
   * `media`, not just the track: an earlier version stopped only the audio
   * track it had picked out, and `fail()` did not stop even that — it closed
   * the peer and left the microphone capturing after a mint failure, an SDP
   * failure, or any thrown error during negotiation.
   */
  let media: MediaStream | null = null
  let micTrack: MediaStreamTrack | null = null
  /**
   * The utterance currently sounding, if any.
   *
   * One at a time is the truth of this session: the server produces one
   * response at a time on the default conversation, and a second `speak`
   * before the first ends replaces it. Holding one id rather than a set is
   * therefore honest rather than a simplification -- and it is what lets a
   * `silence` naming a finished utterance be ignored instead of cancelling
   * whatever happens to be speaking now.
   */
  /**
   * Whether any of her audio is playing, driven or not.
   *
   * `sounding` below tracks only utterances the app ASKED for. A delegation
   * answer lands in the middle of ordinary conversation, so deciding whether it
   * is safe to request a turn needs the broader fact.
   */
  let audible = false
  /** A queued answer waiting for her to stop talking. See `answerWorkspace`. */
  let owedTurn = false
  /**
   * Whether the service has a response in flight, which is not the same as
   * whether audio is playing.
   *
   * A turn is rejected with `conversation_already_has_active_response` from
   * `response.created` onward, and audio does not start until some way after
   * that -- so gating on playback alone left a window where the request went
   * out and was refused, with nothing queued to retry it.
   */
  let responding = false

  let sounding: UtteranceId | null = null
  /**
   * The SERVER's id for the response now sounding.
   *
   * Required to cancel it. `response.cancel` without a `response_id` cancels
   * "an in-progress response in the default conversation" -- and every drill
   * utterance is sent with `conversation: 'none'`, so it is not in that
   * conversation and a bare cancel silently matches nothing. The caller then
   * waits forever for an outcome that was never going to come.
   */
  /**
   * Request a turn for whatever has just been queued. Safe when there is none.
   *
   * Two callers, one debt: the delegation ACKNOWLEDGEMENT and the delegation
   * ANSWER both need her to speak at a moment the service will accept, and
   * neither has a user utterance to ride on. `owedTurn` is a boolean rather
   * than a count because a single turn services everything queued before it --
   * she reads the conversation, not one item.
   */
  /**
   * Put a frame on the wire, and say whether it left.
   *
   * `RTCDataChannel.send()` throws -- a closing transport, a message past the
   * SCTP limit -- and every caller here mutates state BEFORE sending, because a
   * response exists from the moment it is requested rather than from the moment
   * the server agrees. So a throw left `responding` or `sounding` set with
   * nothing on the way to clear them, which is the permanent-silence failure
   * this file has now fixed from three directions.
   *
   * Returning a boolean rather than throwing: every caller has a different
   * thing to undo, and none of them wants an exception crossing a DOM event
   * handler where nothing is watching for it.
   */
  const put = (frame: unknown): boolean => {
    if (channel === null || channel.readyState !== 'open') return false
    try {
      channel.send(JSON.stringify(frame))
      return true
    } catch (error: unknown) {
      log(`could not send ${String((frame as { type?: unknown }).type)}: ${String(error)}`)
      return false
    }
  }

  /** Put one item into the conversation. False when there is nowhere to put it. */
  const queueItem = (item: unknown): boolean =>
    !closed && put({ type: 'conversation.item.create', item })

  /**
   * Queue a system instruction for her to read on her next turn.
   *
   * The three callers -- arm, acknowledge, answer -- repeated the same channel
   * guard and the same `conversation.item.create` envelope, and the first two
   * differed only in a string and in whether they then asked for a turn. Three
   * copies of one envelope is three places for the shape verified against a
   * live session to drift from what was measured.
   */
  const tellHer = (text: string): boolean =>
    queueItem({ type: 'message', role: 'system', content: [{ type: 'input_text', text }] })

  const askForTurn = (): void => {
    if (closed || channel === null || channel.readyState !== 'open') {
      owedTurn = false
      return
    }
    // Still busy: stay owed rather than spend the request on a refusal. The
    // debt is serviced again by whichever of the two terminal events lands.
    if (audible || responding) {
      owedTurn = true
      return
    }
    owedTurn = false
    // Marked busy SYNCHRONOUSLY, not when the server acknowledges.
    //
    // `response.created` comes back a round trip later, and an answer arriving
    // in that window saw `responding === false` and sent a second request --
    // which the service can reject, leaving the queued answer with nothing to
    // deliver it. The local send is the moment a response exists.
    responding = true
    // Named, so a refusal can be traced back to it. See `inFlightResponses`.
    const id = `resp-${String((nextRequestId += 1))}`
    inFlightResponses.set(id, null)
    if (!put({ type: 'response.create', event_id: id })) {
      // Nothing left, so nothing is coming back to clear this. The debt stays
      // owed and is retried by whichever terminal event lands next.
      inFlightResponses.delete(id)
      responding = false
      owedTurn = true
      return
    }
    log('asked her for a turn to say what is queued')
  }

  let soundingResponse: string | null = null
  /** A cancel asked for before `response.created` told us what to name. */
  let cancelWhenCreated = false
  /**
   * A cancel has been sent for the sounding utterance.
   *
   * Kept so a drained buffer cannot be reported as `played`. Clearing the
   * output buffer may or may not also emit `output_audio_buffer.stopped`; if it
   * does, the ONE outcome this must never produce is "she said it".
   */
  let cancelling = false
  /** Whether the utterance now sounding has actually produced audio. */
  let soundingHadAudio = false
  /**
   * How the sounding utterance ended, when its audio has not drained yet.
   *
   * `onUtteranceEnded` promises PLAYBACK, not protocol: `response.done` arrives
   * seconds before the buffer empties, so reporting a cancelled or failed
   * response the moment the protocol says so hands the caller an ended
   * utterance while she is still audible. A drill advances and speaks over her.
   *
   * So the outcome is remembered and spent by whichever terminal audio event
   * lands, which is the same rule the successful path already follows.
   */
  let pendingOutcome: UtteranceOutcome | null = null
  /**
   * The `event_id` of every `response.create` we have sent and not yet seen
   * resolved.
   *
   * The service rejects a response request with an `error` frame that carries
   * no response and no `response.done` -- so `responding`, set eagerly at send
   * time, was never cleared and every later turn was refused by a session that
   * looked permanently busy. Correlating the error back to the request is the
   * only way to tell "this request died" from "some unrelated error".
   */
  const inFlightResponses = new Map<string, UtteranceId | null>()
  let nextRequestId = 0
  /** The analyser's clone. Not in `media`, so `shutdown` must stop it by name. */
  let analysisTrack: MediaStreamTrack | null = null
  let closed = false
  /** Whether the server ever acknowledged us. Decides failed-vs-lost. */
  let established = false
  let graceTimer: ReturnType<typeof setTimeout> | null = null

  function clearGrace(): void {
    if (graceTimer !== null) {
      clearTimeout(graceTimer)
      graceTimer = null
    }
  }

  /** Idempotent, and the only path that releases anything. */
  function shutdown(): void {
    // Media is released on EVERY call, ABOVE the `closed` guard, and that order
    // is the whole point.
    //
    // `getUserMedia` cannot be cancelled: aborting an attempt does not stop the
    // permission prompt or the capture that follows it, so `media` is routinely
    // assigned AFTER the first shutdown has already run. With the release below
    // the guard, that second call returned immediately and left a live
    // microphone with no reference anywhere to stop it -- an open capture, for
    // the rest of the process, that every surface in the app reported as
    // closed. Stopping an already-stopped track is a no-op, so doing it
    // unconditionally costs nothing and removes the ordering requirement.
    for (const track of media?.getTracks() ?? []) track.stop()
    // The analyser's clone is a SEPARATE capture and is not in `media`.
    analysisTrack?.stop()
    analysisTrack = null
    media = null
    micTrack = null
    if (closed) return
    closed = true
    clearGrace()
    // A channel closing during teardown must not raise its own error report.
    // Optional because teardown can now run BEFORE the channel exists: the
    // setup that creates it is inside the guarded region, and a failure there
    // must still release the peer.
    try {
      channel?.close()
    } catch {
      /* already gone with the peer */
    }
    peer.close()
  }

  /** Report once, through whichever door matches how far we got. */
  function stop(reason: string): void {
    if (closed) return
    const lost = established
    shutdown()
    if (lost) callbacks.onLost(reason)
    else callbacks.onFailed(reason)
  }

  signal.addEventListener('abort', shutdown, { once: true })

  // One listener, not two. Diagnostics and failure policy read the same state,
  // and splitting them across two subscriptions meant the log and the decision
  // could describe different transitions.
  peer.addEventListener('connectionstatechange', () => {
    log(`peer ${peer.connectionState}`)
    if (peer.connectionState === 'connected') clearGrace()
    if (peer.connectionState === 'failed') stop('the peer connection failed')
    if (peer.connectionState === 'disconnected' && graceTimer === null) {
      graceTimer = setTimeout(() => stop('the peer connection did not recover'), RECONNECT_GRACE_MS)
    }
  })
  peer.addEventListener('iceconnectionstatechange', () => log(`ice ${peer.iceConnectionState}`))

  // Her voice. Handed straight out for the analyser to tap; nothing here
  // decides what it means.
  peer.addEventListener('track', (event) => {
    // `streams` can be empty for a track negotiated without one, and ignoring
    // that case discards a perfectly good audio track and presents as silence.
    const stream = event.streams[0] ?? new MediaStream([event.track])
    log(`remote track: ${stream.getAudioTracks().length} audio track(s)`)
    callbacks.onRemoteStream(stream)
  })

  // BEFORE the offer, or it is not in it.
  //
  // Declared here and assigned inside the guarded block below. `createDataChannel`
  // can throw synchronously -- on a peer already closed by a same-tick abort,
  // for one -- and it used to sit outside every catch: the throw escaped
  // `openVoiceSession` with the peer connection still open, no `onFailed`
  // report, and a lifecycle waiting on a session that had already died.
  let channel: RTCDataChannel | null = null
  try {
    // Assigned to the outer binding immediately, so `shutdown()` can close it
    // however the rest of this block ends; `wire` is the non-null local the
    // listeners below capture.
    const wire = peer.createDataChannel('oai-events')
    channel = wire
    /** Correlates our `session.update` with the acknowledgement for it. */
    const configureId = `configure-${attempt}`

    wire.addEventListener('open', () => {
      // A shut-down session must not configure itself. Events already queued on
      // the task queue when `close()` or an abort ran still fire, so `open` could
      // land after teardown and push a `session.update` down a channel this
      // attempt no longer owns -- and `message` could invoke callbacks belonging
      // to an attempt that had been superseded.
      if (closed) return
      // Configure, THEN let anyone speak. A session that was never told to
      // produce audio answers in text, and the analyser reads a noise floor
      // while the transport gets blamed.
      wire.send(
        JSON.stringify({
          type: 'session.update',
          event_id: configureId,
          session: {
            type: 'realtime',
            instructions: instructionsFor(persona, memory, spokenRules),
            output_modalities: ['audio'],
            audio: {
              input: {
                // Both of these are the difference between her turn detection and
                // somebody else's defaults. `far_field` is what OpenAI documents
                // for a microphone and speaker sharing an enclosure — a laptop —
                // and without it her own voice through the speaker reads as the
                // user taking a turn. `semantic_vad` lets the model decide what a
                // turn is instead of an energy threshold deciding for it.
                noise_reduction: { type: 'far_field' },
                turn_detection: {
                  type: 'semantic_vad',
                  eagerness: sound.eagerness,
                  // Turns are still DETECTED and transcribed; only the reply
                  // is withheld. That split is what lets the app hear "next"
                  // while remaining the only thing that makes her speak.
                  ...(driven ? { create_response: false } : {}),
                },
                transcription: { model: 'whisper-1' },
              },
              output: { voice: persona.voice },
            },
            /**
             * The one tool she has.
             *
             * Declared ALWAYS, whatever the trigger setting says, because
             * whether a call is allowed to run is main's decision and not the
             * model's: withdrawing the tool would make "you have not pressed
             * the key" indistinguishable from "she cannot do that at all", and
             * she would say the second when the first is true.
             *
             * The shape is the one verified against a live session, not one
             * read off the documentation.
             */
            tools: [
              {
                type: 'function',
                name: 'ask_workspace',
                description:
                  'Look something up: read the files in the workspace, and search the web when the question needs current information. Returns immediately and the answer arrives later, usually within a minute — say you are going to look, then carry on talking. The answer names where it came from; pass that on rather than presenting it as your own knowledge.',
                parameters: {
                  type: 'object',
                  properties: {
                    question: {
                      type: 'string',
                      description: 'What to find out.',
                    },
                  },
                  required: ['question'],
                },
              },
            ],
            tool_choice: 'auto',
          },
        }),
      )
      log('data channel open — session.update sent')
    })

    // A channel can die while the peer stays up, and every later `speak()` then
    // goes nowhere. Silently: the lifecycle would sit awake with a companion that
    // had stopped answering.
    wire.addEventListener('close', () => {
      if (!closed) stop('the data channel closed')
    })
    wire.addEventListener('error', () => {
      if (!closed) stop('the data channel errored')
    })

    wire.addEventListener('message', (event) => {
      // Same reason as `open` above: a queued message must not reach callbacks
      // that belong to a session already torn down.
      if (closed) return
      let parsed: unknown
      try {
        parsed = JSON.parse(String(event.data))
      } catch {
        // Only the parse. Wrapping the dispatch too meant an exception thrown by
        // a callback was reported as malformed JSON from the server.
        return
      }
      // Shape-checked, not just parsed. `JSON.parse` succeeds on the primitives
      // -- `null`, `7`, `"hi"` are all valid JSON documents -- and `null.type`
      // then throws a TypeError from OUTSIDE the catch above, which narrowly
      // wraps the parse. One malformed frame would take down the message handler
      // for the rest of the session.
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        log(`ignored a server frame that was not an object: ${typeof parsed}`)
        return
      }
      const record = parsed as { type?: unknown; event_id?: unknown }
      const type = String(record.type)

      if (type === 'input_audio_buffer.speech_started') callbacks.onUserSpoke()
      // Her audio has drained. This is the moment she stopped being heard,
      // which is what an utterance ending means to anything downstream.
      if (type === 'response.created') {
        responding = true
        // The request was ACCEPTED, so it can no longer be refused. Cleared
        // here rather than on `response.done`, because the window this map
        // guards is exactly send-to-created: after `created` the ordinary
        // response lifecycle takes over.
        inFlightResponses.clear()
      }
      if (type === 'response.done') {
        responding = false
        // Serviced HERE too, not only on the audio events. The buffer can stop
        // while a response is still open -- and then `askForTurn` re-queued the
        // debt and nothing ever came back for it, which is the same permanent
        // silence this deferral was added to prevent, one event later.
        if (owedTurn) askForTurn()
      }
      if (type === 'output_audio_buffer.started') {
        audible = true
        // Recorded PER UTTERANCE, because `audible` is cleared by the terminal
        // events and cannot answer "did this turn ever sound?" once they land.
        // That question is what separates a turn that finished from one that
        // produced only a function call -- see the `response.done` branch.
        if (sounding !== null) soundingHadAudio = true
      }
      // BOTH terminal audio events, not just `stopped`.
      //
      // This file already records that `cleared` may arrive without a following
      // `stopped` -- an interruption takes that path. Handling only `stopped`
      // meant an interrupted turn left `audible` true forever, and an answer
      // owed at that moment was never delivered at all: the 47-second silence
      // the deferred turn was added to fix, made permanent.
      if (type === 'output_audio_buffer.stopped' || type === 'output_audio_buffer.cleared') {
        audible = false
        if (owedTurn) askForTurn()
      }
      if (type === 'output_audio_buffer.stopped' && sounding !== null) {
        const ended = sounding
        // A held outcome WINS. The buffer draining normally says `played`, and
        // for a response the server already reported cancelled or failed that
        // would be a lie told by the more recent event.
        const outcome = pendingOutcome ?? (cancelling ? 'cancelled' : 'played')
        endSounding()
        callbacks.onUtteranceEnded(ended, outcome)
      }
      // The buffer we asked to clear has been cleared. TERMINAL, and the case
      // that matters most rather than an exotic one.
      //
      // `response.done` arrives SECONDS before her audio drains -- measured at
      // 7.9s on an eight-second item -- so an interruption during those seconds
      // reaches a response the server considers already `completed`. Cancelling
      // one is refused (cancellation applies to in-progress responses), and the
      // `response.done` that would have said `cancelled` went by long ago
      // saying `completed`. Clearing the output buffer is then the ONLY
      // acknowledgement left, and without this branch the utterance never ends:
      // the caller waits forever and the drill stops offering anything.
      if (type === 'output_audio_buffer.cleared' && sounding !== null) {
        const ended = sounding
        const outcome = pendingOutcome ?? 'cancelled'
        endSounding()
        // `cancelled` unless the response already reported otherwise: nothing
        // clears this buffer except `sendCancel`, but a response can have
        // failed first and be cleared afterwards.
        callbacks.onUtteranceEnded(ended, outcome)
      }
      // The server names the response we just asked for. Kept because it is the
      // only handle that can cancel it -- see `soundingResponse`.
      if (type === 'response.created' && sounding !== null && soundingResponse === null) {
        const id = (record as { response?: { id?: unknown } }).response?.id
        soundingResponse = typeof id === 'string' ? id : null
        // A cancel that arrived before we knew the name. Sent now rather than
        // dropped, because dropping it leaves the caller waiting on an
        // utterance it has already given up on.
        if (cancelWhenCreated && soundingResponse !== null) {
          cancelWhenCreated = false
          sendCancel()
        }
      }
      // A response that ended without producing audio -- cancelled by us, or
      // refused. Distinguished so a caller can tell an interruption from a
      // fault, because those want opposite handling.
      if (type === 'response.done' && sounding !== null) {
        const status = (record as { response?: { status?: unknown } }).response?.status
        if (status === 'cancelled' || status === 'failed' || status === 'incomplete') {
          const outcome = status === 'cancelled' || cancelling ? 'cancelled' : 'failed'
          if (audible) {
            // STILL SOUNDING. `onUtteranceEnded` promises playback, not
            // protocol -- ending here would advance a drill while she is
            // audibly mid-word, and the caller would speak over her. Held for
            // whichever terminal audio event lands.
            pendingOutcome = outcome
          } else {
            const ended = sounding
            endSounding()
            callbacks.onUtteranceEnded(ended, outcome)
          }
        } else if (!soundingHadAudio) {
          // COMPLETED, and it produced no audio at all.
          //
          // Not a hypothetical: a live turn was recorded whose only
          // output was a function call -- `response.output_item.added`,
          // `response.function_call_arguments.done`, `response.done`, and no
          // `output_audio_buffer.started` anywhere between them. Tools stay
          // declared for every response, so a `speak()` turn can take that
          // shape too.
          //
          // The terminal audio events are what normally clear `sounding`, and
          // neither of them is coming for a turn that never sounded. Without
          // this branch the slot is occupied forever and every later utterance
          // is refused -- the same permanent silence, reached down a different
          // path than the `speak` gate above.
          const ended = sounding
          endSounding()
          log(`#${String(ended)} completed without audio — ending it as failed`)
          callbacks.onUtteranceEnded(ended, 'failed')
        }
      }
      /**
       * A tool call, wherever the turn's outcome left it.
       *
       * Read from `response.done`'s output list rather than from a dedicated
       * event, which is the shape the live-session spike verified. Handled
       * SEPARATELY from the `sounding` branch above and never touching it: that
       * slot has exactly one occupant, and a bug this repository has already
       * paid for was two things writing to it (see the loudspeaker finding). A
       * tool call is not an utterance and must not be recorded as one.
       */
      if (type === 'response.done') {
        const output = (record as { response?: { output?: unknown } }).response?.output
        if (Array.isArray(output)) {
          for (const item of output) {
            if (typeof item !== 'object' || item === null) continue
            const call = item as { type?: unknown; name?: unknown; call_id?: unknown }
            if (call.type !== 'function_call' || call.name !== 'ask_workspace') continue
            if (typeof call.call_id !== 'string') continue
            const args = (item as { arguments?: unknown }).arguments
            log(`TOOL CALL: ask_workspace call_id=${call.call_id}`)
            callbacks.onWorkspaceAsked(call.call_id, readQuestion(args))
          }
        }
      }
      if (type === 'session.updated') {
        // Ready means the server ACCEPTED the configuration, not that we sent it.
        // Announcing on send let a rejected configuration reach `awake` and start
        // speaking against the service's defaults.
        if (!established) {
          established = true
          log('session.updated — configuration accepted')
          callbacks.onReady()
        }
      }
      if (type === 'error') {
        const detail = JSON.stringify((parsed as { error?: unknown }).error)
        log(`SERVER ERROR ${detail}`)
        // Only our configuration failing is fatal; a per-response error is not.
        //
        // BOTH locations are checked, deliberately. An error frame carries its
        // own `event_id`, while the id of the client event that CAUSED it is
        // documented as nested at `error.event_id` -- and `realtime-wire.json`,
        // this project's record of field names verified against a live session,
        // covers neither. Matching only the top level risks never firing, which
        // fails silently: a rejected `session.update` would leave her running on
        // the service's defaults until the 15s wake timeout, with nothing said.
        // Matching both cannot be wrong in either direction, because `configureId`
        // is a value we generated and no server frame can collide with it.
        //
        // To settle it: send a deliberately invalid `session.update` on a live
        // session and record which field carries the id back.
        const caused = (parsed as { error?: { event_id?: unknown } }).error?.event_id
        if (record.event_id === configureId || caused === configureId) {
          stop(`the session was rejected: ${detail}`)
        } else {
          // A REJECTED RESPONSE REQUEST, resolved rather than only logged.
          //
          // `responding` is set at send time on purpose -- a response exists
          // from the moment it is sent, not from the moment the server agrees.
          // The cost is that a refusal has to clear it, and a refusal arrives
          // as this frame: no `response.created`, no `response.done`, no audio.
          // Nothing else was ever going to. The session then looked busy
          // forever and refused every later turn, which is the permanent
          // silence this file has now fixed three ways.
          const failed = [record.event_id, caused].find(
            (id) => typeof id === 'string' && inFlightResponses.has(id),
          ) as string | undefined
          if (failed !== undefined) {
            const utterance = inFlightResponses.get(failed) ?? null
            inFlightResponses.delete(failed)
            responding = false
            log(`response request ${failed} was refused — clearing it`)
            // An utterance is only ended if THIS request was carrying one.
            // `askForTurn`'s requests carry none, and ending the unrelated
            // utterance that happens to be sounding would be the "two things
            // writing to one slot" bug this file already has scars from.
            if (utterance !== null && sounding === utterance) {
              endSounding()
              callbacks.onUtteranceEnded(utterance, 'failed')
            }
            // The debt survives the refusal. Something is still queued and
            // still undelivered, so it has to be asked for again.
            if (owedTurn) askForTurn()
          }
        }
      } else if (type === 'response.output_audio_transcript.done') {
        const said = (parsed as { transcript?: unknown }).transcript ?? ''
        log(`SHE SAID: ${JSON.stringify(said)}`)
        if (typeof said === 'string') callbacks.onSaid('her', said)
      } else if (type === 'conversation.item.input_audio_transcription.completed') {
        const said = (parsed as { transcript?: unknown }).transcript ?? ''
        log(`YOU SAID: ${JSON.stringify(said)}`)
        if (typeof said === 'string') callbacks.onSaid('you', said)
      } else if (!type.endsWith('.delta')) {
        // Deltas are a flood; everything else is worth seeing exactly once.
        log(`<- ${type}`)
      }
    })

    // Together, not in sequence. Settled rather than raced: `Promise.all`
    // rejects on the first failure, so a mint that failed while the microphone
    // was still being granted left a live capture nobody held a reference to.
    const minting = window.mochi.mintKey(attempt)
    const capturing = navigator.mediaDevices.getUserMedia({
      // AEC3 is the whole reason this app is Electron. Asked for
      // explicitly rather than left to a default that varies by device -- and
      // asked for as a CONSTRAINT rather than assumed granted: `getSettings()`
      // below reports what the device actually did, and the two differ.
      audio: {
        echoCancellation: sound.echoCancellation,
        noiseSuppression: true,
        autoGainControl: true,
      },
    })
    // A LATE STREAM IS STOPPED WHEREVER THIS ENDS.
    //
    // `getUserMedia` cannot be cancelled: the permission prompt stays up and
    // the capture still happens, however long that takes. So waiting for both
    // meant a known-failed mint -- or an abort -- could not settle this
    // function while somebody stared at a permission dialog, holding the peer
    // connection and every listener open for as long as they took to answer.
    //
    // The continuation is attached HERE, once, rather than left to the
    // `allSettled` below: after an early return nothing else is watching this
    // promise, and the stream it eventually yields would be a live microphone
    // with no reference to it -- the exact defect `session.test.ts` opens with.
    void capturing.then(
      (stream) => {
        if (media === stream) return
        if (closed || signal.aborted) for (const track of stream.getTracks()) track.stop()
      },
      () => undefined,
    )

    const [keyResult, micResult] = await Promise.allSettled([minting, capturing])

    if (micResult.status === 'fulfilled') media = micResult.value
    // Adopted before any early return below, so every exit path releases it.
    if (closed || signal.aborted) {
      shutdown()
      throw new Error('the attempt was abandoned while opening')
    }

    if (keyResult.status === 'rejected') return failAndThrow(stop, 'the mint call failed')
    const key = keyResult.value
    log(key.ok ? 'key minted' : `MINT FAILED: ${key.reason}`)
    if (!key.ok) return failAndThrow(stop, key.reason)
    if (micResult.status === 'rejected')
      return failAndThrow(stop, `the microphone was refused: ${String(micResult.reason)}`)

    micTrack = media?.getAudioTracks()[0] ?? null
    if (micTrack === null || media === null)
      return failAndThrow(stop, 'the microphone produced no audio track')
    const granted = micTrack.getSettings()
    log(
      `mic "${micTrack.label}" aec=${granted.echoCancellation} ns=${granted.noiseSuppression} rate=${granted.sampleRate}`,
    )
    // MUTED until the lifecycle says otherwise. The track has to be added now —
    // it must appear in the offer — but it started enabled, so she transmitted
    // during `waking`, before the `mic` command and while every surface still
    // reported the microphone closed. The tray was telling the truth about what
    // it had been told and a lie about the hardware.
    micTrack.enabled = false
    peer.addTrack(micTrack, media)
    // Handed over BEFORE the negotiation, so the measurement covers her
    // greeting -- the first utterance is the one judged with no evidence.
    //
    // ENABLED explicitly, and that line is the whole point of the clone.
    // `clone()` copies the track's state as it is at that moment, and the
    // moment here is one line after the original was muted for the offer --
    // so the clone is born silent and stays that way. The analyser then reads
    // zero forever, the microphone envelope never moves, `correlation` can
    // never return a verdict, and the auto setting falls back to "assume echo"
    // permanently. Everything looks fine: she talks, the gate closes, nothing
    // in any log says a measurement never happened.
    // Held on the session, because `shutdown()` stops `media`'s tracks and this
    // clone is not one of them. It was a live capture with no reference anywhere
    // to stop it -- the same leak the comment above `shutdown` describes, in the
    // one track that comment does not cover.
    analysisTrack = micTrack.clone()
    analysisTrack.enabled = true
    callbacks.onLocalStream(new MediaStream([analysisTrack]))

    await peer.setLocalDescription(await peer.createOffer())
    const offer = peer.localDescription?.sdp
    if (offer === undefined) return failAndThrow(stop, 'no local description')

    log('offer ready')
    const answer = await window.mochi.exchangeSdp(attempt, offer)
    log(answer.ok ? 'sdp answered' : `SDP FAILED: ${answer.reason}`)
    if (!answer.ok) return failAndThrow(stop, answer.reason)
    if (closed || signal.aborted) {
      shutdown()
      throw new Error('the attempt was abandoned while opening')
    }
    await peer.setRemoteDescription({ type: 'answer', sdp: answer.answer })
    log('remote description set — ICE begins')
  } catch (error: unknown) {
    // `stop` is idempotent and knows which door to use.
    stop(String(error))
    throw error
  }

  /** Everything that names the utterance now sounding, released together. */
  function endSounding(): void {
    sounding = null
    soundingResponse = null
    cancelWhenCreated = false
    cancelling = false
    soundingHadAudio = false
    pendingOutcome = null
  }

  /**
   * Stop the response now sounding, by NAME, and cut the audio already sent.
   *
   * Two events, because they do different jobs: `response.cancel` stops the
   * model generating, while audio already handed to the peer keeps playing
   * until the output buffer is cleared. Cancelling alone leaves her talking for
   * as long as the buffer holds -- and this session has measured that at nearly
   * eight seconds on a long utterance.
   */
  function sendCancel(): void {
    if (channel === null || channel.readyState !== 'open') return
    cancelling = true
    log(`-> response.cancel ${soundingResponse ?? '(unnamed)'}`)
    channel.send(
      JSON.stringify({
        type: 'response.cancel',
        ...(soundingResponse !== null ? { response_id: soundingResponse } : {}),
      }),
    )
    channel.send(JSON.stringify({ type: 'output_audio_buffer.clear' }))
  }

  return {
    speak(utterance, instructions, isolation) {
      if (closed || channel === null || channel.readyState !== 'open') {
        log(`speak ignored — closed=${closed} channel=${channel?.readyState ?? 'none'}`)
        // Reported, not dropped. A caller holding an id for a request that
        // never left has no other way to learn it, and a drill would sit
        // waiting to commit an item that is never coming.
        callbacks.onUtteranceEnded(utterance, 'failed')
        return
      }
      // One at a time, asserted rather than assumed.
      //
      // `sounding` is a single slot and NO server frame carries our id, so a
      // second request while one is in flight rebinds the slot and hands the
      // FIRST one's `output_audio_buffer.stopped` to the SECOND. A drill then
      // commits an item that was never spoken while the one she did say stays
      // unseen -- both wrong, in opposite directions, and silent. The service
      // refuses a concurrent response anyway, and its `error` frame carries no
      // utterance, so the caller would also wait forever for an outcome that
      // cannot come. Callers serialise; this is here so that they must.
      //
      // Gated on the WHOLE response state, not just `sounding`. Those are not
      // the same set: `askForTurn` -- which delivers the workspace
      // acknowledgement and the workspace answer -- sets `responding` without
      // ever occupying `sounding`, and an automatic turn does the same. A
      // `speak` landing in that window used to pass this check, send a second
      // `response.create`, and be refused with
      // `conversation_already_has_active_response`. Nothing then resolves the
      // utterance, because the refusal arrives as an `error` frame carrying no
      // response and no id -- so `sounding` stays set forever and every later
      // utterance is refused by this very branch. Permanent silence, from the
      // check meant to prevent it.
      if (sounding !== null || responding || audible) {
        const why =
          sounding !== null ? `#${String(sounding)} is still sounding` : 'a response is active'
        log(`speak refused #${String(utterance)} — ${why}`)
        callbacks.onUtteranceEnded(utterance, 'failed')
        return
      }
      sounding = utterance
      // Same reason as `askForTurn`: a response exists from the moment it is
      // sent, not from the moment the server says so.
      responding = true
      // WHAT was asked for, not just that something was. A log that records
      // only `#2` cannot tell "the instruction was sent and she ignored it"
      // from "the instruction never left" -- and those have opposite fixes.
      // Cost one debugging session on a goodbye that came out as a lesson.
      //
      // Truncated, because a `verbatim` line is user text of up to 300
      // characters and this is a per-utterance line in a dev console.
      log(
        `-> response.create #${String(utterance)} reads=${String(isolation.reads)} instructions=${JSON.stringify(instructions.slice(0, 160))}`,
      )
      // Named, so a refusal can be traced back to THIS utterance and end it.
      // Without it the rejection arrived as an untraceable `error` frame, no
      // `response.done` followed, and the slot stayed occupied for good.
      const requestId = `resp-${String((nextRequestId += 1))}`
      inFlightResponses.set(requestId, utterance)
      const left = put({
        type: 'response.create',
        event_id: requestId,
        response: {
          instructions,
          // Each field from its OWN dimension. `conversation` was derived
          // from `reads && writes`, which made `{reads:false, writes:true}`
          // encode `conversation:'none'` -- the one combination that says
          // "answer without context, but keep the answer" silently became
          // "and throw the answer away". Two dimensions the comment called
          // independent, joined by an `&&`.
          //
          // `conversation` is the write choice; `input` is the read choice.
          ...(isolation.writes ? {} : { conversation: 'none' }),
          ...(isolation.reads ? {} : { input: [] }),
          // Always audio. See `Isolation` for the text-only flag that was
          // removed rather than left as a request that never completes.
          output_modalities: ['audio'],
        },
      })
      if (!left) {
        // The frame never reached the wire, so nothing is coming back to
        // resolve it. Everything claimed above is released, and the caller is
        // told -- a caller holding an id for a request that never left has no
        // other way to learn it, and would wait forever.
        inFlightResponses.delete(requestId)
        responding = false
        endSounding()
        callbacks.onUtteranceEnded(utterance, 'failed')
      }
    },
    armWorkspace() {
      // NO turn requested -- unlike the two below, which have something to
      // deliver. She reads this on her next turn, which is exactly when the
      // user finishes speaking the request, so asking for one would interrupt
      // them mid-sentence.
      if (tellHer(SYSTEM_ARM)) log('workspace armed for the next turn')
      else log('workspace arm dropped, session gone')
    },
    acknowledgeWorkspace() {
      if (!tellHer(SYSTEM_ACKNOWLEDGE)) {
        log('workspace acknowledgement dropped, session gone')
        return
      }
      log('workspace acknowledgement queued')
      askForTurn()
    },
    answerWorkspace(callId, payload) {
      // The item alone. NO `response.create` here -- see the contract above;
      // asking for a turn inline is what fails intermittently. `askForTurn`
      // below decides when one can be accepted.
      const queued = queueItem({
        type: 'function_call_output',
        call_id: callId,
        output: JSON.stringify(payload),
      })
      if (!queued) {
        // Nothing to deliver into. Logged rather than thrown: the session going
        // away while Codex was working is ordinary, and the answer is simply
        // lost with the conversation it belonged to.
        log(`workspace answer dropped, session gone: ${callId}`)
        return
      }
      // Queued, and then ASKED FOR. `askForTurn` decides whether now is a
      // moment the service will accept, and stays owed when it is not.
      log(`workspace answer queued for ${callId}`)
      askForTurn()
    },
    silence(utterance) {
      // Checked FIRST, so a stale id is a no-op whatever the channel is doing.
      if (sounding !== utterance) return
      if (closed || channel === null || channel.readyState !== 'open') {
        // Same rule as `speak`: a caller waiting on an outcome has to get one.
        // Returning in silence here leaves it holding a pending utterance for
        // a session that is already gone, and it never asks for anything again.
        endSounding()
        callbacks.onUtteranceEnded(utterance, 'cancelled')
        return
      }
      if (soundingResponse === null) {
        // `response.created` has not arrived, so there is nothing to name yet.
        // Remembered rather than sent unnamed: an unnamed cancel goes to the
        // DEFAULT conversation, and an out-of-band response is not in it.
        cancelWhenCreated = true
        log(`cancel deferred #${String(utterance)} — no response id yet`)
        return
      }
      sendCancel()
    },
    setMicEnabled(enabled: boolean): void {
      // `enabled`, not a removed track. Disabling makes the track produce
      // silence while keeping the connection's shape, so re-enabling needs no
      // renegotiation — and a renegotiation mid-conversation is a gap in the
      // audio somebody would hear.
      if (micTrack !== null) micTrack.enabled = enabled
      log(`mic ${enabled ? 'open' : 'closed'}`)
    },
    close: shutdown,
  }
}

function failAndThrow(stop: (reason: string) => void, reason: string): never {
  stop(reason)
  throw new Error(reason)
}
