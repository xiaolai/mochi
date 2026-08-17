import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseServerFrame } from './frames'

/**
 * Frames captured off a live session on this machine by
 * `dev-docs/spikes/probe-audio-buffer-id/`, committed verbatim.
 *
 * The tests parse THESE rather than hand-written approximations, so the parser
 * is checked against what the service actually sent rather than against what I
 * believed it sends. Two mechanisms in this project's history were green and
 * dead on arrival for want of exactly this.
 */
const OBSERVED = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('./__fixtures__/observed-frames.json', import.meta.url)),
    'utf8',
  ),
) as Record<string, Record<string, unknown>>

const frame = (type: string): string => JSON.stringify(OBSERVED[type])

describe('frames captured from the live service', () => {
  it('has the fixture the rest of this file depends on', () => {
    // If the fixture is ever emptied, every assertion below would pass
    // vacuously against `undefined`. Counted first.
    expect(Object.keys(OBSERVED).sort()).toEqual([
      'conversation.item.input_audio_transcription.completed',
      'error',
      'output_audio_buffer.cleared',
      'output_audio_buffer.started',
      'output_audio_buffer.stopped',
      'response.done',
      'response.function_call_arguments.delta',
      'response.function_call_arguments.done',
      'response.output_audio_transcript.delta',
      'response.output_audio_transcript.done',
    ])
  })

  it('reads a real tool call, arguments left as the string they arrived as', () => {
    const parsed = parseServerFrame(frame('response.function_call_arguments.done'))

    expect(parsed).toEqual({
      kind: 'tool-call',
      callId: 'call_LzM9HoHHCl3J1RJl',
      name: 'look_up_the_passphrase',
      // Verbatim, whitespace and newlines included. The service really does send
      // it like this, and anything that trims or re-serialises it here is
      // guessing on behalf of the manifest's own reader.
      args: '{  \n  "what": "the passphrase" \n} \n',
    })
  })

  it('reads all three audio-buffer phases, each with its response id', () => {
    for (const phase of ['started', 'stopped', 'cleared'] as const) {
      const parsed = parseServerFrame(frame(`output_audio_buffer.${phase}`))
      expect(parsed.kind, phase).toBe('audio-buffer')
      if (parsed.kind !== 'audio-buffer') continue
      expect(parsed.phase).toBe(phase)
      expect(parsed.responseId).toMatch(/^resp_/)
    }
  })

  it('does NOT take a second tool call out of response.done', () => {
    // The fixture proves `response.done` carries the same call, in
    // `response.output[]`. Reading both would dispatch one call twice and leave
    // the duplicate to be caught by the ledger instead of never being made.
    const done = OBSERVED['response.done']
    const output = (done?.['response'] as Record<string, unknown>)?.['output'] as
      Record<string, unknown>[] | undefined
    expect(output?.[0]?.['call_id']).toBe('call_LzM9HoHHCl3J1RJl')

    const parsed = parseServerFrame(frame('response.done'))
    expect(parsed).toEqual({
      kind: 'other',
      type: 'response.done',
      // Carried so an unrecognised frame can announce its own shape once, which
      // is how the next set of fields gets captured rather than guessed.
      keys: ['type', 'event_id', 'response'],
    })
  })

  it('ignores the streaming deltas', () => {
    const parsed = parseServerFrame(frame('response.function_call_arguments.delta'))
    expect(parsed.kind).toBe('other')
    if (parsed.kind !== 'other') return
    expect(parsed.type).toBe('response.function_call_arguments.delta')
    expect(parsed.keys).toContain('delta')
  })
})

describe('the two frames that make a conversation visible', () => {
  it('reads a fragment of what she is saying, for the bubble', () => {
    const parsed = parseServerFrame(frame('response.output_audio_transcript.delta'))
    expect(parsed).toEqual({
      kind: 'saying',
      delta: 'one fragment ',
      responseId: 'resp_observed',
    })
  })

  it('reads what the user said', () => {
    const parsed = parseServerFrame(frame('conversation.item.input_audio_transcription.completed'))
    expect(parsed).toEqual({
      kind: 'heard',
      transcript: 'what the user said',
      itemId: 'item_observed',
    })
  })

  it('reads what she said, and carries the response id that distinguishes utterances', () => {
    const parsed = parseServerFrame(frame('response.output_audio_transcript.done'))
    expect(parsed).toEqual({
      kind: 'said',
      transcript: 'what she said',
      responseId: 'resp_observed',
      itemId: 'item_observed',
    })
  })

  it('is malformed rather than silent when a transcript is missing', () => {
    // Silently dropping one would put the log back where it started: able to say
    // the wire is up and unable to say whether anybody spoke.
    expect(
      parseServerFrame(JSON.stringify({ type: 'response.output_audio_transcript.done' })),
    ).toEqual({
      kind: 'malformed',
      type: 'response.output_audio_transcript.done',
      missing: ['transcript', 'response_id', 'item_id'],
    })
  })
})

