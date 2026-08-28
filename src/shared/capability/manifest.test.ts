import { describe, expect, it } from 'vitest'
import { parseManifest } from './manifest'

/** Split out so a case can vary the parameters alone without restating them. */
function validParameters(): Record<string, unknown> {
  return {
    type: 'object',
    properties: { format: { type: 'string', description: 'text or html.' } },
    required: ['format'],
  }
}

/** A manifest that is valid, so every case below can be one deviation from it. */
function valid(): Record<string, unknown> {
  return {
    name: 'read_clipboard',
    description: 'Read what is currently on the clipboard.',
    parameters: validParameters(),
  }
}

function problemOf(value: unknown): string {
  const result = parseManifest(value)
  return result.ok ? 'ACCEPTED' : result.problem.kind
}

describe('parseManifest', () => {
  it('accepts a well-formed manifest and narrows it', () => {
    const result = parseManifest(valid())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.manifest.name).toBe('read_clipboard')
    expect(result.manifest.parameters.required).toEqual(['format'])
  })

  it('rejects anything that is not an object', () => {
    for (const value of [null, undefined, 42, 'a string', [valid()]]) {
      expect(problemOf(value)).toBe('not-an-object')
    }
  })

  it('rejects names that could be confused with another capability', () => {
    // A name is both the wire identifier and the dispatch key, so anything that
    // reads as a different name is refused rather than normalised. Normalising
    // is what makes `Ask_Workspace` silently become `ask_workspace`.
    for (const name of [
      '',
      'Ask_Workspace',
      'ask-workspace',
      'ask/workspace',
      '1st',
      'a'.repeat(65),
    ]) {
      expect(problemOf({ ...valid(), name })).toBe('bad-name')
    }
    expect(problemOf({ ...valid(), name: 'a'.repeat(64) })).toBe('ACCEPTED')
  })

  it('rejects an empty or oversized description', () => {
    // The description enters the model's context on every single session, so an
    // unbounded one is a cost and an injection surface at once.
    expect(problemOf({ ...valid(), description: '   ' })).toBe('bad-description')
    expect(problemOf({ ...valid(), description: 4 })).toBe('bad-description')
    expect(problemOf({ ...valid(), description: 'x'.repeat(4097) })).toBe('bad-description')
    expect(problemOf({ ...valid(), description: 'x'.repeat(4096) })).toBe('ACCEPTED')
  })

  it('refuses a property type it cannot honestly support, rather than ignoring it', () => {
    // Silently dropping a non-string property would put a tool on the wire whose
    // declared arguments do not match what anything here can read back.
    const parameters = {
      type: 'object',
      properties: { count: { type: 'number', description: 'How many.' } },
      required: ['count'],
    }
    expect(problemOf({ ...valid(), parameters })).toBe('unsupported-property-type')
  })

  it('rejects a required entry that names no declared property', () => {
    const parameters = { ...validParameters(), required: ['nonexistent'] }
    expect(problemOf({ ...valid(), parameters })).toBe('required-not-declared')
  })

  it('rejects a duplicated required entry', () => {
    const parameters = { ...validParameters(), required: ['format', 'format'] }
    expect(problemOf({ ...valid(), parameters })).toBe('required-duplicated')
  })

  it('rejects malformed parameter blocks', () => {
    expect(problemOf({ ...valid(), parameters: null })).toBe('bad-parameters')
    expect(problemOf({ ...valid(), parameters: { type: 'array' } })).toBe('bad-parameters')
    expect(problemOf({ ...valid(), parameters: { type: 'object', properties: {} } })).toBe(
      'no-properties',
    )
  })

  it('bounds the number of properties', () => {
    const properties: Record<string, unknown> = {}
    for (let i = 0; i < 9; i += 1) properties[`p${i}`] = { type: 'string', description: 'x' }
    const parameters = { type: 'object', properties, required: [] }
    expect(problemOf({ ...valid(), parameters })).toBe('too-many-properties')
  })

  it('refuses an argument called `description`, which the catalogue cannot key', () => {
    /*
      `toolDescriptionKey(name)` is `tool.<name>.description` and
      `toolArgumentKey(name, argument)` is `tool.<name>.<argument>`, so an
      argument with that name builds the IDENTICAL key. The prompt catalogue
      would then hold two entries under one key — different titles, different
      length limits — and one override would silently govern both, with the
      pane showing two rows that are the same setting.

      Refused here rather than worked around in the catalogue, because it makes
      the collision unrepresentable and costs nothing: no manifest in this build
      uses the name. Changing the key shape instead would have stranded every
      override anybody had already stored under the old one.
    */
    const parameters = {
      type: 'object',
      properties: { description: { type: 'string', description: 'what it is' } },
      required: ['description'],
    }
    expect(problemOf({ ...valid(), parameters })).toBe('reserved-property-name')
  })

  it('CONTROL: any other argument name is still fine', () => {
    // Without this the assertion above passes for a parser that refuses every
    // argument.
    const parameters = {
      type: 'object',
      properties: { question: { type: 'string', description: 'what to ask' } },
      required: ['question'],
    }
    expect(problemOf({ ...valid(), parameters })).toBe('ACCEPTED')
  })

  it('does not let an inherited key masquerade as a declared property', () => {
    // `'constructor' in properties` is true for a plain object literal, so the
    // `required` check has to be about DECLARED keys rather than reachable ones.
    const parameters = { ...validParameters(), required: ['constructor'] }
    expect(problemOf({ ...valid(), parameters })).toBe('required-not-declared')
  })
})

