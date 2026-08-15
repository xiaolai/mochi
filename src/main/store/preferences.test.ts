/**
 * What the loader does with a file it did not write.
 *
 * `json-file.test.ts` covers the round trip and the unreadable file, because
 * those are properties of the shared writer. This covers the part that belongs
 * to preferences alone: every field arrives from disk as `unknown`, and each
 * one has a wrong value that used to pass through in silence.
 */

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_SHORTCUTS } from '@shared/shortcuts'
import { DEFAULT_DELEGATION } from '@shared/delegation'
import { DEFAULT_PREFERENCES, loadPreferences, quarantinePreferences } from './preferences'

const dirs: string[] = []
function withFile(contents: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'mochi-prefs-'))
  dirs.push(dir)
  writeFileSync(join(dir, 'preferences.json'), JSON.stringify(contents))
  return dir
}
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe('loading a preferences file', () => {
  it('resets one of two actions bound to the same chord, and says which', () => {
    // `savePreferences` cannot write this -- the save path checks. A file from
    // an older build, or one edited by hand, can. It has to be caught on the
    // way IN as well, because `globalShortcut.register()` accepts the duplicate
    // happily and the second handler simply never runs: the user presses the
    // key, gets the other action, and nothing anywhere explains it.
    const loaded = loadPreferences(
      withFile({
        shortcuts: { toggleVisible: 'Control+Shift+M', toggleAwake: 'Control+Shift+M' },
      }),
    )

    const { toggleVisible, toggleAwake } = loaded.preferences.shortcuts
    expect(toggleVisible).not.toBe(toggleAwake)
    expect(toggleAwake).toBe(DEFAULT_SHORTCUTS.toggleAwake)
    expect(loaded.problem).toContain('toggleAwake')
  })

  it('reports an unrecognised credential source instead of quietly swapping it', () => {
    const loaded = loadPreferences(withFile({ credentialSource: 'openai' }))
    expect(loaded.preferences.credentialSource).toBe(DEFAULT_PREFERENCES.credentialSource)
    // The fallback is right; doing it in silence is not. Somebody who typed
    // the wrong word sees the pane showing Codex with nothing to read.
    expect(loaded.problem).not.toBeNull()
  })

  it('says nothing about a source that was simply never written', () => {
    // Absent is the ordinary case -- every fresh machine, and every file
    // written before this field existed. Reporting it would put a warning on
    // a first launch.
    const loaded = loadPreferences(withFile({ sizePercent: 100 }))
    expect(loaded.preferences.credentialSource).toBe(DEFAULT_PREFERENCES.credentialSource)
    expect(loaded.problem).toBeNull()
  })

  it('keeps the readable half of a file whose other half is wrong', () => {
    // Per FIELD, not all-or-nothing. One fumbled line must not reset the rest.
    const loaded = loadPreferences(
      withFile({ sizePercent: 133, shortcuts: { toggleAwake: 'Ctrl+Shift+' } }),
    )
    expect(loaded.preferences.sizePercent).toBe(133)
    expect(loaded.preferences.shortcuts.toggleAwake).toBe(DEFAULT_SHORTCUTS.toggleAwake)
    expect(loaded.problem).toContain('toggleAwake')
  })

  /**
   * The upgrade case. A file written before M10 has no `delegation` key at all,
   * and reading it must add the defaults without disturbing anything already
   * in it -- the migration failure this repository has already paid for once
   * was `pruneBefore` quietly deleting another persona's archive.
   */
  it('adds delegation defaults to a file written before it existed', () => {
    const loaded = loadPreferences(withFile({ sizePercent: 120, credentialSource: 'apikey' }))
    expect(loaded.preferences.delegation).toEqual(DEFAULT_DELEGATION)
    expect(loaded.preferences.sizePercent).toBe(120)
    expect(loaded.preferences.credentialSource).toBe('apikey')
    expect(loaded.problem).toBeNull()
  })

  it('keeps a stored delegation choice', () => {
    const loaded = loadPreferences(
      withFile({
        delegation: {
          model: 'gpt-5.6-luna',
          effort: 'xhigh',
          trigger: 'anytime',
          trustWorkspace: true,
        },
      }),
    )
    expect(loaded.preferences.delegation).toEqual({
      model: 'gpt-5.6-luna',
      effort: 'xhigh',
      trigger: 'anytime',
      trustWorkspace: true,
      // Untouched fields keep their defaults rather than vanishing, which is
      // the upgrade case: a file written before either existed.
      prompt: null,
      webSearch: 'follow',
    })
  })

  /**
   * Coerced AND reported, like the credential source. `anytime` is the looser
   * of the two settings, so silently getting `hotkey` instead would read as the
   * preference simply not working.
   */
  it('falls back to requiring the shortcut when the trigger is not recognised, and says so', () => {
    const loaded = loadPreferences(withFile({ delegation: { trigger: 'whenever-she-likes' } }))
    expect(loaded.preferences.delegation.trigger).toBe('hotkey')
    expect(loaded.problem).toContain('trigger')
  })

  /**
   * A slug we cannot check is KEPT, not erased. This loader cannot see
   * `~/.codex`, and a Codex that is merely offline must not cost the user a
   * choice they made deliberately.
   */
  it('keeps a model slug it has no way to validate', () => {
    const loaded = loadPreferences(withFile({ delegation: { model: 'some-future-model' } }))
    expect(loaded.preferences.delegation.model).toBe('some-future-model')
    expect(loaded.problem).toBeNull()
  })

  it('reads a delegation of the wrong shape as the defaults rather than throwing', () => {
    for (const value of [[], 'delegation', 42, null]) {
      const loaded = loadPreferences(withFile({ delegation: value }))
      expect(loaded.preferences.delegation, JSON.stringify(value)).toEqual(DEFAULT_DELEGATION)
    }
  })

  it('survives a file whose top level is not an object, and says so', () => {
    // `null`, `[]` and `42` are all valid JSON, so the read succeeds and the
    // shape check then fell through to `{}` -- every preference reset itself on
    // launch with nothing anywhere explaining it. Silent is the one thing this
    // loader is not allowed to be; that is what `problem` exists for.
    for (const value of [[], 'preferences', 42, null]) {
      const loaded = loadPreferences(withFile(value))
      expect(loaded.preferences, JSON.stringify(value)).toEqual(DEFAULT_PREFERENCES)
      expect(loaded.problem, JSON.stringify(value)).not.toBeNull()
    }
  })
})

