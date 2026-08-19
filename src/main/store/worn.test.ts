import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  readBubbleSide,
  readResting,
  readWornPersonaId,
  writeBubbleSide,
  writeResting,
  writeWornPersonaId,
  isProfileName,
  readProfile,
  writeProfile,
  readGrants,
  writeGrant,
} from './worn'
import { DEFAULT_GRANTS, WITHHELD_GRANTS } from '@shared/grants'

let userData = ''
beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'mochi-worn-'))
})
afterEach(() => {
  rmSync(userData, { recursive: true, force: true })
})

function writePreferences(value: unknown): void {
  writeFileSync(join(userData, 'preferences.json'), JSON.stringify(value))
}

describe('remembering who she is', () => {
  it('reads the one field it needs out of a file full of other things', () => {
    // The shape a real v1 installation has. Everything except the one key is
    // about a settings window that does not exist here yet.
    writePreferences({
      sizePercent: 100,
      shortcuts: {},
      credentialSource: 'codex',
      activePersonaId: 'loki',
      sound: {},
      idleMs: 180_000,
      realtimeModel: 'gpt-realtime-2.1',
    })
    expect(readWornPersonaId(userData)).toBe('loki')
  })

  it('answers null on a fresh install, which is not a fault', () => {
    // Nobody has chosen. The caller falls back to the built-in, and saying so
    // loudly would train people to ignore the log.
    expect(readWornPersonaId(userData)).toBeNull()
  })

  it('answers null rather than throwing on a file it cannot parse', () => {
    writeFileSync(join(userData, 'preferences.json'), '{ not json')
    expect(readWornPersonaId(userData)).toBeNull()
  })

  it('refuses an id that would become a path segment', () => {
    // It is used as a lookup key and, downstream, as a directory name — the same
    // line `personas.ts` guards for a loose file's stem, where a name turns into
    // a location.
    for (const activePersonaId of ['../escape', 'a/b', '.', '', 'CAPITALS', 42, null]) {
      writePreferences({ activePersonaId })
      expect(readWornPersonaId(userData), String(activePersonaId)).toBeNull()
    }
  })

  it('answers null when the key is simply absent', () => {
    writePreferences({ sizePercent: 100 })
    expect(readWornPersonaId(userData)).toBeNull()
  })
})

describe('remembering who is worn', () => {
  it('writes the id, and reads it back', () => {
    writeWornPersonaId(userData, 'loki')
    expect(readWornPersonaId(userData)).toBe('loki')
  })

  it('keeps every other key in the file', () => {
    // This file is older than this application. v1 put window geometry,
    // shortcuts and a model choice in it, and writing `{ activePersonaId }`
    // alone would silently discard somebody's settings for an app that may
    // still be installed.
    writeFileSync(
      join(userData, 'preferences.json'),
      JSON.stringify({ activePersonaId: 'mochi', windowBounds: { x: 10, y: 20 }, theme: 'dark' }),
    )
    writeWornPersonaId(userData, 'loki')
    const after: unknown = JSON.parse(readFileSync(join(userData, 'preferences.json'), 'utf8'))
    expect(after).toEqual({
      activePersonaId: 'loki',
      windowBounds: { x: 10, y: 20 },
      theme: 'dark',
    })
  })

  it('replaces a file nothing can parse rather than refusing to write', () => {
    // There is nothing to preserve in unreadable JSON, and refusing would leave
    // the switch silently ineffective — the worst of the three outcomes.
    writeFileSync(join(userData, 'preferences.json'), '{ not json at all')
    writeWornPersonaId(userData, 'loki')
    expect(readWornPersonaId(userData)).toBe('loki')
  })

  it('refuses an id that is not usable as one', () => {
    // It becomes a lookup key and, downstream, a path segment. The reader
    // already validates on the way in; a writer that did not would let the file
    // hold something the reader must then reject on every launch.
    expect(() => writeWornPersonaId(userData, '../elsewhere')).toThrow()
    expect(readWornPersonaId(userData)).toBeNull()
  })
})

describe('which side the bubble sits on', () => {
  it('is auto until somebody says otherwise', () => {
    // Also what a missing file, a broken file, and an unrecognised value mean:
    // there is exactly one answer for "nobody has chosen", and it is the one
    // that works everywhere.
    expect(readBubbleSide(userData)).toBe('auto')
    writeFileSync(join(userData, 'preferences.json'), '{ not json')
    expect(readBubbleSide(userData)).toBe('auto')
    writeFileSync(join(userData, 'preferences.json'), JSON.stringify({ bubbleSide: 'sideways' }))
    expect(readBubbleSide(userData)).toBe('auto')
  })

  it('remembers a side, and keeps the worn persona while doing it', () => {
    // Two writers into one file. A second that wrote only its own key would
    // silently drop the first one's — which is somebody's persona.
    writeWornPersonaId(userData, 'loki')
    writeBubbleSide(userData, 'left')
    expect(readBubbleSide(userData)).toBe('left')
    expect(readWornPersonaId(userData)).toBe('loki')
  })

  it('refuses a side that is not one', () => {
    expect(() => writeBubbleSide(userData, 'diagonally' as never)).toThrow()
    expect(readBubbleSide(userData)).toBe('auto')
  })
})

