import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { trayMenuTemplate, WINDOWS_SCALES } from './tray'

/** Nothing wrong, nothing chosen, and only the side there is always room for. */
const BUBBLE = { available: ['above'], asked: 'auto', using: 'above' }

/** Awake, visible, and both keys claimed — the ordinary state. */
const RESTING = { asleep: false, hidden: false }
const KEYS = { rest: 'Control+Shift+L', hide: 'Control+Shift+M' }

const HANDLERS = {
  onOpen: () => undefined,
  onWear: () => undefined,
  onBubbleSide: () => undefined,
  onRest: () => undefined,
  onHide: () => undefined,
  onQuit: () => undefined,
}

function labels(template: ReturnType<typeof trayMenuTemplate>): string[] {
  return template.map((item) => (item.type === 'separator' ? '—' : String(item.label)))
}

/**
 * The microphone's one unswitchable surface.
 *
 * ## Why this is a source check and not a unit
 *
 * `markListening` runs inside `createTray`, which needs a real `Tray`. What is
 * being asserted is not what it draws — it is that the fact reaches the tray at
 * all, and that no preference stands between them. Neither is observable from
 * either module alone, which is the case `lifecycle.test.ts` and
 * `stylesheets.test.ts` already read source text for.
 *
 * ## What it is guarding
 *
 * `halo.ts` exists because an open microphone with nothing on screen saying so
 * is the worst thing this application can do. The halo used to be the only
 * surface carrying that, which made it a promise rather than a preference — and
 * left `setHidden` able to break the promise in one click, since hiding her
 * window deliberately does not touch the session.
 *
 * The tray item cannot be hidden, cannot be dragged off a display, and is the
 * only way to quit. Moving the fact here is what makes "never draw the halo" an
 * ordinary preference. The moment a preference reaches this file, that is
 * undone — quietly, and the app goes on looking exactly the same.
 */
