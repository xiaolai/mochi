import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { leftoverCapabilities, legacyCapabilitiesRoot, MAX_NAMED } from './legacy'

let userData = ''

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'mochi-legacy-'))
})
afterEach(() => {
  rmSync(userData, { recursive: true, force: true })
})

function put(...folders: readonly string[]): void {
  for (const folder of folders) {
    mkdirSync(join(legacyCapabilitiesRoot(userData), folder), { recursive: true })
  }
}

describe('the capabilities folder that used to mean something', () => {
  it('says nothing when there is no folder, which is almost everybody', () => {
    // A person who never made one has not made a mistake, and a warning in
    // front of them would be noise on every launch.
    expect(leftoverCapabilities(userData)).toEqual({ ok: true, folders: [], count: 0 })
  })

  it('says nothing when the folder is there and empty', () => {
    mkdirSync(legacyCapabilitiesRoot(userData), { recursive: true })
    expect(leftoverCapabilities(userData)).toEqual({ ok: true, folders: [], count: 0 })
  })

  it('names what is in it, sorted, so somebody can go and look', () => {
    // The whole reason this survived the deletion: silence about a folder
    // somebody filled on purpose is the "the app ignored my files" failure.
    put('zebra', 'weather')
    expect(leftoverCapabilities(userData)).toEqual({
      ok: true,
      folders: ['weather', 'zebra'],
      count: 2,
    })
  })

  it('counts folders, not the loose files beside them', () => {
    // One folder was one capability. A `.DS_Store` is not somebody's work.
    put('weather')
    writeFileSync(join(legacyCapabilitiesRoot(userData), '.DS_Store'), '')
    expect(leftoverCapabilities(userData)).toEqual({ ok: true, folders: ['weather'], count: 1 })
  })

  it('reports a folder it cannot list, rather than calling it empty', () => {
    // The case where somebody's work is most likely to be sitting there
    // unreachable is exactly the case a blanket catch would have reported as
    // fine. A FILE where the folder should be stands in for any errno that is
    // not ENOENT — it fails the same way and needs no chmod to arrange.
    writeFileSync(legacyCapabilitiesRoot(userData), 'not a directory')
    const found = leftoverCapabilities(userData)
    expect(found.ok).toBe(false)
  })

  it('names at most a handful, and still says how many there are', () => {
    // These go into a message somebody reads. A folder with hundreds in it
    // would otherwise produce a problem note nobody can use, and the count is
    // the part that actually tells them something.
    put(...Array.from({ length: MAX_NAMED + 5 }, (_, n) => `cap-${String(n).padStart(3, '0')}`))
    const found = leftoverCapabilities(userData)
    expect(found.ok).toBe(true)
    if (!found.ok) return
    expect(found.folders).toHaveLength(MAX_NAMED)
    expect(found.count).toBe(MAX_NAMED + 5)
  })

  it('never takes more names than it will use, however large the folder is', () => {
    // Bounded AS IT READS, not sliced afterwards — and observable, which the
    // first version of this test was not. `name` is a GETTER here, so it counts
    // how many names the implementation actually took. A version that mapped
    // every entry and sliced at the end would take a thousand and still return
    // twenty, passing a test that only checked the returned length.
    let read = 0
    let namesTaken = 0
    const reader = {
      readSync: () => {
        if (read >= 1000) return null
        read += 1
        const at = read
        return {
          get name(): string {
            namesTaken += 1
            return `cap-${String(at).padStart(4, '0')}`
          },
          isDirectory: () => true,
        }
      },
      closeSync: () => {},
    }
    const found = leftoverCapabilities(userData, () => reader)
    expect(found.ok).toBe(true)
    if (!found.ok) return
    expect(namesTaken).toBe(MAX_NAMED)
    expect(found.folders).toHaveLength(MAX_NAMED)
    // And it still walked to the end, because the count is the useful part and
    // knowing how many there are means reaching the last one.
    expect(read).toBe(1000)
    expect(found.count).toBe(1000)
  })

  it('gives the handle back even when reading fails part way through', () => {
    // A startup check that leaks a directory handle on every launch is a slower
    // version of the same bug.
    let closed = false
    let read = 0
    const reader = {
      readSync: (): { name: string; isDirectory(): boolean } | null => {
        read += 1
        if (read > 3) throw new Error('the mount went away')
        return { name: `cap-${read}`, isDirectory: () => true }
      },
      closeSync: () => {
        closed = true
      },
    }
    const found = leftoverCapabilities(userData, () => reader)
    // A read that fails PART WAY is a directory whose contents are unknown, and
    // unknown has to mean "say so" rather than "here is what I got first".
    expect(found.ok).toBe(false)
    expect(closed).toBe(true)
  })
})
