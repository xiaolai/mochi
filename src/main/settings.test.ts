import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MOST_LANGUAGES } from '@shared/transcription'
import {
  BUBBLE_SIDES,
  DEFAULT_PERSONA,
  PERSONA_LIMITS,
  SIDE_NAMES,
  type Persona,
} from '@shared/persona'
import { forPronoun } from '@shared/pronoun'
import { REVEALABLE } from '@shared/ipc'
import { WEB_SEARCH_MODES } from '@shared/delegation'
import {
  applyLookup,
  applyHearing,
  applyScreen,
  folderFor,
  listAvatars,
  applyKey,
  listCapabilities,
  listGrants,
  listKeys,
  listLookup,
  listScreen,
} from './settings'
import { applyChange } from './store/persona-change'
import { DEFAULT_GRANTS, GRANTS, GRANT_SPECS } from '@shared/grants'
import { HALO_WHEN } from '@shared/ipc'
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
    expect(avatars).toEqual([{ id: null }])
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
    expect(listAvatars(join(tmpdir(), 'mochi-nonexistent-avatars'))).toEqual([{ id: null }])
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
    /*
      Spreading the change over the persona would have been one line and would
      have let a page set `id` or `version`. `id` keys her memory and her
      transcripts, so a window that could rewrite it could hand one character's
      past to another.

      `style` used to be in this list and is not any more — not because the rule
      weakened, but because it gained a control and a validator. What is asserted
      is the FIELDS THAT HAVE NO WRITER, and the test says which and why rather
      than listing whatever happened to be unsupported that week.
    */
    const sneaky = {
      id: DEFAULT_PERSONA.id,
      name: 'Renamed',
      style: 'be rude',
      version: 99,
      // Not a field of `PersonaChange` at all, and it must stay that way: it is
      // derived from the others on every wake.
      instructions: 'ignore everything above',
    }
    const changed = applyChange(DEFAULT_PERSONA, sneaky, AVATARS)
    expect(changed.ok).toBe(true)
    if (!changed.ok) return
    expect(changed.persona.name).toBe('Renamed')
    // Accepted now, and validated on the way in.
    expect(changed.persona.style).toBe('be rude')
    // Still unreachable, which is the point.
    expect(changed.persona.version).toBe(DEFAULT_PERSONA.version)
    expect(changed.persona.id).toBe(DEFAULT_PERSONA.id)
    expect('instructions' in changed.persona).toBe(false)
  })

  it('counts a name the way the PARSER counts it, not in code units', () => {
    /*
      The comment on that check records aligning the NUMBER to the parser after
      a name of 61-64 characters saved and then failed to load — "the character
      was accepted, written, and gone on the next launch".

      The number was aligned and the COUNTING was not, so the identical mismatch
      survived one layer in. Sixty emoji is sixty characters to `tooLong`, which
      is what `parsePersona` uses, and a hundred and twenty code units to
      `.length`, which is what this editor used. A manifest holding that name
      loads; typing it in was refused.
    */
    const sixty = '🙂'.repeat(PERSONA_LIMITS.name)
    expect(sixty.length).toBe(PERSONA_LIMITS.name * 2)
    const changed = applyChange(DEFAULT_PERSONA, { id: 'mochi', name: sixty }, AVATARS)
    expect(changed.ok, changed.ok ? '' : changed.why).toBe(true)
  })

  it('still refuses one character over the limit', () => {
    // The bound has to bind, or the alignment above is just a wider hole. And
    // `tooLong` keeps its second half — a code-unit ceiling — so a name that is
    // few characters and enormous on the wire is still refused.
    const over = applyChange(
      DEFAULT_PERSONA,
      { id: 'mochi', name: '🙂'.repeat(PERSONA_LIMITS.name + 1) },
      AVATARS,
    )
    expect(over.ok).toBe(false)
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
    const listed = listCapabilities(createRegistry([parsed.manifest]).tools)
    expect(listed).toEqual([{ name: 'weather', description: 'Look outside.' }])
  })

  it('says nothing at all when a build has none', () => {
    expect(listCapabilities(createRegistry([]).tools)).toEqual([])
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
      profileExists: false,
      codex: READY,
    })
    expect(shown.workspaceIsDefault).toBe(true)
    expect(
      listLookup({
        workspace: '/somewhere/else',
        defaultWorkspace: '/u/workspace',
        webSearch: 'follow',
        profile: null,
        profilePath: null,
        profileExists: false,
        codex: READY,
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
      profileExists: false,
      codex: READY,
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
      profileExists: false,
      codex: READY,
    })
    expect(shown.profilePath).toBeNull()
  })

  it('claims no profile file exists when no profile is in force', () => {
    // Even when something IS at the path handed in. There is no profile, so
    // there is no file of its to be there — and the pane draws the sentence and
    // the Show button off this, so a stray `true` here is a button that reveals
    // a file belonging to a setting nobody has made.
    const shown = listLookup({
      workspace: '/w',
      defaultWorkspace: '/w',
      webSearch: 'follow',
      profile: null,
      profilePath: '/somewhere/mochi.config.toml',
      profileExists: true,
      codex: READY,
    })
    expect(shown.profileExists).toBe(false)
  })

  it('reports the file as there when a profile is in force and it is', () => {
    const shown = listLookup({
      workspace: '/w',
      defaultWorkspace: '/w',
      webSearch: 'follow',
      profile: 'mochi',
      profilePath: '/somewhere/mochi.config.toml',
      profileExists: true,
      codex: READY,
    })
    expect(shown.profileExists).toBe(true)
    expect(shown.profilePath).toBe('/somewhere/mochi.config.toml')
  })

  it('reports the file as missing when the profile names one that was never written', () => {
    // A profile is a NAME. Nothing guarantees a file, and the pane said
    // "settings for it live in <path>" about paths with nothing at them.
    const shown = listLookup({
      workspace: '/w',
      defaultWorkspace: '/w',
      webSearch: 'follow',
      profile: 'never-made',
      profilePath: '/somewhere/never-made.config.toml',
      profileExists: false,
      codex: READY,
    })
    expect(shown.profileExists).toBe(false)
    expect(shown.profilePath).toBe('/somewhere/never-made.config.toml')
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

  it('does NOT claim a last use for the row nothing records', () => {
    // 5b's acceptance: real, or the row does not claim it. "Never used" about
    // something the ledger does not write down would be a claim, and it is a
    // different answer from "nothing writes this down".
    //
    // One row rather than two: `microphone` was the other, and it is gone.
    // Derived from the specs rather than named, so a grant that stops being a
    // tool call is covered without anybody remembering to add it here.
    const rows = listGrants(DEFAULT_GRANTS, readable())
    const untracked = GRANT_SPECS.filter((one) => one.capabilities.length === 0).map(
      (one) => one.id,
    )
    expect(untracked).not.toEqual([])
    for (const id of untracked) {
      expect(rows.find((one) => one.id === id)?.lastUsed).toEqual({ kind: 'not-recorded' })
    }
  })

  it('ignores a recorded time for something that is not one of the four', () => {
    const rows = listGrants(DEFAULT_GRANTS, readable([['recall_conversations', 1_000]]))
    expect(rows).toHaveLength(GRANTS.length)
  })
})

