/**
 * The gate between main and this window.
 *
 * Every field here is one a pane reads without checking. A snapshot that
 * passes this and is still wrong fails later, inside a builder, as a
 * `TypeError` on `undefined` in a detached render — which reaches the user as
 * a blank settings window and a line in a console nobody has open.
 */

import { describe, expect, it } from 'vitest'
import { DEFAULT_SOUND } from '@shared/sound'
import { DEFAULT_IDLE_MS } from '@shared/companion'
import { DEFAULT_DELEGATION, type DelegationView } from '@shared/delegation'

/**
 * Built here rather than imported from `main/codex/facts`.
 *
 * That helper is main-side and reaches `node:fs` through the model cache and
 * the trust file, so importing it would pull node into a renderer bundle -- the
 * exact layering break that had to be undone when a remedy lived in `main/`.
 */
const NO_DELEGATION: DelegationView = {
  settings: DEFAULT_DELEGATION,
  catalog: { models: [], problem: null },
  readiness: 'unreadable',
  remedy: 'retry',
  trust: 'unreadable',
  trustIsOurs: false,
  codexDefault: { model: null, effort: null },
}
import { DEFAULT_PERSONA } from '@shared/persona'
import { MOCHI } from '@shared/avatar-spec'
import { DEFAULT_SHORTCUTS } from '@shared/shortcuts'
import type { SettingsSnapshot } from '@shared/ipc'
import { readSnapshot } from './snapshot'

/** The problems alone, which is what most of these assert on. */
const problemsIn = (value: unknown): readonly string[] => {
  const read = readSnapshot(value)
  return read.ok ? [] : read.problems
}

function good(): SettingsSnapshot {
  return {
    delegation: NO_DELEGATION,
    spokenRules: { stored: null, builtIn: 'be brief' },
    persona: DEFAULT_PERSONA,
    personas: [{ id: 'mochi', name: 'Mochi' }],
    builtInEdited: false,
    sound: DEFAULT_SOUND,
    idleMs: DEFAULT_IDLE_MS,
    loopbackHeard: null,
    kept: { sessions: 0, turns: 0, bytes: 0, where: '/tmp/transcripts.db' },
    policy: { keeps: true, keepDays: null },
    memory: '',
    personaProblems: [],
    face: MOCHI,
    locale: 'en',
    sizePercent: 100,
    version: '0.1.0',
    about: {
      name: 'mochi',
      repository: 'https://example.invalid/repo',
      author: 'someone',
      homepage: 'https://example.invalid',
    },
    auth: { source: 'codex', keySet: false, keyHint: '', canStoreKey: true },
    keys: {
      toggleVisible: {
        accelerator: DEFAULT_SHORTCUTS.toggleVisible,
        shown: '⇧⌃M',
        unavailable: false,
      },
      toggleAwake: { accelerator: DEFAULT_SHORTCUTS.toggleAwake, shown: '⇧⌃L', unavailable: false },
      askWorkspace: { accelerator: 'Control+Shift+K', shown: '', unavailable: false },
    },
    locales: [{ tag: 'en', nativeName: 'English' }],
  }
}

/** A snapshot with one field replaced by something wrong. */
function broken<K extends keyof SettingsSnapshot>(key: K, value: unknown): unknown {
  return { ...good(), [key]: value }
}

