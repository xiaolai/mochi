import { describe, expect, it } from 'vitest'
import { acceleratorFrom, acceleratorProblem, isAccelerator } from './accelerator'
import { SHORTCUTS } from './shortcuts'

describe('what counts as a key combination', () => {
  it('accepts what this build ships, which is the floor', () => {
    // A default that failed its own grammar would refuse every reset. The same
    // argument the prompt catalogue makes about its own required phrases.
    for (const accelerator of Object.values(SHORTCUTS)) {
      expect(acceleratorProblem(accelerator), accelerator).toBeNull()
    }
  })

  it('accepts letters, digits, the function row and the named keys', () => {
    for (const one of [
      'Control+A',
      'Command+9',
      'Alt+F12',
      'Control+Shift+Space',
      'Alt+Command+PageDown',
      'Control+Left',
    ]) {
      expect(acceleratorProblem(one), one).toBeNull()
    }
  })

  it('refuses Shift on its own, which would eat that key everywhere', () => {
    // The one mistake here that is easy to make and very hard to undo: undoing
    // it means typing into a field whose keystrokes are being taken.
    expect(acceleratorProblem('Shift+L')).toContain('Shift on its own')
    expect(acceleratorProblem('L')).toContain('Shift on its own')
  })

  it('refuses a key it does not know rather than letting Electron throw', () => {
    // `globalShortcut.register` throws on a malformed accelerator. That was a
    // programming error while these were constants and is reachable from a
    // control now.
    for (const one of ['Control+Semicolon', 'Control+F25', 'Control+', 'Control+ß']) {
      expect(acceleratorProblem(one), one).not.toBeNull()
    }
  })

  it('refuses a modifier spelled the other way Electron allows', () => {
    // Electron takes `Cmd` and `Ctrl`. Two spellings of one combination is how
    // a collision check quietly stops finding collisions.
    expect(acceleratorProblem('Cmd+L')).toContain('not a modifier')
    expect(acceleratorProblem('Ctrl+Shift+L')).toContain('not a modifier')
  })

  it('refuses the modifiers in another order, so equality is a string compare', () => {
    expect(acceleratorProblem('Control+Shift+L')).toBeNull()
    expect(acceleratorProblem('Shift+Control+L')).toContain('order')
  })

  it('refuses anything that is not a string', () => {
    for (const one of [null, undefined, 7, {}, ['Control+L'], '']) {
      expect(isAccelerator(one)).toBe(false)
    }
  })
})

describe('reading a key combination off a keystroke', () => {
  const press = (over: Partial<Parameters<typeof acceleratorFrom>[0]>) =>
    acceleratorFrom({
      code: 'KeyL',
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      metaKey: false,
      ...over,
    })

  it('writes the modifiers in the canonical order however they were held', () => {
    expect(press({ ctrlKey: true, shiftKey: true })).toBe('Control+Shift+L')
    expect(press({ metaKey: true, altKey: true, ctrlKey: true, shiftKey: true })).toBe(
      'Control+Alt+Shift+Command+L',
    )
  })

  it('reads the physical key, not the character the modifier produced', () => {
    // On macOS Alt is the compose modifier: ⌥L reports `key` as `¬`, which is
    // not an accelerator and not what anybody thinks they pressed.
    expect(press({ code: 'KeyL', altKey: true, ctrlKey: true })).toBe('Control+Alt+L')
  })

  it('answers nothing for a modifier held on its own', () => {
    // What makes a capture control possible: somebody on the way to ⌃⇧K
    // generates two events that mean nothing yet, and a control that took the
    // first would record `Control` and stop listening.
    for (const code of ['ControlLeft', 'ShiftRight', 'AltLeft', 'MetaLeft']) {
      expect(press({ code, ctrlKey: true }), code).toBeNull()
    }
  })

  it('answers nothing for a key outside the accepted set', () => {
    for (const code of ['Semicolon', 'Numpad5', 'IntlBackslash']) {
      expect(press({ code, ctrlKey: true }), code).toBeNull()
    }
  })

  it('renames the codes that are not their own accelerator name', () => {
    expect(press({ code: 'Enter', ctrlKey: true })).toBe('Control+Return')
    expect(press({ code: 'ArrowUp', ctrlKey: true })).toBe('Control+Up')
    expect(press({ code: 'ArrowRight', metaKey: true })).toBe('Command+Right')
  })

  it('produces something the grammar accepts whenever a real modifier was held', () => {
    // The two halves have to agree: a capture control that recorded a
    // combination the store then refused would be a control that ignores you.
    for (const code of ['KeyA', 'Digit4', 'F7', 'Space', 'Home', 'Enter', 'ArrowLeft']) {
      const written = press({ code, ctrlKey: true, shiftKey: true })
      expect(written, code).not.toBeNull()
      expect(acceleratorProblem(written), `${code} -> ${String(written)}`).toBeNull()
    }
  })
})
