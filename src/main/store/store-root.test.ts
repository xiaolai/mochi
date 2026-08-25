import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { forgetVerifiedRoots, storeRoot } from './store-root'

/**
 * The directory check every store was missing.
 *
 * Per-FILE defences were already good — a symlinked file is reported rather
 * than followed, and an id that fails the persona grammar never becomes a path.
 * Nothing looked at the directory, so redirecting one moved every read and
 * write in that store while every per-file check went on passing.
 */
let userData = ''

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'mochi-root-'))
  forgetVerifiedRoots()
})

afterEach(() => {
  rmSync(userData, { recursive: true, force: true })
})

describe('a store directory', () => {
  it('is fine when it is an ordinary directory', () => {
    mkdirSync(join(userData, 'grants'))
    expect(storeRoot(userData, 'grants')).toBe(join(userData, 'grants'))
  })

  it('is fine when it does not exist yet', () => {
    // A store nobody has written to has no directory, and creating it is the
    // ordinary path. Absent is the one answer safe to accept.
    expect(storeRoot(userData, 'grants')).toBe(join(userData, 'grants'))
  })

  it('is refused when it is a symbolic link', () => {
    const elsewhere = mkdtempSync(join(tmpdir(), 'mochi-elsewhere-'))
    try {
      symlinkSync(elsewhere, join(userData, 'grants'))
      expect(() => storeRoot(userData, 'grants')).toThrow(/symbolic link/)
    } finally {
      rmSync(elsewhere, { recursive: true, force: true })
    }
  })

  it('is refused when it is a file', () => {
    writeFileSync(join(userData, 'grants'), 'not a directory')
    expect(() => storeRoot(userData, 'grants')).toThrow(/not a directory/)
  })

  it('does not remember an absent one, so it sees what is created next', () => {
    expect(storeRoot(userData, 'grants')).toBeTruthy()
    const elsewhere = mkdtempSync(join(tmpdir(), 'mochi-elsewhere-'))
    try {
      symlinkSync(elsewhere, join(userData, 'grants'))
      expect(() => storeRoot(userData, 'grants')).toThrow(/symbolic link/)
    } finally {
      rmSync(elsewhere, { recursive: true, force: true })
    }
  })
})
