import { describe, expect, it } from 'vitest'
import { trayMenuTemplate, WINDOWS_SCALES } from './tray'

/** Nothing wrong, nothing chosen, and only the side there is always room for. */
const BUBBLE = { available: ['above'], asked: 'auto', using: 'above' }

const HANDLERS = {
  onConversations: () => undefined,
  onSettings: () => undefined,
  onWear: () => undefined,
  onBubbleSide: () => undefined,
  onQuit: () => undefined,
}

function labels(template: ReturnType<typeof trayMenuTemplate>): string[] {
  return template.map((item) => (item.type === 'separator' ? '—' : String(item.label)))
}

describe('the only way out', () => {
  it('always offers quit, whatever else is in the menu', () => {
    // The item this whole file exists for. Her window is frameless, she is out
    // of the Dock, and `window-all-closed` does not quit on macOS — so without
    // this the only exit is Activity Monitor.
    const bare = trayMenuTemplate(
      { personas: [], wornId: 'mochi', bubble: BUBBLE },
      HANDLERS,
      'Mochi',
    )
    expect(labels(bare)).toContain('Quit Mochi')
  })

  it('spells the shortcut out, because there is no application menu to carry it', () => {
    const template = trayMenuTemplate(
      { personas: [], wornId: 'mochi', bubble: BUBBLE },
      HANDLERS,
      'Mochi',
    )
    const quit = template.find((item) => item.label === 'Quit Mochi')
    expect(quit?.accelerator).toBe('Command+Q')
  })

  it('offers both windows, which are otherwise reached only by hovering her', () => {
    const template = trayMenuTemplate(
      { personas: [], wornId: 'mochi', bubble: BUBBLE },
      HANDLERS,
      'Mochi',
    )
    expect(labels(template)).toEqual(
      expect.arrayContaining(['Conversations…', 'Settings…', 'Quit Mochi']),
    )
  })
})

describe('who she is, and who she could be', () => {
  const SHELF = {
    personas: [
      { id: 'mochi', name: 'Mochi' },
      { id: 'loki', name: 'Loki' },
    ],
    wornId: 'loki',
    bubble: BUBBLE,
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
    const alone = { personas: [{ id: 'mochi', name: 'Mochi' }], wornId: 'mochi', bubble: BUBBLE }
    const template = trayMenuTemplate(alone, HANDLERS, 'Mochi')
    expect(template.some((i) => i.type === 'radio')).toBe(false)
    expect(labels(template)).not.toContain('Wearing')
  })

  it('falls back to the app name when the worn id names nobody', () => {
    // Reachable: the preferences file is written by hand as easily as by us,
    // and a header reading "Mochi — undefined" is worse than no name.
    const stray = { personas: [{ id: 'mochi', name: 'Mochi' }], wornId: 'nobody', bubble: BUBBLE }
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
    bubble: { available: ['above', 'left'], asked: 'auto', using: 'above' },
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
