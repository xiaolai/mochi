/**
 * The menu bar item, which is the only way out.
 *
 * Her window is frameless, she is out of the Dock, and `window-all-closed` does
 * not quit on macOS — so before this existed the only way to stop her was
 * Activity Monitor or `kill` from a terminal. `electron-builder.yml` has said
 * so in a comment since the assets were first shipped: *an invisible tray icon
 * is an app nobody can quit.* The assets were there; nothing created a `Tray`.
 *
 * It is also the only surface that is always present. Everything else is
 * reached by hovering a small green shape that may be behind a window, which is
 * a fine way to offer something and a poor way to be the only way.
 *
 * ## Actions here, configuration in the settings window
 *
 * v1's standing rule, and it is carried over deliberately rather than by
 * habit: the tray is actions and state, the settings window is configuration.
 * "Become somebody else now" is an action you want without opening a window,
 * so the persona list is here. Editing who that persona IS stays in the window.
 *
 * Both go through the same handler in main, and the settings window re-reads
 * when it regains focus, so the two cannot drift apart — which is the failure
 * v1's own note warns about when one setting grows two entry points.
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { Menu, Tray, app, nativeImage } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'
import { forPronoun, type ByPronoun, type Pronoun } from '@shared/pronoun'

export interface TrayModel {
  /** Everyone she could be, and who she is. */
  readonly personas: readonly { readonly id: string; readonly name: string }[]
  readonly wornId: string
  /**
   * Which words this menu uses for the worn character.
   *
   * Six of its labels are about her rather than about the app, and every one of
   * them said "her" whatever the persona stored.
   */
  readonly pronoun: Pronoun
  /**
   * Where the bubble could go right now, what was asked for, and where it is.
   *
   * `available` comes up from the renderer, the only thing that knows how big
   * the bubble is and where the screen ends — so the menu can never offer a
   * side that would not be honoured. It shrinks as she is dragged into a
   * corner: in the bottom right there is no room below her or to her right, and
   * the menu says so by having two entries instead of four.
   */
  readonly bubble: {
    readonly available: readonly string[]
    readonly asked: string
    readonly using: string
  }
  /** Whether she is asleep, and whether she is hidden. Two separate things. */
  readonly resting: { readonly asleep: boolean; readonly hidden: boolean }
  /** The keys, as claimed. A binding another application took is not shown. */
  readonly keys: { readonly rest: string | null; readonly hide: string | null }
}

export interface TrayHandlers {
  readonly onShelf: () => void
  readonly onSettings: () => void
  readonly onWear: (id: string) => void
  readonly onBubbleSide: (side: string) => void
  readonly onRest: () => void
  readonly onHide: () => void
  readonly onQuit: () => void
}

/**
 * The menu, as data, so it can be checked without a display.
 *
 * Separated from `new Tray` for exactly that reason: everything below decides
 * what appears and in what order, and none of it needs a menu bar to run.
 */