describe('a known frame whose fields are not what was observed', () => {
  it('is malformed, not quietly "other"', () => {
    // The failure this prevents: the service changes, tool calls stop being
    // dispatched, and it is indistinguishable from her not calling one.
    const missingCallId = {
      type: 'response.function_call_arguments.done',
      name: 'x',
      arguments: '{}',
    }
    expect(parseServerFrame(JSON.stringify(missingCallId))).toEqual({
      kind: 'malformed',
      type: 'response.function_call_arguments.done',
      missing: ['call_id'],
    })
  })

  it('names every field that is missing, not just the first', () => {
    expect(
      parseServerFrame(JSON.stringify({ type: 'response.function_call_arguments.done' })),
    ).toEqual({
      kind: 'malformed',
      type: 'response.function_call_arguments.done',
      missing: ['call_id', 'name', 'arguments'],
    })
  })

  it('applies to session.created and the audio buffer too', () => {
    expect(parseServerFrame(JSON.stringify({ type: 'session.created', session: {} }))).toEqual({
      kind: 'malformed',
      type: 'session.created',
      missing: ['session.expires_at'],
    })
    expect(parseServerFrame(JSON.stringify({ type: 'output_audio_buffer.started' }))).toEqual({
      kind: 'malformed',
      type: 'output_audio_buffer.started',
      missing: ['response_id'],
    })
  })
})

describe('the error frame, now read from a captured one', () => {
  it('reads code, message and param off a real refusal', () => {
    const parsed = parseServerFrame(frame('error'))
    expect(parsed.kind).toBe('error')
    if (parsed.kind !== 'error') return
    expect(parsed.code).toBe('invalid_value')
    expect(parsed.param).toBe('type')
    expect(parsed.message).toContain('Supported values are')
  })

  it('does not offer error.event_id as a way to correlate anything', () => {
    // It is documented as "the event_id of the client event that caused the
    // error" and has arrived as `null` three times on three different codes —
    // including this fixture, where the causing client event was sent by the
    // probe one line earlier and was known for certain. A shipped mechanism
    // already died on it; there is no field here to write it a third time.
    const inner = OBSERVED['error']?.['error'] as Record<string, unknown>
    expect(inner['event_id']).toBeNull()
    expect(parseServerFrame(frame('error'))).not.toHaveProperty('causedBy')
  })

  it('gives the hour being up its own kind, because the remedy is different', () => {
    // Observed by `probe-session-lifetime` at exactly 60 minutes, twice (§53).
    // Every other error means something was sent wrongly; this one means time
    // passed, and reconnecting on the wrong one loops.
    const expired = {
      type: 'error',
      event_id: 'event_x',
      error: {
        type: 'invalid_request_error',
        code: 'session_expired',
        message: 'Your session hit the maximum duration of 60 minutes.',
        param: null,
        event_id: null,
      },
    }
    expect(parseServerFrame(JSON.stringify(expired))).toEqual({
      kind: 'session-expired',
      message: 'Your session hit the maximum duration of 60 minutes.',
    })
  })

  it('survives an error whose inner object is missing or wrong', () => {
    expect(parseServerFrame(JSON.stringify({ type: 'error' }))).toEqual({
      kind: 'error',
      code: null,
      message: null,
      param: null,
      raw: { type: 'error' },
    })
  })
})

describe('what cannot be read at all', () => {
  it('never throws, on anything', () => {
    for (const text of ['', 'not json', '{', 'null', '42', '"a string"', '[1,2]', '{}']) {
      expect(() => parseServerFrame(text), text).not.toThrow()
    }
  })

  it('reports unreadable rather than inventing a type', () => {
    for (const text of ['not json', 'null', '42', '[1,2]', '{}', '{"type":7}']) {
      expect(parseServerFrame(text), text).toEqual({ kind: 'unreadable' })
    }
  })

  it('reads session.created, which the lifetime probe depends on', () => {
    // Observed shape, from `probe-session-lifetime`'s own logs (§21).
    const parsed = parseServerFrame(
      JSON.stringify({ type: 'session.created', session: { expires_at: 1_755_432_000 } }),
    )
    expect(parsed).toEqual({ kind: 'session-created', expiresAt: 1_755_432_000 })
  })
})