describe('checking a snapshot before anything is drawn from it', () => {
  it('accepts the one main actually sends', () => {
    expect(problemsIn(good())).toEqual([])
  })

  it('refuses anything that is not an object at all', () => {
    for (const value of [null, undefined, 42, 'snapshot', []]) {
      expect(problemsIn(value).length, JSON.stringify(value ?? null)).toBeGreaterThan(0)
    }
  })

  it('checks the four groups that used to go unchecked', () => {
    // `auth`, `keys`, `about` and the locale entries were absent from this
    // function entirely, so each of these passed the gate and failed inside a
    // pane builder instead.
    expect(problemsIn(broken('auth', undefined))).toContain('auth is not an object')
    expect(problemsIn(broken('keys', undefined))).toContain('keys is not an object')
    expect(problemsIn(broken('about', undefined))).toContain('about is not an object')
    expect(problemsIn(broken('locales', [{ tag: 'klingon', nativeName: 'tlhIngan' }]))).toContain(
      'locales[0] is not a locale',
    )
  })

  it('names the exact field, not just the group', () => {
    // The diagnostic is the whole value of this function: a reader should not
    // have to diff two objects by eye to find the one bad field.
    const noHint = problemsIn({ ...good(), auth: { source: 'codex', keySet: false } })
    expect(noHint).toContain('auth.keyHint is not text')
    expect(noHint).toContain('auth.canStoreKey is not a boolean')

    const halfKey = {
      ...good(),
      keys: { toggleVisible: { accelerator: 'Control+Shift+M', shown: '⇧⌃M' } },
    }
    expect(problemsIn(halfKey)).toContain('keys.toggleVisible.unavailable is not a boolean')
    expect(problemsIn(halfKey)).toContain('keys.toggleAwake is missing')
  })

  it('refuses a credential source this build does not know', () => {
    // It selects which controls the Auth pane draws. An unknown one rendered
    // neither set.
    expect(problemsIn(broken('auth', { ...good().auth, source: 'gemini' }))).toContain(
      'auth.source is not a known source',
    )
  })

  it('still refuses the four it always checked', () => {
    expect(problemsIn(broken('locale', 'klingon')).join(' ')).toContain('locale')
    expect(problemsIn(broken('sizePercent', 'big'))).toContain('sizePercent is not a number')
    expect(problemsIn(broken('version', 7))).toContain('version is not text')
    expect(problemsIn(broken('persona', {})).length).toBeGreaterThan(0)
  })
})

describe('what a caller gets back', () => {
  it('hands back a persona with the fields the parser filled in', () => {
    // `parsePersona` accepts a persona written before themes existed and
    // defaults the theme. The check used to return only the problems, so the
    // caller rendered the ORIGINAL object -- and read `undefined` from a field
    // the type promised was a ThemeId. Validation passing is what made that
    // reachable.
    const { theme: _dropped, ...themeless } = DEFAULT_PERSONA
    const read = readSnapshot({ ...good(), persona: themeless })
    expect(read.ok).toBe(true)
    if (read.ok) expect(read.snapshot.persona.theme).toBe(DEFAULT_PERSONA.theme)
  })

  it('carries every other field through untouched', () => {
    const read = readSnapshot(good())
    expect(read.ok).toBe(true)
    if (read.ok) {
      expect(read.snapshot.auth).toEqual(good().auth)
      expect(read.snapshot.keys).toEqual(good().keys)
      expect(read.snapshot.sizePercent).toBe(good().sizePercent)
    }
  })
})

describe('the fields the catalog added', () => {
  it('refuses a snapshot with no persona list', () => {
    const { personas: _dropped, ...without } = good()
    const read = readSnapshot(without)
    expect(read.ok).toBe(false)
    if (!read.ok) expect(read.problems.join(' ')).toContain('personas')
  })

  it('refuses a snapshot with no problem list', () => {
    // `paint` reads `.length` on this directly. Unchecked, an absent field is
    // a TypeError inside a render, which surfaces as a blank window and a
    // console line -- the failure this whole module exists to turn into a
    // named problem BEFORE anything is drawn.
    const { personaProblems: _dropped, ...without } = good()
    const read = readSnapshot(without)
    expect(read.ok).toBe(false)
    if (!read.ok) expect(read.problems.join(' ')).toContain('personaProblems')
  })

  it('refuses a persona entry that is not an id and a name', () => {
    const read = readSnapshot({ ...good(), personas: [{ id: 'mochi' }] })
    expect(read.ok).toBe(false)
    if (!read.ok) expect(read.problems.join(' ')).toContain('personas[0]')
  })
})
