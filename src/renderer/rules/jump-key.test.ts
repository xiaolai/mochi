import { describe, expect, it } from 'vitest'

import { opensJump, type Pressed } from './jump-key'

/**
 * The combination that opens "find a setting", and the ones that must not.
 *
 * Every case below is one the shipped predicate got wrong. It read
 * `event.metaKey || event.ctrlKey` on every platform, so on macOS it fired on
 * `Control+K` — kill-to-end-of-line, which every native text field honours —
 * and called `preventDefault` on it, inside the thirty prompt editors this
 * feature was built to reach.
 */

function pressed(over: Partial<Pressed> = {}): Pressed {
  return {
    key: 'k',
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    repeat: false,
    ...over,
  }
}

describe('on macOS', () => {
  const mac = 'darwin'

  it('opens on Command+K', () => {
    expect(opensJump(pressed({ metaKey: true }), mac)).toBe(true)
  })

  it('does NOT open on Control+K, which is kill-to-end-of-line', () => {
    /*
      THE BUG THIS FILE EXISTS FOR.

      `Control+K` deletes to the end of the line in every macOS text field, and
      the listener calls `preventDefault` — so the panel did not merely open by
      mistake, it ate an editing command inside the prompt editors.
    */
    expect(opensJump(pressed({ ctrlKey: true }), mac)).toBe(false)
  })

  it('does not open when both modifiers are down', () => {
    // A shortcut that fires on a superset of itself cannot be avoided by
    // adding a modifier, which is what somebody with a conflicting binding does.
    expect(opensJump(pressed({ metaKey: true, ctrlKey: true }), mac)).toBe(false)
  })

  it('does not open on Shift+Command+K, which is a different binding', () => {
    expect(opensJump(pressed({ metaKey: true, shiftKey: true }), mac)).toBe(false)
  })

  it('does not open on Option+Command+K', () => {
    expect(opensJump(pressed({ metaKey: true, altKey: true }), mac)).toBe(false)
  })
})

describe('off macOS', () => {
  const win = 'win32'

  it('opens on Control+K, which is the convention there', () => {
    expect(opensJump(pressed({ ctrlKey: true }), win)).toBe(true)
  })

  it('does not open on the Windows key, which is not a shortcut modifier', () => {
    expect(opensJump(pressed({ metaKey: true }), win)).toBe(false)
  })

  it('treats linux like windows', () => {
    expect(opensJump(pressed({ ctrlKey: true }), 'linux')).toBe(true)
    expect(opensJump(pressed({ metaKey: true }), 'linux')).toBe(false)
  })
})

describe('what it refuses whatever the platform', () => {
  it('ignores every other letter', () => {
    expect(opensJump(pressed({ key: 'j', metaKey: true }), 'darwin')).toBe(false)
  })

  it('takes the letter in either case, so caps lock still opens it', () => {
    expect(opensJump(pressed({ key: 'K', metaKey: true }), 'darwin')).toBe(true)
  })

  it('ignores a bare K, which is a character somebody is typing', () => {
    expect(opensJump(pressed(), 'darwin')).toBe(false)
  })

  it('ignores a held key', () => {
    expect(opensJump(pressed({ metaKey: true, repeat: true }), 'darwin')).toBe(false)
  })

  it('answers no while the platform is still unknown', () => {
    /*
      The SAFE direction, and the reason it is safe: opening on the wrong
      modifier steals a key that belongs to the text field under the cursor,
      and not opening costs one keystroke. The window reads the settings at
      startup, so this state lasts only until its first read lands.
    */
    expect(opensJump(pressed({ metaKey: true }), null)).toBe(false)
    expect(opensJump(pressed({ ctrlKey: true }), null)).toBe(false)
  })
})