describe('the two prompts a person may edit', () => {
  /**
   * Reported: hard-coding these shipped one opinion to everybody. Both are
   * stored as `null` until changed, so somebody who never touches them keeps
   * receiving a default that improves -- and "untouched" stays distinguishable
   * from "set back to today's wording".
   */
  it('keeps an edited delegation prompt and an edited rule block', () => {
    const loaded = loadPreferences(
      withFile({
        delegation: { prompt: 'Only the files. {question}' },
        spokenRules: 'Answer in one sentence.',
      }),
    )
    expect(loaded.preferences.delegation.prompt).toBe('Only the files. {question}')
    expect(loaded.preferences.spokenRules).toBe('Answer in one sentence.')
  })

  /** Clearing a box is how somebody asks for the original back. */
  it.each([[''], ['   '], [null], [42]])('reads %s as "use the built-in"', (value) => {
    const loaded = loadPreferences(withFile({ delegation: { prompt: value }, spokenRules: value }))
    expect(loaded.preferences.delegation.prompt).toBeNull()
    expect(loaded.preferences.spokenRules).toBeNull()
  })

  /** Both reach a system prompt, so neither is the file's to size. */
  it('refuses a stored prompt past the limit', () => {
    const huge = 'x'.repeat(20_000)
    const loaded = loadPreferences(withFile({ delegation: { prompt: huge }, spokenRules: huge }))
    expect(loaded.preferences.delegation.prompt).toBeNull()
    expect(loaded.preferences.spokenRules).toBeNull()
  })

  it('accepts a web search override, and coerces one it does not know', () => {
    expect(
      loadPreferences(withFile({ delegation: { webSearch: 'live' } })).preferences.delegation
        .webSearch,
    ).toBe('live')
    expect(
      loadPreferences(withFile({ delegation: { webSearch: 'yes please' } })).preferences.delegation
        .webSearch,
    ).toBe('follow')
  })
})

