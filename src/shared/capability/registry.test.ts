import { describe, expect, it } from 'vitest'
import { createRegistry } from './registry'
import type { CapabilityManifest } from './manifest'

/**
 * What survived the deletion of the second source.
 *
 * This file used to spend most of its length on capabilities found in a user's
 * folder: refused for having no sandbox, refused for shadowing a built-in,
 * refused for colliding with each other. There is no user's folder now — a
 * capability is a folder in the source that somebody compiled — so those
 * assertions went with the code they were about. Two capabilities claiming one
 * name is refused by `collect` at module evaluation, naming both files —
 * asserted in `src/capabilities/index.test.ts`, and caught by `pnpm test`
 * rather than by `pnpm build`, which bundles that module without running it.
 *
 * What is left is what the registry is actually for: the wire payload, and a
 * dispatch table that answers only to names it was given — plus the one refusal
 * that survived, because it is about the two views agreeing with each other
 * rather than about who wrote the code.
 */

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

const COLLECTED = [manifest('ask_workspace'), manifest('recall_conversations')]

describe('createRegistry', () => {
  it('puts every capability on the wire in the order it was collected', () => {
    const registry = createRegistry(COLLECTED)
    expect(registry.tools.map((tool) => tool.name)).toEqual([
      'ask_workspace',
      'recall_conversations',
    ])
    expect(registry.tools[0]?.type).toBe('function')
  })

  it('dispatches by name and refuses a name it was never given', () => {
    const registry = createRegistry(COLLECTED)
    expect(registry.has('ask_workspace')).toBe(true)
    expect(registry.get('ask_workspace')?.name).toBe('ask_workspace')
    expect(registry.has('rm_minus_rf')).toBe(false)
    expect(registry.get('rm_minus_rf')).toBeNull()
  })

  it('does not answer to an inherited key', () => {
    // The lookup is a Map for this reason. An object used as a table answers
    // `true` for `constructor` and `toString`, which would dispatch a call
    // nobody declared into whatever `get` returned for it.
    const registry = createRegistry(COLLECTED)
    for (const key of ['constructor', 'toString', 'valueOf', '__proto__', 'hasOwnProperty']) {
      expect(registry.has(key), key).toBe(false)
      expect(registry.get(key), key).toBeNull()
    }
  })

  it('carries the manifest through to the wire unaltered', () => {
    const one = manifest('read_clipboard')
    const registry = createRegistry([one])
    expect(registry.tools[0]).toEqual({
      type: 'function',
      name: one.name,
      description: one.description,
      parameters: one.parameters,
    })
  })

  it('answers empty rather than throwing when there are none', () => {
    // Not a state a build should be in, and not this module's to refuse. The
    // set being empty is `src/capabilities/index.test.ts`'s to notice.
    const registry = createRegistry([])
    expect(registry.tools).toEqual([])
    expect(registry.has('anything')).toBe(false)
  })

  it('refuses two manifests sharing a name, rather than disagreeing with itself', () => {
    // Not tidiness. `tools` would carry both onto the wire while the lookup
    // silently kept the last one, so every call to that name would reach the
    // wrong capability — the `shadows-builtin` hazard this module used to name,
    // arriving through a caller that skipped `collect`.
    expect(() => createRegistry([manifest('twice'), manifest('twice')])).toThrow(/twice/)
  })
})