export function trayMenuTemplate(
  model: TrayModel,
  handlers: TrayHandlers,
  appName: string,
): MenuItemConstructorOptions[] {
  const worn = model.personas.find((one) => one.id === model.wornId)
  return [
    // Who she is right now, as a readout. Disabled because it is not a control
    // — the list below is.
    { label: worn === undefined ? appName : `${appName} — ${worn.name}`, enabled: false },
    { type: 'separator' },
    /**
     * The two states, at the top, because they are what somebody opens this
     * menu for in a hurry.
     *
     * Labelled by what pressing them DOES, not by what she currently is: "Wake
     * her" is unambiguous in a way that a checkbox marked "Asleep" is not, and
     * this menu is read at a glance by somebody who wants her quiet NOW.
     *
     * A binding another application already owns is left off rather than shown
     * greyed: a label promising a key that does nothing is worse than no label,
     * and there would be no way to tell the two apart.
     */
    {
      label: forPronoun(model.resting.asleep ? WAKE : REST, model.pronoun),
      // Spread rather than `?? undefined`: with `exactOptionalPropertyTypes` an
      // explicit `undefined` is not the same as an absent key, and an absent
      // key is what "no accelerator" means.
      ...(model.keys.rest === null ? {} : { accelerator: model.keys.rest }),
      click: handlers.onRest,
    },
    {
      label: forPronoun(model.resting.hidden ? SHOW : HIDE, model.pronoun),
      ...(model.keys.hide === null ? {} : { accelerator: model.keys.hide }),
      click: handlers.onHide,
    },
    { type: 'separator' },
    { label: 'Shelf…', click: handlers.onShelf },
    { label: 'Settings…', click: handlers.onSettings },
    { type: 'separator' },
    ...(model.personas.length > 1
      ? ([
          { label: 'Wearing', enabled: false },
          ...model.personas.map((persona): MenuItemConstructorOptions => ({
            label: persona.name,
            type: 'radio',
            checked: persona.id === model.wornId,
            click: () => {
              handlers.onWear(persona.id)
            },
          })),
          { type: 'separator' },
        ] as MenuItemConstructorOptions[])
      : []),
    {
      label: 'Speech bubble',
      submenu: [
        {
          label: 'Wherever it fits',
          type: 'radio',
          checked: model.bubble.asked === 'auto',
          click: () => {
            handlers.onBubbleSide('auto')
          },
        },
        { type: 'separator' },
        /**
         * Only the sides that fit, so a choice is always honoured.
         *
         * Disabled-and-present was the alternative and it is worse: a greyed
         * "Below her" while she is in the bottom corner invites the reading
         * that the feature is broken rather than that the screen ends there.
         */
        ...model.bubble.available.map((side): MenuItemConstructorOptions => ({
          // `?? side` keeps a side this menu has no name for readable rather
          // than blank -- the raw key is at least true.
          label: (() => {
            const named = SIDE_NAMES[side]
            return named === undefined ? side : forPronoun(named, model.pronoun)
          })(),
          type: 'radio',
          checked: model.bubble.asked === side,
          click: () => {
            handlers.onBubbleSide(side)
          },
        })),
      ],
    },
    { type: 'separator' },
    // The item this whole file exists for. `Command+Q` is spelled out because
    // an accessory app has no application menu to carry it.
    { label: `Quit ${appName}`, accelerator: 'Command+Q', click: handlers.onQuit },
  ]
}

/**
 * What the sides are called to a person.
 *
 * "Above her" rather than "Top", because the menu is about where she speaks
 * from, not about a corner of a box.
 */
const SIDE_NAMES: Readonly<Record<string, ByPronoun>> = {
  above: { she: 'Above her', he: 'Above him', it: 'Above it' },
  below: { she: 'Below her', he: 'Below him', it: 'Below it' },
  left: { she: 'To her left', he: 'To his left', it: 'To its left' },
  right: { she: 'To her right', he: 'To his right', it: 'To its right' },
}

/**
 * The four labels that are about HER rather than about the app.
 *
 * "Shelf…" and "Settings…" are not here and should not be: they name windows,
 * and writing them three times would put the same word in three slots and
 * invite somebody to change one of them.
 */
const WAKE: ByPronoun = { she: 'Wake her', he: 'Wake him', it: 'Wake it' }
const REST: ByPronoun = { she: 'Let her rest', he: 'Let him rest', it: 'Let it rest' }
const SHOW: ByPronoun = { she: 'Show her', he: 'Show him', it: 'Show it' }
const HIDE: ByPronoun = { she: 'Hide her', he: 'Hide him', it: 'Hide it' }

/**
 * Which asset, per platform. Conventions, not duplication.
 *
 *   darwin  a TEMPLATE — pure alpha, recoloured by the system for light and
 *           dark menu bars, and inset because every glyph up there carries
 *           optical margin
 *   win32   coloured, FILLING its box at real Windows sizes. Inheriting the Mac
 *           inset made her visibly smaller than every neighbour
 *   linux   the coloured variant; panel conventions vary
 *
 * **The Windows taskbar-theme query is deliberately NOT carried over from v1.**
 * It shells out to `reg` to read `SystemUsesLightTheme`, and the subprocess
 * helper it used does not exist in this tree. Dark is both the Windows default
 * and the direction where a wrong guess is merely dim rather than invisible —
 * but it is a guess, and this comment is here so the next person finds a known
 * gap rather than an oversight.
 */
export function iconFileFor(platform: NodeJS.Platform): string {
  if (platform === 'darwin') return 'trayTemplate.png'
  if (platform !== 'win32') return 'tray.png'
  return 'trayWin-onDark-16.png'
}

