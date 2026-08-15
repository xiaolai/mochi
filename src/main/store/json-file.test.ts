import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_DELEGATION } from '@shared/delegation'
import { DEFAULT_SHORTCUTS } from '@shared/shortcuts'
import { DEFAULT_SOUND } from '@shared/sound'
import { DEFAULT_IDLE_MS } from '@shared/companion'
import { readJsonFile, writeJsonAtomically } from './json-file'

// Real files, not a mocked filesystem. Everything this module exists for is a
// property of an actual write — that a rename replaces atomically, that a
// permission error is distinguishable from an absent file — and a mock would
// only confirm the mock.
const dirs: string[] = []
function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mochi-json-'))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe('writeJsonAtomically', () => {
  it('writes a file that reads back as the same value', () => {
    const path = join(workspace(), 'thing.json')
    writeJsonAtomically(path, { sizePercent: 94 })
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ sizePercent: 94 })
  })

  it('creates the directory it was pointed into', () => {
    const path = join(workspace(), 'nested', 'deeper', 'thing.json')
    writeJsonAtomically(path, { ok: true })
    expect(existsSync(path)).toBe(true)
  })

  it('leaves no temporary file behind', () => {
    // The rename is what makes this atomic. A leftover `.tmp` means the rename
    // did not happen and the live file is whatever was there before.
    const dir = workspace()
    const path = join(dir, 'thing.json')
    writeJsonAtomically(path, { a: 1 })
    expect(existsSync(`${path}.tmp`)).toBe(false)
  })

  it('replaces an existing file rather than appending to it', () => {
    const path = join(workspace(), 'thing.json')
    writeJsonAtomically(path, { first: true })
    writeJsonAtomically(path, { second: true })
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ second: true })
  })
})

describe('readJsonFile', () => {
  it('reports a missing file as absent, which is nobody’s problem', () => {
    const result = readJsonFile(join(workspace(), 'nope.json'))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.problem.kind).toBe('absent')
  })

  it('distinguishes malformed from absent', () => {
    // The distinction the callers are built on. Collapsing the two is how a
    // corrupt file presents as "you have not customised anything", and the next
    // save writes straight over it.
    const path = join(workspace(), 'broken.json')
    writeFileSync(path, '{ not json')
    const result = readJsonFile(path)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.problem.kind).toBe('malformed')
  })

  it('distinguishes unreadable from absent', () => {
    // A directory where a file should be. ENOTDIR/EISDIR is not ENOENT, and
    // saying "you have no preferences" about a path that cannot be read leaves
    // somebody watching their settings reset with nothing to point at.
    const dir = workspace()
    mkdirSync(join(dir, 'itsafolder'))
    const result = readJsonFile(join(dir, 'itsafolder'))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.problem.kind).toBe('unreadable')
  })

  it('returns the parsed value when the file is good', () => {
    const path = join(workspace(), 'good.json')
    writeJsonAtomically(path, { sizePercent: 120 })
    const result = readJsonFile(path)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toEqual({ sizePercent: 120 })
  })
})

describe('the two stores that share this', () => {
  it('round-trips preferences, and reports a file it cannot read', async () => {
    const { DEFAULT_PREFERENCES, loadPreferences, savePreferences } = await import('./preferences')
    const dir = workspace()
    expect(loadPreferences(dir)).toEqual({
      preferences: DEFAULT_PREFERENCES,
      problem: null,
      // No file at all: this installation has never run. The retention
      // migration reads this to decide it has nothing to carry across.
      ranBefore: false,
      // Nothing on disk to protect, so nothing to move aside. A fresh install
      // must not quarantine a file that does not exist.
      unusableFile: false,
    })

    savePreferences(dir, {
      sizePercent: 150,
      shortcuts: DEFAULT_SHORTCUTS,
      credentialSource: 'codex',
      sound: DEFAULT_SOUND,
      idleMs: DEFAULT_IDLE_MS,
      activePersonaId: null,
      delegation: DEFAULT_DELEGATION,
      spokenRules: null,
    })
    expect(loadPreferences(dir).preferences.sizePercent).toBe(150)

    writeFileSync(join(dir, 'preferences.json'), 'not json at all')
    const broken = loadPreferences(dir)
    // Still starts, still uses the defaults -- and now SAYS so, which is the
    // whole change. The blanket catch made this indistinguishable from a fresh
    // machine.
    expect(broken.preferences).toEqual(DEFAULT_PREFERENCES)
    expect(broken.problem).not.toBeNull()
  })

  it('clamps a stored size rather than rejecting it', async () => {
    const { loadPreferences } = await import('./preferences')
    const dir = workspace()
    writeFileSync(join(dir, 'preferences.json'), JSON.stringify({ sizePercent: 5000 }))
    const loaded = loadPreferences(dir)
    expect(loaded.problem).toBeNull()
    expect(loaded.preferences.sizePercent).toBeLessThanOrEqual(200)
  })

  it('round-trips a persona through the same helper', async () => {
    const { loadPersona, savePersona } = await import('./persona')
    const { DEFAULT_PERSONA } = await import('@shared/persona')
    const dir = workspace()
    expect(loadPersona(dir)).toEqual({ persona: DEFAULT_PERSONA, problem: null })

    const mine = { ...DEFAULT_PERSONA, name: 'Ada' }
    savePersona(dir, mine)
    expect(loadPersona(dir)).toEqual({ persona: mine, problem: null })
  })

  it('reports a persona that does not validate, and falls back', async () => {
    const { loadPersona } = await import('./persona')
    const { DEFAULT_PERSONA } = await import('@shared/persona')
    const dir = workspace()
    writeFileSync(join(dir, 'persona.json'), JSON.stringify({ name: 'half a persona' }))
    const loaded = loadPersona(dir)
    expect(loaded.persona).toEqual(DEFAULT_PERSONA)
    expect(loaded.problem).not.toBeNull()
  })
})
