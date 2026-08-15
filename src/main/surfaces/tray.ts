import { Menu, Tray, app, nativeImage, nativeTheme } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'
import { runProbe } from '../probe'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { format, messagesFor, type LocaleTag, type Messages } from '@shared/i18n'
import type { Remedy } from '../codex/status'
import type { Phase } from '@shared/companion'
import type { Pronoun } from '@shared/pronoun'

export interface TrayHandlers {
  readonly onToggleVisible: () => void
  /** Re-open the Codex dialog. Only reachable while she cannot speak. */
  readonly onFixVoice: () => void
  /** Wake her, or send her to sleep. The same gesture the shortcut will be. */
  readonly onToggleAwake: () => void
  /** Open the settings window, or focus the one already open. */
  readonly onOpenSettings: () => void
  /** Wear a different persona. An ACTION, so it belongs here. */
  readonly onSwitchPersona: (id: string) => void
  readonly onQuit: () => void
}

export interface TrayModel {
  readonly visible: boolean
  /**
   * Everyone she could be, and who she is.
   *
   * On the TRAY rather than in the settings window, and that is the standing
   * rule rather than a preference: the tray is actions and state, the settings
   * window is configuration, and "become somebody else now" is an action you
   * want without opening a window. The settings window gets the shelf --
   * install, inspect, edit, delete. Putting a switcher in both is how the
   * predecessor ended up with one setting behind two entry points and two
   * refresh paths.
   */
  readonly personas: ReadonlyArray<{ readonly id: string; readonly name: string }>
  readonly activePersonaId: string
  /**
   * Whether what is said is being written to disk, right now.
   *
   * A MACHINE-level fact even though the policy behind it belongs to the
   * persona: only one character is worn at a time, so there is
   * always exactly one effective answer, and the person in the room has a
   * right to it without opening a window. The tray is the only surface that
   * is always there, which is the same argument the microphone line already
   * makes.
   *
   * It is a readout, not a switch. Changing it is configuration and lives in
   * the settings window -- one setting behind two entry points is the mistake
   * the tray/window split exists to prevent.
   */
  readonly keepingText: boolean
  /**
   * The chords, as Electron spells them, or null where one could not be
   * claimed.
   *
   * Shown beside the items they drive. Null rather than omitted, because a
   * shortcut another application already owns must not appear in this menu: a
   * label promising a key that does nothing is worse than no label, and the
   * user would have no way to tell which of the two they were looking at.
   */
  readonly keys: {
    readonly toggleVisible: string | null
    readonly toggleAwake: string | null
  }
  /**
   * Null when she can speak. Anything else is the remedy, and its presence is
   * what puts the item in the menu -- so the indicator cannot get out of step
   * with the dialog: both read the same value.
   */
  readonly voice: Remedy | null
  /**
   * Whether a repair dialog is already open.
   *
   * `fixVoice` is single-flight and calls `refreshTray()` on both edges of that
   * flight -- which changed nothing, because this model had no field for it and
   * the menu therefore could not show it. The item stayed clickable with its
   * own dialog on screen, so the guard silently absorbed the second click and
   * the user learned nothing from pressing it.
   */
  readonly repairing: boolean
  /** Which language the menu speaks. Main owns it; this is a view of it. */
  readonly locale: LocaleTag
  /**
   * How this menu refers to her.
   *
   * A separate axis from `locale`, and both are needed: the language decides
   * which table is read, the pronoun decides which row of it. Someone may well
   * want an English menu for a companion they call 他.
   */
  readonly pronoun: Pronoun
  readonly phase: Phase
  /**
   * Whether the microphone is open.
   *
   * This menu is the ONLY surface that shows it, which makes it non-negotiable
   * rather than decorative: a microphone that is live with nothing anywhere
   * saying so is the one state a desktop companion must never be able to reach.
   */
  readonly micOpen: boolean
}

