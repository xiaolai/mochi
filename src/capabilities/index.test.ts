import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createRegistry } from '@shared/capability/registry'
import { CAPABILITIES, collect } from './index'
import { stubDeps } from '../test/capability-deps'
import type { Capability, ImmediateHandler } from './kind'

/**
 * The claims this layout is FOR, stated as assertions.
 *
 * The old shape kept a manifest on disk and a handler in a map in main, and
 * nothing checked that both existed until she called one. This file is where
 * "adding a folder is the whole of adding a capability" stops being a claim.
 */

const HERE = fileURLToPath(new URL('.', import.meta.url))

function fake(name: string, kind: Capability['kind'] = 'immediate'): { capability: Capability } {
  const manifest = {
    name,
    description: `The ${name} capability.`,
    parameters: {
      type: 'object' as const,
      properties: { input: { type: 'string' as const, description: 'The input.' } },
      required: ['input'],
    },
  }
  return {
    capability:
      kind === 'deferred'
        ? { manifest, kind: 'deferred', handler: async () => ({ status: 'ok' }) }
        : { manifest, kind: 'immediate', handler: () => ({ status: 'ok' }) },
  }
}

describe('what the glob collected', () => {
  it('is exactly the folders that are there, by name and not by count', () => {
    // The whole claim of this layout, and the thing that used to be untrue: a
    // folder that exists and is not collected is a capability she is silently
    // without.
    //
    // BY NAME, because counts are not "exactly" — a glob that widened to match
    // a second file per folder, or a folder whose manifest claims a name that
    // is not its own, both keep the count. The second of those is the check
    // `load.ts` used to make against a directory: the folder named the
    // capability, so "which folder do I delete to remove this tool" had an
    // answer. That question is still asked and the answer should still be
    // mechanical, so the rule survived its loader — a folder is the capability
    // name in kebab, because a manifest name may not contain a hyphen.
    const folders = readdirSync(HERE, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
    expect(new Set(CAPABILITIES.manifests.map((one) => one.name))).toEqual(
      new Set(folders.map((folder) => folder.replaceAll('-', '_'))),
    )
    // And every one of them has a handler under that same name.
    expect(new Set(CAPABILITIES.byName.keys())).toEqual(
      new Set(CAPABILITIES.manifests.map((one) => one.name)),
    )
    expect(CAPABILITIES.byName.size).toBe(folders.length)
  })

  it('collected at all, which means every manifest passed the parser', () => {
    // `collect` runs `parseManifest` and throws, so an invalid manifest in any
    // folder makes importing this module fail — this file included. Reaching
    // this assertion IS the check; the emptiness of the set would not be.
    expect(CAPABILITIES.manifests.length).toBeGreaterThan(0)
  })

  it('answers to every name it declared, with the manifest that went on the wire', () => {
    // A manifest on the wire with no handler behind it is the defect this whole
    // layout exists to make unrepresentable, stated over the real set. The
    // manifest held beside the handler is the PARSED one, so the description
    // the model is given and the one the dispatch holds cannot differ.
    for (const manifest of CAPABILITIES.manifests) {
      const held = CAPABILITIES.byName.get(manifest.name)
      expect(held, manifest.name).toBeDefined()
      expect(held?.manifest).toEqual(manifest)
    }
  })

  it('reaches the wire in the order it was collected', () => {
    const registry = createRegistry(CAPABILITIES.manifests)
    expect(registry.tools.map((tool) => tool.name)).toEqual(
      CAPABILITIES.manifests.map((manifest) => manifest.name),
    )
  })
})

describe('collect', () => {
  it('sorts by path, so the wire does not depend on the bundler traversal', () => {
    const collected = collect({
      './zulu/capability.ts': fake('zulu'),
      './alpha/capability.ts': fake('alpha'),
    })
    expect(collected.manifests.map((one) => one.name)).toEqual(['alpha', 'zulu'])
  })

  it('splits the two kinds, so a slow handler cannot go down the fast path', () => {
    const collected = collect({
      './fast/capability.ts': fake('fast'),
      './slow/capability.ts': fake('slow', 'deferred'),
    })
    expect(collected.byName.get('fast')?.kind).toBe('immediate')
    expect(collected.byName.get('slow')?.kind).toBe('deferred')
  })

  it('refuses two capabilities sharing a name, and says which two files', () => {
    // "Duplicate capability" without the paths is a message that sends somebody
    // through every folder looking for the other one.
    expect(() =>
      collect({
        './one/capability.ts': fake('same_name'),
        './two/capability.ts': fake('same_name'),
      }),
    ).toThrow(/same_name.*\.\/one\/capability\.ts.*\.\/two\/capability\.ts/s)
  })

  it('refuses a collection with nothing in it, because that is a broken glob', () => {
    // The one failure mode the pattern has that is not a typo in a file: it
    // matches nothing, and the app starts cleanly with no tools and says
    // nothing about it — the silence this layout exists to remove, arriving
    // through the mechanism that removed it.
    expect(() => collect({})).toThrow(/matched nothing/)
  })

  it('refuses a manifest the parser rejects, naming the file and the field', () => {
    // Written in TypeScript and still wrong: the type has no opinion about a
    // name with a slash in it, a description longer than anybody meant, or a
    // `required` entry naming a property nothing declares. Each would configure
    // a session cleanly and then behave wrongly.
    const bad = (parameters: unknown, name = 'ok_name', description = 'Fine.') => ({
      capability: {
        manifest: { name, description, parameters },
        kind: 'immediate',
        handler: () => ({}),
      },
    })
    const good = {
      type: 'object',
      properties: { input: { type: 'string', description: 'In.' } },
      required: ['input'],
    }
    expect(() => collect({ './a/capability.ts': bad(good, 'Bad/Name') })).toThrow(
      /\.\/a\/capability\.ts.*bad-name/,
    )
    expect(() => collect({ './b/capability.ts': bad(good, 'ok_name', 'x'.repeat(5000)) })).toThrow(
      /\.\/b\/capability\.ts.*bad-description/,
    )
    expect(() =>
      collect({ './c/capability.ts': bad({ ...good, required: ['nothing_declares_this'] }) }),
    ).toThrow(/\.\/c\/capability\.ts.*required-not-declared/)
  })

  it('refuses a folder that exports nothing usable, naming the file', () => {
    expect(() => collect({ './empty/capability.ts': {} })).toThrow(/\.\/empty\/capability\.ts/)
    expect(() => collect({ './wrong/capability.ts': { capability: { manifest: {} } } })).toThrow(
      /\.\/wrong\/capability\.ts/,
    )
    // A manifest and a kind but no handler — the exact state that shipped, now
    // caught before the app starts rather than said out loud to somebody.
    expect(() =>
      collect({
        './declared/capability.ts': {
          capability: { manifest: { name: 'x' }, kind: 'immediate' },
        },
      }),
    ).toThrow(/\.\/declared\/capability\.ts/)
  })
})

describe('the two kinds are not interchangeable', () => {
  it('refuses an async handler declared immediate — a compile error, asserted', () => {
    // The immediate return type was `unknown`, and `unknown` subsumes
    // `Promise<unknown>` — so this typechecked, and main would have awaited it
    // on the fast path, leaving her silent for however long it took instead of
    // saying she was going to look. The `@ts-expect-error` IS the assertion:
    // `pnpm typecheck` fails if this line ever stops being an error.
    // @ts-expect-error an immediate handler settles the call, so it may not return a promise
    const wrong: ImmediateHandler = async () => ({ status: 'ok' })
    expect(typeof wrong).toBe('function')
  })

  it('refuses an answer that cannot survive JSON', () => {
    // `JSON.stringify(undefined)` is `undefined`, not `"undefined"` — and the
    // log line beside the answer calls `.slice()` on it. On the deferred path
    // that throw lands in a `.then` with nothing to catch it, after the call
    // has already been acknowledged.
    // @ts-expect-error a handler must answer with an object of JSON values
    const wrong: ImmediateHandler = () => undefined
    expect(typeof wrong).toBe('function')
  })

  it('takes a plain object answer, which is what every capability returns', () => {
    const fine: ImmediateHandler = () => ({ status: 'ok', hits: [{ said: 'x' }], n: 1 })
    expect(fine({}, stubDeps())).toEqual({ status: 'ok', hits: [{ said: 'x' }], n: 1 })
  })
})