describe('how she was left', () => {
  it('is awake and visible until told otherwise', () => {
    // The direction a wrong guess should fail in: a companion that is present
    // and listening can be told to stop, and one that is neither cannot be told
    // anything at all.
    expect(readResting(userData)).toEqual({ asleep: false, hidden: false })
    writeFileSync(join(userData, 'preferences.json'), '{ not json')
    expect(readResting(userData)).toEqual({ asleep: false, hidden: false })
    writeFileSync(join(userData, 'preferences.json'), JSON.stringify({ asleep: 'yes' }))
    expect(readResting(userData).asleep).toBe(false)
  })

  it('remembers each independently', () => {
    // Asleep is about her attention; hidden is about the screen. Two reasons,
    // two answers.
    writeResting(userData, { asleep: true })
    expect(readResting(userData)).toEqual({ asleep: true, hidden: false })
    writeResting(userData, { hidden: true })
    expect(readResting(userData)).toEqual({ asleep: true, hidden: true })
    writeResting(userData, { asleep: false })
    expect(readResting(userData)).toEqual({ asleep: false, hidden: true })
  })

  it('keeps the worn persona and the bubble side while doing it', () => {
    writeWornPersonaId(userData, 'loki')
    writeBubbleSide(userData, 'left')
    writeResting(userData, { asleep: true })
    expect(readWornPersonaId(userData)).toBe('loki')
    expect(readBubbleSide(userData)).toBe('left')
  })
})

describe('the Codex profile', () => {
  it('is nothing until somebody chooses one', () => {
    // Absent leaves the user's own `config.toml` alone, which is the same
    // first-class choice `follow` is for web search.
    expect(readProfile(userData)).toBeNull()
  })

  it('round-trips a name, and clears it again', () => {
    writeProfile(userData, 'mochi')
    expect(readProfile(userData)).toBe('mochi')
    writeProfile(userData, null)
    expect(readProfile(userData)).toBeNull()
  })

  it('REFUSES a name that would reach out of Codex home', () => {
    // The name becomes a filename inside `$CODEX_HOME` — `<name>.config.toml` —
    // so a slash or a `..` in it is a path rather than a profile. Same reason
    // `memoryPath` refuses an id that has not passed the persona grammar.
    for (const bad of ['../escape', 'a/b', '/absolute', '.', '..', 'Mochi', 'has space', '']) {
      expect(isProfileName(bad), bad).toBe(false)
      expect(() => writeProfile(userData, bad), bad).toThrow()
    }
  })

  it('refuses a bad name on the way OUT as well, since the file is hand-edited', () => {
    // Written past the setter, the way somebody editing preferences.json by
    // hand would. A name that failed the grammar must not become an argument.
    writeFileSync(
      join(userData, 'preferences.json'),
      JSON.stringify({ codexProfile: '../../etc/passwd' }),
    )
    expect(readProfile(userData)).toBeNull()
  })
})

describe('what she may do while nobody is watching', () => {
  it('allows everything until somebody says otherwise', () => {
    // A companion that arrives unable to hear you is not a safer companion.
    expect(readGrants(userData)).toEqual(DEFAULT_GRANTS)
  })

  it('remembers a refusal', () => {
    writeGrant(userData, 'ask_workspace', false)
    expect(readGrants(userData).ask_workspace).toBe(false)
    expect(readGrants(userData).remember_this).toBe(true)
  })

  it('keeps every other key in the file', () => {
    // The whole reason there is one writer for this file: a second one that
    // knew only its own key would drop the worn persona.
    writePreferences({ activePersonaId: 'loki', bubbleSide: 'left' })
    writeGrant(userData, 'microphone', false)
    expect(readWornPersonaId(userData)).toBe('loki')
    expect(readBubbleSide(userData)).toBe('left')
    expect(readGrants(userData).microphone).toBe(false)
  })

  it('keeps the other refusals when one is changed back', () => {
    writeGrant(userData, 'ask_workspace', false)
    writeGrant(userData, 'remember_this', false)
    writeGrant(userData, 'ask_workspace', true)
    expect(readGrants(userData)).toEqual({
      ...DEFAULT_GRANTS,
      ask_workspace: true,
      remember_this: false,
    })
  })

  it('honours a stored refusal even beside keys it does not understand', () => {
    writePreferences({ grants: { ask_workspace: false, wobble: true } })
    expect(readGrants(userData).ask_workspace).toBe(false)
  })

  it('WITHHOLDS everything for a file nothing can parse', () => {
    // Absent means nobody has said no. A file that is there and cannot be read
    // holds somebody's answers and this process cannot see them — and reading
    // that as "allowed" is the one direction that lets her do something they
    // may have said she may not. `hasPolicy` draws the same line for retention.
    writeFileSync(join(userData, 'preferences.json'), '{ not json')
    expect(readGrants(userData)).toEqual(WITHHELD_GRANTS)
  })

  it('WITHHOLDS everything for valid JSON that is not an object', () => {
    // `null`, `[]` and `"broken"` all parse, and `.grants` on each of them
    // reads as `undefined` — which is absent, which is allowed. So a
    // preferences file replaced by any of them re-enabled every permission,
    // through the one path that had already been made to fail closed twice.
    for (const root of ['null', '[]', '"broken"', '42']) {
      writeFileSync(join(userData, 'preferences.json'), root)
      expect(readGrants(userData)).toEqual(WITHHELD_GRANTS)
    }
  })

  it('refuses to write permissions over a file it could not read', () => {
    // Otherwise a transient read failure becomes four permanent refusals
    // nobody made: `readGrants` answers "all withheld", and writing THAT back
    // would put it on disk.
    writeFileSync(join(userData, 'preferences.json'), '{ not json')
    expect(() => writeGrant(userData, 'microphone', true)).toThrow()
  })

  it('refuses to write something that is not a grant', () => {
    expect(() => writeGrant(userData, 'sudo' as never, true)).toThrow()
  })
})
