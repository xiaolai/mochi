import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { HALO_WHEN } from '@shared/ipc'
import {
  readResting,
  readWornPersonaId,
  writeResting,
  writeWornPersonaId,
  isProfileName,
  readProfile,
  writeProfile,
  readGrants,
  writeGrant,
  readSleepAfterMinutes,
  writeSleepAfterMinutes,
  DEFAULT_SLEEP_AFTER_MINUTES,
  readHaloWhen,
  writeHaloWhen,
  readShoulderChip,
  writeShoulderChip,
  readHerPlace,
  writeHerPlace,
  readShelfPlace,
  writeShelfPlace,
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

  it('keeps every other key in the file while doing it', () => {
    // Two writers into one file. A second that wrote only its own key would
    // silently drop the first one's — which is somebody's persona.
    writeWornPersonaId(userData, 'loki')
    writeShoulderChip(userData, false)
    writeResting(userData, { asleep: true })
    expect(readWornPersonaId(userData)).toBe('loki')
    expect(readShoulderChip(userData)).toBe(false)
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
    writeGrant(userData, 'speak_first', false)
    expect(readWornPersonaId(userData)).toBe('loki')
    expect(readGrants(userData).speak_first).toBe(false)
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
    expect(() => writeGrant(userData, 'speak_first', true)).toThrow()
  })

  it('refuses to write something that is not a grant', () => {
    expect(() => writeGrant(userData, 'sudo' as never, true)).toThrow()
  })
})

describe('when she rests on her own', () => {
  it('defaults rather than never, so an untouched install still stops connecting', () => {
    expect(readSleepAfterMinutes(userData)).toBe(DEFAULT_SLEEP_AFTER_MINUTES)
  })

  it('keeps zero, which is the one value that is not a duration', () => {
    writeSleepAfterMinutes(userData, 0)
    expect(readSleepAfterMinutes(userData)).toBe(0)
  })

  it('refuses a value nothing can honour rather than clamping it', () => {
    // Clamping would store a number nobody chose and show it back as though
    // they had. The caller sees the throw; the file keeps what it had.
    expect(() => {
      writeSleepAfterMinutes(userData, 90)
    }).toThrow()
    expect(() => {
      writeSleepAfterMinutes(userData, 2.5)
    }).toThrow()
  })

  it('falls back when the file says something unusable, rather than never sleeping', () => {
    // A hand-edited file is ordinary here. The direction matters: an unreadable
    // value must not become "stay connected for ever".
    writePreferences({ sleepAfterMinutes: 'soon' })
    expect(readSleepAfterMinutes(userData)).toBe(DEFAULT_SLEEP_AFTER_MINUTES)
    writePreferences({ sleepAfterMinutes: 600 })
    expect(readSleepAfterMinutes(userData)).toBe(DEFAULT_SLEEP_AFTER_MINUTES)
  })
})

describe('when the halo is drawn', () => {
  it('is always, unless somebody has said otherwise', () => {
    expect(readHaloWhen(userData)).toBe('always')
    writePreferences({ haloWhen: 'sometimes' })
    // A value this side cannot read is not one it may act on, and the direction
    // a wrong guess should fail in is toward MORE indication rather than less.
    expect(readHaloWhen(userData)).toBe('always')
  })

  it.each([...HALO_WHEN])('round-trips %s', (when) => {
    writeHaloWhen(userData, when)
    expect(readHaloWhen(userData)).toBe(when)
  })

  it('refuses to store an answer nothing can honour', () => {
    expect(() => {
      writeHaloWhen(userData, 'sometimes' as never)
    }).toThrow()
  })

  it('honours the OLD boolean, so a preference does not revert on update', () => {
    /*
      This was `haloAtRest: boolean`, and `false` meant exactly what
      `'listening'` means now — the open ring, no resting hairline.

      A reader that knew only the new key would answer `always` for every
      install that had switched the hairline off: a preference somebody set,
      silently coming back on the launch after an update. That is the failure
      `readResting`'s header names for rest and hiding, and it is invisible —
      the app looks like it is working, it is simply doing something nobody
      asked for.
    */
    writePreferences({ haloAtRest: false })
    expect(readHaloWhen(userData)).toBe('listening')

    // And `true` is the default, which is what it always meant.
    writePreferences({ haloAtRest: true })
    expect(readHaloWhen(userData)).toBe('always')

    // The NEW key wins when both are there, which is what makes the migration
    // converge: the next write of `haloWhen` settles it for good.
    writePreferences({ haloAtRest: false, haloWhen: 'never' })
    expect(readHaloWhen(userData)).toBe('never')
  })
})

