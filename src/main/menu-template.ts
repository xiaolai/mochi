import { type MenuItemConstructorOptions } from 'electron'

/**
 * The application menu as DATA, with no Electron in it.
 *
 * `menu.ts` imports `Menu` and `app` at module scope, so anything that imports
 * it drags a runtime Electron into the process — which a vitest run does not
 * have. That is why this file exists separately: the import above is
 * `type`-only and erases at compile time, `role` and `accelerator` are plain
 * strings, and the platform and the application name arrive as arguments
 * instead of being read from `app`.
 *
 * The point is that the keyboard contract can be ASSERTED. This menu "exists for
 * its keys rather than to be looked at", and the one time its keys were wrong —
 * Electron's default ⌘Q, quitting a resident companion for somebody who meant to
 * put a window away — nothing failed, because nothing was looking. A test over a
 * template is looking.
 *
 * Not a source-text check, deliberately. Reading this file and grepping it for
 * `CommandOrControl+W` would pass just as happily on a mention inside a comment,
 * which is the shape of a green tick that means nothing.
 */

/**
 * Both keys close the focused window, and neither quits.
 *
 * ## ⌘W, which was missing
 *
 * ⌘W is THE close-window reflex on macOS and nothing bound it at all — the menu
 * carried ⌘Q for close and stopped there. `role: 'close'` is left without an
 * explicit accelerator so it takes the platform's own binding, which is ⌘W on
 * macOS and Ctrl+W elsewhere: the standard key, spelled by the platform rather
 * than asserted by this file.
 *
 * ## ⌘Q, which must keep working
 *
 * Nothing set an application menu once, so Electron installed its default one,
 * and that default binds ⌘Q to quit. She is a resident — a companion left
 * running all day — and ⌘Q is muscle memory for "I am done with this window",
 * because every other application IS its window. Here it ended the session,
 * closed the conversation and dropped the archive.
 *
 * So ⌘Q also closes. Quitting keeps its menu item and loses its key: a
 * deliberate act, reachable here and from the tray, not something a reflex can
 * reach. That is the rule this menu exists to hold, and adding ⌘W must not cost
 * it — hence two items rather than one retuned accelerator.
 *
 * ## Why the second item is hidden on macOS and visible everywhere else
 *
 * A menu showing two rows that both say Close is worse than one, so the ⌘Q entry
 * is hidden — but `acceleratorWorksWhenHidden` is macOS-ONLY. Elsewhere a hidden
 * item's accelerator is simply not registered, and hiding it there would retire
 * Ctrl+Q silently while the menu still looked right. A duplicated row is the
 * lesser cost, and it is only paid on the platforms this does not ship to.
 */
export function windowSubmenu(platform: NodeJS.Platform): MenuItemConstructorOptions[] {
  return [
    /*
      No accelerator, and no label. Both come from the role, and that was checked
      against a real Electron rather than assumed — `Menu.buildFromTemplate` on
      this exact item answers:

          {"label":"Close Window","role":"close","accelerator":"CommandOrControl+W"}

      So ⌘W is Electron's own answer to `role: 'close'`, not a string this file
      asserts. Spelling it here would take the binding away from the platform for
      the sake of repeating it.
    */
    { role: 'close' },
    { role: 'close', accelerator: 'CommandOrControl+Q', visible: platform !== 'darwin' },
    { role: 'minimize' },
  ]
}

/**
 * The whole template.
 *
 * `appName` and `quit` are passed rather than read from `app`, which is the only
 * reason this is testable at all.
 */
export function menuTemplate(
  platform: NodeJS.Platform,
  appName: string,
  quit: () => void,
): MenuItemConstructorOptions[] {
  const template: MenuItemConstructorOptions[] = []

  if (platform === 'darwin') {
    template.push({
      label: appName,
      submenu: [
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        /*
          NO ACCELERATOR, and that absence is the whole point of this file.

          `role: 'quit'` would carry ⌘Q with it, so the item is spelled out
          instead. It is still here — quitting from the menu is a reasonable
          thing to want — but you have to mean it.
        */
        { label: `Quit ${appName}`, click: quit },
      ],
    })
  }

  /*
    The Edit submenu is not decoration.

    Replacing the default menu replaces the standard Edit roles with it, and
    those are what make ⌘C, ⌘V, ⌘A and ⌘Z work inside a text field. Her
    instruction is a textarea, every prompt on the machine's page is a textarea,
    and the transcript has a copy control. Leaving this out would trade one fixed
    shortcut for four broken ones.
  */
  template.push({
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'selectAll' },
    ],
  })

  template.push({ label: 'Window', submenu: windowSubmenu(platform) })

  return template
}
