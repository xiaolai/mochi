import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PERSONA, PERSONA_LIMITS } from '@shared/persona'
import { REVEALABLE } from '@shared/ipc'
import { WEB_SEARCH_MODES } from '@shared/delegation'
import {
  applyChange,
  applyLookup,
  applyScreen,
  folderFor,
  listAvatars,
  listCapabilities,
  listGrants,
  listKeys,
  listLookup,
  listScreen,
} from './settings'
import { DEFAULT_GRANTS, GRANTS } from '@shared/grants'
import type { Usage } from './store/usage'
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

describe('how a lookup runs', () => {
  const isProfileName = (value: unknown): boolean =>
    typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value)

  it('says when the workspace is only the default, rather than making the window guess', () => {
    // The default is a path main computes. A window that recomputed it would be
    // the second place that rule lives, and the two would drift.
    const shown = listLookup({
      workspace: '/u/workspace',
      defaultWorkspace: '/u/workspace',
      webSearch: 'follow',
      profile: null,
      profilePath: null,
      codexFound: true,
    })
    expect(shown.workspaceIsDefault).toBe(true)
    expect(
      listLookup({
        workspace: '/somewhere/else',
        defaultWorkspace: '/u/workspace',
        webSearch: 'follow',
        profile: null,
        profilePath: null,
        codexFound: true,
      }).workspaceIsDefault,
    ).toBe(false)
  })

  it('offers every value Codex accepts, and does not invent one', () => {
    // This project shipped `on`/`off` once. It typechecked, its tests passed —
    // they asserted the string reached the argv — and the CLI rejected it on the
    // first real run.
    const shown = listLookup({
      workspace: '/w',
      defaultWorkspace: '/w',
      webSearch: 'follow',
      profile: null,
      profilePath: null,
      codexFound: true,
    })
    expect(shown.webSearchModes).toEqual([...WEB_SEARCH_MODES])
  })

  it('names no profile file when no profile is in force', () => {
    // Pointing at a path that is not there is worse than pointing at nothing.
    const shown = listLookup({
      workspace: '/w',
      defaultWorkspace: '/w',
      webSearch: 'follow',
      profile: null,
      profilePath: '/somewhere/mochi.config.toml',
      codexFound: true,
    })
    expect(shown.profilePath).toBeNull()
  })

  it('refuses a workspace that is not a full path', () => {
    // A relative path resolves against whatever the process considers its
    // working directory — `/` for a packaged app — so it would silently point
    // her somewhere nobody chose. Refusing here is what lets somebody be told.
    for (const bad of ['notes', './notes', '../notes', '~/notes', '']) {
      const asked = applyLookup({ workspace: bad }, isProfileName)
      expect(asked.ok, bad).toBe(false)
    }
    expect(applyLookup({ workspace: '/Users/them/notes' }, isProfileName).ok).toBe(true)
  })

  it('refuses a web search value Codex does not have', () => {
    expect(applyLookup({ webSearch: 'on' }, isProfileName).ok).toBe(false)
    expect(applyLookup({ webSearch: 'live' }, isProfileName).ok).toBe(true)
  })

  it('refuses a profile name that would reach out of Codex home', () => {
    // It becomes `<name>.config.toml` inside `$CODEX_HOME`.
    expect(applyLookup({ profile: '../escape' }, isProfileName).ok).toBe(false)
    expect(applyLookup({ profile: 'mochi' }, isProfileName).ok).toBe(true)
  })

  it('takes null as a profile, because none is a real choice', () => {
    const asked = applyLookup({ profile: null }, isProfileName)
    expect(asked.ok).toBe(true)
    if (!asked.ok) return
    expect(asked.change.profile).toBeNull()
  })

  it('carries only the fields it was given, so an absent one is left alone', () => {
    // The same reason `applyChange` folds field by field: a spread would let a
    // page clear settings it never mentioned.
    const asked = applyLookup({ webSearch: 'live' }, isProfileName)
    expect(asked.ok).toBe(true)
    if (!asked.ok) return
    expect(asked.change).toEqual({ webSearch: 'live' })
  })
})

/** A readable record of use, which is not the same as an unreadable one. */
function readable(entries: readonly (readonly [string, number])[] = []): Usage {
  return { ok: true, used: new Map(entries) }
}

describe('the four standing grants, as the window draws them', () => {
  it('lists all four, in the order they are declared', () => {
    expect(listGrants(DEFAULT_GRANTS, readable()).map((one) => one.id)).toEqual([...GRANTS])
  })

  it('carries whether each is allowed', () => {
    const rows = listGrants({ ...DEFAULT_GRANTS, ask_workspace: false }, readable())
    expect(rows.find((one) => one.id === 'ask_workspace')?.allowed).toBe(false)
    expect(rows.find((one) => one.id === 'remember_this')?.allowed).toBe(true)
  })

  it('says a capability has NEVER been used when nothing has recorded one', () => {
    const rows = listGrants(DEFAULT_GRANTS, readable())
    expect(rows.find((one) => one.id === 'ask_workspace')?.lastUsed).toEqual({ kind: 'never' })
  })

  it('carries the real time when there is one', () => {
    const rows = listGrants(DEFAULT_GRANTS, readable([['remember_this', 1_700_000_000_000]]))
    expect(rows.find((one) => one.id === 'remember_this')?.lastUsed).toEqual({
      kind: 'at',
      at: 1_700_000_000_000,
    })
  })

  it('does NOT claim a last use for the two nothing records', () => {
    // 5b's acceptance: real, or the row does not claim it. "Never used" about a
    // microphone somebody has been talking into all morning would be a claim,
    // and it is a different answer from "nothing writes this down".
    const rows = listGrants(DEFAULT_GRANTS, readable())
    expect(rows.find((one) => one.id === 'microphone')?.lastUsed).toEqual({ kind: 'not-recorded' })
    expect(rows.find((one) => one.id === 'speak_first')?.lastUsed).toEqual({ kind: 'not-recorded' })
  })

  it('ignores a recorded time for something that is not one of the four', () => {
    const rows = listGrants(DEFAULT_GRANTS, readable([['recall_conversations', 1_000]]))
    expect(rows).toHaveLength(GRANTS.length)
  })
})

