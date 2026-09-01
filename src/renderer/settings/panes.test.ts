import { describe, expect, it } from 'vitest'
import type { SettingsView } from '@shared/ipc'
import { CODEX_READINESS } from '@shared/delegation'
import { PANES } from './panes'
import { settledView as settled } from '../../test/settings-view'
import { PRONOUNS, label as paneLabel } from '@shared/pronoun'

/**
 * The six groups, and the one rule that decides when one wears a dot.
 *
 * Only the parts that are arithmetic: which groups there are, and
 * `attention(view)`. What each pane DRAWS needs a document and is checked live
 * — `plan-shell.md` says so, and `documents.test.ts` covers the mechanical half
 * of that. This covers the half that is a decision.
 */

describe('the groups this page holds', () => {
  it('is seven, in the order they are drawn, and does not include her grants', () => {
    /*
      `where` is gone, folded into `about`.

      It was two rows — avatars and personas — and About ended with the sentence
      "Everything of hers is under `~/…/Mochi`", which is the parent of both. One
      group named the root in prose and another listed two of its children with
      buttons, so finding either meant knowing which of two words this
      repository had picked for one subject.
    */
    // `hearing` sits after `looking` and before `on-screen`: both of the first
    // two are about what she does with the world outside this window, and
    // `on-screen` begins the ones about the window itself.
    //
    // `prompts` joins them rather than sitting with the window ones, and for
    // the same test: what she is TOLD is about her dealings with the world, not
    // about how this window looks.
    /*
      `may-do` is NOT here any more.

      The grants are per-character and they now live as view III of her page —
      the delivered design's central move, and the reason this page can finally
      say what it is about. See `panes.ts`, which carries the argument, and
      `renderPermits`, which draws them.

      The delivery's own navigation says "Seven groups" and names the seventh
      "Storage" without drawing it. Its contents were read out of this
      repository instead — see `storage.ts`, which also records what was
      deliberately left out of it.
    */
    expect(PANES.map((one) => one.id)).toEqual([
      'looking',
      'hearing',
      'prompts',
      'on-screen',
      'keys',
      // `storage` before `about`: it is where things are kept, which somebody
      // arrives looking for, and About is a version number, which nobody does.
      // It carries the folders, the root under them and the deletion that
      // empties all of it — the second half `about` was answering under a name
      // that described the first.
      'storage',
      'about',
    ])
  })

  it('is W-S1’s groups rather than the handoff’s', () => {
    // The handoff lists Voice, Sound, On screen, Keys, What is kept, About.
    // Voice is a `Persona` field and retention is filed under her id, so both
    // are per character and live on the shelf; Sound would be empty, and an
    // empty pane is a pane people learn to skip. `plan-shell.md` settles it.
    /*
      RESOLVED, because a label is `string | ByPronoun`.

      These compared the raw values, so a group whose name is a table — and one
      of them is, "What she is told" — was an object among strings: it could
      never match `toContain`, and a pane renamed INTO one of the forbidden
      names as a table would have slipped through the `not.toContain` half
      entirely. What is being asserted is what the nav says, so it has to be
      read the way the nav reads it.
    */
    const labels = PANES.map((one) => paneLabel(one.label, 'she'))
    expect(labels).not.toContain('Voice')
    expect(labels).not.toContain('Sound')
    expect(labels).not.toContain('What is kept')
    expect(labels).toContain('On screen')
    expect(labels).toContain('Hearing you')
    expect(labels).toContain('Keys')
    expect(labels).toContain('About')
  })

  it('gives every group its own id and its own name, in every pronoun', () => {
    expect(new Set(PANES.map((one) => one.id)).size).toBe(PANES.length)
    /*
      RESOLVED, and once per pronoun.

      This compared `string | ByPronoun` by identity, so two panes with different
      table objects carrying the same words counted as distinct — a nav with two
      identical entries would have passed. And two names can collide in one
      pronoun while differing in another, which is a nav that reads fine on the
      machine it was written on.
    */
    for (const pronoun of PRONOUNS) {
      const said = PANES.map((one) => paneLabel(one.label, pronoun))
      expect(new Set(said).size, `two groups read alike as "${pronoun}"`).toBe(PANES.length)
    }
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
        lookup: {
          ...view.lookup,
          codex: { readiness, remedy: 'login', version: null, checkedAt: null },
        },
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
          name: 'Show or hide her',
          what: 'Hide her',
          accelerator: 'Control+Shift+M',
          refused: 'another application already has it',
          edited: false,
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
