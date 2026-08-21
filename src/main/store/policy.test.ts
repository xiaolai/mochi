/**
 * The retention setting, and the two different ways of not having one.
 *
 * The distinction this file is mostly about: a persona nobody has configured
 * takes the app's default and keeps, while a persona whose setting exists and
 * cannot be read keeps NOTHING. Collapsing those two into one answer is how a
 * privacy choice gets resolved in the direction that produces data.
 */

import { mkdtempSync, mkdirSync, writeFileSync, existsSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_POLICY, parsePolicy } from '@shared/policy'
import {
  forgetPolicy,
  hasPolicy,
  markRetentionMigrated,
  policyRoot,
  readPolicy,
  retentionMigrated,
  writePolicy,
} from './policy'

function workspace(): string {
  return mkdtempSync(join(tmpdir(), 'mochi-policy-'))
}

/** Put a file there by hand, the way somebody editing it would. */
function plant(dir: string, id: string, body: string): void {
  mkdirSync(policyRoot(dir), { recursive: true })
  writeFileSync(join(policyRoot(dir), `${id}.json`), body)
}

describe('reading a policy', () => {
  it('takes the app default when nobody has chosen', () => {
    // Keep, and keep indefinitely -- what the app did before the switch
    // existed. Turning it off for everybody who never opened the pane would
    // be a silent data change in the other direction.
    expect(readPolicy(workspace(), 'ada')).toEqual(DEFAULT_POLICY)
    expect(DEFAULT_POLICY.keeps).toBe(true)
  })

  it('keeps nothing when a setting exists and cannot be read', () => {
    // NOT the default. Absent means nobody chose; unreadable means a choice
    // exists and is unavailable, and guessing "keep" there resolves somebody's
    // unreadable preference in the one direction that writes data they may
    // have asked not to have.
    const dir = workspace()
    plant(dir, 'ada', '{ this is not json')
    expect(readPolicy(dir, 'ada').keeps).toBe(false)
  })

  it('keeps nothing when the file holds something that is not a policy', () => {
    const dir = workspace()
    plant(dir, 'ada', JSON.stringify({ keeps: 'yes please' }))
    expect(readPolicy(dir, 'ada').keeps).toBe(false)
  })

  it('reads back what was written', () => {
    const dir = workspace()
    writePolicy(dir, 'ada', { keeps: false })
    expect(readPolicy(dir, 'ada')).toEqual({ keeps: false })
  })

  it('keeps two personas apart', () => {
    // The same boundary memory and transcripts have. "A therapist persona
    // keeps nothing and a tutor keeps everything" is the case made
    // personas plural for, not an edge case.
    const dir = workspace()
    writePolicy(dir, 'ada', { keeps: false })
    writePolicy(dir, 'coach', { keeps: true })
    expect(readPolicy(dir, 'ada').keeps).toBe(false)
    expect(readPolicy(dir, 'coach').keeps).toBe(true)
  })

  it('refuses to turn an id that is not one into a path', () => {
    // This function is where an id becomes a PATH. The grammar admits no
    // separator today, so this is the place a grammar change would turn into
    // traversal rather than a lookup failure.
    expect(() => readPolicy(workspace(), '../escape')).toThrow(/refusing/)
  })
})

describe('what counts as a policy', () => {
  it('accepts the two shapes that mean something', () => {
    expect(parsePolicy({ keeps: true })).toEqual({ keeps: true })
    expect(parsePolicy({ keeps: false })).toEqual({ keeps: false })
  })

  it('IGNORES a stored keepDays rather than refusing the file', () => {
    /*
      Every policy written before the field was removed carries one, and
      `UNREADABLE_POLICY` resolves a refusal as "record nothing" — so refusing
      them would silently stop saving anybody's conversations as a side effect
      of tidying up. An unknown key is not a broken file.

      The field was a number of days to keep, validated here and enforced
      nowhere: `Transcripts.pruneBefore` was its other half and had no caller
      either. See `@shared/policy`.
    */
    for (const days of [7, 0, -1, 1.5, 'seven', null]) {
      expect(parsePolicy({ keeps: true, keepDays: days }), JSON.stringify(days)).toEqual({
        keeps: true,
      })
    }
  })

  it('refuses anything that is not an object carrying the switch', () => {
    for (const value of [null, 42, [], 'off', {}, { keepDays: 7 }]) {
      expect(parsePolicy(value), JSON.stringify(value)).toBeNull()
    }
  })
})

describe('forgetting a policy', () => {
  it('removes it, so a later persona with the same id does not inherit it', () => {
    const dir = workspace()
    writePolicy(dir, 'ada', { keeps: false })
    forgetPolicy(dir, 'ada')
    expect(existsSync(join(policyRoot(dir), 'ada.json'))).toBe(false)
    expect(readPolicy(dir, 'ada')).toEqual(DEFAULT_POLICY)
  })

  it('succeeds for a persona who never opened the pane', () => {
    expect(() => forgetPolicy(workspace(), 'ada')).not.toThrow()
  })
})

describe('whether a setting exists at all', () => {
  it('separates "never chosen" from "chosen", without reading what it says', () => {
    // What the migration needs. Seeding a policy from an old manifest must not
    // overwrite one somebody has since changed, and "what does it say" is the
    // wrong question for that -- an unreadable file is still a choice that
    // exists, and re-seeding over it would silently undo it.
    const dir = workspace()
    expect(hasPolicy(dir, 'ada')).toBe(false)
    writePolicy(dir, 'ada', { keeps: false })
    expect(hasPolicy(dir, 'ada')).toBe(true)
    plant(dir, 'coach', 'not json at all')
    expect(hasPolicy(dir, 'coach')).toBe(true)
  })

  it('calls a file it cannot read EXISTING, not absent', () => {
    // `readBounded` reports absent, oversized, symlinked and permission-denied
    // all as `!ok`. Asking it alone let the migration overwrite a stored
    // opt-out on the grounds that it could not read it -- resolving somebody's
    // unreadable privacy choice by replacing it.
    const dir = workspace()
    mkdirSync(policyRoot(dir), { recursive: true })
    // A symlink, which `readBounded` refuses to follow.
    symlinkSync('/etc/hosts', join(policyRoot(dir), 'ada.json'))
    expect(hasPolicy(dir, 'ada')).toBe(true)
    // And it still refuses to act on what it cannot read.
    expect(readPolicy(dir, 'ada').keeps).toBe(false)
  })
})

describe('the one-time retention migration marker', () => {
  it('counts a marker it cannot read as still marked', () => {
    // Same rule as `hasPolicy`, and the same reason: absent is the only answer
    // that means "this has not happened". A marker that exists and cannot be
    // read, treated as absent, would run the one-time pass again -- and that
    // pass is what stops a package claiming to predate the move from seeding
    // a retention policy.
    const dir = workspace()
    expect(retentionMigrated(dir)).toBe(false)
    mkdirSync(policyRoot(dir), { recursive: true })
    symlinkSync('/etc/hosts', join(policyRoot(dir), '.migrated'))
    expect(retentionMigrated(dir)).toBe(true)
  })

  it('is marked by writing it, and stays marked', () => {
    const dir = workspace()
    markRetentionMigrated(dir)
    expect(retentionMigrated(dir)).toBe(true)
  })
})