describe('the two global keys, as the window shows them', () => {
  const SAYS = { rest: 'Let her rest, or wake her', hide: 'Hide her, or bring her back' }
  const SHIPPED = { rest: 'Control+Shift+L', hide: 'Control+Shift+M' }

  it('names what each one does rather than our word for it', () => {
    // "rest" is the internal id. "Let her rest, or wake her" is the thing
    // somebody scanning this pane is actually looking for.
    const shown = listKeys(
      [{ id: 'rest', accelerator: 'Control+Shift+L', refused: null }],
      SAYS,
      SHIPPED,
    )
    expect(shown[0]?.what).toContain('rest')
    expect(shown[0]?.accelerator).toBe('Control+Shift+L')
    expect(shown[0]?.refused).toBeNull()
  })

  it('keeps the row for a key another application took', () => {
    // THE case worth seeing. Hiding it would make it look as though this
    // application never wanted a key, which is the silent failure the row
    // exists to end.
    const shown = listKeys(
      [
        {
          id: 'hide',
          accelerator: 'Control+Shift+M',
          refused: 'another application already has it',
        },
      ],
      SAYS,
      SHIPPED,
    )
    expect(shown).toHaveLength(1)
    expect(shown[0]?.refused).toBe('another application already has it')
  })

  it('still shows something for an id it has no wording for', () => {
    const shown = listKeys([{ id: 'wobble', accelerator: 'F13', refused: null }], SAYS, SHIPPED)
    expect(shown[0]?.what).toBe('wobble')
  })

  it('calls a key unedited when it is on what ships', () => {
    // The Reset button reads this. A row that reported itself edited while
    // sitting on the default would offer a reset that changes nothing.
    const shown = listKeys(
      [{ id: 'rest', accelerator: 'Control+Shift+L', refused: null }],
      SAYS,
      SHIPPED,
    )
    expect(shown[0]?.edited).toBe(false)
  })

  it('calls a key edited when somebody has moved it', () => {
    const shown = listKeys([{ id: 'rest', accelerator: 'Alt+F9', refused: null }], SAYS, SHIPPED)
    expect(shown[0]?.edited).toBe(true)
  })

  it('calls an id it does not ship unedited, so a reset cannot unbind it', () => {
    // It has no default to be edited away from, and `true` here would offer a
    // reset that sends `null` — which deletes a stored answer that is the only
    // thing binding it.
    const shown = listKeys([{ id: 'wobble', accelerator: 'F13', refused: null }], SAYS, SHIPPED)
    expect(shown[0]?.edited).toBe(false)
  })
})