/**
 * The closed set a property may declare, which this parser used to drop.
 *
 * `CapabilityProperty.enum` says what it is for — *"On the wire, so the model is
 * CONSTRAINED rather than asked"* — and `parseManifest` read the type and the
 * description and never looked at it. A manifest declaring one was accepted and
 * silently widened to an unrestricted string.
 *
 * Latent rather than live: no manifest in this build declares one, which is why
 * nothing failed, and why `prompts.test.ts`'s assertion that `describedTools`
 * preserves an enum was passing over an empty set. These are the tests that
 * stop it being latent.
 */
describe('a property with a closed set of values', () => {
  const withEnum = (value: unknown): Record<string, unknown> => ({
    ...valid(),
    parameters: {
      type: 'object',
      properties: { format: { type: 'string', description: 'text or html.', enum: value } },
      required: ['format'],
    },
  })

  it('carries the enum through instead of dropping it', () => {
    const result = parseManifest(withEnum(['text', 'html']))
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.manifest.parameters.properties['format']?.enum).toEqual(['text', 'html'])
  })

  it('copies it rather than holding the caller array', () => {
    // The parser narrows untrusted input into a value the rest of the app
    // treats as settled. Keeping the caller's array would let whoever passed it
    // mutate a manifest after it was accepted.
    const values = ['text', 'html']
    const result = parseManifest(withEnum(values))
    if (!result.ok) throw new Error('unreachable')
    values.push('smuggled')
    expect(result.manifest.parameters.properties['format']?.enum).toEqual(['text', 'html'])
  })

  it('still accepts a property that declares none', () => {
    const result = parseManifest(valid())
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.manifest.parameters.properties['format']?.enum).toBeUndefined()
  })

  it('refuses an empty set, which no value could satisfy', () => {
    expect(problemOf(withEnum([]))).toBe('bad-property-enum')
  })

  it('refuses anything that is not an array of strings', () => {
    for (const bad of ['text', 7, {}, null, ['text', 7], ['text', null]]) {
      expect(problemOf(withEnum(bad)), JSON.stringify(bad)).toBe('bad-property-enum')
    }
  })

  it('refuses a blank or over-long value, like every other field here', () => {
    expect(problemOf(withEnum(['text', '   ']))).toBe('bad-property-enum')
    expect(problemOf(withEnum(['x'.repeat(65)]))).toBe('bad-property-enum')
  })

  it('refuses a set too large to be a deliberate constraint', () => {
    expect(problemOf(withEnum(Array.from({ length: 33 }, (_, i) => `v${String(i)}`)))).toBe(
      'bad-property-enum',
    )
  })

  it('refuses duplicates, which are a mistake rather than a constraint', () => {
    expect(problemOf(withEnum(['text', 'text']))).toBe('bad-property-enum')
  })
})
