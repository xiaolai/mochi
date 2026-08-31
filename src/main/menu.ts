import { Menu, app } from 'electron'

import { menuTemplate } from './menu-template'

/**
 * The application menu, which exists for its keys rather than to be looked at.
 *
 * She is an accessory: no Dock icon, no menu bar most of the time. The menu
 * becomes visible only while an ordinary window is open, because `window.ts`
 * switches the activation policy to `regular` for exactly that long. So this is
 * mostly a keyboard contract.
 *
 * The contract itself — which keys close, which one does not quit, and why the
 * Edit roles have to be restated — lives in `./menu-template`, along with the
 * argument for each. It is a separate module because this one imports `Menu` and
 * `app` at module scope: a test that reached the template through here would
 * need a running Electron, and would therefore not exist.
 *
 * What is left here is the installation, which is the half no test can check
 * without an application around it.
 */
export function installMenu(): void {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(menuTemplate(process.platform, app.getName(), () => app.quit())),
  )
}