describe('rebinding one global key', () => {
  const SHIPPED = { rest: 'Control+Shift+L', hide: 'Control+Shift+M' }
  const BOUND = { rest: 'Control+Shift+L', hide: 'Control+Shift+M' }

  it('accepts a usable combination for a key this build has', () => {
    const asked = applyKey({ id: 'rest', accelerator: 'Alt+F9' }, BOUND, SHIPPED)
    expect(asked).toEqual({ ok: true, id: 'rest', accelerator: 'Alt+F9' })
  })

  it('resolves null to what the app ships, rather than storing today words', () => {
    // `null` is a reset, and the resolved value is what gets registered. A
    // handler that registered `null` would unbind the key.
    const asked = applyKey({ id: 'rest', accelerator: null }, BOUND, SHIPPED)
    expect(asked).toEqual({ ok: true, id: 'rest', accelerator: 'Control+Shift+L' })
  })

  it('refuses a key this build does not have', () => {
    const asked = applyKey({ id: 'wobble', accelerator: 'Alt+F9' }, BOUND, SHIPPED)
    expect(asked).toEqual({ ok: false, why: 'There is no key by that name.' })
  })

  it('refuses an id that is only on Object.prototype', () => {
    // `'toString' in shipped` is true. `in` would let this past the first check
    // and leave it to be caught three checks later, which stops being an
    // accident the moment somebody reorders the function.
    for (const id of ['toString', 'constructor', 'hasOwnProperty', '__proto__']) {
      const asked = applyKey({ id, accelerator: 'Alt+F9' }, BOUND, SHIPPED)
      expect(asked, id).toEqual({ ok: false, why: 'There is no key by that name.' })
    }
  })

  it('refuses a combination that would take a key from the whole machine', () => {
    // The one mistake here that is easy to make and very hard to undo.
    const asked = applyKey({ id: 'rest', accelerator: 'Shift+L' }, BOUND, SHIPPED)
    expect(asked.ok).toBe(false)
  })

  it('refuses a combination the other key already has', () => {
    /*
      Electron does NOT refuse this. `register` on a combination this process
      already holds replaces the handler and answers true — so without this
      check, binding rest to hide's combination would silently make one key do
      the other's job, and the pane would show both bound and working.
    */
    const asked = applyKey({ id: 'rest', accelerator: 'Control+Shift+M' }, BOUND, SHIPPED)
    expect(asked.ok).toBe(false)
    if (asked.ok) throw new Error('unreachable')
    expect(asked.why).toContain('already doing something else')
  })

  it('lets a key keep the combination it already has', () => {
    // Its OWN row is skipped, or saving a row without changing it would refuse.
    const asked = applyKey({ id: 'rest', accelerator: 'Control+Shift+L' }, BOUND, SHIPPED)
    expect(asked.ok).toBe(true)
  })

  it('refuses a reset that would collide with the other key', () => {
    // Reachable: move hide onto rest's shipped combination, then reset rest.
    // The default is held to the same rule as a choice, which is the one path
    // nobody thinks to test.
    const asked = applyKey(
      { id: 'rest', accelerator: null },
      { ...BOUND, hide: SHIPPED.rest },
      SHIPPED,
    )
    expect(asked.ok).toBe(false)
  })

  it('refuses anything that is not a string or null', () => {
    for (const accelerator of [7, {}, ['Alt+F9'], undefined]) {
      const asked = applyKey({ id: 'rest', accelerator } as never, BOUND, SHIPPED)
      expect(asked.ok, JSON.stringify(accelerator)).toBe(false)
    }
  })
})

