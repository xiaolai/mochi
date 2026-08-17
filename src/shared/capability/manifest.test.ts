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

  it('does not let an inherited key masquerade as a declared property', () => {
    // `'constructor' in properties` is true for a plain object literal, so the
    // `required` check has to be about DECLARED keys rather than reachable ones.
    const parameters = { ...validParameters(), required: ['constructor'] }
    expect(problemOf({ ...valid(), parameters })).toBe('required-not-declared')
  })
})
