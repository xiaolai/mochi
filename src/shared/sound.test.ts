/**
 * Reading a sound block somebody else wrote.
 *
 * Every field arrives from disk as `unknown`, and the three of them are read
 * INDEPENDENTLY on purpose: a file written before this existed has none of
 * them, and a file with one fumbled line must keep the other two.
 */

import { describe, expect, it } from 'vitest'
import { DEFAULT_SOUND, EAGERNESS, isEagerness, mergeSound, readSound } from './sound'

describe('reading the stored sound block', () => {
  it('takes the defaults when there is nothing to read', () => {
    // Every shape a JSON file can be while not being an object. `null`, `[]`
    // and `7` all parse, and each one used to be a different way to crash a
    // reader that assumed a record.
    for (const value of [undefined, null, [], 7, 'sound']) {
      expect(readSound(value), JSON.stringify(value ?? null)).toEqual(DEFAULT_SOUND)
    }
  })

  it('keeps the fields it understands and defaults the rest', () => {
    expect(readSound({ listening: 'earphones' })).toEqual({
      ...DEFAULT_SOUND,
      listening: 'earphones',
    })
    expect(readSound({ eagerness: 'low' })).toEqual({ ...DEFAULT_SOUND, eagerness: 'low' })
  })

  it('does not let one wrong field reset the others', () => {
    // Per FIELD, like the rest of the preferences. Somebody hand-editing this
    // file and mistyping one value should lose that value, not the block.
    const read = readSound({ listening: 'earphones', echoCancellation: 'yes', eagerness: 42 })
    expect(read.listening).toBe('earphones')
    expect(read.echoCancellation).toBe(DEFAULT_SOUND.echoCancellation)
    expect(read.eagerness).toBe(DEFAULT_SOUND.eagerness)
  })

  it('works it out rather than asking', () => {
    // The DEFAULT is the interesting part. A setting somebody must change
    // every time they plug earphones in is a setting nobody maintains, so the
    // shipped answer is the measured one and the two manual answers exist only
    // because a measurement can be wrong.
    expect(DEFAULT_SOUND.listening).toBe('auto')
    // And the canceller is on, which is half of why this shell is Electron.
    expect(DEFAULT_SOUND.echoCancellation).toBe(true)
  })

  it('accepts every eagerness it offers, and nothing else', () => {
    for (const value of EAGERNESS) expect(isEagerness(value), value).toBe(true)
    for (const value of ['', 'eager', 'LOW', 0, null]) expect(isEagerness(value)).toBe(false)
  })
})

/**
 * An IPC message is not a file.
 *
 * `readSound` reads a document that describes the whole block, so absent means
 * "use the default". A message from the settings window carries the ONE field
 * somebody just changed, so absent means "leave it" — and reading it the file
 * way reset everything it did not mention while reporting success.
 */
describe('merging a partial message onto what is stored', () => {
  const stored = { listening: 'earphones', echoCancellation: false, eagerness: 'low' } as const

  it('leaves out what the message does not mention', () => {
    expect(mergeSound(stored, { eagerness: 'high' })).toEqual({ ...stored, eagerness: 'high' })
  })

  it('changes nothing at all for an empty message', () => {
    expect(mergeSound(stored, {})).toEqual(stored)
  })

  /** The renderer is the least trusted process here. */
  it('contributes no fields for a message that is not an object', () => {
    for (const value of [null, undefined, 42, 'hello', ['listening']]) {
      expect(mergeSound(stored, value), JSON.stringify(value ?? null)).toEqual(stored)
    }
  })

  /**
   * Present-but-invalid is still `readSound`'s judgement: the message DID
   * mention the field, so falling back to the default is a decision about a
   * value somebody sent rather than about one they did not.
   */
  it('falls back to the default for a field that is present and wrong', () => {
    expect(mergeSound(stored, { eagerness: 42 }).eagerness).toBe(DEFAULT_SOUND.eagerness)
    // And its neighbours are untouched.
    expect(mergeSound(stored, { eagerness: 42 }).listening).toBe('earphones')
  })
})
