import { describe, expect, it } from 'vitest'
import { whatWasPressed, type Keystroke } from './pressed'

/**
 * What a keystroke during a shortcut capture means.
 *
 * These rules were five branches inside a 110-line DOM builder, tangled with a
 * button's label and a `listening` flag, so they could only be exercised by
 * constructing the row — and this suite runs in node with no DOM.
 *
 * That cost something real. `Command+Escape` was unreachable through the only
 * control that can set a shortcut: `Escape` is in the accepted key set, so the
 * grammar allows the combination, and the control treated every event whose
 * `key` is `Escape` as cancel. Nothing could have caught it, because there was
 * nothing to point a test at.
 */
function press(over: Partial<Keystroke> = {}): Keystroke {
  return {
    key: 'k',
    code: 'KeyK',
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ...over,
  }
}

describe('a keystroke while a shortcut is being captured', () => {
  it('leaves on a BARE Escape', () => {
    // A capture with no way out is one that has to be escaped by pressing
    // something you did not want.
    expect(whatWasPressed(press({ key: 'Escape', code: 'Escape' }), 'Alt+F9').kind).toBe('leave')
  })

  it('treats Escape WITH a modifier as a combination, not as cancel', () => {
    /*
      The bug this seam exists for. Every combination containing Escape was
      unreachable through the only control that can set one.
    */
    const said = whatWasPressed(press({ key: 'Escape', code: 'Escape', metaKey: true }), 'Alt+F9')
    expect(said.kind).toBe('save')
    if (said.kind === 'save') expect(said.pressed).toContain('Escape')
  })

  it('ignores a modifier on its own, without ending the capture', () => {
    // Somebody on the way to Control+Shift+K holds two modifiers first, and a
    // control that gave up on the first would record `Control`.
    expect(
      whatWasPressed(press({ key: 'Control', code: 'ControlLeft', ctrlKey: true }), 'Alt+F9').kind,
    ).toBe('ignore')
  })

  it('refuses a combination with no real modifier, and keeps listening', () => {
    // `refuse` rather than `leave`: they are most of the way to a good answer.
    const said = whatWasPressed(press(), 'Alt+F9')
    expect(said.kind).toBe('refuse')
    if (said.kind === 'refuse') {
      expect(said.pressed).toBe('K')
      expect(said.why).not.toBe('')
    }
  })

  it('says UNCHANGED for the combination it already has', () => {
    /*
      Not a save. It would round-trip cleanly — main releases the combination
      and takes it straight back — and it would put a "Saved." over a key nobody
      moved.
    */
    const said = whatWasPressed(press({ code: 'F9', key: 'F9', altKey: true }), 'Alt+F9')
    expect(said.kind).toBe('unchanged')
  })

  it('saves a new one', () => {
    const said = whatWasPressed(press({ code: 'F10', key: 'F10', altKey: true }), 'Alt+F9')
    expect(said.kind).toBe('save')
    if (said.kind === 'save') expect(said.pressed).toBe('Alt+F10')
  })
})