/**
 * The theme listener, held so it can be taken off again.
 *
 * An anonymous listener on `nativeTheme` cannot be removed, and it closes over
 * the tray -- so a destroyed tray stayed reachable for the life of the process,
 * and a second `createTray` added a second listener beside the first. Every
 * theme change then ran one registry query per tray ever created, each one
 * repainting an object that in most cases no longer exists.
 */
let themeListener: (() => void) | null = null

/**
 * The tray is the only dependable way out of this app.
 *
 * The window is frameless, click-through by default and kept out of the Dock,
 * so neither a close button nor Cmd+Q can reach it. Without the tray the only
 * remaining exit is killing the process from a terminal -- which is why "quit"
 * is the one item that exists before anything else does.
 *
 * This block sat two declarations above, over `themeListener`, so the reason
 * the tray is non-negotiable read as a note about a listener variable.
 */
export function createTray(model: TrayModel, handlers: TrayHandlers): Tray {
  const tray = new Tray(icon())
  applyTrayModel(tray, model, handlers)

  // Windows has no template image, so the variant is chosen once here and has
  // to be re-chosen whenever the theme moves. `nativeTheme` fires for the APP
  // theme, which is the wrong value -- but it is the only event Electron gives
  // for a theme change, and both settings live in the same registry key, so it
  // is a reliable enough trigger for re-reading the right one.
  if (process.platform === 'win32') {
    const repaint = (): void => {
      if (!tray.isDestroyed()) tray.setImage(icon())
    }
    // Any listener from a previous tray goes first, so this is idempotent
    // rather than cumulative.
    removeThemeListener()
    themeListener = (): void => refreshTaskbarTheme(repaint)
    // Once at startup, then on every theme change. Both are background reads;
    // the tray simply starts on the dark variant and corrects itself within a
    // few milliseconds if the taskbar turns out to be light.
    refreshTaskbarTheme(repaint)
    nativeTheme.on('updated', themeListener)
  }
  return tray
}

function removeThemeListener(): void {
  if (themeListener === null) return
  nativeTheme.removeListener('updated', themeListener)
  themeListener = null
}

/**
 * Take the tray down, and the listener with it.
 *
 * Paired with `createTray` rather than left to the caller's `tray.destroy()`:
 * the listener is created here, so forgetting it is only possible if removing
 * it is somebody else's job.
 */
export function destroyTray(tray: Tray | null): void {
  removeThemeListener()
  if (tray !== null && !tray.isDestroyed()) tray.destroy()
}

/**
 * The menu, as data.
 *
 * Separated from `applyTrayModel` so a test can read it. That function needs a
 * live `Tray`, so every decision it made -- which items exist, which are
 * enabled, what they say -- was observable only by running Electron. The enable
 * rules are the part most worth pinning: each exists because offering an action
 * that cannot work is worse than not offering it.
 */