describe('what the menu bar says about the microphone', () => {
  /*
    CODE only, comments stripped.

    The assertions below forbid things, and a paragraph explaining why one was
    removed contains the very string it forbids — which is how the first version
    of the `setTitle` check failed on its own rationale. `lifecycle.test.ts` and
    `first-show.test.ts` keep the same helper for the same reason.
  */
  const source = readFileSync(fileURLToPath(new URL('./tray.ts', import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

  it('takes the fact from the model and puts it on the item', () => {
    expect(source).toContain('readonly listening: boolean')
    expect(source).toMatch(/markListening\(item, now\.listening\)/)
    expect(source).toMatch(/setToolTip\(/)
  })

  it('does not draw a second dot beside the system’s own', () => {
    /*
      This asserted `setTitle(` — a `●` next to the icon while the device was
      live. macOS already shows an orange dot in the menu bar whenever any app
      has the microphone, and names the app in Control Center, so ours sat a few
      pixels from the system's saying the same thing and cost menu bar width.

      The promise `halo.ts` makes is unaffected and is now carried by the
      stronger of the two: the system indicator cannot be switched off by this
      application, hidden by a preference, or forgotten in a render loop.
    */
    expect(source).not.toMatch(/setTitle\(/)
  })

  it('is reachable from no preference at all', () => {
    // Every switch this app offers, by the name it has in the store. Any of
    // them appearing in this file would mean the one surface that cannot be
    // turned off had acquired a way to be turned off.
    for (const preference of ['haloWhen', 'haloAtRest', 'shoulderChip', 'bubbleSide']) {
      expect(source, `${preference} must not reach the tray mark`).not.toContain(preference)
    }
  })
})

/**
 * The menu never offers a side nothing computed.
 *
 * `bubbleSides` in main is a placeholder until her window reports, and it was
 * `['above']` — not a default so much as a fabrication. The renderer only
 * reported while it was DRAWING a bubble, so a character with the bubble
 * switched off never reported at all, and the menu spent whole sessions
 * offering one invented side on a machine where three of the four fitted.
 *
 * A placeholder cannot be right, so this pins which way it is allowed to be
 * wrong. Too many is recoverable — `auto` declines a side that does not fit,
 * and the menu marks what was ASKED rather than what was used. Too few hides
 * real choices behind an answer that looks considered.
 */
describe('the sides main starts with', () => {
  it('is every real side, not one somebody picked', () => {
    const index = readFileSync(fileURLToPath(new URL('./index.ts', import.meta.url)), 'utf8')
    const held = /let bubbleSides[\s\S]*?\n\}/.exec(index)?.[0] ?? ''
    expect(held, 'main still holds the sides').not.toBe('')
    // Derived from the one list, so a fifth side cannot arrive without this
    // placeholder learning about it.
    expect(held).toContain('BUBBLE_SIDES')
    expect(held).not.toMatch(/available: \['above'\]/)
  })

  it('leaves `auto` out, because it is not a side', () => {
    // `auto` is the absence of a choice. The submenu draws it separately, above
    // the rule; listing it as available would put it in twice.
    const index = readFileSync(fileURLToPath(new URL('./index.ts', import.meta.url)), 'utf8')
    const held = /let bubbleSides[\s\S]*?\n\}/.exec(index)?.[0] ?? ''
    expect(held).toContain("!== 'auto'")
  })
})

describe('the only way out', () => {
  it('always offers quit, whatever else is in the menu', () => {
    // The item this whole file exists for. Her window is frameless, she is out
    // of the Dock, and `window-all-closed` does not quit on macOS — so without
    // this the only exit is Activity Monitor.
    const bare = trayMenuTemplate(
      {
        personas: [],
        wornId: 'mochi',
        pronoun: 'she' as const,
        bubble: BUBBLE,
        resting: RESTING,
        listening: false,
        keys: KEYS,
      },
      HANDLERS,
      'Mochi',
    )
    expect(labels(bare)).toContain('Quit Mochi')
  })

  it('spells the shortcut out, because there is no application menu to carry it', () => {
    const template = trayMenuTemplate(
      {
        personas: [],
        wornId: 'mochi',
        pronoun: 'she' as const,
        bubble: BUBBLE,
        resting: RESTING,
        listening: false,
        keys: KEYS,
      },
      HANDLERS,
      'Mochi',
    )
    const quit = template.find((item) => item.label === 'Quit Mochi')
    expect(quit?.accelerator).toBe('Command+Q')
  })

  it('offers the window, which is otherwise reached only by hovering her', () => {
    const template = trayMenuTemplate(
      {
        personas: [],
        wornId: 'mochi',
        pronoun: 'she' as const,
        bubble: BUBBLE,
        resting: RESTING,
        listening: false,
        keys: KEYS,
      },
      HANDLERS,
      'Mochi',
    )
    /*
      "Main Window", not the application's name.

      This menu is already headed by the application's name, and the item under
      it repeating that word says "Mochi… what?". The tray IS Mochi; what the
      item opens is her main window.
    */
    expect(labels(template)).toEqual(expect.arrayContaining(['Main Window', 'Quit Mochi']))
  })

  it('offers ONE way into the window, not one per tab of it', () => {
    /*
      "Shelf…" and "Settings…" both stood here and both opened the same window;
      the second sent it to the Machine tab afterwards. That was honest while
      settings was its own window and became two doors into one room when the
      six groups became a tab.

      Counted rather than named, so adding a third entry that opens it fails
      here rather than being noticed on somebody's screen.
    */
    const template = trayMenuTemplate(
      {
        personas: [{ id: 'mochi', name: 'Mochi' }],
        wornId: 'mochi',
        pronoun: 'she' as const,
        bubble: BUBBLE,
        resting: RESTING,
        listening: false,
        keys: KEYS,
      },
      HANDLERS,
      'Mochi',
    )
    /*
      Counted by what they DO, not by how they are punctuated.

      This filtered on a trailing ellipsis, which counted the convention rather
      than the behaviour — and the convention is wrong here anyway: an ellipsis
      says the command needs more input before it can complete, and showing a
      window needs none. A second item that opened the window without one would
      have passed.
    */
    const opens = template
      .filter((item) => item.click === HANDLERS.onOpen)
      .map((item) => item.label)
    expect(opens).toEqual(['Main Window'])
  })
})

describe('who she is, and who she could be', () => {
  const SHELF = {
    personas: [
      { id: 'mochi', name: 'Mochi' },
      { id: 'loki', name: 'Loki' },
    ],
    wornId: 'loki',
    pronoun: 'she' as const,
    bubble: BUBBLE,
    resting: RESTING,
    listening: false,
    keys: KEYS,
  }

  it('says who is worn, as a readout rather than a control', () => {
    // The list below is the control. A header that could be clicked would be a
    // second way to do one thing.
    const template = trayMenuTemplate(SHELF, HANDLERS, 'Mochi')
    expect(template[0]?.label).toBe('Mochi — Loki')
    expect(template[0]?.enabled).toBe(false)
  })

  it('marks the worn one, and only that one', () => {
    const radios = trayMenuTemplate(SHELF, HANDLERS, 'Mochi').filter((i) => i.type === 'radio')
    expect(radios.map((i) => [i.label, i.checked])).toEqual([
      ['Mochi', false],
      ['Loki', true],
    ])
  })

  it('leaves the switcher out entirely when there is nobody to switch to', () => {
    // A radio list of one is not a choice, and a "Wearing" heading over a
    // single unclickable name is furniture.
    const alone = {
      personas: [{ id: 'mochi', name: 'Mochi' }],
      wornId: 'mochi',
      pronoun: 'she' as const,
      bubble: BUBBLE,
      resting: RESTING,
      listening: false,
      keys: KEYS,
    }
    const template = trayMenuTemplate(alone, HANDLERS, 'Mochi')
    expect(template.some((i) => i.type === 'radio')).toBe(false)
    expect(labels(template)).not.toContain('Wearing')
  })

  it('falls back to the app name when the worn id names nobody', () => {
    // Reachable: the preferences file is written by hand as easily as by us,
    // and a header reading "Mochi — undefined" is worse than no name.
    const stray = {
      personas: [{ id: 'mochi', name: 'Mochi' }],
      wornId: 'nobody',
      pronoun: 'she' as const,
      bubble: BUBBLE,
      resting: RESTING,
      listening: false,
      keys: KEYS,
    }
    expect(trayMenuTemplate(stray, HANDLERS, 'Mochi')[0]?.label).toBe('Mochi')
  })
})

describe('the Windows renditions', () => {
  it('covers every scale Windows offers, not the three obvious ones', () => {
    // 16/24/32 covers 100, 150 and 200 and leaves 125% resampling — and 125% is
    // the default on a great many laptops, so the most common non-default scale
    // would have been the blurry one.
    expect(WINDOWS_SCALES.map(([, factor]) => factor)).toEqual([1.25, 1.5, 1.75, 2, 2.25, 2.5, 3])
  })
})

describe('choosing where she speaks from', () => {
  const AT_CORNER = {
    personas: [{ id: 'mochi', name: 'Mochi' }],
    wornId: 'mochi',
    pronoun: 'she' as const,
    bubble: { available: ['above', 'left'], asked: 'auto', using: 'above' },
    resting: RESTING,
    listening: false,
    keys: KEYS,
  }

  function sides(model: typeof AT_CORNER): string[] {
    const item = trayMenuTemplate(model, HANDLERS, 'Mochi').find(
      (one) => one.label === 'Speech bubble',
    )
    const menu = item?.submenu
    if (!Array.isArray(menu)) throw new Error('expected a submenu')
    return menu.map((one) => (one.type === 'separator' ? '—' : String(one.label)))
  }

  it('offers only the sides that fit right now', () => {
    // Her in the bottom right: the display ends below her and to her right. The
    // menu says so by having two entries rather than four — a greyed "Below
    // her" would invite the reading that the feature is broken.
    expect(sides(AT_CORNER)).toEqual(['Wherever it fits', '—', 'Above her', 'To her left'])
  })

  it('grows back when she is dragged somewhere with more room', () => {
    const middle = {
      ...AT_CORNER,
      bubble: { available: ['above', 'below', 'left', 'right'], asked: 'auto', using: 'above' },
    }
    expect(sides(middle)).toEqual([
      'Wherever it fits',
      '—',
      'Above her',
      'Below her',
      'To her left',
      'To her right',
    ])
  })

  it('marks what was asked for, not what is being used', () => {
    // They differ whenever a chosen side stopped fitting. The menu is a record
    // of the choice; the bubble is where it could actually go.
    const asked = { ...AT_CORNER, bubble: { available: ['above'], asked: 'below', using: 'above' } }
    const item = trayMenuTemplate(asked, HANDLERS, 'Mochi').find((o) => o.label === 'Speech bubble')
    const menu = item?.submenu
    if (!Array.isArray(menu)) throw new Error('expected a submenu')
    expect(menu.filter((one) => one.checked).map((one) => one.label)).toEqual([])
  })

  it('checks "wherever it fits" when nobody has chosen', () => {
    const item = trayMenuTemplate(AT_CORNER, HANDLERS, 'Mochi').find(
      (o) => o.label === 'Speech bubble',
    )
    const menu = item?.submenu
    if (!Array.isArray(menu)) throw new Error('expected a submenu')
    expect(menu.filter((one) => one.checked).map((one) => one.label)).toEqual(['Wherever it fits'])
  })
})

describe('resting and hiding', () => {
  function labels(model: Parameters<typeof trayMenuTemplate>[0]): string[] {
    return trayMenuTemplate(model, HANDLERS, 'Mochi').map((one) =>
      one.type === 'separator' ? '—' : String(one.label),
    )
  }
  const BASE = {
    personas: [],
    wornId: 'mochi',
    pronoun: 'she' as const,
    bubble: BUBBLE,
    listening: false,
    keys: KEYS,
  }

  it('says what pressing it DOES, not what she currently is', () => {
    // Read at a glance by somebody who wants her quiet NOW. A checkbox marked
    // "Asleep" makes them stop and work out which way it points.
    expect(labels({ ...BASE, resting: { asleep: false, hidden: false } })).toEqual(
      expect.arrayContaining(['Let her rest', 'Hide her']),
    )
    expect(labels({ ...BASE, resting: { asleep: true, hidden: true } })).toEqual(
      expect.arrayContaining(['Wake her', 'Show her']),
    )
  })

  it('keeps the two independent, because the reasons are', () => {
    // Somebody walked in, versus you need that corner of the screen. Collapsing
    // them would make one of the two answers always wrong.
    expect(labels({ ...BASE, resting: { asleep: true, hidden: false } })).toEqual(
      expect.arrayContaining(['Wake her', 'Hide her']),
    )
  })

  it('shows the key beside the item', () => {
    const rest = trayMenuTemplate(
      { ...BASE, resting: { asleep: false, hidden: false } },
      HANDLERS,
      'Mochi',
    ).find((one) => one.label === 'Let her rest')
    expect(rest?.accelerator).toBe('Control+Shift+L')
  })

  it('leaves the key OFF when another application took it', () => {
    // A label promising a key that does nothing is worse than no label, and
    // there would be no way to tell the two apart.
    const item = trayMenuTemplate(
      { ...BASE, resting: { asleep: false, hidden: false }, keys: { rest: null, hide: null } },
      HANDLERS,
      'Mochi',
    ).find((one) => one.label === 'Let her rest')
    expect(item?.accelerator).toBeUndefined()
    expect('accelerator' in (item ?? {})).toBe(false)
  })

  it('puts them first, where somebody in a hurry looks', () => {
    const shown = labels({ ...BASE, resting: { asleep: false, hidden: false } })
    expect(shown.indexOf('Let her rest')).toBeLessThan(shown.indexOf('Main Window'))
  })
})