/**
 * The launch that cannot read your settings must not be the launch that
 * destroys them.
 *
 * The app flushes preferences on quit unconditionally. So a file that failed to
 * load — corrupt, or merely unreadable because something changed the mode on
 * `userData` — was replaced by defaults a few seconds later, and afterwards
 * there was nothing left to diagnose: the evidence is exactly what got
 * overwritten.
 */
describe('a file nothing could be read out of', () => {
  /** A first launch has nothing to protect, and must not quarantine a ghost. */
  it('is not reported for a missing file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mochi-prefs-'))
    dirs.push(dir)
    const loaded = loadPreferences(dir)
    expect(loaded.unusableFile).toBe(false)
    expect(loaded.ranBefore).toBe(false)
    expect(loaded.problem).toBeNull()
  })

  it('is reported for JSON that is valid but not an object', () => {
    // `null`, `[]` and `42` all parse. None of them has a field in it, so every
    // value handed back is a default standing in for something unread.
    for (const value of [null, [], 42, 'hello']) {
      const loaded = loadPreferences(withFile(value))
      expect(loaded.unusableFile, JSON.stringify(value)).toBe(true)
    }
  })

  it('is reported for a file that is not JSON at all', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mochi-prefs-'))
    dirs.push(dir)
    writeFileSync(join(dir, 'preferences.json'), '{ this is not json')
    const loaded = loadPreferences(dir)
    expect(loaded.unusableFile).toBe(true)
    expect(loaded.problem).toContain('not valid JSON')
  })

  /**
   * NOT reported when a field fell back. The rest of the file survived, so
   * writing over it loses only the value that was already invalid — which is
   * what the fallback decided to do. Quarantining here would move a working
   * file aside every time somebody mistyped one setting.
   */
  it('is not reported when only a field fell back', () => {
    const loaded = loadPreferences(withFile({ credentialSource: 'openai', sizePercent: 100 }))
    expect(loaded.problem, 'the bad field should still be reported').not.toBeNull()
    expect(loaded.unusableFile).toBe(false)
  })

  it('moves the file aside, keeping its bytes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mochi-prefs-'))
    dirs.push(dir)
    const original = '{ this is not json'
    writeFileSync(join(dir, 'preferences.json'), original)

    const aside = quarantinePreferences(dir, new Date('2026-08-15T20:48:16.000Z'))
    expect(aside).not.toBeNull()
    // The original name is free, so the next write cannot collide with it.
    expect(existsSync(join(dir, 'preferences.json'))).toBe(false)
    // A RENAME, not a delete. "Unreadable to this build" is not "worthless" —
    // an unreadable file is a perfectly good one under a permissions problem.
    expect(readFileSync(aside!, 'utf8')).toBe(original)
    // Nothing in the name needs escaping to type back.
    expect(aside).not.toContain(':')
  })

  /** Two bad launches must not have the second one eat the first one's rescue. */
  it('does not overwrite an earlier quarantine', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mochi-prefs-'))
    dirs.push(dir)
    writeFileSync(join(dir, 'preferences.json'), 'first')
    quarantinePreferences(dir, new Date('2026-08-15T20:48:16.000Z'))
    writeFileSync(join(dir, 'preferences.json'), 'second')
    quarantinePreferences(dir, new Date('2026-08-15T21:00:00.000Z'))

    const saved = readdirSync(dir).filter((name) => name.includes('unusable'))
    expect(saved.length, 'the second rescue replaced the first').toBe(2)
  })

  /** Most likely the same permissions problem that made it unreadable. */
  it('says so rather than throwing when it cannot move the file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mochi-prefs-'))
    dirs.push(dir)
    expect(quarantinePreferences(dir)).toBeNull()
  })
})