export function trayMenuTemplate(
  model: TrayModel,
  handlers: TrayHandlers,
  labels: Messages['tray'],
  appName: string,
): MenuItemConstructorOptions[] {
  return [
    // A status line, not an action. Disabled so it reads as a readout rather
    // than something that failed to respond to a click.
    { label: statusOf(model, labels), enabled: false },
    // Always shown, in both states. An indicator that appears only while
    // recording is one whose absence means either "not recording" or "this
    // build does not have the feature", and somebody deciding whether to say
    // something out loud cannot tell those apart.
    {
      label: model.keepingText ? labels.keepingText : labels.keepingNothing,
      enabled: false,
    },
    {
      label: (model.phase === 'asleep' ? labels.wake : labels.sleep)[model.pronoun],
      click: handlers.onToggleAwake,
      ...(model.keys.toggleAwake === null ? {} : { accelerator: model.keys.toggleAwake }),
      // Mid-transition the gesture has a meaning, but not a stable label —
      // and offering the wrong verb is worse than offering none.
      //
      // Waking additionally requires a route to a voice. `model.voice` is the
      // remedy for what is wrong, so non-null means we already know the wake
      // cannot succeed -- offering it anyway buys a guaranteed failure and a
      // fifteen-second timeout. Sleeping stays available in every live phase,
      // because getting out must never depend on anything working.
      enabled: model.phase === 'awake' || (model.phase === 'asleep' && model.voice === null),
    },
    { type: 'separator' },
    {
      label: model.visible ? labels.hide : labels.show,
      click: handlers.onToggleVisible,
      // The accelerator is DISPLAYED here, not bound here. A tray menu is not
      // focused when you press the key, so the binding is global (see
      // `shortcuts.ts`); this is the only place a user finds out it exists.
      ...(model.keys.toggleVisible === null ? {} : { accelerator: model.keys.toggleVisible }),
    },
    // Only when there is a choice to make. A submenu holding one radio item
    // is a control that cannot do anything, and it would appear on every fresh
    // install -- where the catalog holds only the built-in.
    ...(model.personas.length < 2
      ? []
      : [
          {
            label: labels.personas[model.pronoun],
            submenu: model.personas.map((one) => ({
              // The NAME, never the id. The id is a key -- lowercase, hyphens,
              // possibly `ada-2` -- and it is not what anybody calls her.
              label: one.name,
              type: 'radio' as const,
              checked: one.id === model.activePersonaId,
              click: () => handlers.onSwitchPersona(one.id),
            })),
          },
        ]),
    { label: labels.settings, click: handlers.onOpenSettings },
    ...(model.voice === null
      ? []
      : [
          {
            label: labels.cannotSpeak[model.pronoun],
            // Greyed while its own dialog is already open, rather than letting
            // the click disappear into the single-flight guard. `fixVoice`
            // calls `refreshTray()` on both edges of that flight, and those
            // calls did nothing at all until the model carried this field.
            enabled: !model.repairing,
            click: handlers.onFixVoice,
          },
        ]),
    { type: 'separator' },
    {
      // Not `role: 'quit'` -- Electron ignores `click` when a role is set, and
      // the teardown would never run.
      // The app NAME stays dynamic: the platform decides what she is called,
      // and a translation that hardcoded it would be wrong on any rename.
      label: format(labels.quit, { app: appName }),
      accelerator: 'CommandOrControl+Q',
      click: handlers.onQuit,
    },
  ]
}

export function applyTrayModel(tray: Tray, model: TrayModel, handlers: TrayHandlers): void {
  const { tray: labels } = messagesFor(model.locale)
  tray.setToolTip(labels.tooltip)
  tray.setContextMenu(
    Menu.buildFromTemplate(trayMenuTemplate(model, handlers, labels, app.getName())),
  )
}

function statusOf(model: TrayModel, labels: Messages['tray']): string {
  // The microphone outranks the phase, because it is the only place a live
  // microphone is ever shown. A transitional label used to win, so the
  // representable state `{ phase: 'waking', micOpen: true }` displayed
  // "waking" over an open microphone -- the tray quietly disclaiming the one
  // thing it exists to disclose.
  if (model.micOpen) return labels.listening
  if (model.phase === 'waking') return labels.waking
  if (model.phase === 'farewell') return labels.sayingGoodbye
  return labels.notListening
}

/**
 * Whether the TASKBAR is light. Windows only; null when unknown.
 *
 * Read from the registry rather than from `nativeTheme.shouldUseDarkColors`,
 * and that is the whole point of this function. Windows has TWO independent
 * theme settings and Electron exposes only one of them:
 *
 *   AppsUseLightTheme    app windows      -> nativeTheme.shouldUseDarkColors
 *   SystemUsesLightTheme taskbar and tray -> not exposed at all
 *
 * A user can run light apps on a dark taskbar, and using the app value would
 * pick the wrong icon for exactly those people. Electron has an open request
 * for the shell theme (electron#46429); until it lands, the registry is the
 * only correct source.
 *
 * Null on a failed read, and the caller treats null as dark -- the Windows
 * default, and the case where a wrong guess is least harmful, since the light
 * variant on a dark bar is merely dim rather than invisible.
 */
