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
      'output_audio_buffer.cleared',
      'output_audio_buffer.started',
      'output_audio_buffer.stopped',
      'response.done',
      'response.function_call_arguments.delta',
      'response.function_call_arguments.done',
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

    expect(parseServerFrame(frame('response.done'))).toEqual({
      kind: 'other',
      type: 'response.done',
    })
  })

  it('ignores the streaming deltas', () => {
    expect(parseServerFrame(frame('response.function_call_arguments.delta'))).toEqual({
      kind: 'other',
      type: 'response.function_call_arguments.delta',
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

describe('the error frame', () => {
  it('is recognised by type and passed through whole', () => {
    // Nothing here has ever captured one, so nothing here reads inside it.
    const raw = { type: 'error', error: { code: 'whatever', message: 'unverified shape' } }
    expect(parseServerFrame(JSON.stringify(raw))).toEqual({ kind: 'error', raw })
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