describe('the two global keys, as the window shows them', () => {
  it('names what each one does rather than our word for it', () => {
    // "rest" is the internal id. "Let her rest, or wake her" is the thing
    // somebody scanning this pane is actually looking for.
    const shown = listKeys([{ id: 'rest', accelerator: 'Control+Shift+L', refused: null }])
    expect(shown[0]?.what).toContain('rest')
    expect(shown[0]?.accelerator).toBe('Control+Shift+L')
    expect(shown[0]?.refused).toBeNull()
  })

  it('keeps the row for a key another application took', () => {
    // THE case worth seeing. Hiding it would make it look as though this
    // application never wanted a key, which is the silent failure the row
    // exists to end.
    const shown = listKeys([
      { id: 'hide', accelerator: 'Control+Shift+M', refused: 'another application already has it' },
    ])
    expect(shown).toHaveLength(1)
    expect(shown[0]?.refused).toBe('another application already has it')
  })

  it('still shows something for an id it has no wording for', () => {
    const shown = listKeys([{ id: 'wobble', accelerator: 'F13', refused: null }])
    expect(shown[0]?.what).toBe('wobble')
  })
})

describe('what she looks like on the desktop', () => {
  it('offers every side that can be CHOSEN, not every side that fits now', () => {
    // What fits shrinks as she is dragged into a corner, and that is the
    // renderer's answer. A settings window whose options changed when somebody
    // moved her would be describing this moment instead of a setting.
    const shown = listScreen('above', ['auto', 'above', 'below', 'left', 'right'])
    expect(shown.bubbleSide).toBe('above')
    expect(shown.sides).toEqual(['auto', 'above', 'below', 'left', 'right'])
  })

  it('takes a side it knows', () => {
    expect(applyScreen({ bubbleSide: 'left' }, ['auto', 'left'])).toEqual({
      ok: true,
      change: { bubbleSide: 'left' },
    })
  })

  it('refuses a side nothing can honour, with a sentence', () => {
    const refused = applyScreen({ bubbleSide: 'diagonally' }, ['auto', 'left'])
    expect(refused.ok).toBe(false)
    if (refused.ok) return
    expect(refused.why).toContain('diagonally')
  })

  it('changes nothing when nothing was asked for', () => {
    expect(applyScreen({}, ['auto'])).toEqual({ ok: true, change: {} })
  })
})

describe('whether she can look anything up at all', () => {
  it('carries the answer, so the group can mark itself', () => {
    // Without the CLI she cannot look anything up, and the failure otherwise
    // presents as her declining to help.
    const shown = listLookup({
      workspace: '/w',
      defaultWorkspace: '/w',
      webSearch: 'follow',
      profile: null,
      profilePath: null,
      codexFound: false,
    })
    expect(shown.codexFound).toBe(false)
  })
})

describe('a record of use that could not be read', () => {
  it('does not claim "never" for a capability it cannot answer for', () => {
    // The distinction the union exists for. A corrupt `usage.json` used to
    // answer the same empty map as a fresh install, so every row said "Never
    // used" — a claim, about capabilities she may have called all morning.
    const rows = listGrants(DEFAULT_GRANTS, { ok: false, why: 'usage.json is not valid JSON' })
    for (const row of rows) expect(row.lastUsed).toEqual({ kind: 'not-recorded' })
  })

  it('still says whether each one is allowed', () => {
    // The switch is on disk in a different file. Losing the record of use must
    // not lose the permission beside it.
    const rows = listGrants({ ...DEFAULT_GRANTS, microphone: false }, { ok: false, why: 'gone' })
    expect(rows.find((one) => one.id === 'microphone')?.allowed).toBe(false)
  })
})

describe('a payload that is not the shape the type promises', () => {
  it('refuses a workspace that is not a string, rather than throwing', () => {
    // `LookupChange` is the WIRE shape and a page can put anything in it.
    // `.trim()` on an object throws out of the IPC handler, which reaches the
    // window as a rejected invoke instead of the refusal this function promises.
    const refused = applyLookup({ workspace: {} as unknown as string }, () => true)
    expect(refused.ok).toBe(false)
  })

  it('refuses a name that is not a string, rather than throwing', () => {
    const refused = applyChange(DEFAULT_PERSONA, { id: 'mochi', name: 7 as unknown as string }, [])
    expect(refused.ok).toBe(false)
  })

  it('refuses a name the persona format would then reject on load', () => {
    // This writer allowed 64 while `PERSONA_LIMITS.name` is 60, so a name of 61
    // to 64 characters SAVED and then failed to load — accepted, written, and
    // gone on the next launch.
    const tooLong = 'x'.repeat(PERSONA_LIMITS.name + 1)
    expect(applyChange(DEFAULT_PERSONA, { id: 'mochi', name: tooLong }, []).ok).toBe(false)
    // And the longest one the format accepts still goes through.
    const longest = 'x'.repeat(PERSONA_LIMITS.name)
    expect(applyChange(DEFAULT_PERSONA, { id: 'mochi', name: longest }, []).ok).toBe(true)
  })
})
