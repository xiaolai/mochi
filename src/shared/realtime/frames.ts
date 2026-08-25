/**
 * Server frames, read into the few shapes this application acts on.
 *
 * ## Written from observed traffic, not from documentation
 *
 * Every field below was captured off a live session on this machine and is
 * committed as `__fixtures__/observed-frames.json`, which the tests parse
 * directly. That is not ceremony: this project has shipped **two** mechanisms
 * that were green and dead on arrival because they were reasoned from a
 * published page — `web_search="off"`, which the CLI does not accept, and an
 * `event_id` echoed on truncate errors, which the service sends as `null`.
 *
 * So the rule is literal. If a field is not in that fixture, nothing here reads
 * it. Adding one means capturing it first.
 *
 * ## A recognised type missing its fields is LOUD
 *
 * The tempting shape is to fall back to `other` when a known frame does not
 * look right. That converts "the service changed" into "nothing happened", and
 * the symptom is a tool call that is simply never dispatched — indistinguishable
 * from her deciding not to call one. `malformed` exists so the caller can say so
 * at the moment it happens.
 */

export type ServerFrame =
  /** The session opened. `expires_at` is absolute Unix seconds (findings §21). */
  | { readonly kind: 'session-created'; readonly expiresAt: number }
  /** She called a capability. Everything needed to dispatch and answer it. */
  | {
      readonly kind: 'tool-call'
      readonly callId: string
      readonly name: string
      /** A JSON **string**, as sent. Parsing belongs to the manifest's reader. */
      readonly args: string
    }
  /** WebRTC/SIP only. `responseId` is what makes two utterances distinguishable. */
  | {
      readonly kind: 'audio-buffer'
      readonly phase: 'started' | 'stopped' | 'cleared'
      readonly responseId: string
    }
  /**
   * The server cut her off, and says how much audio had played.
   *
   * §27: on WebRTC this arrives **unsolicited** after an `output_audio_buffer.clear`
   * — nothing here asks for it. It carries `item_id`, `content_index` and
   * `audio_end_ms`, and **no `response_id`**, which makes `item_id` the only key
   * that joins it to the transcript.
   *
   * `audioEndMs` is the service's account of where the audio was cut.
   *
   * **Nothing in this app reads it**, and this comment used to say it "is the
   * one signal about what she was actually HEARD saying" — which described an
   * earlier design. The estimate actually used is the renderer's own cursor
   * (`utterance.at()`), which is why `pending.truncated` takes `heardAt` as an
   * argument rather than reaching for this.
   *
   * Kept in the shape because it is worth logging beside ours when the two
   * disagree, and **optional** because a required field nobody reads can only
   * ever reject a frame that mattered.
   */
  | {
      readonly kind: 'truncated'
      readonly itemId: string
      readonly contentIndex: number
      readonly audioEndMs: number | null
    }
  /**
   * The hour is up. Its own kind because the remedy is completely different
   * from every other error: nothing is wrong, reconnect (§53).
   */
  | { readonly kind: 'session-expired'; readonly message: string | null }
  /** Anything else the service refused. `raw` is kept so nothing is lost. */
  | {
      readonly kind: 'error'
      readonly code: string | null
      readonly message: string | null
      readonly param: string | null
      readonly raw: unknown
    }
  /**
   * What the user said, once ASR has settled it.
   *
   * A SEPARATE pass from the audio she hears — she is speech-to-speech, so bad
   * ASR does not make her mishear anyone. **Measured, not assumed**: §70 pushed
   * a real recording in and watched the user's item enter the conversation with
   * `transcript: null` and stay null while she began generating 587ms later. It
   * makes the log and the archive wrong, which is a different problem with a
   * different fix.
   *
   * The frame also carries `item_id`, which is deliberately not exposed: this
   * is filed against the open conversation, not joined to anything.
   */
  | { readonly kind: 'heard'; readonly transcript: string }
  /**
   * An item was opened in a response — the earliest frame in a turn.
   *
   * Two things nothing else in this parser can supply.
   *
   * **`phase`.** §67 measured it on 11 of 11 responses: `commentary` on every
   * turn that went on to call a tool, `final_answer` on every turn that did
   * not, never both in one response. §26 §5 and §69 measured what that means
   * here — the commentary message is SPOKEN and carries its own audio
   * transcript, so without this field a sentence like *"let me celebrate with
   * you for a moment"* is indistinguishable from an answer and is filed as one.
   *
   * **The join.** `output_audio_buffer.*` carries only `response_id`;
   * `conversation.item.truncated` carries only `item_id`. This frame is the one
   * place both appear together, and §28 measured it arriving 197ms BEFORE
   * `output_audio_buffer.started`, so the pairing is known before either of the
   * others can need it.
   *
   * `phase` is null on a `function_call` item, which carries none — captured
   * that way, not assumed.
   */
  | {
      readonly kind: 'item-added'
      readonly itemId: string
      readonly responseId: string
      readonly phase: string | null
    }
  /**
   * One fragment of what she is saying, as it is generated.
   *
   * Observed keys include `delta`, which is the fragment. Used for the bubble
   * and nothing else: it tracks GENERATION, which runs ahead of her audio at
   * both ends — §56 measured it starting 0–320ms earlier, §19 measured it
   * finishing 2.1–7.9s earlier. So it is not a signal about what she has
   * actually said aloud.
   *
   * `responseId` is what separates one utterance from the next. Taking that
   * boundary from the audio stream instead is §56's whole subject: it discards
   * the opening deltas, and for a one-word reply it discards all of them.
   */
  | { readonly kind: 'saying'; readonly delta: string; readonly responseId: string }
  /**
   * What she said, as text. Arrives BEFORE her audio finishes draining — §19
   * measured the gap at 2.1–7.9s and growing with length, so this is not a
   * signal that she has stopped talking.
   */
  | {
      readonly kind: 'said'
      readonly transcript: string
      readonly responseId: string
      readonly itemId: string
    }
  /**
   * A frame this application does not act on — **yet**, and `keys` is why it
   * carries them.
   *
   * The rule here is not to build on a field nobody has seen in a real log. The
   * corollary is that there has to be a way to see one, and the cheapest is for
   * an unrecognised frame to announce its own shape the first time it arrives.
   * That is how the transcript events get read next: talk to her once, read the
   * log, then write the parser against what it printed.
   */
  | { readonly kind: 'other'; readonly type: string; readonly keys: readonly string[] }
  /** A frame we DO act on, whose fields are not what was observed. */
  | { readonly kind: 'malformed'; readonly type: string; readonly missing: readonly string[] }
  /** Not JSON, or not an object. */
  | { readonly kind: 'unreadable' }

