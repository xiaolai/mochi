// @vitest-environment happy-dom
/**
 * The two gates this pane exists to hold, plus the sentence it must not swallow.
 *
 * Both gates are conjunctions that look like single conditions, which is how
 * they get written wrong: an effort level is valid only for the model that
 * declares it, and a model is offerable only when the ACTIVE CREDENTIAL can
 * reach it. Either one checked alone renders a control that reports success and
 * then fails at run time.
 */

import { describe, expect, it } from 'vitest'
import { DEFAULT_PERSONA } from '@shared/persona'
import { MOCHI } from '@shared/avatar-spec'
import { DEFAULT_SOUND } from '@shared/sound'
import { DEFAULT_IDLE_MS } from '@shared/companion'
import { DEFAULT_SHORTCUTS, SHORTCUT_IDS } from '@shared/shortcuts'
import { LOCALES, LOCALE_TAGS, messagesFor } from '@shared/i18n'
import { DEFAULT_DELEGATION, type CodexModel, type DelegationView } from '@shared/delegation'
import type { SettingsSnapshot } from '@shared/ipc'
import { forPronoun } from '@shared/pronoun'
import type { Copy } from '../copy'
import { delegationSection } from './delegation'

const SOL: CodexModel = {
  slug: 'gpt-5.6-sol',
  displayName: 'GPT-5.6 Sol',
  efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
  defaultEffort: 'low',
  inApi: true,
}
const LUNA: CodexModel = {
  slug: 'gpt-5.6-luna',
  displayName: 'GPT-5.6 Luna',
  efforts: ['low', 'medium', 'high', 'xhigh'],
  defaultEffort: 'medium',
  inApi: true,
}
/** Measured: usable through a Codex login, not through a pasted key. */
const SPARK: CodexModel = {
  slug: 'gpt-5.3-codex-spark',
  // Four levels, as the real cache reports. An earlier version of this fixture
  // trimmed it to three, which quietly changed what the intersection across all
  // models comes to -- a fixture that disagrees with the file it stands for
  // makes every test built on it agree with an assumption instead.
  efforts: ['low', 'medium', 'high', 'xhigh'],
  displayName: 'GPT-5.3 Codex Spark',
  defaultEffort: 'high',
  inApi: false,
}

function snapshotWith(
  delegation: Partial<DelegationView>,
  source: 'codex' | 'apikey' = 'codex',
): SettingsSnapshot {
  const view: DelegationView = {
    settings: DEFAULT_DELEGATION,
    catalog: { models: [SOL, LUNA, SPARK], problem: null },
    readiness: 'ready',
    remedy: null,
    trust: 'untrusted',
    trustIsOurs: false,
    codexDefault: { model: null, effort: null },
    ...delegation,
  }
  return {
    delegation: view,
    spokenRules: { stored: null, builtIn: 'be brief' },
    persona: DEFAULT_PERSONA,
    personas: [{ id: 'mochi', name: 'Mochi' }],
    builtInEdited: false,
    sound: DEFAULT_SOUND,
    idleMs: DEFAULT_IDLE_MS,
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
    auth: { source, keySet: false, keyHint: '', canStoreKey: true },
    locales: LOCALE_TAGS.map((tag) => ({ tag, nativeName: LOCALES[tag].nativeName })),
  }
}

const deps = {
  act: (_what: string, run: () => Promise<unknown>) => {
    void run()
  },
  showProblems: () => {},
}

const copyIn = (tag: 'en' | 'zh-CN'): Copy => ({
  t: messagesFor(tag).settings,
  locale: tag,
  pronoun: 'she',
  say: (table) => forPronoun(table, 'she'),
})

const render = (snapshot: SettingsSnapshot): HTMLElement =>
  delegationSection(copyIn('en'), snapshot, deps)

const selects = (node: HTMLElement): HTMLSelectElement[] =>
  [...node.querySelectorAll('select')] as HTMLSelectElement[]

