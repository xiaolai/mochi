/**
 * The shape main promises the settings window.
 *
 * This is one half of a contract whose other half — `renderer/settings/
 * snapshot.ts` — validates it on arrival. Two descriptions of one value is the
 * pair that drifts, and until this was pulled out of `index.ts` only the
 * receiving half could be tested.
 */

import { describe, expect, it } from 'vitest'
import { DEFAULT_SOUND } from '@shared/sound'
import { DEFAULT_IDLE_MS } from '@shared/companion'
import { DEFAULT_PERSONA } from '@shared/persona'
import { MOCHI } from '@shared/avatar-spec'
import { DEFAULT_SHORTCUTS, SHORTCUT_IDS } from '@shared/shortcuts'
import { unknownDelegation } from '../codex/facts'
import { DEFAULT_DELEGATION } from '@shared/delegation'
import { buildSnapshot, type SnapshotInput } from './view'

const input: SnapshotInput = {
  delegation: unknownDelegation(DEFAULT_DELEGATION),
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
  version: '1.2.3',
  about: { name: 'mochi', version: '1.2.3', repository: 'r', author: 'a', homepage: 'h' },
  sizePercent: 100,
  shortcuts: DEFAULT_SHORTCUTS,
  claimed: {
    toggleVisible: DEFAULT_SHORTCUTS.toggleVisible,
    toggleAwake: null,
    askWorkspace: DEFAULT_SHORTCUTS.askWorkspace,
  },
  credentialSource: 'codex',
  key: { set: false, hint: '' },
  canStoreKey: true,
}

describe('the snapshot main sends', () => {
  it('carries no key, under any field name', () => {
    // The one invariant worth more than all the others here. `auth` says
    // whether a key is stored and its last four characters; the key itself has
    // exactly one destination in main and the renderer is not it.
    const snapshot = buildSnapshot({
      ...input,
      credentialSource: 'apikey',
      key: { set: true, hint: '••••WXYZ' },
    })
    const serialised = JSON.stringify(snapshot)
    expect(serialised).not.toContain('sk-')
    expect(snapshot.auth).toEqual({
      source: 'apikey',
      keySet: true,
      keyHint: '••••WXYZ',
      canStoreKey: true,
    })
    // Nothing beyond those four. A field added here is a field the window can
    // read, so the list is pinned rather than spot-checked.
    expect(Object.keys(snapshot.auth).sort()).toEqual([
      'canStoreKey',
      'keyHint',
      'keySet',
      'source',
    ])
  })

  it('shows a chord that could not be claimed, marked as taken', () => {
    // An absence would read as though the setting had not saved. The window has
    // to show the combination you chose even when another application owns it.
    const { keys } = buildSnapshot(input)
    expect(keys.toggleAwake.accelerator).toBe(DEFAULT_SHORTCUTS.toggleAwake)
    expect(keys.toggleAwake.unavailable).toBe(true)
    expect(keys.toggleVisible.unavailable).toBe(false)
  })

  it('spells each chord for a person, not for Electron', () => {
    // `describeAccelerator` needs the platform, which is why this happens in
    // main: the renderer has no business knowing which OS it is on.
    const { keys } = buildSnapshot(input)
    for (const id of SHORTCUT_IDS) {
      expect(keys[id].shown, id).not.toBe('')
      expect(keys[id].shown, id).not.toContain('CommandOrControl')
    }
  })

  it('falls back to the raw accelerator when a stored chord will not parse', () => {
    // Rather than an empty button. A binding this build cannot read is still
    // something the user set, and showing nothing loses the only clue to why
    // the key does not work.
    const { keys } = buildSnapshot({
      ...input,
      shortcuts: { ...DEFAULT_SHORTCUTS, toggleAwake: 'Nonsense+Nope' },
    })
    expect(keys.toggleAwake.shown).toBe('Nonsense+Nope')
  })

  it('offers every locale by its own name', () => {
    // AGENTS.md: a language name is never translated, or somebody who cannot
    // read the current interface has no way back.
    const { locales } = buildSnapshot(input)
    expect(locales.length).toBeGreaterThan(1)
    for (const entry of locales) expect(entry.nativeName.trim(), entry.tag).not.toBe('')
    expect(new Set(locales.map((l) => l.nativeName)).size).toBe(locales.length)
  })

  it('does not copy the manifest version into the About block', () => {
    // `About` carries one; the snapshot declares four fields here and a
    // `version` at the top level. Assigning the whole record put a fifth field
    // on the wire that the type denied, unread by the pane and counted by the
    // redraw signature.
    const snapshot = buildSnapshot(input)
    expect(Object.keys(snapshot.about).sort()).toEqual(['author', 'homepage', 'name', 'repository'])
    expect(snapshot.version).toBe('1.2.3')
  })
})
