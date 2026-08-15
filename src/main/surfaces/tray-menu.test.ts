/**
 * What the tray menu offers, and what it refuses to offer.
 *
 * Every `enabled` here exists because an action that cannot work is worse than
 * one that is not there: the user presses it, nothing happens, and there is no
 * way to tell a broken app from a misunderstood one. Those rules lived inside a
 * function that needs a live `Tray`, so nothing could read them.
 */

import { describe, expect, it, vi } from 'vitest'
import type { MenuItemConstructorOptions } from 'electron'

vi.mock('electron', () => ({
  Menu: { buildFromTemplate: vi.fn() },
  Tray: class {},
  app: { getName: () => 'mochi' },
  nativeImage: { createFromPath: vi.fn() },
  nativeTheme: { on: vi.fn(), removeListener: vi.fn(), shouldUseDarkColors: false },
}))

const { trayMenuTemplate } = await import('./tray')
const { messagesFor } = await import('@shared/i18n')

const labels = messagesFor('en').tray
const handlers = {
  onToggleVisible: vi.fn(),
  onToggleAwake: vi.fn(),
  onOpenSettings: vi.fn(),
  onFixVoice: vi.fn(),
  onQuit: vi.fn(),
  onSwitchPersona: vi.fn(),
}

type Model = Parameters<typeof trayMenuTemplate>[0]

function model(patch: Partial<Model> = {}): Model {
  return {
    visible: true,
    keys: { toggleVisible: 'Control+Shift+M', toggleAwake: 'Control+Shift+L' },
    locale: 'en',
    pronoun: 'she',
    voice: null,
    repairing: false,
    phase: 'asleep',
    micOpen: false,
    keepingText: false,
    // One persona by default: a fresh install, where the submenu must NOT
    // appear. Tests that want the switcher say so explicitly.
    personas: [{ id: 'mochi', name: 'Mochi' }],
    activePersonaId: 'mochi',
    ...patch,
  }
}

const items = (patch: Partial<Model> = {}): ReturnType<typeof trayMenuTemplate> =>
  trayMenuTemplate(model(patch), handlers, labels, 'mochi')

/** The item whose click is this handler. Found by behaviour, not by index. */
function itemFor(
  patch: Partial<Model>,
  handler: keyof typeof handlers,
): { label?: string; enabled?: boolean } | undefined {
  return items(patch).find((item) => item.click === handlers[handler])
}

describe('the wake item', () => {
  it('is offered when she is asleep and there is a route to a voice', () => {
    expect(itemFor({ phase: 'asleep', voice: null }, 'onToggleAwake')?.enabled).toBe(true)
  })

  it('is refused when there is no route to a voice', () => {
    // Offering it buys a guaranteed failure and a fifteen-second timeout.
    expect(itemFor({ phase: 'asleep', voice: 'login' }, 'onToggleAwake')?.enabled).toBe(false)
  })

  it('lets her be put back to sleep even with no voice', () => {
    // Getting OUT must never depend on anything working. A credential that
    // expired mid-conversation must not trap somebody in a live session.
    expect(itemFor({ phase: 'awake', voice: 'login' }, 'onToggleAwake')?.enabled).toBe(true)
  })

  it('offers neither verb mid-transition', () => {
    for (const phase of ['waking', 'farewell'] as const) {
      expect(itemFor({ phase, voice: null }, 'onToggleAwake')?.enabled, phase).toBe(false)
    }
  })
})

describe('whether what is said is being written down', () => {
  /** Every label in the menu, so a readout can be found without a handler. */
  const labelsOf = (patch: Partial<Model>): string[] =>
    trayMenuTemplate(model(patch), handlers, labels, 'mochi')
      .map((item) => (typeof item.label === 'string' ? item.label : ''))
      .filter((one) => one !== '')

  it('says so in BOTH states, never only while it is happening', () => {
    // An indicator that appears only while recording is one whose absence
    // means either "not recording" or "this build has no such feature", and
    // somebody deciding whether to say a thing out loud cannot tell those
    // apart. The effective answer has to be continuously visible.
    expect(labelsOf({ keepingText: true }).join(' ')).toContain(labels.keepingText)
    expect(labelsOf({ keepingText: false }).join(' ')).toContain(labels.keepingNothing)
  })

  it('is a readout, not a switch', () => {
    // Changing it is configuration and belongs in the settings window. One
    // setting behind two entry points, each with its own refresh path, is the
    // mistake the tray/window split exists to prevent.
    const item = trayMenuTemplate(model({ keepingText: true }), handlers, labels, 'mochi').find(
      (one) => one.label === labels.keepingText,
    )
    expect(item?.enabled).toBe(false)
    expect(item?.click).toBeUndefined()
  })

  it('names no speaker, because a transcript holds both of them', () => {
    // It used to read "Writing down what she says". A stored conversation
    // holds `her` turns AND `you` turns, so that sentence disclosed less than
    // the app keeps -- the one direction this line must never be wrong in.
    for (const pronoun of ['she', 'he', 'it'] as const) {
      expect(labelsOf({ keepingText: true, pronoun }).join(' ')).toContain(labels.keepingText)
    }
  })
})

