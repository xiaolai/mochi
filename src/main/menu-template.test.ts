import { type MenuItemConstructorOptions } from 'electron'
import { describe, expect, it } from 'vitest'

import { menuTemplate, windowSubmenu } from './menu-template'

/**
 * The keyboard contract, asserted.
 *
 * This menu "exists for its keys rather than to be looked at", and the one time
 * its keys were wrong nothing failed — Electron's default ⌘Q quit a companion
 * that is meant to be left running all day, and the only way anybody found out
 * was by losing a session to it. These are the tests that were missing then.
 */

function submenuOf(
  template: MenuItemConstructorOptions[],
  label: string,
): MenuItemConstructorOptions[] {
  const found = template.find((one) => one.label === label)
  if (!found || !Array.isArray(found.submenu)) throw new Error(`no ${label} submenu`)
  return found.submenu
}

/** Every accelerator anywhere in the template, flattened. */
function accelerators(template: MenuItemConstructorOptions[]): string[] {
  const out: string[] = []
  for (const item of template) {
    if (typeof item.accelerator === 'string') out.push(item.accelerator)
    if (Array.isArray(item.submenu)) out.push(...accelerators(item.submenu))
  }
  return out
}

/** Every role anywhere in the template, flattened. */
function roles(template: MenuItemConstructorOptions[]): string[] {
  const out: string[] = []
  for (const item of template) {
    if (typeof item.role === 'string') out.push(item.role)
    if (Array.isArray(item.submenu)) out.push(...roles(item.submenu))
  }
  return out
}

describe('closing a window', () => {
  it('binds the platform’s own close key by leaving the role bare', () => {
    /*
      ⌘W is THE close-window reflex on macOS, and for a long time nothing bound
      it: the menu carried ⌘Q for close and stopped there.

      Asserted as "a close item with NO accelerator" rather than as the literal
      string, because that absence is the mechanism — an unspecified accelerator
      is what makes `role: 'close'` take ⌘W on macOS and Ctrl+W elsewhere.
      Writing `CommandOrControl+W` here would pass while quietly overriding the
      platform on some future one.
    */
    for (const platform of ['darwin', 'win32', 'linux'] as const) {
      const window = windowSubmenu(platform)
      const bare = window.filter((one) => one.role === 'close' && one.accelerator === undefined)
      expect(bare, platform).toHaveLength(1)
    }
  })

  it('keeps ⌘Q on close, which is the rule this menu exists for', () => {
    // Losing this to the ⌘W addition would be the original defect returning:
    // ⌘Q is muscle memory for "done with this window", and she is a resident.
    for (const platform of ['darwin', 'win32', 'linux'] as const) {
      const closesOnQ = windowSubmenu(platform).filter(
        (one) => one.accelerator === 'CommandOrControl+Q' && one.role === 'close',
      )
      expect(closesOnQ, platform).toHaveLength(1)
    }
  })

  it('never offers a quit ROLE, on any platform', () => {
    /*
      `role: 'quit'` carries ⌘Q with it and would take the key back the moment
      anybody added it for tidiness. Quitting is a spelled-out item with a click
      handler and no accelerator, so it stays reachable and stays deliberate.
    */
    for (const platform of ['darwin', 'win32', 'linux'] as const) {
      const template = menuTemplate(platform, 'Mochi', () => {})
      expect(roles(template), platform).not.toContain('quit')
      expect(accelerators(template), platform).not.toContain('Command+Q')
    }
  })

  it('hides the ⌘Q row only where a hidden accelerator still fires', () => {
    /*
      `acceleratorWorksWhenHidden` is macOS-only. Hiding the row anywhere else
      would retire Ctrl+Q silently while the menu still looked correct — the
      exact failure shape this file is about, so it is pinned rather than
      trusted to a comment.
    */
    const onQ = (platform: NodeJS.Platform): MenuItemConstructorOptions => {
      const found = windowSubmenu(platform).find((one) => one.accelerator === 'CommandOrControl+Q')
      if (!found) throw new Error('nothing binds Q')
      return found
    }
    expect(onQ('darwin').visible).toBe(false)
    expect(onQ('win32').visible).toBe(true)
    expect(onQ('linux').visible).toBe(true)
  })
})

describe('the rest of the contract', () => {
  it('quits from the menu, and only from the menu', () => {
    let quit = 0
    const template = menuTemplate('darwin', 'Mochi', () => (quit += 1))
    const item = submenuOf(template, 'Mochi').find((one) => one.label === 'Quit Mochi')
    expect(item).toBeDefined()
    expect(item?.accelerator).toBeUndefined()
    item?.click?.(undefined as never, undefined, undefined as never)
    expect(quit, 'the menu item actually quits').toBe(1)
  })

  it('restates the Edit roles, or ⌘C ⌘V ⌘A ⌘Z break in every text field', () => {
    // Replacing the default menu replaces these with it. Her instruction is a
    // textarea, and so is every prompt on the machine's page.
    const edit = roles(
      submenuOf(
        menuTemplate('darwin', 'Mochi', () => {}),
        'Edit',
      ),
    )
    for (const role of ['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll']) {
      expect(edit).toContain(role)
    }
  })

  it('gives the application submenu only to macOS', () => {
    // Windows and Linux have no application menu to hang it from; a stray one
    // shows up as a menu named after the app with nothing standard in it.
    expect(menuTemplate('darwin', 'Mochi', () => {}).map((one) => one.label)).toEqual([
      'Mochi',
      'Edit',
      'Window',
    ])
    expect(menuTemplate('win32', 'Mochi', () => {}).map((one) => one.label)).toEqual([
      'Edit',
      'Window',
    ])
  })
})
