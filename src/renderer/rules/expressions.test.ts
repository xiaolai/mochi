import { describe, expect, it } from 'vitest'
import { RESTING, permitted, wearing } from './expressions'

const ALL = ['neutral', 'happy', 'shy', 'sad', 'surprised', 'thinking', 'sleepy', 'angry']

describe('what she wears when she may not wear what was wanted', () => {
  it('wears the wanted one when it is permitted', () => {
    expect(wearing(ALL, 'happy')).toBe('happy')
  })

  it('falls back to resting when it is withheld', () => {
    expect(wearing(['neutral', 'happy'], 'angry')).toBe(RESTING)
  })

  it('survives an EMPTY set, which is legal', () => {
    // "switch all eight off and she is simply never told she has a face to
    // change, which is a state the application has to survive rather than
    // prevent." So the fallback cannot be "the first allowed one".
    expect(wearing([], 'happy')).toBe(RESTING)
    expect(wearing([], RESTING)).toBe(RESTING)
  })

  it('wears resting even when resting itself is withheld', () => {
    // Withholding an expression withholds a CHANGE. A character with no face at
    // all is not a state anything downstream can draw.
    expect(wearing(['happy'], RESTING)).toBe(RESTING)
  })
})

describe('C5 · looking at one and permitting it are two questions', () => {
  it('answers them separately', () => {
    expect(permitted(['neutral'], 'angry')).toBe(false)
    // And the tile still draws it: "you can always look".
    expect(wearing(['neutral'], 'angry')).toBe(RESTING)
  })
})