/**
 * The two Codex answers these fixtures need, named once.
 *
 * `listLookup` does not compute this — main holds the last check and hands it
 * in, because probing spawns child processes with a deadline each and this runs
 * on every redraw of the window.
 */
const READY = { readiness: 'ready', remedy: null } as const
const MISSING = { readiness: 'not-installed', remedy: 'install' } as const

/**
 * Which side her words sit on, now that it is HERS.
 *
 * It was app-level, in `preferences.json`. Whether she shows words was already
 * the character's, so holding where they go on the machine split one feature
 * across two tabs — and left a live side control on the settings pane for a
 * character whose bubble was switched off.
 *
 * The subtlety worth pinning is `null`. "Nobody has been asked" and "somebody
 * chose auto" are different answers, and only the first may fall back to the
 * app-level value this replaced. Collapsing them would take a side deliberately
 * set to `auto` and quietly overwrite it with whatever the old file held.
 */
describe('which side her words sit on', () => {
  const HERS: Persona = { ...DEFAULT_PERSONA, id: 'loki' }

  it('starts at `auto`, which is a real answer and not an absence', () => {
    /*
      It was `null` for one commit, so a character nobody had touched could fall
      back to the app-level setting this field replaced. That made the control
      lie: every untouched persona showed the same inherited side, so a setting
      advertised as per-character behaved globally until somebody changed it.

      One state. A control shows a value somebody could have set, and it is the
      value in force.
    */
    expect(DEFAULT_PERSONA.bubbleSide).toBe('auto')
  })

  it.each([...BUBBLE_SIDES])('takes %s', (side) => {
    const out = applyChange(HERS, { id: 'loki', bubbleSide: side }, [])
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.persona.bubbleSide).toBe(side)
  })

  it('is named the same way here as it is in the menu bar', () => {
    /*
      One vocabulary. Her sheet grew this control with its own blunter words —
      `above`, `left`, `wherever there is room` — for a setting the tray already
      had names for, so picking "To her left" from the menu and then opening her
      sheet showed "left" and left somebody deciding whether those matched.
    */
    for (const side of BUBBLE_SIDES) {
      expect(SIDE_NAMES[side], side).toBeDefined()
      expect(forPronoun(SIDE_NAMES[side], 'she').trim().length).toBeGreaterThan(0)
    }
    expect(forPronoun(SIDE_NAMES.left, 'he')).toBe('To his left')
    // `auto` reads as a sentence, because it is not a fifth direction.
    expect(forPronoun(SIDE_NAMES.auto, 'it')).toBe('Wherever it fits')
  })

  it('refuses a side nothing can honour, with a sentence naming it', () => {
    const out = applyChange(HERS, { id: 'loki', bubbleSide: 'diagonally' }, [])
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.why).toContain('diagonally')
  })

  it('leaves every other field alone', () => {
    // One field per branch. `applyChange` rebuilds the persona, so a branch that
    // spread the wrong thing would quietly reset her name or her voice.
    const out = applyChange(
      { ...HERS, name: 'Loki', bubble: true },
      { id: 'loki', bubbleSide: 'left' },
      [],
    )
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.persona.name).toBe('Loki')
    expect(out.persona.bubble).toBe(true)
  })
})

