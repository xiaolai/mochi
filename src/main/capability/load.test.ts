import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRegistry } from '@shared/capability/registry'
import { loadCapabilities } from './load'

/** The built-ins that ship, read off disk exactly as they will be in production. */
const BUILTIN_DIR = fileURLToPath(new URL('../../../resources/capabilities', import.meta.url))

/**
 * v1's `TOOLS` array, extracted mechanically from the archived
 * `renderer/companion/audio/configure.ts` rather than retyped.
 */
const GOLDEN = fileURLToPath(
  new URL('../../shared/capability/__fixtures__/v1-tools.json', import.meta.url),
)

let scratch = ''

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'mochi-cap-'))
})

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true })
})

function install(root: string, folder: string, manifest: unknown): void {
  mkdirSync(join(root, folder), { recursive: true })
  writeFileSync(join(root, folder, 'manifest.json'), JSON.stringify(manifest, null, 2))
}

function clipboard(name = 'read_clipboard'): Record<string, unknown> {
  return {
    name,
    description: 'Read what is currently on the clipboard.',
    parameters: {
      type: 'object',
      properties: { format: { type: 'string', description: 'Either text or html.' } },
      required: ['format'],
    },
  }
}

describe('the built-ins on disk', () => {
  it('all load, with nothing reported', () => {
    const { manifests, problems } = loadCapabilities(BUILTIN_DIR)
    expect(problems).toEqual([])
    expect(manifests.map((m) => m.name)).toEqual([
      'ask_workspace',
      'recall_conversations',
      'remember_this',
    ])
  })

  it('produce byte-for-byte the payload v1 sent', () => {
    // THE regression proof. If the manifest route ever changes a description, a
    // parameter name or a required list, the session that ships stops being the
    // session that was verified against the live service — and nothing in any
    // log would say which field did it. Ordering matters here too: these three
    // go on the wire in this order today.
    const { manifests } = loadCapabilities(BUILTIN_DIR)
    const registry = createRegistry(manifests, [])
    const expected: unknown = JSON.parse(readFileSync(GOLDEN, 'utf8'))
    expect(registry.tools).toEqual(expected)
  })
})

describe('loadCapabilities', () => {
  it('accepts a capability nobody wrote code for', () => {
    // The claim, end to end and off a real filesystem: a folder appears, and a
    // new tool is on the wire and dispatchable. No source file in this
    // repository mentions `read_clipboard`.
    install(scratch, 'read_clipboard', clipboard())
    const { manifests, problems } = loadCapabilities(scratch)
    expect(problems).toEqual([])

    const builtin = loadCapabilities(BUILTIN_DIR).manifests
    const registry = createRegistry(builtin, manifests)
    expect(registry.tools.map((tool) => tool.name)).toEqual([
      'ask_workspace',
      'recall_conversations',
      'remember_this',
      'read_clipboard',
    ])
    expect(registry.get('read_clipboard')?.parameters.required).toEqual(['format'])
  })

  it('treats a missing directory as "nothing installed", not as a fault', () => {
    const result = loadCapabilities(join(scratch, 'never-created'))
    expect(result).toEqual({ manifests: [], problems: [] })
  })

  it('names the folder for every kind of broken capability', () => {
    install(scratch, 'not_json', {})
    writeFileSync(join(scratch, 'not_json', 'manifest.json'), '{ this is not json')
    install(scratch, 'bad_shape', { name: 'bad_shape', description: '' })
    install(scratch, 'wrong_folder', clipboard('read_clipboard'))
    mkdirSync(join(scratch, 'empty_folder'), { recursive: true })

    const { manifests, problems } = loadCapabilities(scratch)
    expect(manifests).toEqual([])
    const seen = problems
      .map((problem) => ({ folder: problem.folder, kind: problem.kind }))
      .sort((a, b) => (a.folder < b.folder ? -1 : 1))
    expect(seen).toEqual([
      { folder: 'bad_shape', kind: 'invalid' },
      { folder: 'empty_folder', kind: 'unreadable' },
      { folder: 'not_json', kind: 'not-json' },
      { folder: 'wrong_folder', kind: 'name-mismatch' },
    ])
  })

  it('keeps loading the good ones when one is broken', () => {
    // A single bad folder silently taking out every other capability is the
    // failure that would be blamed on the wrong file.
    install(scratch, 'read_clipboard', clipboard())
    install(scratch, 'broken', { nonsense: true })
    const { manifests, problems } = loadCapabilities(scratch)
    expect(manifests.map((m) => m.name)).toEqual(['read_clipboard'])
    expect(problems).toHaveLength(1)
  })

  it('refuses a manifest larger than the ceiling instead of reading it', () => {
    install(scratch, 'huge', clipboard('huge'))
    writeFileSync(join(scratch, 'huge', 'manifest.json'), 'x'.repeat(64 * 1024 + 1))
    const { problems } = loadCapabilities(scratch)
    expect(problems[0]?.kind).toBe('too-large')
  })

  it('reads folders in a fixed order regardless of creation order', () => {
    install(scratch, 'zulu', clipboard('zulu'))
    install(scratch, 'alpha', clipboard('alpha'))
    expect(loadCapabilities(scratch).manifests.map((m) => m.name)).toEqual(['alpha', 'zulu'])
  })
})
