import { describe, expect, it } from 'vitest'
import {
  KEYS,
  MODIFIERS,
  describeAccelerator,
  parseAccelerator,
  toAccelerator,
} from './accelerator'

/**
 * The property this module exists for: nothing it emits can throw.
 *
 * `globalShortcut.register()` throws on an accelerator it cannot parse — not
 * returns false, which is what it does for the ordinary case of another app
 * owning the key. So a malformed string takes the process down, and the strings
 * will eventually come from a settings field.
 */
describe('the closed grammar', () => {
  it('emits only combinations built from the two fixed sets', () => {
    // The guarantee is structural, so the test is exhaustive rather than
    // sampled: every modifier against every key, checked for the shape Electron
    // documents. If a member of either set were misspelled, this is where it
    // shows up rather than at `register()`.
    for (const modifier of MODIFIERS) {
      for (const key of KEYS) {
        const text = toAccelerator({ modifiers: [modifier], key })
        expect(text).toBe(`${modifier}+${key}`)
        // And it round-trips: anything emitted parses back to itself.
        expect(toAccelerator(parseAccelerator(text)!)).toBe(text)
      }
    }
  })

  it('reads the two bindings this app ships', () => {
    expect(parseAccelerator('Shift+Control+M')).toEqual({
      modifiers: ['Control', 'Shift'],
      key: 'M',
    })
    expect(parseAccelerator('Shift+Control+L')).toEqual({
      modifiers: ['Control', 'Shift'],
      key: 'L',
    })
  })

  it('puts modifiers in one order, so two spellings of a chord compare equal', () => {
    // Without this, `Shift+Control+M` and `Control+Shift+M` are two different
    // strings for one shortcut, and "is this already bound" is a question no
    // comparison answers correctly.
    expect(parseAccelerator('Shift+Control+M')).toEqual(parseAccelerator('Control+Shift+M'))
    expect(toAccelerator(parseAccelerator('Shift+Control+M')!)).toBe('Control+Shift+M')
  })

  it('accepts the spellings people type', () => {
    expect(toAccelerator(parseAccelerator('ctrl+shift+m')!)).toBe('Control+Shift+M')
    expect(toAccelerator(parseAccelerator('CmdOrCtrl+Enter')!)).toBe('CommandOrControl+Return')
    expect(toAccelerator(parseAccelerator('  Alt + Space ')!)).toBe('Alt+Space')
  })

  it('refuses a chord with no modifier', () => {
    // Electron would register this happily. A global shortcut on a bare letter
    // takes that letter from every application on the machine — the user can no
    // longer type it anywhere. Electron treats that as the caller's business;
    // here it is malformed.
    for (const text of ['M', 'Space', 'F1', '+M', 'M+']) {
      expect(parseAccelerator(text), text).toBeNull()
    }
  })

  it('refuses an unknown modifier rather than dropping it', () => {
    // Dropping it would register a DIFFERENT shortcut from the one asked for,
    // silently — the user presses their combination and nothing happens, while
    // some other combination they never chose is live.
    expect(parseAccelerator('Hyper+M')).toBeNull()
    expect(parseAccelerator('Control+Hyper+M')).toBeNull()
  })

  it('refuses anything that is not a key it knows', () => {
    for (const text of ['Control+', 'Control+Escape', 'Control+MediaPlayPause', 'Control+¶', '']) {
      expect(parseAccelerator(text), text).toBeNull()
    }
  })

  it('refuses a value that is not a string at all', () => {
    // It will arrive from IPC one day, where the type says string and the wire
    // says whatever the sender put on it.
    for (const value of [null, undefined, 42, {}, ['Control', 'M']]) {
      expect(parseAccelerator(value), JSON.stringify(value)).toBeNull()
    }
  })
})

describe('how a chord is shown to a person', () => {
  it('uses glyphs on macOS, because that is what the platform writes', () => {
    const chord = parseAccelerator('Shift+Control+M')!
    expect(describeAccelerator(chord, 'darwin')).toBe('⌃⇧M')
  })

  it('uses words everywhere else', () => {
    const chord = parseAccelerator('Shift+Control+M')!
    expect(describeAccelerator(chord, 'win32')).toBe('Control+Shift+M')
    expect(describeAccelerator(chord, 'linux')).toBe('Control+Shift+M')
  })

  it('never shows Electron’s portable spelling to a user', () => {
    // `CommandOrControl` is an Electron token, not a key anybody has. It has to
    // become ⌘ on a Mac and Ctrl elsewhere, or the settings window shows a
    // debug string where a shortcut should be.
    const chord = parseAccelerator('CmdOrCtrl+K')!
    expect(describeAccelerator(chord, 'darwin')).toBe('⌘K')
    expect(describeAccelerator(chord, 'win32')).toBe('Ctrl+K')
    for (const platform of ['darwin', 'win32', 'linux']) {
      expect(describeAccelerator(chord, platform)).not.toContain('CommandOrControl')
    }
  })
})

describe('the grammar is actually closed', () => {
  it('rejects a malformed string rather than reading a different chord out of it', () => {
    // `.split('+').filter(part => part !== '')` used to sit in the parser, so
    // a doubled or leading plus was DISCARDED: `Control++M` parsed, registered,
    // and worked -- as `Control+M`, a shortcut the user did not type. Nothing
    // in this grammar has an empty part, because the plus key is `Plus`.
    for (const malformed of ['Control++M', '+Control+M', 'Control+M+', '++', 'Control+ +M']) {
      expect(parseAccelerator(malformed), malformed).toBeNull()
    }
    // The plus KEY still parses -- it is spelled, not punctuated.
    expect(toAccelerator(parseAccelerator('Control+Plus')!)).toBe('Control+Plus')
  })

  it('gives two spellings of one physical chord one string', () => {
    // `Option` is macOS's name for Alt and `Meta` is the other name for Super.
    // While both were members, `Alt+M` and `Option+M` were two different
    // strings for one chord -- so `collides` saw no clash and let two actions
    // bind the same keys, which the OS then silently resolves by dropping one.
    expect(toAccelerator(parseAccelerator('Option+M')!)).toBe(
      toAccelerator(parseAccelerator('Alt+M')!),
    )
    expect(toAccelerator(parseAccelerator('Meta+M')!)).toBe(
      toAccelerator(parseAccelerator('Super+M')!),
    )
  })

  it('orders modifiers the same way whatever order they were written in', () => {
    const written = ['Shift+Control+M', 'Control+Shift+M', 'shift+ctrl+m']
    const canonical = written.map((text) => toAccelerator(parseAccelerator(text)!))
    expect(new Set(canonical).size, canonical.join(' / ')).toBe(1)
  })

  it('shows every modifier it registered, never a silent blank', () => {
    // The glyph table was `Partial<Record<Modifier, string>>` with a `?? ''`
    // fallback, so a modifier missing an entry vanished from the display while
    // remaining in the registration: the window said `⌘M` for a chord that was
    // really Command+Alt+M. Now every member must have a glyph to compile --
    // this asserts the runtime half.
    for (const modifier of MODIFIERS) {
      const chord = parseAccelerator(`${modifier}+M`)
      expect(chord, modifier).not.toBeNull()
      const shown = describeAccelerator(chord!, 'darwin')
      expect(shown.length, `${modifier} shows as "${shown}"`).toBeGreaterThan('M'.length)
    }
  })
})
