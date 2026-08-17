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
  /** A frame this application does not act on. */
  | { readonly kind: 'other'; readonly type: string }
  /** A frame we DO act on, whose fields are not what was observed. */
  | { readonly kind: 'malformed'; readonly type: string; readonly missing: readonly string[] }
  /** Not JSON, or not an object. */
  | { readonly kind: 'unreadable' }

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

  return { kind: 'other', type }
}
