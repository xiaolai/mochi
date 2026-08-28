import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { isPackageFolder, markDeleting, unfinishedDeletions, unmarkDeleting } from './deleting'
import { personasRoot } from './persona-files'
import { problems } from '../problems'

/**
 * The record that a deletion did not finish, and the two ways of losing one.
 *
 * ## Why these branches are worth a test of their own
 *
 * `unfinishedDeletions` skips a mark it cannot read or cannot parse. Skipping
 * is right — acting on a record we cannot read would delete the wrong
 * persona's data — but the consequence is severe and easy to lose sight of:
 * **that deletion is never resumed.** Somebody asked for their conversations to
 * be removed, the app agreed, and the data is still on disk.
 *
 * So the guarantee these tests hold is not "it skips". It is "it skips AND
 * says so", which is the only version anybody can act on.
 *
 * The lifecycle itself — mark, fail, sweep, release — is covered end to end in
 * `personas.test.ts` against a real store. What was uncovered is the pair of
 * branches that turn a bad file into silence, and they are the branches a
 * refactor is most likely to simplify away.
 */
const roots: string[] = []

function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mochi-deleting-'))
  roots.push(dir)
  return dir
}

/** The marks directory, which is dot-prefixed so the catalogue skips it. */
function marksIn(userData: string): string {
  return join(personasRoot(userData), '.deleting')
}

beforeEach(() => {
  problems.clear()
})

afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('a deletion that did not finish', () => {
  it('is read back by id and source', () => {
    const dir = workspace()
    markDeleting(dir, 'ada', 'ada')
    expect([...unfinishedDeletions(dir)]).toEqual([['ada', 'ada']])
  })

  it('is gone once it is cleared', () => {
    const dir = workspace()
    markDeleting(dir, 'ada', 'ada')
    unmarkDeleting(dir, 'ada')
    expect(unfinishedDeletions(dir).size).toBe(0)
  })

  it('answers empty when nothing has ever been deleted', () => {
    // The ordinary state, and it must cost nothing: no directory, no problem,
    // no log. A missing folder here is not a fault.
    const dir = workspace()
    expect(unfinishedDeletions(dir).size).toBe(0)
    expect(problems.all()).toHaveLength(0)
  })

  it('clearing one that is already gone is not an error', () => {
    // ENOENT only. `unmarkDeleting` runs at the end of every deletion and again
    // on every sweep, so "already gone" is the common case rather than a fault.
    const dir = workspace()
    expect(() => unmarkDeleting(dir, 'never-existed')).not.toThrow()
    expect(problems.all()).toHaveLength(0)
  })
})

describe('a mark nobody can act on is reported, not skipped in silence', () => {
  it('says so when the file will not parse', () => {
    // Half a file is what a crash mid-write leaves. Acting on a guess here
    // would delete a persona nobody named.
    const dir = workspace()
    mkdirSync(marksIn(dir), { recursive: true })
    writeFileSync(join(marksIn(dir), 'ada.json'), '{ half a record')

    expect(unfinishedDeletions(dir).size).toBe(0)
    expect(
      problems
        .all()
        .map((one) => one.detail)
        .join(' '),
    ).toContain('unfinished deletion')
  })

  it('skips a record whose id is not one, and SAYS SO', () => {
    /*
      `id` and `source` are both joined into paths downstream. A traversal
      sequence in either is the reason they are checked here rather than there.

      The id branch was the one silent one of three: the folder branch reported,
      the unparseable branch reported, and an unusable id was dropped without a
      word. It suppresses a deletion permanently — the mark is never removed and
      never acted on — so the record of somebody's request outlives the request
      with nothing to show for it.
    */
    const dir = workspace()
    mkdirSync(marksIn(dir), { recursive: true })
    writeFileSync(join(marksIn(dir), 'bad.json'), JSON.stringify({ id: '../..', source: 'ada' }))
    writeFileSync(join(marksIn(dir), 'worse.json'), JSON.stringify({ id: 'ada', source: '../..' }))
    problems.clear()

    expect(unfinishedDeletions(dir).size).toBe(0)
    const said = problems
      .all()
      .map((one) => one.detail)
      .join(' ')
    expect(said).toContain('unusable character')
    expect(said).toContain('unusable folder')
  })

  it('SAYS SO when the folder is there and cannot be listed', () => {
    /*
      Every `readdirSync` failure answered "no pending deletions". A missing
      folder is the ordinary state and is what that catch was written for; a
      permission or I/O error means the marks ARE there and could not be read,
      and answering "none" silently switches recovery off — every interrupted
      deletion stays interrupted, with data somebody asked to have removed
      sitting on disk and nothing anywhere saying why.
    */
    const dir = workspace()
    markDeleting(dir, 'ada', 'ada')
    problems.clear()
    chmodSync(marksIn(dir), 0o000)
    try {
      expect(unfinishedDeletions(dir).size).toBe(0)
      expect(
        problems
          .all()
          .map((one) => one.detail)
          .join(' '),
      ).toContain('could not be read')
    } finally {
      chmodSync(marksIn(dir), 0o700)
    }
  })

  it('one unreadable record does not take the readable ones with it', () => {
    // The sweep must still finish every deletion it CAN. A bad file that
    // aborted the read would strand every other pending deletion behind it.
    const dir = workspace()
    markDeleting(dir, 'ada', 'ada')
    writeFileSync(join(marksIn(dir), 'broken.json'), 'not json at all')

    expect([...unfinishedDeletions(dir)]).toEqual([['ada', 'ada']])
  })
})