describe('what she looks like on the desktop', () => {
  /** The two rest settings that travel with the bubble's side. */
  const REST = { halo: 'always', shoulderChip: true, sleepAfterMinutes: 15 } as const

  it('no longer carries the bubble’s side, which is hers', () => {
    /*
      It moved to `Persona.bubbleSide`. Whether she shows words was already the
      character's, and holding WHERE they go on this pane split one feature
      across two tabs — leaving a live side control here on a machine wearing a
      character with the bubble switched off.
    */
    const shown = listScreen(REST) as unknown as Record<string, unknown>
    expect(shown['bubbleSide']).toBeUndefined()
    expect(shown['sides']).toBeUndefined()
  })

  it('changes nothing when nothing was asked for', () => {
    expect(applyScreen({})).toEqual({ ok: true, change: {} })
  })

  it('carries both rest settings, so the pane can draw them', () => {
    const shown = listScreen({ halo: 'never' as const, shoulderChip: false, sleepAfterMinutes: 30 })
    expect(shown.halo).toBe('never')
    // Offered by main rather than held by the page, like `sides` and the sleep
    // choices: two lists is two answers to what may be chosen, and only one of
    // them is checked on the way back.
    expect(shown.haloChoices).toEqual([...HALO_WHEN])
    expect(shown.shoulderChip).toBe(false)
    expect(shown.sleepAfterMinutes).toBe(30)
    expect(shown.sleepAfterChoices).toContain(0)
  })

  it('takes a halo answer only from the three it offers', () => {
    for (const when of HALO_WHEN) {
      expect(applyScreen({ halo: when })).toEqual({ ok: true, change: { halo: when } })
    }
    /*
      It crosses a bridge, and this one decides whether an indicator is drawn.

      `true` is the value that would arrive from the control this replaced — a
      checkbox — and it must not be read as "yes, draw it": the grammar is three
      words now, and a value this side cannot read is not one it may act on.
    */
    expect(applyScreen({ halo: 'sometimes' }).ok).toBe(false)
    expect(applyScreen({ halo: true as unknown as string }).ok).toBe(false)
  })

  it('takes the shoulder control the same way, and refuses a string', () => {
    // The second switch on this pane, and the second chance to accept a
    // truthy string. `'false'` is the value that would arrive from a form and
    // turn a control ON while reading as off.
    expect(applyScreen({ shoulderChip: false })).toEqual({
      ok: true,
      change: { shoulderChip: false },
    })
    expect(applyScreen({ shoulderChip: 'false' as unknown as boolean }).ok).toBe(false)
  })

  it('refuses an idle timeout that is not one of the offered choices', () => {
    // Narrower than the store's own grammar, deliberately: the store takes any
    // whole minute up to an hour, which is right for a hand-edited file and
    // wrong for a page — 47 is a value no control here can express or show back.
    const refused = applyScreen({ sleepAfterMinutes: 47 })
    expect(refused.ok).toBe(false)
    if (refused.ok) return
    expect(refused.why).toContain('47')
    expect(applyScreen({ sleepAfterMinutes: 0 })).toEqual({
      ok: true,
      change: { sleepAfterMinutes: 0 },
    })
  })

  it('folds several changes in one message rather than taking only the first', () => {
    expect(applyScreen({ halo: 'listening', shoulderChip: false })).toEqual({
      ok: true,
      change: { halo: 'listening', shoulderChip: false },
    })
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
      profileExists: false,
      codex: MISSING,
    })
    expect(shown.codex).toEqual(MISSING)
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
    const rows = listGrants({ ...DEFAULT_GRANTS, speak_first: false }, { ok: false, why: 'gone' })
    expect(rows.find((one) => one.id === 'speak_first')?.allowed).toBe(false)
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

describe('the six fields that had no control until now', () => {
  /**
   * Every one of these was validated, persisted and settable only by hand-editing
   * a manifest. `faces` is the sharpest: it narrows the tool enum on the wire and
   * appears in her prompt, and it shipped with no way to set it.
   */
  const AVATARS = ['mine', 'other']

  function change(one: Record<string, unknown>) {
    return applyChange(DEFAULT_PERSONA, { id: DEFAULT_PERSONA.id, ...one }, AVATARS)
  }

  it('takes a pronoun, and refuses the retired one', () => {
    const set = change({ pronoun: 'he' })
    expect(set.ok && set.persona.pronoun).toBe('he')
    // `they` is readable in a stored file and mapped forward; a WINDOW may not
    // write it. A build may keep reading what it will not let you choose.
    expect(change({ pronoun: 'they' }).ok).toBe(false)
    expect(change({ pronoun: 'unicorn' }).ok).toBe(false)
  })

  it('lets what she calls you be emptied, because empty is an answer', () => {
    // `addressLine` omits the instruction entirely rather than telling her to
    // address somebody as "you" — a sentence that says nothing.
    const cleared = change({ addressUser: '   ' })
    expect(cleared.ok && cleared.persona.addressUser).toBe('')
  })

  it('takes one of the eight themes and nothing else', () => {
    expect(change({ theme: 'clay' }).ok).toBe(true)
    expect(change({ theme: 'octarine' }).ok).toBe(false)
    // A custom hue is an OBJECT, and no control sends one. A window that could
    // post one could set any colour on the interface.
    expect(change({ theme: { h: 20, s: 1, l: 0.5 } }).ok).toBe(false)
  })

  it('refuses an empty greeting, because the parser does', () => {
    // Saving one would write a manifest this build cannot load — the failure
    // that presents as "the app ate my character" one launch later.
    expect(change({ greeting: '' }).ok).toBe(false)
    const set = change({ greeting: 'as though they just came back' })
    expect(set.ok && set.persona.greeting.instruction).toBe('as though they just came back')
  })

  it('leaves the verbatim half of a moment alone', () => {
    // No control offers it. Overwriting it from a field that cannot express it
    // would silently discard something a manifest author wrote.
    const withVerbatim = {
      ...DEFAULT_PERSONA,
      greeting: { instruction: 'warmly', verbatim: 'Hello again.' },
    }
    const set = applyChange(withVerbatim, { id: withVerbatim.id, greeting: 'briskly' }, AVATARS)
    expect(set.ok && set.persona.greeting.verbatim).toBe('Hello again.')
  })

  it('takes faces in EMOTIONS order however they were sent', () => {
    const set = change({ faces: ['sleepy', 'happy', 'neutral'] })
    expect(set.ok && set.persona.faces).toEqual(['neutral', 'happy', 'sleepy'])
  })

  it('lets a character wear exactly one face, and refuses one that is not real', () => {
    const none = change({ faces: [] })
    expect(none.ok && none.persona.faces).toEqual([])
    expect(change({ faces: ['smug'] }).ok).toBe(false)
    expect(change({ faces: 'happy' }).ok).toBe(false)
  })

  it('refuses a prompt past the limit the parser enforces', () => {
    expect(change({ style: 'x'.repeat(PERSONA_LIMITS.style + 1) }).ok).toBe(false)
    expect(change({ style: '' }).ok).toBe(true)
  })
})

/**
 * Which languages she should expect to hear.
 *
 * The one that separates this from `readLanguages`: a FILE is read tolerantly,
 * because it may have been written by another version, and a CONTROL somebody
 * just operated is refused loudly. Filtering a person's selection down and
 * telling them it saved is the failure this whole pane exists to remove.
 */
describe('which languages she should expect to hear', () => {
  it('changes nothing when nothing was asked for', () => {
    expect(applyHearing({})).toEqual({ ok: true, change: {} })
  })

  it('takes a list of codes', () => {
    expect(applyHearing({ languages: ['en', 'zh'] })).toEqual({
      ok: true,
      change: { languages: ['en', 'zh'] },
    })
  })

  it('takes an EMPTY list, because detection is a real answer', () => {
    // Not "nothing was asked for" -- clearing the selection is a choice, and
    // refusing it would leave somebody unable to undo a hint they regretted.
    expect(applyHearing({ languages: [] })).toEqual({ ok: true, change: { languages: [] } })
  })

  it('REFUSES a code it does not recognise rather than dropping it', () => {
    // The whole difference from the file reader. Saving three of somebody's
    // four choices and reporting success is how a control comes to be
    // distrusted.
    const asked = applyHearing({ languages: ['en', 'ENGLISH'] })
    expect(asked.ok).toBe(false)
    if (!asked.ok) expect(asked.why).toContain('ENGLISH')
  })

  it('refuses more than may be chosen at once', () => {
    const many = ['en', 'zh', 'es', 'hi', 'ar', 'pt', 'ru']
    expect(many.length).toBeGreaterThan(MOST_LANGUAGES)
    const asked = applyHearing({ languages: many })
    expect(asked.ok).toBe(false)
    if (!asked.ok) expect(asked.why).toContain(String(MOST_LANGUAGES))
  })

  it('refuses anything that is not a list', () => {
    // It crosses a bridge, so the wire type accepts whatever a page sent.
    // `.length` on a string is a number, which is how `'en'` would otherwise
    // pass the bound check and reach the store as two one-character codes.
    for (const value of ['en', 42, null, { 0: 'en' }]) {
      expect(applyHearing({ languages: value as unknown as readonly unknown[] }).ok).toBe(false)
    }
  })

  it('collapses duplicates, so what is stored is what was asked for', () => {
    expect(applyHearing({ languages: ['en', 'en', 'zh'] })).toEqual({
      ok: true,
      change: { languages: ['en', 'zh'] },
    })
  })
})

describe('her size, which had no control at all', () => {
  const at = (size: number | null): Persona => ({ ...DEFAULT_PERSONA, size })

  it('accepts a size inside the band the face format allows', () => {
    const done = applyChange(at(null), { id: 'ada', size: 80 }, [])
    expect(done.ok && done.persona.size).toBe(80)
  })

  it('accepts null, which is the way back to her face’s own answer', () => {
    // `undefined` is "unchanged"; null is a real choice. Without the
    // distinction there is no way back once somebody has disagreed once.
    const done = applyChange(at(80), { id: 'ada', size: null }, [])
    expect(done.ok && done.persona.size).toBeNull()
  })

  it.each([49, 201, Number.NaN])('refuses %p rather than clamping it', (size) => {
    // Said, not silently turned into a different number they did not choose.
    const done = applyChange(at(null), { id: 'ada', size }, [])
    expect(done.ok).toBe(false)
  })

  it('leaves it alone when the change does not mention it', () => {
    const done = applyChange(at(120), { id: 'ada', name: 'Ada' }, [])
    expect(done.ok && done.persona.size).toBe(120)
  })
})

/**
 * Text that survives `trim()` and draws as nothing.
 *
 * `persona-change.ts` already carries this class, about the LENGTH bound: a
 * name of 61–64 characters saved and then failed to load because the control
 * said 64 and the parser said 60 — "the character was accepted, written, and
 * gone on the next launch". The length was aligned to the parser. The emptiness
 * rule was not, one line above it.
 *
 * `looksEmpty` covers three character classes for a measured reason of its own:
 * U+3164 HANGUL FILLER is a LETTER and U+2800 BRAILLE PATTERN BLANK is a
 * SYMBOL, so both survive `trim()` and both draw as blank everywhere.
 */
describe('a name that draws as nothing', () => {
  const AVATARS = ['mine', 'other']
  const INVISIBLE = ['\u3164', '\u2800', '\u200b', '\u2060', '\u3164\u2800']

  it('is refused, as the parser will refuse it on the next launch', () => {
    for (const blank of INVISIBLE) {
      expect(
        applyChange(DEFAULT_PERSONA, { id: 'mochi', name: blank }, AVATARS).ok,
        JSON.stringify(blank),
      ).toBe(false)
    }
  })

  it('is refused as a greeting or a farewell too', () => {
    for (const blank of INVISIBLE) {
      expect(
        applyChange(DEFAULT_PERSONA, { id: 'mochi', greeting: blank }, AVATARS).ok,
        JSON.stringify(blank),
      ).toBe(false)
      expect(
        applyChange(DEFAULT_PERSONA, { id: 'mochi', farewell: blank }, AVATARS).ok,
        JSON.stringify(blank),
      ).toBe(false)
    }
  })

  it('does not refuse text, which is the other half', () => {
    expect(applyChange(DEFAULT_PERSONA, { id: 'mochi', name: 'Ada' }, AVATARS).ok).toBe(true)
    expect(applyChange(DEFAULT_PERSONA, { id: 'mochi', name: '洛基' }, AVATARS).ok).toBe(true)
  })
})
