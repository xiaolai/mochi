import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
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

/**
 * `realpathSync` on the expected side, deliberately.
 *
 * `storeRoot` resolves the root before joining — it checks the chain ABOVE the
 * store, not only the leaf, and `lstat` on the leaf says nothing about the
 * components before it. On macOS `/var` is a symlink to `/private/var`, so a
 * temp directory makes that resolution visible where a real
 * `Application Support` path would not.
 *
 * These assert the property (the named store under the given root, canonically)
 * rather than the literal `join` they used to, which was an implementation
 * detail that happened to hold while nothing resolved.
 */
describe('a store directory', () => {
  it('is fine when it is an ordinary directory', () => {
    mkdirSync(join(userData, 'grants'))
    expect(storeRoot(userData, 'grants')).toBe(join(realpathSync(userData), 'grants'))
  })

  it('is fine when it does not exist yet', () => {
    // A store nobody has written to has no directory, and creating it is the
    // ordinary path. Absent is the one answer safe to accept.
    expect(storeRoot(userData, 'grants')).toBe(join(realpathSync(userData), 'grants'))
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

describe('a symlink ABOVE the store', () => {
  /**
   * Every check in `storeRoot` was on `userData/name`. None said anything
   * about `userData` itself, or any component of it — and `lstat` on the leaf
   * is exactly the wrong tool for that question: it refuses to follow the last
   * link and is silent about the ones before it.
   *
   * So a symlinked ancestor passed, and the guard reported on a directory it
   * had never looked at.
   */
  it('is followed deliberately rather than passing unseen', () => {
    const real = mkdtempSync(join(tmpdir(), 'mochi-real-'))
    const link = join(mkdtempSync(join(tmpdir(), 'mochi-link-')), 'userData')
    symlinkSync(real, link, 'dir')
    forgetVerifiedRoots()

    // The store is reported at its CANONICAL location, not through the link.
    const got = storeRoot(link, 'grants')
    expect(got).toBe(join(realpathSync(real), 'grants'))
    expect(got.startsWith(realpathSync(real))).toBe(true)
  })

  it('gives one answer for two aliases of the same directory', () => {
    /*
      Why this matters beyond tidiness.

      The registry's claim is "one connection per file". A lexical key cannot
      make it: two symlinked aliases produce two different strings for one
      directory, both pass a `has` check, and the second connection meets a
      `busy_timeout` of 0. `transcripts.ts` says exactly this about its own
      path; resolving here makes it true for every other store too.
    */
    const real = mkdtempSync(join(tmpdir(), 'mochi-alias-'))
    const link = join(mkdtempSync(join(tmpdir(), 'mochi-alias-link-')), 'alias')
    symlinkSync(real, link, 'dir')
    forgetVerifiedRoots()

    expect(storeRoot(link, 'grants')).toBe(storeRoot(real, 'grants'))
  })
})
