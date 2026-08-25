import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { DEFAULT_GRANTS, WITHHELD_GRANTS } from '@shared/grants'
import { forgetGrants, hasGrants, migrateGrants, readGrants, writeGrant } from './grants'
import { legacyGrants } from './worn'

/**
 * What each character may do, filed under her id.
 *
 * The per-character assertions are the point. Granting one character the
 * workspace used to grant it to every character on the machine, including any
 * imported afterwards.
 */
let userData = ''

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'mochi-grants-'))
})

afterEach(() => {
  rmSync(userData, { recursive: true, force: true })
})

describe('what she may do while nobody is watching', () => {
  it('allows everything until somebody says otherwise', () => {
    // A companion that arrives unable to hear you is not a safer companion.
    expect(readGrants(userData, 'ada')).toEqual(DEFAULT_GRANTS)
  })

  it('remembers a refusal', () => {
    writeGrant(userData, 'ada', 'ask_workspace', false)
    expect(readGrants(userData, 'ada').ask_workspace).toBe(false)
    expect(readGrants(userData, 'ada').remember_this).toBe(true)
  })

  it('keeps the other refusals when one is changed back', () => {
    writeGrant(userData, 'ada', 'ask_workspace', false)
    writeGrant(userData, 'ada', 'remember_this', false)
    writeGrant(userData, 'ada', 'ask_workspace', true)
    expect(readGrants(userData, 'ada')).toEqual({
      ...DEFAULT_GRANTS,
      ask_workspace: true,
      remember_this: false,
    })
  })
})

describe('one character at a time', () => {
  it('does not grant the workspace to everybody at once', () => {
    // The whole reason this moved out of `preferences.json`.
    writeGrant(userData, 'ada', 'ask_workspace', false)
    expect(readGrants(userData, 'ada').ask_workspace).toBe(false)
    expect(readGrants(userData, 'bob').ask_workspace).toBe(true)
  })

  it('refuses to build a path from something that is not an id', () => {
    // The one place a grammar change letting a separator through would become
    // traversal rather than a lookup failure.
    expect(() => readGrants(userData, '../../etc/passwd')).toThrow(/refusing/)
    expect(() => writeGrant(userData, '..', 'speak_first', false)).toThrow(/refusing/)
  })
})

describe('when the file cannot be read', () => {
  it('withholds everything rather than defaulting to yes', () => {
    mkdirSync(join(userData, 'grants'), { recursive: true })
    writeFileSync(join(userData, 'grants', 'ada.json'), '{not json')
    expect(readGrants(userData, 'ada')).toEqual(WITHHELD_GRANTS)
  })
})

describe('her permissions die with her', () => {
  it('forgets them, so a new character of the same name starts fresh', () => {
    writeGrant(userData, 'ada', 'ask_workspace', false)
    forgetGrants(userData, 'ada')
    expect(readGrants(userData, 'ada')).toEqual(DEFAULT_GRANTS)
  })

  it('is quiet when there was nothing to forget', () => {
    expect(() => forgetGrants(userData, 'ada')).not.toThrow()
  })
})

describe('carrying the one global setting forward', () => {
  it('seeds everybody who existed under it', () => {
    // Without this, upgrading silently revokes every permission on the machine.
    const legacy = { ...DEFAULT_GRANTS, ask_workspace: false }
    expect(migrateGrants(userData, ['ada', 'bob'], legacy)).toEqual(['ada', 'bob'])
    expect(readGrants(userData, 'ada').ask_workspace).toBe(false)
    expect(readGrants(userData, 'bob').ask_workspace).toBe(false)
  })

  it('leaves alone anybody who already chose', () => {
    writeGrant(userData, 'ada', 'ask_workspace', true)
    migrateGrants(userData, ['ada'], { ...DEFAULT_GRANTS, ask_workspace: false })
    expect(readGrants(userData, 'ada').ask_workspace).toBe(true)
  })

  it('seeds nothing when there was no global setting', () => {
    expect(migrateGrants(userData, ['ada'], null)).toEqual([])
    expect(hasGrants(userData, 'ada')).toBe(false)
  })

  it('is safe to run on every launch', () => {
    const legacy = { ...DEFAULT_GRANTS, speak_first: false }
    expect(migrateGrants(userData, ['ada'], legacy)).toEqual(['ada'])
    expect(migrateGrants(userData, ['ada'], legacy)).toEqual([])
  })

  it('reads nothing from a preferences file that is not there', () => {
    expect(legacyGrants(userData)).toEqual(DEFAULT_GRANTS)
  })
})

describe('the failure modes the audit found', () => {
  it('refuses to write one switch over a file it cannot read', () => {
    // Otherwise `readGrants` answers WITHHELD on an unreadable file, and using
    // that as the merge base persists all-withheld — silently discarding every
    // other choice somebody made. The global writer refused for this reason.
    mkdirSync(join(userData, 'grants'), { recursive: true })
    writeFileSync(join(userData, 'grants', 'ada.json'), '{not json')
    expect(() => writeGrant(userData, 'ada', 'speak_first', false)).toThrow(/refusing to rewrite/)
  })

  it('refuses to migrate from a legacy file that is there and unreadable', () => {
    // Seeding is impossible and skipping is permissive, so it says so instead
    // of quietly choosing the worse direction.
    expect(() => migrateGrants(userData, ['ada'], undefined)).toThrow(/cannot be read/)
  })

  it('reports a removal it could not perform, rather than reporting success', () => {
    // `existsSync` answers false for a permission error as readily as for
    // absence, so guarding on it would release the slug and leave the file for
    // whoever gets the name next. Third instance of that shape in this repo.
    writeGrant(userData, 'ada', 'ask_workspace', false)
    const dir = join(userData, 'grants')
    chmodSync(dir, 0o500)
    try {
      expect(() => forgetGrants(userData, 'ada')).toThrow()
    } finally {
      chmodSync(dir, 0o700)
    }
  })
})

describe('an unseeded character is never permissive', () => {
  it('falls back to the global setting when she has no file yet', () => {
    // The hole the second audit found: migration was the only thing standing
    // between an upgrade and DEFAULT_GRANTS, so a migration that threw — or had
    // simply not reached her — handed back every permission somebody withheld.
    const legacy = { ...DEFAULT_GRANTS, ask_workspace: false }
    expect(hasGrants(userData, 'ada')).toBe(false)
    expect(readGrants(userData, 'ada', legacy).ask_workspace).toBe(false)
  })

  it('prefers her own file once she has one', () => {
    writeGrant(userData, 'ada', 'ask_workspace', true)
    const legacy = { ...DEFAULT_GRANTS, ask_workspace: false }
    expect(readGrants(userData, 'ada', legacy).ask_workspace).toBe(true)
  })

  it('still withholds when her file is there and unusable, fallback or not', () => {
    mkdirSync(join(userData, 'grants'), { recursive: true })
    writeFileSync(join(userData, 'grants', 'ada.json'), '{not json')
    expect(readGrants(userData, 'ada', DEFAULT_GRANTS)).toEqual(WITHHELD_GRANTS)
  })
})