let taskbarLight: boolean | null = null
/**
 * Which theme query is current.
 *
 * `nativeTheme` can fire repeatedly, and two overlapping reads may finish in
 * either order -- so an OLDER answer landing last would set the icon to a theme
 * the user has already left. Only the newest query is allowed to write.
 */
let themeQuery = 0

/**
 * Cached answer, never a blocking read.
 *
 * The first version called `spawnSync('reg', …)` from `icon()`, which runs on
 * tray creation and again on every theme change -- up to five seconds of
 * frozen main thread during startup, for a cosmetic choice. Now nothing blocks:
 * the cache starts null, `iconFile()` treats null as dark, and `refreshTaskbarTheme`
 * updates it in the background and re-sets the image only if the answer moved.
 *
 * Null-as-dark is the right default in both senses: it is the Windows default,
 * and it is the direction where a wrong guess is merely dim rather than
 * invisible.
 */
function refreshTaskbarTheme(onChange: () => void): void {
  if (process.platform !== 'win32') return
  themeQuery += 1
  const mine = themeQuery
  const promise = runProbe(
    'reg',
    [
      'query',
      'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize',
      '/v',
      'SystemUsesLightTheme',
    ],
    { platform: process.platform, env: process.env, timeoutMs: 5_000 },
  ).then((result) => {
    // Superseded queries do not write. `nativeTheme` can fire repeatedly and
    // two reads may finish in either order, so an OLDER answer landing last
    // would set the icon to a theme the user has already left.
    if (mine !== themeQuery) return
    // SAID OUT LOUD. Every one of these used to be a bare `return`, so a
    // missing `reg`, a locked registry or a rewritten output format left her
    // silently on the dark-bar icon -- which on a light taskbar is legible but
    // dim, exactly the kind of wrongness nobody reports and nobody can explain.
    // The value is cosmetic; the SILENCE is what makes it undiagnosable.
    if (result.failed || result.status !== 0) {
      console.warn(
        `[tray] could not read the taskbar theme (${result.timedOut ? 'timed out' : `exit ${String(result.status)}`}); using the dark-bar icon`,
      )
      return
    }
    // `REG_DWORD    0x1`. Matched loosely: the column spacing and the localised
    // header vary, the hex value does not.
    const match = /SystemUsesLightTheme\s+REG_DWORD\s+0x([0-9a-f]+)/i.exec(result.stdout)
    if (match === null) {
      console.warn('[tray] the taskbar theme query returned nothing recognisable')
      return
    }
    const next = Number.parseInt(match[1] ?? '0', 16) === 1
    if (next === taskbarLight) return
    taskbarLight = next
    onChange()
  })
  // CAUGHT. `void` on a promise silences the linter, not the rejection: a throw
  // from `onChange` -- which re-sets the tray image, and can throw if the tray
  // was destroyed between the query starting and finishing -- became an
  // unhandled rejection, which Electron may treat as fatal.
  promise.catch((error: unknown) => {
    console.error('[tray] the taskbar theme query failed:', error)
  })
}

function iconFile(): string {
  // Three platforms, three assets, and the differences are conventions rather
  // than duplication:
  //
  //   darwin  a TEMPLATE -- pure alpha, recoloured by the system per menu bar,
  //           inset 0.74 because every glyph up there carries optical margin
  //   win32   coloured, FILLING its box at real Windows sizes (16/24/32).
  //           Inheriting the Mac inset made her visibly smaller than every
  //           neighbour: 74% wide and 58% tall, about 12x9 in a 16px slot
  //   linux   the 22px coloured variant; panel conventions vary and 22 is the
  //           common one
  if (process.platform === 'darwin') return 'trayTemplate.png'
  if (process.platform !== 'win32') return 'tray.png'
  // Named for the taskbar it sits on, not for its own lightness.
  return taskbarLight === true ? 'trayWin-onLight-16.png' : 'trayWin-onDark-16.png'
}

