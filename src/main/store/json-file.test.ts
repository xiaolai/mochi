import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { writeJsonAtomically } from './json-file'

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

// `readJsonFile`'s block lived here — five cases distinguishing absent,
// unreadable, malformed and ok. It went with the function, which every store
// had already stopped calling in favour of `readBounded`. The cases were
// correct; there was nothing left for them to be correct about.

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
