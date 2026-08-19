import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PERSONA } from '@shared/persona'
import { REVEALABLE } from '@shared/ipc'
import { applyChange, folderFor, listAvatars, listCapabilities } from './settings'
import { createRegistry } from '@shared/capability/registry'
import { parseManifest } from '@shared/capability/manifest'

function avatarFolder(names: readonly string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'mochi-avatars-'))
  mkdirSync(root, { recursive: true })
  for (const name of names) writeFileSync(join(root, name), '{}')
  return root
}

describe('what somebody can wear', () => {
  it('offers the built-in as null, which is what a persona stores', () => {
    // Not a made-up id. `avatarId: null` already means the shipped face, so a
    // name invented here would be a second way to say one thing and the
    // resolver would have to learn the fake one.
    const avatars = listAvatars(avatarFolder([]))
    expect(avatars).toEqual([{ id: null, builtIn: true }])
  })

  it('lists the json files beside it, sorted, without their extension', () => {
    const avatars = listAvatars(avatarFolder(['zebra.json', 'mine.json', 'apple.json']))
    expect(avatars.map((a) => a.id)).toEqual([null, 'apple', 'mine', 'zebra'])
  })

  it('ignores everything that is not a usable avatar name', () => {
    // The names become path segments through `resolveAvatarById`. The example
    // and the readme are shipped alongside on purpose and are not avatars.
    const avatars = listAvatars(
      avatarFolder(['mochi.json.example', 'README.txt', 'notes.md', 'good.json']),
    )
    expect(avatars.map((a) => a.id)).toEqual([null, 'good'])
  })

  it('answers with the built-in when the folder is not there at all', () => {
    // Ordinary on a fresh install, not an error to report.
    expect(listAvatars(join(tmpdir(), 'mochi-nonexistent-avatars'))).toEqual([
      { id: null, builtIn: true },
    ])
  })
})

describe('changing a persona', () => {
  const AVATARS = ['mine', 'other']

  it('changes only the fields it was given', () => {
    const changed = applyChange(
      DEFAULT_PERSONA,
      { id: DEFAULT_PERSONA.id, voice: 'cedar' },
      AVATARS,
    )
    expect(changed.ok).toBe(true)
    if (!changed.ok) return
    expect(changed.persona.voice).toBe('cedar')
    expect(changed.persona.name).toBe(DEFAULT_PERSONA.name)
    expect(changed.persona.style).toBe(DEFAULT_PERSONA.style)
  })

  it('cannot reach a field it was not given, whatever the page sent', () => {
    // Spreading the change over the persona would have been one line and would
    // have let a page set `id`, `version` or `instructions`. `id` keys her
    // memory and her transcripts.
    const sneaky = { id: DEFAULT_PERSONA.id, name: 'Renamed', style: 'be rude', version: 99 }
    const changed = applyChange(DEFAULT_PERSONA, sneaky, AVATARS)
    expect(changed.ok).toBe(true)
    if (!changed.ok) return
    expect(changed.persona.name).toBe('Renamed')
    expect(changed.persona.style).toBe(DEFAULT_PERSONA.style)
    expect(changed.persona.version).toBe(DEFAULT_PERSONA.version)
    expect(changed.persona.id).toBe(DEFAULT_PERSONA.id)
  })

  it('refuses a voice that does not exist', () => {
    const changed = applyChange(DEFAULT_PERSONA, { id: 'mochi', voice: 'gandalf' }, AVATARS)
    expect(changed.ok).toBe(false)
  })

  it('refuses an avatar that is not on disk', () => {
    // Checked against the folder, not against the character set. A persona
    // naming an absent avatar falls back to the built-in silently, which is the
    // "the app ignored my file" failure the avatar store exists to avoid.
    expect(applyChange(DEFAULT_PERSONA, { id: 'mochi', avatarId: 'ghost' }, AVATARS).ok).toBe(false)
    expect(applyChange(DEFAULT_PERSONA, { id: 'mochi', avatarId: 'mine' }, AVATARS).ok).toBe(true)
  })

  it('allows null, because null is how you ask for the built-in', () => {
    const changed = applyChange(DEFAULT_PERSONA, { id: 'mochi', avatarId: null }, AVATARS)
    expect(changed.ok).toBe(true)
    if (!changed.ok) return
    expect(changed.persona.avatarId).toBeNull()
  })

  it('refuses a blank name rather than leaving an entry nobody can point at', () => {
    expect(applyChange(DEFAULT_PERSONA, { id: 'mochi', name: '   ' }, AVATARS).ok).toBe(false)
  })
})

describe('what she can do', () => {
  const parsed = parseManifest({
    name: 'weather',
    description: 'Look outside.',
    parameters: {
      type: 'object',
      properties: { where: { type: 'string', description: 'Where.' } },
      required: ['where'],
    },
  })
  if (!parsed.ok) throw new Error('the fixture itself is invalid')

  it('lists what is on the wire, with the description she was given', () => {
    // One list, and everything on it is something she can actually call. The
    // second half of this — capabilities found in a user's folder, shown with
    // their descriptions and marked refused — went with the folder that fed it,
    // and the `state`/`why` fields that carried the distinction went with it.
    const listed = listCapabilities(createRegistry([parsed.manifest]))
    expect(listed).toEqual([{ name: 'weather', description: 'Look outside.' }])
  })

  it('says nothing at all when a build has none', () => {
    expect(listCapabilities(createRegistry([]))).toEqual([])
  })
})

describe('naming a folder', () => {
  it('maps a kind to a location, which is the only place that mapping is made', () => {
    // Nothing crossing the bridge is a path. A renderer that could hand main an
    // arbitrary one would be a file browser with the user's authority.
    expect(folderFor('/u', 'avatars')).toBe(join('/u', 'avatars'))
    expect(folderFor('/u', 'personas')).toBe(join('/u', 'personas'))
  })

  it('has no capabilities folder to offer, because nothing loads from one', () => {
    // `capabilities` was revealable while a person could put one there. Showing
    // it now would offer a "Show" button that CREATES the folder — pointing
    // somebody at a place to put work that this build would then ignore.
    expect(REVEALABLE).toEqual(['avatars', 'personas'])
  })
})
