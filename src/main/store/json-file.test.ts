import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { writeJsonAtomically } from './json-file'
import { readWebSearch, readWorkspace, writeWebSearch, writeWorkspace } from './worn'

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
// round-tripping a real preferences store and a real persona store through
// these helpers. It was removed with the v2 migration rather than ported,
// because at the time neither store had been migrated and a test cannot reach
// through modules that are not here.
//
// **That blocker is gone and the block is restored below.** `store/worn.ts` is
// the preferences store now — it was `preferences.ts` when the note above was
// written, which is why the note pointed at a filename nobody can open — and it
// writes through `writeJsonAtomically`. What this catches, and the cases above
// cannot, is the helper being correct in isolation while a caller hands it
// something it silently mangles: the value comes precisely from both ends being
// real.

describe('the store that shares this, with both ends real', () => {
  let userData: string

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'mochi-jsonfile-both-ends-'))
  })
  afterEach(() => {
    rmSync(userData, { recursive: true, force: true })
  })

  it('round-trips a preference through the real writer and the real reader', () => {
    // Neither end is a stub: `writeWorkspace` writes through
    // `writeJsonAtomically` and `readWorkspace` reads through `readBounded`.
    writeWorkspace(userData, '/somewhere/a person picked')
    expect(readWorkspace(userData)).toBe('/somewhere/a person picked')
  })

  it('leaves the other keys alone when one is written', () => {
    // The merge is the part an isolated helper test cannot see: each writer
    // read-modify-writes the same file, so a helper that replaced rather than
    // merged would pass every case above and silently drop a setting here.
    writeWorkspace(userData, '/first')
    writeWebSearch(userData, 'live')
    expect(readWorkspace(userData)).toBe('/first')
    expect(readWebSearch(userData)).toBe('live')
  })

  it('survives text the helper could mangle on the way through', () => {
    /*
      What this block exists for, in the words of the note above: the helper
      being correct in isolation while a caller hands it something it silently
      mangles. Newlines, quotes, a backslash and an astral character all have to
      come back as themselves through JSON and the atomic rename.
    */
    const awkward = '/tmp/a "quoted"\\path\nwith a newline and \u{1F642}'
    writeWorkspace(userData, awkward)
    expect(readWorkspace(userData)).toBe(awkward)
  })

  it('writes a file that is valid JSON on disk, not merely readable back', () => {
    // Round-tripping through one implementation would pass even if it wrote
    // something only it could read. The file is parsed independently here.
    writeWorkspace(userData, '/checked')
    const raw = readFileSync(join(userData, 'preferences.json'), 'utf8')
    expect(JSON.parse(raw)).toMatchObject({ workspace: '/checked' })
  })
})