/**
 * The platform is an ARGUMENT above, and that is the whole point of the split.
 *
 * `findings.md` §16 records that the Windows branch "has never been executed
 * anywhere", and while this read `process.platform` directly it could not be:
 * on a Mac the `win32` line is unreachable, so nothing could check that the file
 * it names is even present in the build. It is now exercised by
 * `tray-assets.test.ts` on every run, on every platform.
 *
 * What that does NOT do is render anything. Whether Windows draws her correctly
 * in a real notification area is still unverified, and no test in this
 * repository can say otherwise -- see §16.
 */
function iconFile(): string {
  return iconFileFor(process.platform)
}

/**
 * Where it lives — ONE path, decided by whether this is packaged, never a list
 * of candidates tried in order.
 *
 * Guessing at runtime hides exactly the failure that matters: a packaging
 * mistake leaving the asset out of the bundle is invisible while a development
 * copy is still findable, so it only appears on somebody else's machine.
 */
function iconPath(file: string): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'tray', file)
    : join(app.getAppPath(), 'resources/tray', file)
}

/**
 * The extra Windows renditions beside the 16px base.
 *
 * All eight scales, not the three obvious ones: 16/24/32 covers 100, 150 and
 * 200 and leaves 125% resampling — and 125% is the default on a great many
 * laptops, so the most common non-default scale would be the blurry one.
 */
export const WINDOWS_SCALES = [
  [20, 1.25],
  [24, 1.5],
  [28, 1.75],
  [32, 2],
  [36, 2.25],
  [40, 2.5],
  [48, 3],
] as const

function withWindowsScales(
  image: Electron.NativeImage,
  directory: string,
  base: string,
): Electron.NativeImage {
  for (const [size, scaleFactor] of WINDOWS_SCALES) {
    const path = join(directory, base.replace('-16.png', `-${String(size)}.png`))
    // A missing rendition costs sharpness at one scale, not the icon — so this
    // is the one place here that degrades rather than throws.
    if (!existsSync(path)) continue
    image.addRepresentation({ scaleFactor, buffer: readFileSync(path) })
  }
  return image
}

/**
 * Her silhouette, or nothing at all — and nothing at all THROWS.
 *
 * `nativeImage.createEmpty()` produces a tray with no pixels in it. On macOS
 * that is a menu bar item nobody can see and therefore nobody can click — and
 * since this item is the only way to quit, an invisible one is an application
 * whose only exit is `kill`. Refusing to start, naming the file, is strictly
 * kinder.
 */
function icon(): Electron.NativeImage {
  const file = iconFile()
  const path = iconPath(file)
  if (!existsSync(path)) throw new Error(`[tray] icon asset missing at ${path}`)
  const image = nativeImage.createFromPath(path)
  // A file that EXISTS and cannot be decoded is its own failure — truncated, or
  // no longer a PNG. `createFromPath` reports that as an empty image and says
  // nothing about why.
  if (image.isEmpty()) throw new Error(`[tray] icon asset at ${path} could not be decoded`)
  // macOS reads only the alpha of a template image and recolours it per menu
  // bar. Marking it a template elsewhere ships a black blob.
  if (process.platform === 'darwin') image.setTemplateImage(true)
  if (process.platform === 'win32') return withWindowsScales(image, dirname(path), file)
  return image
}

export interface TrayHandle {
  /** Rebuild the menu — after a persona is worn, or the shelf changes. */
  refresh(): void
}

/**
 * Kept in a module-level variable, and that is load-bearing rather than style:
 * a `Tray` that goes out of scope is garbage collected, and the item vanishes
 * from the menu bar some seconds after launch.
 */
let tray: Tray | null = null

export function createTray(model: () => TrayModel, handlers: TrayHandlers): TrayHandle {
  tray ??= new Tray(icon())
  const item = tray

  const refresh = (): void => {
    item.setContextMenu(Menu.buildFromTemplate(trayMenuTemplate(model(), handlers, app.getName())))
  }
  refresh()
  item.setToolTip(app.getName())
  /**
   * Said out loud, because "no error" is not evidence that this worked.
   *
   * A `Tray` that is created and then hidden — the menu bar is full, or the
   * item was collected — looks from the log exactly like one that is sitting
   * there. This is the only way out of the application, so the launch says
   * where the asset came from and that the item exists.
   */
  console.log(`[tray] created from ${iconPath(iconFile())}`)
  return { refresh }
}