describe('whether the control at her shoulder is offered', () => {
  it('is shown unless somebody has said otherwise', () => {
    expect(readShoulderChip(userData)).toBe(true)
    writePreferences({ shoulderChip: 'no' })
    // The halo's direction, for a plainer reason: a missing indicator is a lie
    // about the microphone, and a missing button is only a missing button —
    // but it still reads as a broken app, so an unreadable value leaves it on.
    expect(readShoulderChip(userData)).toBe(true)
  })

  it('round-trips a deliberate no', () => {
    writeShoulderChip(userData, false)
    expect(readShoulderChip(userData)).toBe(false)
    writeShoulderChip(userData, true)
    expect(readShoulderChip(userData)).toBe(true)
  })

  it('does not disturb the other preferences in the same file', () => {
    // One file holds all of them and `writeMerged` is what keeps that true.
    // A write that replaced the object would turn the halo back on for anybody
    // who had switched it off, which is a preference silently reverting.
    writeHaloWhen(userData, 'never')
    writeShoulderChip(userData, false)
    expect(readHaloWhen(userData)).toBe('never')
    expect(readShoulderChip(userData)).toBe(false)
  })
})

describe('where she and the shelf were left', () => {
  it('has no answer before anything has been written', () => {
    expect(readHerPlace(userData)).toBeNull()
    expect(readShelfPlace(userData)).toBeNull()
  })

  it('round-trips her body position and the size it was measured at', () => {
    // The SIZE travels with the position because turning a body corner back
    // into a window origin needs the pad above her, which is her height.
    writeHerPlace(userData, { x: 1200, y: 700, width: 94, height: 73 })
    expect(readHerPlace(userData)).toEqual({ x: 1200, y: 700, width: 94, height: 73 })
  })

  it('keeps the two windows apart', () => {
    writeHerPlace(userData, { x: 10, y: 20, width: 94, height: 73 })
    writeShelfPlace(userData, { x: 30, y: 40, width: 1440, height: 900 })
    expect(readHerPlace(userData)?.x).toBe(10)
    expect(readShelfPlace(userData)?.x).toBe(30)
  })

  it('reads a negative origin, because a second display can be left of the first', () => {
    writeHerPlace(userData, { x: -900, y: 300, width: 94, height: 73 })
    expect(readHerPlace(userData)?.x).toBe(-900)
  })

  it('refuses anything that is not whole, because setPosition throws on a fraction', () => {
    // THROWS rather than returning. It used to refuse silently, which is the
    // same thing a write that never ran looks like — and "she does not remember
    // where she was put" was exactly the symptom, with nothing anywhere to say
    // which of the two had happened. Both callers log a throw.
    expect(() => {
      writeHerPlace(userData, { x: 10.5, y: 20, width: 94, height: 73 })
    }).toThrow()
    expect(readHerPlace(userData)).toBeNull()
  })

  it('refuses a size that could not place her, and says so', () => {
    expect(() => {
      writeHerPlace(userData, { x: 10, y: 20, width: 0, height: 73 })
    }).toThrow()
    expect(() => {
      writeHerPlace(userData, { x: 10, y: 20, width: 94, height: 0.5 })
    }).toThrow()
    expect(readHerPlace(userData)).toBeNull()
  })

  it('reads nothing back from a record missing its size', () => {
    // The size is what the restore needs. A record without one would place her
    // against a nominal body and land a large character visibly out.
    writePreferences({ herPlace: { x: 10, y: 20 } })
    expect(readHerPlace(userData)).toBeNull()
  })

  it('reads nothing back from a zero-sized one', () => {
    writePreferences({ herPlace: { x: 10, y: 20, width: 0, height: 73 } })
    expect(readHerPlace(userData)).toBeNull()
  })
})