/**
 * The phase value that marks a preamble rather than an answer.
 *
 * A constant because two processes compare against it — the renderer to know
 * whether it has ever seen one, main to decide what reaches the archive — and a
 * string literal written twice is how the two come to disagree the day the
 * service adds a third phase.
 *
 * Only this one is named. `final_answer` needs no constant: everything that is
 * not a preamble is filed, which is the safe direction for an archive. A phase
 * nobody here has heard of is treated as an answer and kept, because losing a
 * real turn is worse than keeping a line of filler.
 */
export const COMMENTARY = 'commentary'

const BUFFER_PHASE: Readonly<Record<string, 'started' | 'stopped' | 'cleared'>> = {
  'output_audio_buffer.started': 'started',
  'output_audio_buffer.stopped': 'stopped',
  'output_audio_buffer.cleared': 'cleared',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function missingFrom(frame: Record<string, unknown>, fields: readonly string[]): string[] {
  return fields.filter((field) => typeof frame[field] !== 'string')
}

export function parseServerFrame(text: string): ServerFrame {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return { kind: 'unreadable' }
  }
  if (!isRecord(value)) return { kind: 'unreadable' }

  const type = value['type']
  if (typeof type !== 'string') return { kind: 'unreadable' }

  if (type === 'session.created') {
    const session = value['session']
    const expiresAt = isRecord(session) ? session['expires_at'] : undefined
    if (typeof expiresAt !== 'number') {
      return { kind: 'malformed', type, missing: ['session.expires_at'] }
    }
    return { kind: 'session-created', expiresAt }
  }

  /**
   * ONE source for a tool call, deliberately.
   *
   * `response.done` also carries the call, inside `response.output[]` with
   * `type: 'function_call'` — the fixture has both, from the same call. Reading
   * either would work; reading BOTH would dispatch one call twice, and the
   * duplicate would be caught by the ledger rather than by the thing that
   * created it. Two mechanisms producing one observable is how a test comes to
   * prove nothing about either.
   *
   * This one, because it arrives first: measured at `+0.1s` against
   * `response.done`'s `+0.2s` in the same run, and a capability that runs
   * `codex exec` has a twenty-second floor to get started on.
   */
  if (type === 'response.function_call_arguments.done') {
    const missing = missingFrom(value, ['call_id', 'name', 'arguments'])
    if (missing.length > 0) return { kind: 'malformed', type, missing }
    return {
      kind: 'tool-call',
      callId: value['call_id'] as string,
      name: value['name'] as string,
      args: value['arguments'] as string,
    }
  }

  // Both shapes below were captured on 2026-08-17 by running the app and
  // reading what announced itself — the `other` branch's whole purpose.
  if (type === 'conversation.item.input_audio_transcription.completed') {
    const missing = missingFrom(value, ['transcript'])
    if (missing.length > 0) return { kind: 'malformed', type, missing }
    return { kind: 'heard', transcript: value['transcript'] as string }
  }

  /**
   * Captured 2026-08-22 by `dev-docs/spikes/probe-phase/probe.mjs`, which wrote
   * every frame of eleven responses to disk whole. Both shapes are in the
   * fixture: a `message` item carrying `phase`, and a `function_call` item
   * carrying none.
   *
   * **A missing `phase` is not malformed.** The `function_call` item genuinely
   * has no such field, so demanding one would report every tool turn as a
   * service change. `item.id` and `response_id` are the fields this frame is
   * read for, and those are required.
   */
  if (type === 'response.output_item.added') {
    const item = value['item']
    const itemId = isRecord(item) ? item['id'] : undefined
    const responseId = value['response_id']
    if (typeof itemId !== 'string' || typeof responseId !== 'string') {
      return { kind: 'malformed', type, missing: ['item.id', 'response_id'] }
    }
    const phase = isRecord(item) ? item['phase'] : undefined
    return {
      kind: 'item-added',
      itemId,
      responseId,
      phase: typeof phase === 'string' ? phase : null,
    }
  }

  if (type === 'response.output_audio_transcript.delta') {
    const missing = missingFrom(value, ['delta', 'response_id'])
    if (missing.length > 0) return { kind: 'malformed', type, missing }
    return {
      kind: 'saying',
      delta: value['delta'] as string,
      responseId: value['response_id'] as string,
    }
  }

  if (type === 'conversation.item.truncated') {
    const itemId = value['item_id']
    const audioEndMs = value['audio_end_ms']
    /*
      `item_id` is REQUIRED and `audio_end_ms` is not, though both were.

      Written from a captured frame, not from a page: the observed keys are
      `[type, event_id, item_id, content_index, audio_end_ms]`. Requiring the
      whole observed shape looks conservative and is not -- nothing in this app
      reads `audioEndMs`. The cut is estimated from the renderer's own cursor,
      which is what `pending.truncated` takes as an argument.

      So a service that stops sending a field nobody uses would have made every
      truncation `malformed`, and a malformed truncation means the turn is
      never settled: `pending` holds it until session close and files it whole.
      The frame that says she was CUT OFF is the last one that should be
      rejected over an unused number.

      Kept in the shape rather than dropped, because it is the service's own
      account of the cut and belongs in the log beside ours when they disagree.
    */
    if (typeof itemId !== 'string') {
      return { kind: 'malformed', type, missing: ['item_id'] }
    }
    return {
      kind: 'truncated',
      itemId,
      contentIndex: typeof value['content_index'] === 'number' ? value['content_index'] : 0,
      audioEndMs: typeof audioEndMs === 'number' ? audioEndMs : null,
    }
  }

  if (type === 'response.output_audio_transcript.done') {
    const missing = missingFrom(value, ['transcript', 'response_id', 'item_id'])
    if (missing.length > 0) return { kind: 'malformed', type, missing }
    return {
      kind: 'said',
      transcript: value['transcript'] as string,
      responseId: value['response_id'] as string,
      itemId: value['item_id'] as string,
    }
  }

  const phase = BUFFER_PHASE[type]
  if (phase !== undefined) {
    const missing = missingFrom(value, ['response_id'])
    if (missing.length > 0) return { kind: 'malformed', type, missing }
    return { kind: 'audio-buffer', phase, responseId: value['response_id'] as string }
  }

  /**
   * Now read from a captured frame rather than from a page.
   *
   * The observed envelope is `{ type, event_id, error }`, with the inner object
   * carrying `{ type, code, message, param, event_id }`.
   *
   * **`error.event_id` is deliberately not exposed.** The documentation calls it
   * "the event_id of the client event that caused the error", and it has now
   * arrived as `null` three times, on three different codes — including one
   * where the causing client event was sent by the probe one line earlier and
   * was therefore known for certain. A correlation handle that is always null is
   * not a correlation handle, and a shipped mechanism already died on it. Giving
   * it a field here would invite the same code to be written a third time.
   */
  if (type === 'error') {
    const inner = value['error']
    const read = (field: string): string | null => {
      const found = isRecord(inner) ? inner[field] : undefined
      return typeof found === 'string' ? found : null
    }
    const code = read('code')
    // Its own kind: every other error means something was sent wrongly, and this
    // one means an hour passed. Reconnecting on the wrong one loops.
    if (code === 'session_expired') return { kind: 'session-expired', message: read('message') }
    return { kind: 'error', code, message: read('message'), param: read('param'), raw: value }
  }

  return { kind: 'other', type, keys: Object.keys(value) }
}
