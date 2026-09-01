import { MOCHI } from '@shared/avatar-spec'
import type { SettingsView } from '@shared/ipc'
import type { PaneHandlers } from '../renderer/settings/pane'

/**
 * A settings window with nothing wrong with it, and the handlers to draw it.
 *
 * ## Why it is here rather than in one of the test files
 *
 * It was in `panes.test.ts`, which asks arithmetic questions of it — which
 * groups there are, and when one wears a dot. `fields.test.ts` needs the same
 * view to RENDER with, and a second copy of a forty-line fixture is the shape
 * this repository keeps paying for: the copies stay equal until one of them is
 * taught about a new field, and then the other test is silently exercising an
 * older window.
 *
 * `src/test/` rather than beside them because it is a helper both import and
 * neither owns — the same place `structural-dom.ts` lives, for the same reason.
 */

/** Everything fine: nothing withheld, the CLI present, both keys claimed. */
export function settledView(): SettingsView {
  return {
    face: MOCHI,
    pronoun: 'she',
    capabilities: [{ name: 'ask_workspace', description: 'Look something up.' }],
    grants: [
      { id: 'speak_first', allowed: true, lastUsed: { kind: 'not-recorded' } },
      { id: 'ask_workspace', allowed: true, lastUsed: { kind: 'never' } },
      { id: 'remember_this', allowed: true, lastUsed: { kind: 'at', at: 1_700_000_000_000 } },
      // Off, which is what a settled installation actually looks like: this one
      // ships withheld because it reads another application's archive.
      { id: 'recall_codex', allowed: false, lastUsed: { kind: 'never' } },
    ],
    lookup: {
      workspace: '/w',
      workspaceIsDefault: false,
      webSearch: 'follow',
      webSearchModes: ['follow'],
      profile: null,
      profilePath: null,
      profileExists: false,
      codex: { readiness: 'ready', remedy: null, version: null, checkedAt: null },
    },
    hearing: {
      languages: [],
      choices: [
        { code: 'en', label: 'English' },
        { code: 'zh', label: 'Chinese' },
      ],
      most: 6,
    },
    screen: {
      halo: 'always',
      haloChoices: ['always', 'listening', 'never'],
      shoulderChip: true,
      sleepAfterMinutes: 15,
      sleepAfterChoices: [0, 5, 15],
    },
    keys: [
      {
        id: 'rest',
        name: 'Talk to her',
        what: 'Let her rest',
        accelerator: 'Control+Shift+L',
        refused: null,
        edited: false,
      },
      {
        id: 'hide',
        name: 'Show or hide her',
        what: 'Hide her',
        accelerator: 'Control+Shift+M',
        refused: null,
        edited: false,
      },
    ],
    about: {
      name: 'Mochi',
      version: '0.0.1',
      electron: '43.0.0',
      arch: 'arm64',
      platform: 'darwin',
      userData: '/u',
    },
    update: { kind: 'idle' },
    /*
      TWO, NOT NONE — and the difference is the whole point of listing them.

      This was empty, which is a view no installation ever has: `PROMPTS` ships
      a catalogue and main sends it. An empty list makes the prompts pane draw
      nothing, so every assertion about it passed by drawing zero of zero.

      One of them is `edited`, because that is the state the pane's own count and
      its "Put back as shipped" control key off, and a fixture where nothing has
      been touched exercises neither.
    */
    prompts: [
      {
        key: 'notes.heading',
        title: 'Heading over her notes',
        purpose: 'Introduces what she has been asked to remember.',
        text: 'What you have asked me to remember',
        edited: false,
        missing: [],
      },
      {
        key: 'recall.nothing',
        title: 'When there is nothing to recall',
        purpose: 'Said when a search of her notes finds nothing.',
        text: 'I have nothing written down about that.',
        edited: true,
        missing: [],
        limit: 400,
      },
    ],
    folders: { avatars: '/u/avatars', personas: '/u/personas' },
  }
}

/**
 * Handlers that record nothing and refuse nothing.
 *
 * Every pane takes these to build with, and NONE of the assertions that use
 * them press anything — `fields.test.ts` says why at length. They exist so a
 * builder that binds can be constructed, not so an act can be observed; a test
 * wanting to know what a click does should be testing the rule in `rules/`
 * that decides it.
 */
export function paneHandlers(): PaneHandlers {
  const nothing = (): void => {}
  return {
    lookup: nothing,
    chooseWorkspace: () => Promise.resolve({ ok: false, cancelled: true }),
    showProfile: nothing,
    recheckCodex: () =>
      Promise.resolve({ readiness: 'ready', remedy: null, version: null, checkedAt: null }),
    screen: nothing,
    hearing: nothing,
    prompt: nothing,
    grant: nothing,
    key: nothing,
    forgetEveryTalk: nothing,
    reveal: nothing,
    openLink: nothing,
    checkUpdate: () => Promise.resolve({ kind: 'idle' }),
    downloadUpdate: () => Promise.resolve({ kind: 'idle' }),
    installUpdate: nothing,
    say: nothing,
  }
}