/**
 * The value that would have deleted every persona on the machine.
 *
 * The guard refused `''`, anything with a separator, and `'..'` — and not
 * `'.'`. `join(personasRoot, '.')` IS `personasRoot`, and recovery removes what
 * a mark names recursively, so one corrupted mark took the whole cast.
 *
 * The fix is not `'.'` added to the list. `plan-v2.md` records
 * `agents.override.md` as "blocklist rot that arrived immediately rather than
 * in some future release", and a list of forbidden values is the same shape:
 * nobody can enumerate what is dangerous, and everybody can enumerate what a
 * package folder is.
 */
describe('what a mark may name as a folder', () => {
  it('accepts the shapes a package folder actually has', () => {
    for (const one of ['mochi', 'loki', 'a', 'my-persona', 'my_persona', 'v2.character', 'A1']) {
      expect(isPackageFolder(one), one).toBe(true)
    }
  })

  it('refuses the current directory, which names the personas root itself', () => {
    // The one that mattered. Recovery joins this under `personasRoot` and
    // removes it recursively.
    expect(isPackageFolder('.')).toBe(false)
  })

  it('refuses every other way out of the folder it is joined under', () => {
    for (const one of ['..', './x', '../x', 'a/b', 'a\\b', '/etc', '~', '']) {
      expect(isPackageFolder(one), JSON.stringify(one)).toBe(false)
    }
  })

  it('refuses a hidden name, which no folder this app makes ever is', () => {
    // Falls out of "starts with a letter or a digit" rather than being its own
    // rule — which is the point of an allowlist.
    for (const one of ['.hidden', '.git', '.DS_Store']) {
      expect(isPackageFolder(one), one).toBe(false)
    }
  })

  it('refuses anything that is not a string', () => {
    for (const one of [null, undefined, 7, {}, ['mochi']]) {
      expect(isPackageFolder(one), JSON.stringify(one) ?? 'undefined').toBe(false)
    }
  })

  it('refuses a name too long to be a path component', () => {
    expect(isPackageFolder('a'.repeat(64))).toBe(true)
    expect(isPackageFolder('a'.repeat(65))).toBe(false)
  })

  it('refuses a name carrying a NUL, which truncates a path in the kernel', () => {
    expect(isPackageFolder('mochi\u0000/etc')).toBe(false)
  })
})

describe('writing a mark', () => {
  it('refuses an unusable folder at the WRITE, not only on the way back', () => {
    /*
      The reader cannot tell a value this store wrote from one somebody typed
      into the file, so the write is where an unusable value should fail —
      loudly, beside the caller that produced it.
    */
    const home = mkdtempSync(join(tmpdir(), 'mochi-marks-'))
    expect(() => {
      markDeleting(home, 'ada', '.')
    }).toThrow(/unusable folder/)
    expect(() => {
      markDeleting(home, 'ada', '../elsewhere')
    }).toThrow(/unusable folder/)
    rmSync(home, { recursive: true, force: true })
  })

  it('refuses an unusable id too', () => {
    const home = mkdtempSync(join(tmpdir(), 'mochi-marks-'))
    expect(() => {
      markDeleting(home, '../ada', 'ada')
    }).toThrow(/unusable persona id/)
    rmSync(home, { recursive: true, force: true })
  })
})
