// @vitest-environment happy-dom
/**
 * The pane that decides how long she stays.
 *
 * Two things are worth driving through the real DOM rather than asserting about
 * the module. The select is built from `IDLE_CHOICES` through a key conversion,
 * so "the stored value is the one shown" is a claim about that conversion and
 * not about the tuple -- and it is the claim that was already wrong once, when
 * `null` round-tripped back as ninety seconds. And the cost of "never" is the
 * one sentence in this section that a user has to see before they can be said
 * to have chosen it.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_PERSONA } from '@shared/persona'
import { MOCHI } from '@shared/avatar-spec'
import { DEFAULT_SOUND } from '@shared/sound'
import { DEFAULT_IDLE_MS, IDLE_CHOICES, idleKey, type IdleChoice } from '@shared/companion'
import { DEFAULT_SHORTCUTS, SHORTCUT_IDS } from '@shared/shortcuts'
import { LOCALES, LOCALE_TAGS, messagesFor } from '@shared/i18n'
import { DEFAULT_DELEGATION } from '@shared/delegation'
import type { SettingsSnapshot } from '@shared/ipc'
import { forPronoun } from '@shared/pronoun'
import type { Copy } from '../copy'
import { presenceSection } from './presence'

function snapshotWith(idleMs: IdleChoice): SettingsSnapshot {
  return {
    delegation: {
      settings: DEFAULT_DELEGATION,
      catalog: { models: [], problem: null },
      readiness: 'ready',
      remedy: null,
      trust: 'untrusted',
      trustIsOurs: false,
      codexDefault: { model: null, effort: null },
    },
    spokenRules: { stored: null, builtIn: 'be brief' },
    persona: DEFAULT_PERSONA,
    personas: [{ id: 'mochi', name: 'Mochi' }],
    builtInEdited: false,
    sound: DEFAULT_SOUND,
    idleMs,
    loopbackHeard: null,
    kept: { sessions: 0, turns: 0, bytes: 0, where: '/tmp' },
    policy: { keeps: true, keepDays: null },
    memory: '',
    personaProblems: [],
    face: MOCHI,
    locale: 'en',
    version: '0.0.1',
    about: { name: 'mochi', repository: '', author: '', homepage: '' },
    sizePercent: 100,
    keys: Object.fromEntries(
      SHORTCUT_IDS.map((id) => [
        id,
        { accelerator: DEFAULT_SHORTCUTS[id], shown: '', unavailable: false },
      ]),
    ) as SettingsSnapshot['keys'],
    auth: { source: 'codex', keySet: false, keyHint: '', canStoreKey: true },
    locales: LOCALE_TAGS.map((tag) => ({ tag, nativeName: LOCALES[tag].nativeName })),
  }
}

const copy: Copy = {
  t: messagesFor('en').settings,
  locale: 'en',
  pronoun: 'she',
  say: (table) => forPronoun(table, 'she'),
}

const saved: IdleChoice[] = []

// `defineProperty` on the real window, the same way `sound.test.ts` does it.
// Replacing `window` with a spread instead loses happy-dom's prototype, and
// with it `document` and `Event` for the rest of the file.
beforeEach(() => {
  saved.length = 0
  Object.defineProperty(window, 'mochiSettings', {
    value: {
      saveIdle: (value: IdleChoice) => {
        saved.push(value)
        return Promise.resolve([])
      },
    },
    configurable: true,
  })
})

const deps = {
  act: (_what: string, run: () => Promise<unknown>) => {
    void run()
  },
  showProblems: () => {},
}

const render = (idleMs: IdleChoice): HTMLElement =>
  presenceSection(copy, snapshotWith(idleMs), deps)

const only = (node: HTMLElement): HTMLSelectElement =>
  node.querySelector('select') as HTMLSelectElement

describe('the presence section', () => {
  it('offers every choice and nothing else', () => {
    const values = [...only(render(DEFAULT_IDLE_MS)).options].map((option) => option.value)
    expect(values).toEqual(IDLE_CHOICES.map(idleKey))
  })

  /**
   * The bug this pane nearly shipped: never was stored, and the pane showed
   * ninety seconds. Driven for EVERY choice rather than for `null` alone --
   * one duration passing proves the conversion runs, not that it is right.
   */
  it('shows the stored choice, including never', () => {
    for (const choice of IDLE_CHOICES) {
      expect(only(render(choice)).value, `${String(choice)} was not shown`).toBe(idleKey(choice))
    }
  })

  it('saves the choice the key stands for, not the key', () => {
    const select = only(render(DEFAULT_IDLE_MS))
    select.value = 'never'
    select.dispatchEvent(new Event('change'))
    // `null`, not the string. A save that sent `'never'` would be refused by
    // `isIdleChoice` in main -- correctly, and only at run time.
    expect(saved).toEqual([null])
  })

  /**
   * The shape: the expensive option stays reachable and states its price
   * where it is chosen. A cost shown under every choice is a cost nobody reads.
   */
  it('states what never costs, and only under never', () => {
    const never = render(null)
    const shown = never.querySelector('.presence-cost') as HTMLElement | null
    expect(shown?.textContent ?? '').toMatch(/billing/i)
    expect(shown?.hidden, 'the cost was rendered but not shown').toBe(false)
    // Present and HIDDEN rather than absent: the line has to react to the
    // select, not to the next snapshot, so it is built once and toggled.
    for (const choice of IDLE_CHOICES.filter((one) => one !== null)) {
      const hidden = render(choice).querySelector('.presence-cost') as HTMLElement | null
      expect(hidden, `${String(choice)} lost the cost element`).not.toBeNull()
      expect(hidden?.hidden, `${String(choice)} showed the never cost`).toBe(true)
    }
  })

  /**
   * The point of the line is consent BEFORE the commitment, and the first
   * version could not give it: the warning was rendered from the snapshot, so
   * choosing "Never" showed its price only once main echoed a new snapshot
   * back — and never at all if the save failed.
   */
  it('shows the cost the moment never is chosen, before main answers', () => {
    const node = render(DEFAULT_IDLE_MS)
    const cost = node.querySelector('.presence-cost') as HTMLElement
    expect(cost.hidden).toBe(true)

    const select = only(node)
    select.value = 'never'
    select.dispatchEvent(new Event('change'))
    // No snapshot has come back — nothing re-rendered this pane.
    expect(cost.hidden, 'the price waited for a round trip').toBe(false)
  })
})
