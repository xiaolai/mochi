import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createRegistry } from '@shared/capability/registry'
import { parseManifest } from '@shared/capability/manifest'
import { CAPABILITIES_DIR, discoverInstalled, installedRoot } from './installed'

function aFolder(): string {
  return mkdtempSync(join(tmpdir(), 'mochi-installed-'))
}

function install(userData: string, name: string, body: unknown): void {
  const dir = join(userData, CAPABILITIES_DIR, name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(body))
}

const GOOD = (name: string) => ({
  name,
  description: 'Does a thing somebody wanted.',
  parameters: {
    type: 'object',
    properties: { what: { type: 'string', description: 'What to do.' } },
    required: ['what'],
  },
})

describe('finding what somebody installed', () => {
  it('says where to look, whether or not anything is there', () => {
    const userData = aFolder()
    expect(installedRoot(userData)).toBe(join(userData, 'capabilities'))
    expect(discoverInstalled(userData).root).toBe(installedRoot(userData))
  })

  it('reports nothing when the folder does not exist', () => {
    // Not an error. Somebody with no capabilities installed has not made a
    // mistake, and a warning here would train them to ignore the surface that
    // real problems appear on.
    const found = discoverInstalled(aFolder())
    expect(found.manifests).toEqual([])
    expect(found.problems).toEqual([])
  })

  it('names what is there', () => {
    const userData = aFolder()
    install(userData, 'weather', GOOD('weather'))
    expect(discoverInstalled(userData).manifests.map((m) => m.name)).toEqual(['weather'])
  })

  it('names a broken folder rather than skipping it', () => {
    // "One of your capabilities failed" is the message that makes somebody go
    // and look. Silence makes them think the app ignored the folder.
    const userData = aFolder()
    mkdirSync(join(userData, CAPABILITIES_DIR, 'broken'), { recursive: true })
    writeFileSync(join(userData, CAPABILITIES_DIR, 'broken', 'manifest.json'), '{ not json')
    const found = discoverInstalled(userData)
    expect(found.problems.map((p) => p.folder)).toEqual(['broken'])
  })
})

describe('found is not the same as offered', () => {
  const parsed = parseManifest(GOOD('weather'))
  // The fixture is validated rather than cast: a hand-built object that the
  // real parser would reject would make every assertion below vacuous.
  if (!parsed.ok) throw new Error(`the fixture itself is invalid: ${parsed.problem.kind}`)
  const installedManifests = [parsed.manifest]

  it('keeps an installed capability out of session.tools', () => {
    // The whole of W2's first step. Not "we decline to call it" — she is never
    // told it exists, because a capability she offers and cannot perform is
    // worse than one she has never heard of.
    const registry = createRegistry([], installedManifests)
    expect(registry.tools).toEqual([])
    expect(registry.refused.map((r) => r.problem.kind)).toEqual(['execution-unavailable'])
  })

  it('does not answer to its name either', () => {
    const registry = createRegistry([], installedManifests)
    expect(registry.has('weather')).toBe(false)
    expect(registry.get('weather')).toBeNull()
  })

  it('refuses by DEFAULT, so nobody has to remember to say no', () => {
    // The argument that would let it run has to be written down at the call
    // site. A default that widens authority is the wrong direction for a
    // default to fail in — the preload already made that mistake once.
    expect(createRegistry([], installedManifests).tools).toEqual([])
    expect(createRegistry([], installedManifests, true).tools.map((t) => t.name)).toEqual([
      'weather',
    ])
  })

  it('refuses for THIS reason, not because the name collided', () => {
    // A capability with a perfectly good unique name is still refused, and the
    // reason it carries is the one that will be lifted when a sandbox exists.
    const registry = createRegistry([], installedManifests)
    expect(registry.refused[0]?.problem).toEqual({
      kind: 'execution-unavailable',
      name: 'weather',
    })
  })
})