describe('the repair item', () => {
  it('is absent entirely when she can speak', () => {
    expect(itemFor({ voice: null }, 'onFixVoice')).toBeUndefined()
  })

  it('appears with a remedy, and is greyed while its own dialog is open', () => {
    // `fixVoice` is single-flight, so a second click was swallowed with no
    // sign it had been. The tray refreshes on both edges of that flight and
    // could not show it, because the model had no field for it.
    expect(itemFor({ voice: 'login', repairing: false }, 'onFixVoice')?.enabled).toBe(true)
    expect(itemFor({ voice: 'login', repairing: true }, 'onFixVoice')?.enabled).toBe(false)
  })
})

describe('the rest of the menu', () => {
  it('opens with a status line nobody can click', () => {
    const [first] = items()
    expect(first?.enabled).toBe(false)
    expect(first?.label ?? '').not.toBe('')
  })

  it('says show or hide according to what is on screen', () => {
    expect(itemFor({ visible: true }, 'onToggleVisible')?.label).toBe(labels.hide)
    expect(itemFor({ visible: false }, 'onToggleVisible')?.label).toBe(labels.show)
  })

  it('shows an accelerator only for a chord that was actually claimed', () => {
    // A key printed beside an item that is not bound is a promise the app
    // cannot keep, and pressing it teaches the user the app is broken.
    const claimed = items().find((item) => item.click === handlers.onToggleVisible)
    expect(claimed?.accelerator).toBe('Control+Shift+M')
    const taken = items({ keys: { toggleVisible: null, toggleAwake: null } }).find(
      (item) => item.click === handlers.onToggleVisible,
    )
    expect(taken?.accelerator).toBeUndefined()
  })

  it('quits through a click rather than a role', () => {
    // Electron ignores `click` when a role is set, and the teardown -- which
    // gives the global shortcuts back -- would never run.
    const quit = items().find((item) => item.click === handlers.onQuit)
    expect(quit?.role).toBeUndefined()
    expect(quit?.accelerator).toBe('CommandOrControl+Q')
  })
})

/**
 * The submenu, as an array.
 *
 * `MenuItemConstructorOptions['submenu']` is a union with `Menu`, which the
 * template never produces -- but the type cannot know that, so every read
 * would otherwise need a cast at the point of use.
 */
function submenuOf(patch: Partial<Model>): MenuItemConstructorOptions[] {
  const found = items(patch).find((item) => item.label === labels.personas.she)?.submenu
  return Array.isArray(found) ? found : []
}

describe('the persona switcher', () => {
  it('does not appear when there is nobody to switch to', () => {
    // A fresh install has only the built-in. A submenu holding one radio item
    // is a control that cannot do anything.
    expect(items().some((item) => item.label === labels.personas.she)).toBe(false)
  })

  it('appears once there is a choice, with the active one checked', () => {
    const submenu = submenuOf({
      personas: [
        { id: 'mochi', name: 'Mochi' },
        { id: 'tutor', name: 'Ada' },
      ],
      activePersonaId: 'tutor',
    })

    expect(submenu).toHaveLength(2)
    // Labelled by NAME. The id is a key -- lowercase, hyphenated, possibly
    // `ada-2` -- and it is not what anybody calls her.
    expect(submenu.map((one) => one.label)).toEqual(['Mochi', 'Ada'])
    expect(submenu.map((one) => one.checked)).toEqual([false, true])
  })

  it('asks for the id, not the name', () => {
    const submenu = submenuOf({
      personas: [
        { id: 'mochi', name: 'Mochi' },
        { id: 'ada-2', name: 'Ada' },
      ],
      activePersonaId: 'mochi',
    })

    submenu[1]?.click?.(undefined as never, undefined, undefined as never)
    expect(handlers.onSwitchPersona).toHaveBeenCalledWith('ada-2')
  })
})
