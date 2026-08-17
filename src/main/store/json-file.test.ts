import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
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

// A third block lived here: "the two stores that share this", four cases
// round-tripping a real `preferences.ts` and a real `persona.ts` through these
// helpers. It was removed with the v2 migration rather than ported, because
// neither store has been migrated yet and a test cannot reach through modules
// that are not here.
//
// It is worth restoring WITH `preferences.ts`, not before it. What it caught
// that the cases above cannot is the helper being correct in isolation while a
// caller passes it something it silently mangles — an integration test whose
// value comes precisely from the two ends being real.
