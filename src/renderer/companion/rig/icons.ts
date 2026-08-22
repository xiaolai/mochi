import { MOCHI } from '@shared/avatar-spec'
import type { Treatment } from './svg'

/**
 * Every icon this application ships, as data.
 *
 * ## Why the SET is here and the writing is in a script
 *
 * `scripts/icons.mjs` does filesystem work and cannot be imported by a test
 * without doing it. This is the part worth checking -- which files exist, how
 * big each is, and how each is coloured -- so it lives where `icons.test.ts`
 * can render every entry and compare it with what is committed.
 *
 * That is what turns the generator into a guarantee. Before it, the claim that
 * the mark and the mochi "cannot drift" was, in `shipped-icons.test.ts`' own
 * words, "not true, merely unfalsified". Now the shape comes from `domeOutline`
 * and a test fails if `resources/` disagrees with it.
 *
 * ## The numbers are MEASURED, not chosen
 *
 * Every colour, gradient stop, and fraction below was sampled off the artwork
 * that shipped, so regenerating reproduced the existing icons rather than
 * redesigning them. Where a number looks arbitrary it is because the artwork
 * was.
 */

/** One shipped file: where it goes, how big it is, and how it is coloured. */
export interface IconAsset {
  /** Relative to `resources/`. */
  readonly file: string
  readonly px: number
  readonly treatment: Treatment
}

/**
 * The app icon: her darker palette on a light vertical gradient.
 *
 * NOT `colBody`/`colShadow`. Sampled off `1024x1024.png`, the icon is
 * `#618872` over `#558168` — appreciably darker than the `#8ec8a8` she is drawn
 * in. That is a deliberate piece of artwork rather than a bug: her on-screen
 * green is chosen to sit on a desktop, and an icon has to hold up against a
 * pale gradient in a Dock.
 */
const APP: Treatment = {
  body: '#618872',
  shadow: '#558168',
  background: { from: '#f3f2f2', to: '#e2e1e1' },
  width: 0.64,
}

/** The same picture, smaller in its square: macOS insets a Dock tile. */
const DOCK: Treatment = { ...APP, width: 0.5146 }

/** In-window, on nothing: her real colours, because this one sits beside her. */
const WINDOW: Treatment = {
  body: MOCHI.colBody,
  shadow: MOCHI.colShadow,
  background: null,
  width: 0.875,
}

/**
 * A menu-bar template: black plus alpha, and macOS recolours it.
 *
 * Flat — `shadow` is the same colour as `body`, so the two-fill trick collapses
 * into one silhouette. A template image with a lit side would be recoloured to
 * two shades of the same grey and read as a printing error.
 */
const TEMPLATE: Treatment = { body: '#000000', shadow: '#000000', background: null, width: 0.7045 }

/** The macOS colour fallback, for anyone running with template images off. */
const TRAY_MAC: Treatment = {
  body: MOCHI.colBody,
  shadow: MOCHI.colBody,
  background: null,
  width: 0.7045,
}

/** Windows has no template images, so the mark ships twice and Windows picks. */
const TRAY_WIN_ON_DARK: Treatment = { ...TRAY_MAC, width: 0.9063 }
const TRAY_WIN_ON_LIGHT: Treatment = { ...TRAY_WIN_ON_DARK, body: '#547663', shadow: '#547663' }

const WIN_TRAY_SIZES: readonly number[] = [16, 20, 24, 28, 32, 36, 40, 48]

/** Every file this app ships, and what each is. */
export const ICON_SET: readonly IconAsset[] = [
  ...[16, 32, 64, 128, 256, 512, 1024].map((px) => ({
    file: `icons/${String(px)}x${String(px)}.png`,
    px,
    treatment: APP,
  })),
  { file: 'icons/dock.png', px: 1024, treatment: DOCK },
  ...[32, 64, 256].map((px) => ({
    file: `icons/window-${String(px)}.png`,
    px,
    treatment: WINDOW,
  })),
  ...(
    [
      ['tray/trayTemplate.png', 22],
      ['tray/trayTemplate@2x.png', 44],
      ['tray/trayTemplate@3x.png', 66],
    ] as const
  ).map(([file, px]) => ({ file, px, treatment: TEMPLATE })),
  ...(
    [
      ['tray/tray.png', 22],
      ['tray/tray@2x.png', 44],
      ['tray/tray@3x.png', 66],
    ] as const
  ).map(([file, px]) => ({ file, px, treatment: TRAY_MAC })),
  ...WIN_TRAY_SIZES.map((px) => ({
    file: `tray/trayWin-onDark-${String(px)}.png`,
    px,
    treatment: TRAY_WIN_ON_DARK,
  })),
  ...WIN_TRAY_SIZES.map((px) => ({
    file: `tray/trayWin-onLight-${String(px)}.png`,
    px,
    treatment: TRAY_WIN_ON_LIGHT,
  })),
]
