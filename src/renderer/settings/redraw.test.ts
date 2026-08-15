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
import type { SettingsSnapshot } from '@shared/ipc'
import { nextSignature, signatureOf } from './redraw'

/** The old boolean shape, so these tests read as they always did. */
const redrawn = (previous: string | null, next: Parameters<typeof signatureOf>[0]): boolean =>
  nextSignature(previous, next) !== null

const snapshot: SettingsSnapshot = {
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
  version: '0.0.1',
  about: { name: 'Mochi', repository: 'https://x', author: '@x', homepage: 'https://y' },
  auth: { source: 'codex', keySet: false, keyHint: '', canStoreKey: true },
  keys: {
    toggleVisible: { accelerator: 'Control+Shift+M', shown: '⌃⇧M', unavailable: false },
    toggleAwake: { accelerator: 'Control+Shift+L', shown: '⌃⇧L', unavailable: false },
    askWorkspace: { accelerator: 'Control+Shift+K', shown: '', unavailable: false },
  },
  sizePercent: 100,
  locales: [{ tag: 'en', nativeName: 'English' }],
}

const after = (over: Partial<SettingsSnapshot>): SettingsSnapshot => ({ ...snapshot, ...over })

describe('deciding whether to redraw', () => {
  it('does not redraw for a size change alone', () => {
    // The slider is live: main broadcasts once per animation frame while
    // somebody drags, and rebuilding mid-drag drops the thumb they are holding.
    const before = signatureOf(snapshot)
    expect(redrawn(before, after({ sizePercent: 150 }))).toBe(false)
  })

  it('redraws when a key is stored or removed', () => {
    // The bug this module exists for. Auth lives OUTSIDE the persona, so a
    // persona-only comparison returned false: the key was written, the state
    // was broadcast, and the window changed nothing -- then Remove deleted the
    // key and left it still reading as stored, with the button still enabled.
    const before = signatureOf(snapshot)
    const stored = after({
      auth: { ...snapshot.auth, keySet: true, keyHint: '••••WXYZ' },
    })
    expect(redrawn(before, stored)).toBe(true)
    expect(redrawn(signatureOf(stored), snapshot)).toBe(true)
  })

  it('redraws for the other things that live outside the persona', () => {
    const before = signatureOf(snapshot)
    expect(
      redrawn(
        before,
        after({
          keys: {
            ...snapshot.keys,
            toggleAwake: { accelerator: 'Control+Alt+J', shown: '⌃⌥J', unavailable: false },
          },
        }),
      ),
      'a rebound shortcut',
    ).toBe(true)
    expect(
      redrawn(before, after({ auth: { ...snapshot.auth, source: 'apikey' } })),
      'the credential source changed',
    ).toBe(true)
  })

  it('redraws when the persona changes', () => {
    const before = signatureOf(snapshot)
    expect(redrawn(before, after({ persona: { ...DEFAULT_PERSONA, theme: 'lilac' } }))).toBe(true)
  })

  it('does not redraw for an identical snapshot', () => {
    expect(redrawn(signatureOf(snapshot), { ...snapshot })).toBe(false)
  })

  it('compares every field, including ones added later', () => {
    // A rest spread rather than a list of fields to keep in step: the guard
    // covers a field added to the snapshot next year without anybody
    // remembering to extend it. This asserts the shape of that promise.
    const keys = Object.keys(JSON.parse(signatureOf(snapshot)) as object)
    const expected = Object.keys(snapshot).filter((k) => k !== 'sizePercent')
    expect(keys.sort()).toEqual(expected.sort())
  })

  it('does not redraw over a difference in key order alone', () => {
    // `JSON.stringify` follows insertion order, so two snapshots holding
    // identical values serialise differently if main ever builds one along a
    // second path -- and the window would rebuild itself mid-interaction over
    // a change nobody made.
    const reordered = Object.fromEntries(
      Object.keys(snapshot)
        .sort()
        .reverse()
        .map((key) => [key, snapshot[key as keyof typeof snapshot]]),
    ) as unknown as typeof snapshot
    expect(signatureOf(reordered)).toBe(signatureOf(snapshot))
    expect(nextSignature(signatureOf(snapshot), reordered)).toBeNull()
  })

  it('hands back the signature it computed rather than making the caller redo it', () => {
    // The whole reason this is not a boolean: the caller stores the signature,
    // and recomputing it means a second `JSON.stringify` of the entire snapshot
    // on a path that runs once per animation frame during a drag.
    const changed = after({ locale: 'zh-CN' })
    expect(nextSignature(signatureOf(snapshot), changed)).toBe(signatureOf(changed))
  })
})