describe('the delegation section', () => {
  /**
   * The rule 6 gate. Luna genuinely stops at `xhigh`; offering `ultra` because
   * some OTHER model has it is how a flag reports success while nothing works.
   */
  it('offers only the efforts the chosen model declares', () => {
    const node = render(
      snapshotWith({ settings: { ...DEFAULT_DELEGATION, model: 'gpt-5.6-luna' } }),
    )
    const effort = selects(node).find((select) =>
      [...select.options].some((option) => option.value === 'xhigh'),
    )
    const values = [...(effort?.options ?? [])].map((option) => option.value)
    expect(values).toContain('xhigh')
    expect(values).not.toContain('ultra')
  })

  it('offers ultra for the model that really has it', () => {
    const node = render(snapshotWith({ settings: { ...DEFAULT_DELEGATION, model: 'gpt-5.6-sol' } }))
    const values = selects(node).flatMap((select) =>
      [...select.options].map((option) => option.value),
    )
    expect(values).toContain('ultra')
  })

  /**
   * The control exists even with no model chosen, which is the default and so
   * the case that matters most.
   *
   * `-c model_reasoning_effort=…` is an independent flag; it does not need to
   * know which model runs. The earlier version hid the control until a model
   * was picked, which treated a value constraint as an existence one and left
   * the default configuration with no way to ask for a faster answer.
   */
  it('offers an effort even while the model follows Codex', () => {
    const node = render(snapshotWith({}))
    const values = selects(node).flatMap((select) =>
      [...select.options].map((option) => option.value),
    )
    expect(values).toContain('xhigh')
  })

  /**
   * With no model chosen the offer is the intersection: levels every model on
   * offer supports, so whichever one Codex picks the value is valid. `ultra`
   * is not in it because luna does not have it.
   */
  it('offers only levels that are safe for whichever model Codex picks', () => {
    const node = render(snapshotWith({}))
    const values = selects(node).flatMap((select) =>
      [...select.options].map((option) => option.value),
    )
    expect(values).toContain('low')
    expect(values).toContain('xhigh')
    expect(values).not.toContain('ultra')
  })

  /** Choosing sol explicitly unlocks the level only sol has. */
  it('widens to the chosen model own levels', () => {
    const node = render(snapshotWith({ settings: { ...DEFAULT_DELEGATION, model: 'gpt-5.6-sol' } }))
    const values = selects(node).flatMap((select) =>
      [...select.options].map((option) => option.value),
    )
    expect(values).toContain('ultra')
  })

  /** Conjoins with the credential. Spark is unreachable on a pasted key. */
  it('drops models the active credential cannot reach', () => {
    const withCodex = render(snapshotWith({}, 'codex'))
    const withKey = render(snapshotWith({}, 'apikey'))
    const valuesOf = (node: HTMLElement): string[] =>
      selects(node).flatMap((select) => [...select.options].map((option) => option.value))
    expect(valuesOf(withCodex)).toContain('gpt-5.3-codex-spark')
    expect(valuesOf(withKey)).not.toContain('gpt-5.3-codex-spark')
    expect(valuesOf(withKey)).toContain('gpt-5.6-sol')
  })

  /** A choice the user made is not discarded because Codex is offline today. */
  it('keeps a stored model that is no longer offered', () => {
    const node = render(
      snapshotWith({
        catalog: { models: [], problem: 'absent' },
        settings: { ...DEFAULT_DELEGATION, model: 'gpt-5.6-sol' },
      }),
    )
    const values = selects(node).flatMap((select) =>
      [...select.options].map((option) => option.value),
    )
    expect(values).toContain('gpt-5.6-sol')
  })

  /**
   * Status is a FAULT and carries a command. An empty list with no explanation
   * is the version of this pane that generates support threads.
   */
  it('says what is wrong and what to type when Codex is not ready', () => {
    const node = render(snapshotWith({ readiness: 'logged-out', remedy: 'login' }))
    const t = messagesFor('en')
    expect(node.textContent).toContain(t.codex.loggedOut)
    expect(node.textContent).toContain(t.codex.remedy.login)
  })

  it('says why the model list is empty rather than showing an empty control', () => {
    const node = render(snapshotWith({ catalog: { models: [], problem: 'absent' } }))
    expect(node.textContent).toContain(messagesFor('en').settings.delegationNoModels.absent)
  })

  /** The loose setting states its price while it is chosen, not behind it. */
  it('shows what anytime costs only when anytime is chosen', () => {
    const cost = messagesFor('en').settings.delegationTriggerAnytimeCost.she
    expect(render(snapshotWith({})).textContent).not.toContain(cost)
    expect(
      render(snapshotWith({ settings: { ...DEFAULT_DELEGATION, trigger: 'anytime' } })).textContent,
    ).toContain(cost)
  })

  /** Nothing to write the entry into: say so rather than offer a dead switch. */
  it('replaces the trust switch with an explanation when Codex has no config', () => {
    const node = render(snapshotWith({ trust: 'absent' }))
    expect(node.textContent).toContain(messagesFor('en').settings.delegationTrustNoConfig)
  })

  /**
   * Gap found in the plan audit: the stored answer was written and never read,
   * so a trust entry removed by something else showed as a plain "off" switch
   * -- indistinguishable from one that never worked.
   */
  it('says so when trust was asked for but Codex no longer lists it', () => {
    const asked = { ...DEFAULT_DELEGATION, trustWorkspace: true }
    const lost = render(snapshotWith({ settings: asked, trust: 'untrusted' }))
    expect(lost.textContent).toContain(messagesFor('en').settings.delegationTrustLost)

    const fine = render(snapshotWith({ settings: asked, trust: 'trusted' }))
    expect(fine.textContent).not.toContain(messagesFor('en').settings.delegationTrustLost)
  })

  /**
   * Reported: "you didn't provide users options on choosing models and efforts".
   *
   * The controls existed, but the effort one vanished whenever the model was
   * following Codex -- which is the default, so most people never saw it. The
   * reasoning was that an unknown model has an unknown set of levels; the model
   * is written down in `config.toml` and was never unknown.
   */
  it('offers efforts for the model Codex itself is configured to use', () => {
    const node = render(snapshotWith({ codexDefault: { model: 'gpt-5.6-luna', effort: 'medium' } }))
    const values = selects(node).flatMap((select) =>
      [...select.options].map((option) => option.value),
    )
    expect(values).toContain('xhigh')
    // Still luna's list, not a global one.
    expect(values).not.toContain('ultra')
  })

  it('says what following Codex resolves to, rather than leaving it opaque', () => {
    const node = render(snapshotWith({ codexDefault: { model: 'gpt-5.6-sol', effort: 'ultra' } }))
    // The depth is the part worth seeing: `ultra` is most of why a delegation
    // takes over a minute, and it was invisible.
    expect(node.textContent).toContain('GPT-5.6 Sol')
    expect(node.textContent).toContain('ultra')
  })

  it('falls back to the plain label when the config does not say', () => {
    const node = render(snapshotWith({}))
    expect(node.textContent).toContain(messagesFor('en').settings.delegationFollowCodex)
  })

  /**
   * Reported: "do not inject such system prompt, it's not universal at all".
   *
   * It was a constant in `delegate.ts`, so one opinion about what an answer
   * should be reached everybody. A prompt is configuration; this is the box.
   */
  it('shows the prompt that is actually sent, without making reading it an edit', () => {
    const node = render(snapshotWith({}))
    const boxes = [...node.querySelectorAll('textarea')] as HTMLTextAreaElement[]
    expect(boxes.length).toBeGreaterThan(0)
    // Readable as a PLACEHOLDER, and the value is empty.
    //
    // Rendering the default as the value meant any interaction saved a copy of
    // it: observed on a real preferences file, a stored block identical to the
    // built-in except for one sentence that had changed since. The app then
    // stops tracking its own default with nothing but a button to say so.
    const box = boxes.find((one) => one.placeholder.includes('Never guess'))
    expect(box, 'the built-in prompt is not readable anywhere').toBeDefined()
    expect(box?.value).toBe('')
  })

  it('shows a stored prompt rather than the built-in', () => {
    const node = render(
      snapshotWith({ settings: { ...DEFAULT_DELEGATION, prompt: 'Only the files. {question}' } }),
    )
    const boxes = [...node.querySelectorAll('textarea')] as HTMLTextAreaElement[]
    expect(boxes.some((box) => box.value === 'Only the files. {question}')).toBe(true)
  })

  /** Nothing to put back while it is untouched, so no button offering to. */
  it('offers to restore only once the prompt has been changed', () => {
    const untouched = render(snapshotWith({}))
    expect(untouched.textContent).not.toContain(messagesFor('en').settings.useDefault)
    const edited = render(snapshotWith({ settings: { ...DEFAULT_DELEGATION, prompt: 'mine' } }))
    expect(edited.textContent).toContain(messagesFor('en').settings.useDefault)
  })

  /**
   * `-c` overrides the machine-wide key, so this was never the global config's
   * decision to make on the user's behalf.
   */
  it('offers every web search mode Codex accepts', () => {
    const node = render(snapshotWith({}))
    const values = selects(node).flatMap((select) =>
      [...select.options].map((option) => option.value),
    )
    for (const mode of ['follow', 'disabled', 'cached', 'indexed', 'live']) {
      expect(values, mode).toContain(mode)
    }
  })

  it('renders without throwing in every locale', () => {
    for (const tag of LOCALE_TAGS) {
      expect(() => delegationSection(copyIn(tag), snapshotWith({}), deps)).not.toThrow()
    }
  })
})