/**
 * The Windows tray image, carrying all eight DPI renditions.
 *
 * Windows offers eight display scales -- 100 through 300 percent -- and a 16px
 * tray slot scales with each of them. Handing it one size makes every other
 * scale a resample, which is what the old 22px macOS asset was at EVERY Windows
 * scale, since 22 is a point size that lands on none of them.
 *
 * All eight, not the three obvious ones. 16/24/32 covered 100, 150 and 200 and
 * left 125% resampling -- and 125% is the default on a great many laptops, so
 * the most common non-default scale was the blurry one.
 */
/**
 * The extra renditions, beside the 16px base. Exported so a test can check that
 * `pnpm icons` actually produces every one -- a missing file is skipped here
 * rather than thrown, which is right at runtime and invisible without this.
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
    const path = join(directory, base.replace('-16.png', `-${size}.png`))
    // A missing rendition costs sharpness at one scale, not the icon -- so this
    // is the one place here that degrades rather than throws.
    if (!existsSync(path)) continue
    image.addRepresentation({ scaleFactor, buffer: readFileSync(path) })
  }
  return image
}

/**
 * Where her silhouette lives on disk.
 *
 * Generated by `pnpm icons` from the same geometry the renderer draws, and read
 * from a file rather than redrawn here: the predecessor kept a second,
 * procedural copy of the outline in main plus three hardcoded colours "sampled
 * from the icon", and a sampled value that has left its source can only be
 * noticed by eye. One generator, one output, read at runtime — the project's
 * third settled rule.
 *
 * This block sat forty lines above, over the Windows taskbar-theme cache, where
 * it read as an explanation of a registry query.
 */
function iconPath(file: string): string {
  // ONE path, decided by whether this is a packaged app -- not a list of
  // candidates tried in order. Guessing at runtime is what the project's third
  // settled rule forbids, and for a concrete reason: a packaging mistake that
  // leaves the asset out of the bundle is invisible while a development copy is
  // still findable, so the failure only appears on someone else's machine.
  //
  // Takes the filename rather than choosing it, so `icon()` decides ONCE which
  // variant this is. Calling `iconFile()` here and again for the DPI
  // renditions asked the same question twice and left open, structurally, the
  // possibility of a base image and its scaled representations coming from two
  // different variants.
  return app.isPackaged
    ? join(process.resourcesPath, 'tray', file)
    : join(__dirname, '../../resources/tray', file)
}

/**
 * Her silhouette, or nothing at all.
 *
 * This throws rather than degrading. `nativeImage.createEmpty()` produces a
 * tray with no pixels in it: on macOS that is a menu bar item you cannot see
 * and therefore cannot click -- and since the window is frameless, out of the
 * Dock and unreachable by Cmd+Q, an invisible tray is an application whose only
 * exit is `kill` from a terminal. A refusal to start, naming the file and the
 * command that produces it, is strictly kinder than that.
 */
function icon(): Electron.NativeImage {
  const file = iconFile()
  const path = iconPath(file)
  if (!existsSync(path)) {
    throw new Error(`[tray] icon asset missing at ${path} — run \`pnpm icons\``)
  }
  const image = nativeImage.createFromPath(path)
  // A file that EXISTS and cannot be decoded is its own failure -- truncated,
  // or no longer a PNG. `createFromPath` reports that as an empty image and
  // says nothing about why.
  if (image.isEmpty()) {
    throw new Error(`[tray] icon asset at ${path} could not be decoded — run \`pnpm icons\``)
  }
  // macOS reads only the alpha of a template image and recolours it for light
  // and dark menu bars. Marking it a template elsewhere ships a black blob, so
  // off-macOS keeps the image's own colours.
  if (process.platform === 'darwin') image.setTemplateImage(true)
  if (process.platform === 'win32') return withWindowsScales(image, dirname(path), file)
  return image
}
