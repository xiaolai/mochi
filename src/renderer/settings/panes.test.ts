import { describe, expect, it } from 'vitest'
import { MOCHI } from '@shared/avatar-spec'
import type { SettingsView } from '@shared/ipc'
import { CODEX_READINESS } from '@shared/delegation'
import { PANES } from './panes'

/**
 * The six groups, and the one rule that decides when one wears a dot.
 *
 * Only the parts that are arithmetic: which groups there are, and
 * `attention(view)`. What each pane DRAWS needs a document and is checked live
 * — `plan-shell.md` says so, and `documents.test.ts` covers the mechanical half
 * of that. This covers the half that is a decision.
 */

/** Everything fine: nothing withheld, the CLI present, both keys claimed. */
function settled(): SettingsView {
  return {
    face: MOCHI,
    pronoun: 'she',
    capabilities: [{ name: 'ask_workspace', description: 'Look something up.' }],
    grants: [
      { id: 'speak_first', allowed: true, lastUsed: { kind: 'not-recorded' } },
      { id: 'ask_workspace', allowed: true, lastUsed: { kind: 'never' } },
      { id: 'remember_this', allowed: true, lastUsed: { kind: 'at', at: 1_700_000_000_000 } },
    ],
    lookup: {
      workspace: '/w',
      workspaceIsDefault: false,
      webSearch: 'follow',
      webSearchModes: ['follow'],
      profile: null,
      profilePath: null,
      codex: { readiness: 'ready', remedy: null },
    },
    screen: {
      bubbleSide: 'auto',
      sides: ['auto', 'above'],
      halo: 'always',
      haloChoices: ['always', 'listening', 'never'],
      shoulderChip: true,
      sleepAfterMinutes: 15,
      sleepAfterChoices: [0, 5, 15],
    },
    keys: [
      { id: 'rest', what: 'Let her rest', accelerator: 'Control+Shift+L', refused: null },
      { id: 'hide', what: 'Hide her', accelerator: 'Control+Shift+M', refused: null },
    ],
    about: { name: 'Mochi', version: '0.0.1', electron: '43.0.0', userData: '/u' },
    folders: { avatars: '/u/avatars', personas: '/u/personas' },
  }
}

describe('the five groups', () => {
  it('is five, in the order they are drawn', () => {
    /*
      `where` is gone, folded into `about`.

      It was two rows — avatars and personas — and About ended with the sentence
      "Everything of hers is under `~/…/Mochi`", which is the parent of both. One
      group named the root in prose and another listed two of its children with
      buttons, so finding either meant knowing which of two words this
      repository had picked for one subject.
    */
    expect(PANES.map((one) => one.id)).toEqual(['may-do', 'looking', 'on-screen', 'keys', 'about'])
  })

  it('is W-S1’s groups rather than the handoff’s', () => {
    // The handoff lists Voice, Sound, On screen, Keys, What is kept, About.
    // Voice is a `Persona` field and retention is filed under her id, so both
    // are per character and live on the shelf; Sound would be empty, and an
    // empty pane is a pane people learn to skip. `plan-shell.md` settles it.
    const labels = PANES.map((one) => one.label)
    expect(labels).not.toContain('Voice')
    expect(labels).not.toContain('Sound')
    expect(labels).not.toContain('What is kept')
    expect(labels).toContain('On screen')
    expect(labels).toContain('Keys')
    expect(labels).toContain('About')
  })

  it('gives every group its own id and its own label', () => {
    expect(new Set(PANES.map((one) => one.id)).size).toBe(PANES.length)
    expect(new Set(PANES.map((one) => one.label)).size).toBe(PANES.length)
  })
})

describe('the dot, and what it is for', () => {
  it('is absent from every group when nothing needs looking at', () => {
    const view = settled()
    for (const pane of PANES) expect(pane.attention(view)).toBeNull()
  })

  it('does NOT appear because a permission is switched off', () => {
    // A withheld grant is a decision, not a problem. A dot that appeared for
    // one would be a dot on a pane every careful person has visited on purpose,
    // which is how a dot stops being worth looking at.
    const view = settled()
    const withheld: SettingsView = {
      ...view,
      grants: view.grants.map((one) => ({ ...one, allowed: false })),
    }
    for (const pane of PANES) expect(pane.attention(withheld)).toBeNull()
  })

  it.each(CODEX_READINESS.filter((one) => one !== 'ready'))(
    'appears on Looking things up when Codex is %s',
    (readiness) => {
      /*
        EVERY unhappy state, not only "not installed".

        This asserted one case, because the view carried one boolean. Three
        questions decide whether she can look anything up — is it installed,
        does it run, is its login usable BY US — and the third is the one that
        actually fails: a token Codex is content with because it can refresh it,
        and this app cannot. That machine drew no dot at all.
      */
      const view = settled()
      const unhappy: SettingsView = {
        ...view,
        lookup: { ...view.lookup, codex: { readiness, remedy: 'login' } },
      }
      const looking = PANES.find((one) => one.id === 'looking')
      expect(looking?.attention(unhappy)).toContain('Codex')
      // And on that group only.
      for (const pane of PANES.filter((one) => one.id !== 'looking')) {
        expect(pane.attention(unhappy)).toBeNull()
      }
    },
  )

  it('says nothing on Looking things up when Codex is ready', () => {
    // The other half, and it is what stops the dot becoming decoration: a group
    // marked as needing attention on a machine where nothing is wrong is a
    // group whose mark nobody reads.
    const looking = PANES.find((one) => one.id === 'looking')
    expect(looking?.attention(settled())).toBeNull()
  })

  it('appears on Keys when another application took one, and names it', () => {
    const view = settled()
    const taken: SettingsView = {
      ...view,
      keys: [
        { ...(view.keys[0] as SettingsView['keys'][number]) },
        {
          id: 'hide',
          what: 'Hide her',
          accelerator: 'Control+Shift+M',
          refused: 'another application already has it',
        },
      ],
    }
    const keys = PANES.find((one) => one.id === 'keys')
    // The accelerator, because "a key could not be claimed" without saying
    // WHICH is a message that sends somebody looking.
    expect(keys?.attention(taken)).toContain('Control+Shift+M')
  })

  it('names both keys when both were refused', () => {
    const view = settled()
    const none: SettingsView = {
      ...view,
      keys: view.keys.map((one) => ({ ...one, refused: 'another application already has it' })),
    }
    const said = PANES.find((one) => one.id === 'keys')?.attention(none) ?? ''
    expect(said).toContain('Control+Shift+L')
    expect(said).toContain('Control+Shift+M')
  })
})
