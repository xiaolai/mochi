import { describe, expect, it } from 'vitest'
import { keyGlyphs } from './key-glyphs'

describe('a combination, spelled the way the system spells it', () => {
  it('draws B5’s row', () => {
    expect(keyGlyphs('Control+Shift+L', 'darwin')).toBe('⌃ ⇧ L')
  })

  it('leaves the words alone where the words are the convention', () => {
    // The glyphs are a macOS habit. On Windows every menu says "Ctrl+Shift+L".
    expect(keyGlyphs('Control+Shift+L', 'win32')).toBe('Control+Shift+L')
    expect(keyGlyphs('Control+Shift+L', 'linux')).toBe('Control+Shift+L')
  })

  it('puts the modifiers in Apple’s order, not the order they were typed', () => {
    // Two bindings that differ only in how they were declared are the same key,
    // and a column that draws them differently cannot be compared down.
    expect(keyGlyphs('Shift+Control+K', 'darwin')).toBe(keyGlyphs('Control+Shift+K', 'darwin'))
    expect(keyGlyphs('Shift+Alt+Command+Control+P', 'darwin')).toBe('⌃ ⌥ ⇧ ⌘ P')
  })

  it('spells the two names for one key the same way', () => {
    expect(keyGlyphs('CmdOrCtrl+K', 'darwin')).toBe(keyGlyphs('Command+K', 'darwin'))
  })

  it('does not print a modifier twice', () => {
    expect(keyGlyphs('Command+Cmd+K', 'darwin')).toBe('⌘ K')
  })

  it('passes through a key it has no glyph for', () => {
    expect(keyGlyphs('F13', 'darwin')).toBe('F13')
    expect(keyGlyphs('Control+Space', 'darwin')).toBe('⌃ Space')
  })
})
