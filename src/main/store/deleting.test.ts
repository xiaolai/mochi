import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { markDeleting, unfinishedDeletions, unmarkDeleting } from './deleting'
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

  it('skips a record whose id is not one, and does not invent a path segment', () => {
    // `id` and `source` are both joined into paths downstream. A traversal
    // sequence in either is the reason they are checked here rather than there.
    const dir = workspace()
    mkdirSync(marksIn(dir), { recursive: true })
    writeFileSync(join(marksIn(dir), 'bad.json'), JSON.stringify({ id: '../..', source: 'ada' }))
    writeFileSync(join(marksIn(dir), 'worse.json'), JSON.stringify({ id: 'ada', source: '../..' }))

    expect(unfinishedDeletions(dir).size).toBe(0)
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
