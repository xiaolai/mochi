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
  readSleepAfterMinutes,
  writeSleepAfterMinutes,
  DEFAULT_SLEEP_AFTER_MINUTES,
  bubbleSideMigrated,
  markBubbleSideMigrated,
  readHaloWhen,
  readLegacyBubbleSide,
  writeHaloWhen,
  readShoulderChip,
  writeShoulderChip,
  readTranscriptionLanguages,
  writeTranscriptionLanguages,
  readHerPlace,
  writeHerPlace,
  readShelfPlace,
  writeShelfPlace,
  V1_KEYS,
  guardStopAt,
} from './worn'

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

describe('which languages she should expect to hear', () => {
  it('is EMPTY before anybody has chosen, which means detect', () => {
    // Not a missing answer. Nothing is sent, and the transcriber works the
    // language out for itself -- which is the honest default for an
    // application that has no idea who installed it.
    expect(readTranscriptionLanguages(userData)).toEqual([])
  })

  it('round-trips a choice', () => {
    writeTranscriptionLanguages(userData, ['zh', 'en'])
    expect(readTranscriptionLanguages(userData)).toEqual(['zh', 'en'])
  })

  it('goes back to detection when the choice is cleared', () => {
    writeTranscriptionLanguages(userData, ['zh'])
    writeTranscriptionLanguages(userData, [])
    expect(readTranscriptionLanguages(userData)).toEqual([])
  })

  it('reads a hand-edited file the same way the control would be read', () => {
    // The bound, the grammar and the deduplication are `readLanguages`', and
    // this is the path that proves the FILE goes through them too. A file is
    // exactly as capable of naming forty languages as a broken window is.
    writePreferences({ transcriptionLanguages: ['en', 'en', 'ENGLISH', 9, 'zh'] })
    expect(readTranscriptionLanguages(userData)).toEqual(['en', 'zh'])
  })

  it('falls back to detection rather than to a guess when the file is unreadable', () => {
    writeFileSync(join(userData, 'preferences.json'), 'not json')
    expect(readTranscriptionLanguages(userData)).toEqual([])
  })

  it('stores what will be read back, not something wider', () => {
    // Checked on the way IN as well as out: a caller that skipped the window
    // must not be able to write a file the reader then silently truncates,
    // which is how a stored choice comes to differ from the one that was made.
    writeTranscriptionLanguages(userData, ['en', 'en', 'zz-not-a-code', 'zh'])
    const stored = JSON.parse(readFileSync(join(userData, 'preferences.json'), 'utf8')) as {
      transcriptionLanguages: unknown
    }
    expect(stored.transcriptionLanguages).toEqual(['en', 'zh'])
  })

  it('does not disturb the other preferences in the same file', () => {
    writeHaloWhen(userData, 'never')
    writeTranscriptionLanguages(userData, ['ja'])
    expect(readHaloWhen(userData)).toBe('never')
    expect(readTranscriptionLanguages(userData)).toEqual(['ja'])
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

/**
 * The side that used to be everybody's, carried onto each character once.
 *
 * `bubbleSide` was app-level in `preferences.json` and is a persona field now.
 * A migration that dropped the old value would silently reset anybody who had
 * chosen one; a migration that could run twice would silently revert a choice
 * made in between. Both are invisible, which is why the gate is tested rather
 * than trusted.
 */
describe('carrying the old bubble side over', () => {
  it('reads a value stored before the field moved', () => {
    writePreferences({ bubbleSide: 'left' })
    expect(readLegacyBubbleSide(userData)).toBe('left')
  })

  it('answers auto for a file that never had one, or cannot be read', () => {
    expect(readLegacyBubbleSide(userData)).toBe('auto')
    writeFileSync(join(userData, 'preferences.json'), '{ not json')
    expect(readLegacyBubbleSide(userData)).toBe('auto')
  })

  it('is not marked until it is marked', () => {
    expect(bubbleSideMigrated(userData)).toBe(false)
    markBubbleSideMigrated(userData)
    expect(bubbleSideMigrated(userData)).toBe(true)
  })

  it('treats an unreadable file as DONE, not as pending', () => {
    /*
      The direction matters and it is the opposite of most reads here. A pass
      that cannot be gated must not run: `auto` is both the default and a real
      choice, so a second run cannot tell a character nobody has touched from
      one whose owner has since chosen it.
    */
    writeFileSync(join(userData, 'preferences.json'), '{ not json')
    expect(bubbleSideMigrated(userData)).toBe(true)
  })

  it('keeps the mark when the rest of the file is rewritten', () => {
    // One file, several writers. A marker that a later write dropped would let
    // the pass run again — the failure it exists to prevent.
    markBubbleSideMigrated(userData)
    writeWornPersonaId(userData, 'loki')
    writeShoulderChip(userData, false)
    expect(bubbleSideMigrated(userData)).toBe(true)
    expect(readWornPersonaId(userData)).toBe('loki')
  })
})

describe('the v1-era keys nothing reads', () => {
  it('keeps every one of them through a write', () => {
    // Documented rather than deleted, and this is what makes the documentation
    // a guard: `writeMerged` preserving unknown keys is the mechanism, and a
    // future writer that "tidied up" would break it silently otherwise.
    const before = Object.fromEntries(V1_KEYS.map((key) => [key, `v1-${key}`]))
    writeFileSync(join(userData, 'preferences.json'), JSON.stringify(before))

    writeWornPersonaId(userData, 'ada')

    const after = JSON.parse(readFileSync(join(userData, 'preferences.json'), 'utf8')) as Record<
      string,
      unknown
    >
    for (const key of V1_KEYS) expect(after[key], key).toBe(`v1-${key}`)
    expect(after['activePersonaId']).toBe('ada')
  })
})

describe('how far up the workspace guard walks', () => {
  /**
   * `workspace.ts` says why the walk exists: Codex reads `AGENTS.md` from the
   * working root UPWARD, so *"guarding only the leaf would leave a hole one
   * directory up"*. This function used to return the workspace itself for every
   * workspace outside our data directory — which is every workspace a user
   * picks — so that hole was the ordinary case.
   */
  const home = '/Users/somebody'
  const userData = '/Users/somebody/Library/Application Support/mochi'

  it('walks up to, but not into, the home directory', () => {
    // THE BUG: this used to be '/Users/somebody/projects/thing'.
    expect(guardStopAt(userData, '/Users/somebody/projects/thing', home)).toBe(
      '/Users/somebody/projects',
    )
  })

  it('stops below home however deep the workspace is', () => {
    expect(guardStopAt(userData, '/Users/somebody/a/b/c/d', home)).toBe('/Users/somebody/a')
  })

  it('does not walk into home for a workspace one level down', () => {
    // The walk includes `stopAt`, so returning home here would scan every file
    // they own — and `workspace.ts` says refusing over an `AGENTS.md` in `~`
    // punishes somebody for a file that predates this app.
    expect(guardStopAt(userData, '/Users/somebody/thing', home)).toBe('/Users/somebody/thing')
  })

  it('does not walk at all when the workspace IS home', () => {
    expect(guardStopAt(userData, home, home)).toBe(home)
  })

  it('does not walk outside home at all', () => {
    // A mounted volume or /tmp: no user boundary to reason about, and walking
    // to `/` would scan the machine.
    expect(guardStopAt(userData, '/Volumes/disk/work', home)).toBe('/Volumes/disk/work')
    expect(guardStopAt(userData, '/tmp/scratch', home)).toBe('/tmp/scratch')
  })

  it('still stops at our own data directory for a workspace we own', () => {
    const ours = join(userData, 'workspace', 'notes')
    expect(guardStopAt(userData, ours, home)).toBe(userData)
  })

  it('never returns something that is not an ancestor of the workspace', () => {
    // `chain()` throws when `stopAt` is not on the path, which would turn a
    // guard into a crash. Asserted as a property over every shape above.
    for (const workspace of [
      '/Users/somebody/projects/thing',
      '/Users/somebody/a/b/c/d',
      '/Users/somebody/thing',
      home,
      '/Volumes/disk/work',
      join(userData, 'workspace', 'notes'),
    ]) {
      const stop = guardStopAt(userData, workspace, home)
      expect(workspace === stop || workspace.startsWith(stop + '/')).toBe(true)
    }
  })
})
