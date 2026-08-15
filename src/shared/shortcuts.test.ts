import { describe, expect, it } from 'vitest'
import { chordFromEvent, toAccelerator, type KeyEvent } from './accelerator'
import { DEFAULT_SHORTCUTS, SHORTCUT_IDS, chordsOf, collides, readShortcuts } from './shortcuts'

const press = (over: Partial<KeyEvent> = {}): KeyEvent => ({
  code: 'KeyM',
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ...over,
})

describe('recording a chord from a keypress', () => {
  it('reads the physical key, not the character the layout produced', () => {
    // `code` rather than `key`, and this is the whole reason: Electron matches
    // an accelerator against the physical key, while `key` is whatever the
    // layout made — Option+letter on a Mac produces an entirely different
    // character, and a German layout swaps Y and Z. Recording `key` would bind
    // something other than what the user pressed.
    expect(toAccelerator(chordFromEvent(press({ ctrlKey: true, shiftKey: true }), 'darwin')!)).toBe(
      'Control+Shift+M',
    )
    expect(toAccelerator(chordFromEvent(press({ code: 'Digit1', altKey: true }), 'darwin')!)).toBe(
      'Alt+1',
    )
    expect(toAccelerator(chordFromEvent(press({ code: 'Space', ctrlKey: true }), 'darwin')!)).toBe(
      'Control+Space',
    )
    expect(toAccelerator(chordFromEvent(press({ code: 'F5', ctrlKey: true }), 'darwin')!)).toBe(
      'Control+F5',
    )
  })

  it('translates the DOM’s names into Electron’s', () => {
    // `Enter` and `ArrowUp` are what the browser calls them; Electron wants
    // `Return` and `Up`. Getting this wrong produces an accelerator that
    // parses, registers, and never fires.
    expect(toAccelerator(chordFromEvent(press({ code: 'Enter', ctrlKey: true }), 'darwin')!)).toBe(
      'Control+Return',
    )
    expect(
      toAccelerator(chordFromEvent(press({ code: 'ArrowUp', ctrlKey: true }), 'darwin')!),
    ).toBe('Control+Up')
  })

  it('waits while only modifiers are held', () => {
    // The ordinary state halfway through pressing a chord. Treating it as a
    // failed attempt would make the recorder reject the first half of every
    // combination anybody types.
    for (const code of ['ShiftLeft', 'ControlRight', 'AltLeft', 'MetaLeft']) {
      expect(
        chordFromEvent(press({ code, ctrlKey: true, shiftKey: true }), 'darwin'),
        code,
      ).toBeNull()
    }
  })

  it('refuses a key with no modifier at all', () => {
    // It would register, and take that letter from every application on the
    // machine.
    expect(chordFromEvent(press(), 'darwin')).toBeNull()
    expect(chordFromEvent(press({ code: 'F5' }), 'darwin')).toBeNull()
  })

  it('reads the meta key as the key that was actually pressed', () => {
    // This used to map `metaKey` to `CommandOrControl` on every platform, with
    // a comment claiming that token "means the right thing on both". It does
    // not: `CommandOrControl` is Command on macOS and CONTROL everywhere else.
    // So a Windows user pressing Super+M had Control+M registered -- a chord
    // they never asked for, on a modifier they never touched.
    expect(toAccelerator(chordFromEvent(press({ metaKey: true }), 'darwin')!)).toBe(
      'CommandOrControl+M',
    )
    for (const platform of ['win32', 'linux']) {
      expect(toAccelerator(chordFromEvent(press({ metaKey: true }), platform)!), platform).toBe(
        'Super+M',
      )
    }
  })
})

describe('reading a stored set', () => {
  it('falls back per action, not all at once', () => {
    // One fumbled line in a hand-edited file must not reset the other binding.
    const { shortcuts, problems } = readShortcuts({
      toggleVisible: 'Control+Alt+J',
      toggleAwake: 'nonsense',
    })
    expect(shortcuts.toggleVisible).toBe('Control+Alt+J')
    expect(shortcuts.toggleAwake).toBe(DEFAULT_SHORTCUTS.toggleAwake)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('toggleAwake')
  })

  it('takes the defaults for anything absent, quietly', () => {
    // A file written before an action existed is the ordinary upgrade case, not
    // a problem worth reporting.
    const { shortcuts, problems } = readShortcuts({})
    expect(shortcuts).toEqual(DEFAULT_SHORTCUTS)
    expect(problems).toEqual([])
  })

  it('survives anything that is not an object', () => {
    for (const value of [null, undefined, 42, 'Control+M', []]) {
      expect(readShortcuts(value).shortcuts, JSON.stringify(value)).toEqual(DEFAULT_SHORTCUTS)
    }
  })

  it('normalises what it stores, so two spellings become one', () => {
    const { shortcuts } = readShortcuts({ toggleVisible: 'shift+ctrl+m' })
    expect(shortcuts.toggleVisible).toBe('Control+Shift+M')
    expect(shortcuts.toggleVisible).toBe(DEFAULT_SHORTCUTS.toggleVisible)
  })
})

describe('two actions on one chord', () => {
  it('is caught here, because the OS will not catch it', () => {
    // Registering the same accelerator twice SUCCEEDS. The second handler is
    // simply never called, so the user presses the key, gets the other action,
    // and nothing anywhere explains it. There is no later moment at which this
    // is observable.
    expect(
      collides({
        toggleVisible: 'Control+M',
        toggleAwake: 'Control+M',
        askWorkspace: 'Control+K',
      }),
    ).toBe('toggleAwake')
  })

  it('is not reported when they differ', () => {
    expect(collides(DEFAULT_SHORTCUTS)).toBeNull()
  })

  it('compares chords, not spellings', () => {
    // `Shift+Control+M` and `Control+Shift+M` are one shortcut. Comparing raw
    // strings would call this pair distinct and let both register.
    const { shortcuts } = readShortcuts({
      toggleVisible: 'Shift+Control+M',
      toggleAwake: 'Control+Shift+M',
    })
    expect(collides(shortcuts)).toBe('toggleAwake')
  })
})

describe('the defaults', () => {
  it('are usable chords, checked rather than trusted', () => {
    // They go through the same grammar a user's binding does — the defaults
    // must not be the one path that skips the check.
    const chords = chordsOf(DEFAULT_SHORTCUTS)
    for (const id of SHORTCUT_IDS) {
      expect(chords[id].modifiers.length, id).toBeGreaterThan(0)
      expect(toAccelerator(chords[id]), id).toBe(DEFAULT_SHORTCUTS[id])
    }
  })
})
