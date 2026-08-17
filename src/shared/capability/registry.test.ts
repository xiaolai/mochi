import { describe, expect, it } from 'vitest'
import { createRegistry } from './registry'
import type { CapabilityManifest } from './manifest'

function manifest(name: string): CapabilityManifest {
  return {
    name,
    description: `The ${name} capability.`,
    parameters: {
      type: 'object',
      properties: { input: { type: 'string', description: 'The input.' } },
      required: ['input'],
    },
  }
}

const BUILTIN = [manifest('ask_workspace'), manifest('recall_conversations')]

describe('createRegistry', () => {
  it('puts every built-in on the wire in declared order', () => {
    const registry = createRegistry(BUILTIN, [])
    expect(registry.tools.map((tool) => tool.name)).toEqual([
      'ask_workspace',
      'recall_conversations',
    ])
    expect(registry.tools[0]?.type).toBe('function')
  })

  it('dispatches by name and refuses a name it was never given', () => {
    const registry = createRegistry(BUILTIN, [])
    expect(registry.has('ask_workspace')).toBe(true)
    expect(registry.get('ask_workspace')?.name).toBe('ask_workspace')
    expect(registry.has('rm_minus_rf')).toBe(false)
    expect(registry.get('rm_minus_rf')).toBeNull()
  })

  it('does not answer to an inherited key', () => {
    // The lookup is a Map for this reason. An object used as a table answers
    // `true` for `constructor` and `toString`, which would dispatch a call
    // nobody declared into whatever `get` returned for it.
    const registry = createRegistry(BUILTIN, [])
    for (const key of ['constructor', 'toString', 'valueOf', '__proto__', 'hasOwnProperty']) {
      expect(registry.has(key), key).toBe(false)
      expect(registry.get(key), key).toBeNull()
    }
  })

  it('adds an installed capability without any change to this module', () => {
    // The whole claim, in one assertion: a capability this file has never heard
    // of arrives on the wire and becomes dispatchable.
    const registry = createRegistry(BUILTIN, [manifest('read_clipboard')])
    expect(registry.tools.map((tool) => tool.name)).toEqual([
      'ask_workspace',
      'recall_conversations',
      'read_clipboard',
    ])
    expect(registry.has('read_clipboard')).toBe(true)
    expect(registry.refused).toEqual([])
  })

  it('refuses an installed capability that shadows a built-in', () => {
    // Privilege escalation by naming: this one would receive every call the
    // real `ask_workspace` was meant to answer.
    const impostor = manifest('ask_workspace')
    const registry = createRegistry(BUILTIN, [impostor])
    expect(registry.refused).toEqual([
      { manifest: impostor, problem: { kind: 'shadows-builtin', name: 'ask_workspace' } },
    ])
    expect(registry.tools).toHaveLength(2)
    // And the built-in still answers — the refusal must not have displaced it.
    expect(registry.get('ask_workspace')?.description).toBe(BUILTIN[0]?.description)
  })

  it('refuses the second of two installed capabilities sharing a name', () => {
    const registry = createRegistry(BUILTIN, [manifest('dup'), manifest('dup')])
    expect(registry.tools.map((tool) => tool.name)).toContain('dup')
    expect(registry.refused.map((refusal) => refusal.problem.kind)).toEqual(['duplicate-name'])
  })

  it('orders installed capabilities by name, not by the order handed in', () => {
    // Callers read a directory, and directory order is a property of the
    // filesystem rather than of anyone's intent. Left unsorted, the same set of
    // folders could produce a different `session.update` on a different machine.
    const forwards = createRegistry(BUILTIN, [manifest('zulu'), manifest('alpha')])
    const backwards = createRegistry(BUILTIN, [manifest('alpha'), manifest('zulu')])
    expect(forwards.tools.map((tool) => tool.name)).toEqual(backwards.tools.map((t) => t.name))
    expect(forwards.tools.map((tool) => tool.name).slice(2)).toEqual(['alpha', 'zulu'])
  })

  it('carries the manifest through to the wire unaltered', () => {
    const one = manifest('read_clipboard')
    const registry = createRegistry([], [one])
    expect(registry.tools[0]).toEqual({
      type: 'function',
      name: one.name,
      description: one.description,
      parameters: one.parameters,
    })
  })
})
