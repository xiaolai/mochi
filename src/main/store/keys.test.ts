import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { SHORTCUTS } from '@shared/shortcuts'
import { GLOBAL_KEYS, readShortcuts, writeShortcut } from './keys'
import { V1_KEYS } from './worn'

let userData = ''
const preferences = (): string => join(userData, 'preferences.json')
const stored = (): Record<string, unknown> =>
  JSON.parse(readFileSync(preferences(), 'utf8')) as Record<string, unknown>

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'mochi-keys-'))
})

afterEach(() => {
  rmSync(userData, { recursive: true, force: true })
})

describe('what the global keys are bound to', () => {
  it('is what the app ships until somebody chooses', () => {
    expect(readShortcuts(userData)).toEqual({ ...SHORTCUTS })
  })

  it('remembers a choice', () => {
    writeShortcut(userData, 'rest', 'Alt+F9')
    expect(readShortcuts(userData).rest).toBe('Alt+F9')
    // The other one is untouched. Two keys in one object is how changing one
    // quietly resets the other.
    expect(readShortcuts(userData).hide).toBe(SHORTCUTS.hide)
  })

  it('answers every key, always, so nothing downstream handles a gap', () => {
    writeShortcut(userData, 'rest', 'Alt+F9')
    expect(Object.keys(readShortcuts(userData)).sort()).toEqual(Object.keys(SHORTCUTS).sort())
  })
})

describe('giving a key back', () => {
  it('deletes the stored answer rather than writing today default in', () => {
    /*
      The rule `store/prompts.ts` argues at length, and the reason it matters
      here: a key reset now keeps tracking whatever later releases ship. Writing
      the current default back would freeze this release's combination for ever
      while reporting the key unchanged.
    */
    writeShortcut(userData, 'rest', 'Alt+F9')
    writeShortcut(userData, 'rest', null)
    expect(stored()[GLOBAL_KEYS]).toEqual({})
    expect(readShortcuts(userData).rest).toBe(SHORTCUTS.rest)
  })

  it('treats choosing the shipped combination as not having chosen', () => {
    // Otherwise pressing the default by hand pins it, and the row would report
    // itself edited while sitting on exactly what ships.
    writeShortcut(userData, 'rest', 'Alt+F9')
    writeShortcut(userData, 'rest', SHORTCUTS.rest)
    expect(stored()[GLOBAL_KEYS]).toEqual({})
  })
})

describe('a preferences file this build did not write', () => {
  it('falls back to the shipped combination for an unusable stored value', () => {
    /*
      `globalShortcut.register` THROWS on a malformed accelerator, and this file
      is hand-editable — so a typo in it must not be able to take the launch
      down, and must not pass silently either.
    */
    writeFileSync(preferences(), JSON.stringify({ [GLOBAL_KEYS]: { rest: 'Ctrl+Shift+L' } }))
    expect(readShortcuts(userData).rest).toBe(SHORTCUTS.rest)
  })

  it('falls back when the stored value is not a string at all', () => {
    writeFileSync(preferences(), JSON.stringify({ [GLOBAL_KEYS]: { rest: 7, hide: null } }))
    expect(readShortcuts(userData)).toEqual({ ...SHORTCUTS })
  })

  it('falls back when the key holds something that is not an object', () => {
    for (const value of ['Alt+F9', 42, ['Alt+F9'], null]) {
      writeFileSync(preferences(), JSON.stringify({ [GLOBAL_KEYS]: value }))
      expect(readShortcuts(userData), JSON.stringify(value)).toEqual({ ...SHORTCUTS })
    }
  })

  it('falls back when the file is not JSON at all', () => {
    writeFileSync(preferences(), 'not json')
    expect(readShortcuts(userData)).toEqual({ ...SHORTCUTS })
  })

  it('refuses to store something that would throw at registration', () => {
    // The last line between a bad string and `globalShortcut.register`.
    expect(() => {
      writeShortcut(userData, 'rest', 'Ctrl+Shift+L')
    }).toThrow()
    expect(() => {
      writeShortcut(userData, 'rest', 'L')
    }).toThrow()
  })
})

describe('sharing preferences.json with everything else in it', () => {
  it('keeps the other settings, including v1 keys nothing here reads', () => {
    /*
      `worn.ts`'s rule, and this module is a second writer into the same file —
      which is exactly the dropped-key failure that rule exists to prevent. The
      v1 entries are the sharpest case: nothing in this build reads them, so a
      writer that rebuilt the object would take them out and nothing would fail.
    */
    writeFileSync(
      preferences(),
      JSON.stringify({
        activePersonaId: 'loki',
        asleep: true,
        ...Object.fromEntries(V1_KEYS.map((key) => [key, 'carried'])),
      }),
    )
    writeShortcut(userData, 'hide', 'Alt+F10')
    const after = stored()
    expect(after['activePersonaId']).toBe('loki')
    expect(after['asleep']).toBe(true)
    for (const key of V1_KEYS) expect(after[key], key).toBe('carried')
    expect(after[GLOBAL_KEYS]).toEqual({ hide: 'Alt+F10' })
  })

  it("never writes into v1's own `shortcuts` key", () => {
    /*
      `worn.ts` lists `shortcuts` among the seven keys this build carries
      forward without reading, and says what to do if one is ever wanted:
      give it a name this build understands rather than reviving the old one.
      Writing this build's answer into v1's key would hand a rolled-back v1 a
      table in a format it cannot parse.
    */
    writeShortcut(userData, 'rest', 'Alt+F9')
    expect(stored()['shortcuts']).toBeUndefined()
    expect(V1_KEYS).toContain('shortcuts')
    expect(GLOBAL_KEYS).not.toBe('shortcuts')
  })
})
