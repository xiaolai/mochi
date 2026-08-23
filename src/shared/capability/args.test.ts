import { describe, expect, it } from 'vitest'
import { readArgs } from './args'
import type { CapabilityManifest } from './manifest'

/**
 * v1's `readStringArg`, copied verbatim out of
 * v1's `renderer/companion/audio/configure.ts`, as the reference
 * implementation. That file went with the rewrite and is not readable now; the
 * payload it produced is what the golden test in `manifest.test.ts` pins.
 *
 * The claim this file has to support is "behaviour unchanged". Restating the
 * old rules as fresh expectations would only prove that the new code matches
 * what I believed the old code did; running both over the same inputs proves
 * they agree. If a case below ever diverges, the differential test names it
 * rather than leaving it to be discovered in a conversation.
 */
function readStringArgV1(args: unknown, field: string): string {
  if (typeof args !== 'string') return ''
  try {
    const parsed: unknown = JSON.parse(args)
    if (typeof parsed !== 'object' || parsed === null) return ''
    const value = (parsed as Record<string, unknown>)[field]
    return typeof value === 'string' ? value : ''
  } catch {
    return ''
  }
}

const ASK: CapabilityManifest = {
  name: 'ask_workspace',
  description: 'Look something up.',
  parameters: {
    type: 'object',
    properties: { question: { type: 'string', description: 'What to find out.' } },
    required: ['question'],
  },
}

/** Everything a model, or something pretending to be one, might actually send. */
const INPUTS: readonly unknown[] = [
  JSON.stringify({ question: 'what is in the file' }),
  JSON.stringify({ question: '' }),
  JSON.stringify({ question: 42 }),
  JSON.stringify({ question: null }),
  JSON.stringify({ question: { nested: 'object' } }),
  JSON.stringify({ question: ['an', 'array'] }),
  JSON.stringify({ other: 'field' }),
  JSON.stringify({}),
  JSON.stringify([{ question: 'inside an array' }]),
  JSON.stringify('a bare string'),
  JSON.stringify(7),
  JSON.stringify(null),
  '{"question": "unterminated',
  '',
  'not json at all',
  '{"__proto__": {"question": "polluted"}}',
  '{"constructor": "x"}',
  undefined,
  null,
  42,
  { question: 'already an object, not a string' },
  ['array'],
]

describe('readArgs', () => {
  it('agrees with v1 on every input, field for field', () => {
    for (const input of INPUTS) {
      expect(readArgs(ASK, input)['question'], `input: ${String(input)}`).toBe(
        readStringArgV1(input, 'question'),
      )
    }
  })

  it('never throws, whatever it is handed', () => {
    for (const input of INPUTS) {
      expect(() => readArgs(ASK, input)).not.toThrow()
    }
  })

  it('returns every declared field, so callers never handle undefined', () => {
    // v1's call sites read `args.question` with no optional handling because the
    // parser could not return undefined. Multi-field capabilities have to keep
    // that property or every call site grows a branch.
    const two: CapabilityManifest = {
      name: 'two_fields',
      description: 'Takes two.',
      parameters: {
        type: 'object',
        properties: {
          first: { type: 'string', description: 'a' },
          second: { type: 'string', description: 'b' },
        },
        required: ['first'],
      },
    }
    expect(readArgs(two, JSON.stringify({ first: 'x' }))).toEqual({ first: 'x', second: '' })
    expect(readArgs(two, 'garbage')).toEqual({ first: '', second: '' })
  })

  it('ignores fields the manifest did not declare', () => {
    const out = readArgs(ASK, JSON.stringify({ question: 'q', smuggled: 'payload' }))
    expect(out).toEqual({ question: 'q' })
  })

  it('does not read a value off the prototype', () => {
    // `JSON.parse` gives `__proto__` no special treatment, but a future rewrite
    // using a plain lookup helper could. This asserts the observable rather than
    // today's implementation.
    expect(readArgs(ASK, '{"__proto__": {"question": "polluted"}}')['question']).toBe('')
    expect(({} as Record<string, unknown>)['question']).toBeUndefined()
  })
})
