/**
 * What `readBounded` refuses, and how honest its guarantee is.
 *
 * Memory reaches a system prompt, so a symlink at `memory/<id>.json` would
 * send whatever it points at to a model. The id grammar makes the STRING safe;
 * it says nothing about what the filesystem does with a valid one.
 */

import { mkdtempSync, symlinkSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MAX_FILE_BYTES, readBounded } from './read-bounded'

const workspace = (): string => mkdtempSync(join(tmpdir(), 'mochi-bounded-'))

describe('readBounded', () => {
  it('reads an ordinary file', () => {
    const dir = workspace()
    writeFileSync(join(dir, 'a.json'), '{"notes":"hi"}')
    const read = readBounded(join(dir, 'a.json'))
    expect(read.ok && read.text).toBe('{"notes":"hi"}')
  })

  it('says absent rather than failing, for a file that is not there', () => {
    const read = readBounded(join(workspace(), 'nope.json'))
    expect(read.ok).toBe(false)
    if (!read.ok) expect(read.reason.kind).toBe('absent')
  })

  it('refuses to follow a symlink', () => {
    const dir = workspace()
    const secret = join(dir, 'secret.json')
    writeFileSync(secret, '{"notes":"private"}')
    mkdirSync(join(dir, 'memory'))
    symlinkSync(secret, join(dir, 'memory', 'tutor.json'))

    const read = readBounded(join(dir, 'memory', 'tutor.json'))
    // `readFileSync` alone would have followed this and put the target's
    // contents into a system prompt.
    expect(read.ok).toBe(false)
    if (!read.ok) expect(read.reason.kind).toBe('not-a-file')
  })

  it('refuses a directory', () => {
    const dir = workspace()
    mkdirSync(join(dir, 'folder.json'))
    const read = readBounded(join(dir, 'folder.json'))
    expect(read.ok).toBe(false)
    if (!read.ok) expect(read.reason.kind).toBe('not-a-file')
  })

  it('refuses a file past the ceiling, without reading it', () => {
    const dir = workspace()
    writeFileSync(join(dir, 'big.json'), 'x'.repeat(MAX_FILE_BYTES + 1))
    const read = readBounded(join(dir, 'big.json'))
    expect(read.ok).toBe(false)
    if (!read.ok) {
      expect(read.reason.kind).toBe('too-large')
      // The SIZE is named, so a log line says what happened rather than that
      // something did.
      if (read.reason.kind === 'too-large') {
        expect(read.reason.bytes).toBeGreaterThan(MAX_FILE_BYTES)
      }
    }
  })

  it('honours a caller-supplied limit', () => {
    const dir = workspace()
    writeFileSync(join(dir, 'a.json'), 'x'.repeat(100))
    expect(readBounded(join(dir, 'a.json'), 50).ok).toBe(false)
    expect(readBounded(join(dir, 'a.json'), 200).ok).toBe(true)
  })
})
