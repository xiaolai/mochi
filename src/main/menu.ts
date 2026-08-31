import { Menu, app, type MenuItemConstructorOptions } from 'electron'

/**
 * The application menu, which exists for its keys rather than to be looked at.
 *
 * She is an accessory: no Dock icon, no menu bar most of the time. The menu
 * becomes visible only while an ordinary window is open, because `window.ts`
 * switches the activation policy to `regular` for exactly that long. So this is
 * mostly a keyboard contract.
 *
 * ## ⌘Q closes the window; it does not quit
 *
 * Nothing set an application menu, so Electron installed its default one, and
 * that default binds ⌘Q to quit. That was never a decision — it is what you get
 * for not making one, and it contradicts the design `tray.ts` states plainly:
 * the tray is *"the only way out"*.
 *
 * The cost of the default was specific. She is a resident: a companion you leave
 * running all day. ⌘Q is muscle memory for "I am done with this window", and on
 * every other application that is what it means, because every other application
 * IS its window. Here it ended her session, closed the conversation and dropped
 * the archive — for somebody who meant to put a window away.
 *
 * So ⌘Q is `close`, which is what the reflex intends. Quitting keeps its item and
 * loses its key: it is a deliberate act, reachable from here and from the tray,
 * and not something a reflex can reach.
 *
 * ## The Edit submenu is not decoration
 *
 * Replacing the default menu replaces the standard Edit roles with it, and those
 * are what make ⌘C, ⌘V, ⌘A and ⌘Z work inside a text field. Her instruction is a
 * textarea, every prompt on the machine's page is a textarea, and the transcript
 * has a copy control. Leaving this out would trade one fixed shortcut for four
 * broken ones.
 */
export function installMenu(): void {
  const template: MenuItemConstructorOptions[] = []

  if (process.platform === 'darwin') {
    template.push({
      label: app.getName(),
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
        { label: `Quit ${app.getName()}`, click: () => app.quit() },
      ],
    })
  }

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

  template.push({
    label: 'Window',
    submenu: [
      /*
        THE REFLEX, pointed at what it means.

        `CommandOrControl` rather than `Command`: on Windows the same reflex is
        Alt+F4, which the system already routes to the focused window, and Ctrl+Q
        costs nothing to offer beside it.
      */
      { role: 'close', accelerator: 'CommandOrControl+Q' },
      { role: 'minimize' },
    ],
  })

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
