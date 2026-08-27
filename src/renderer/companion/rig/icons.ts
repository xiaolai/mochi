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

/**
 * The Dock tile: the same picture on a rounded plate with margin around it.
 *
 * ## The mark was never the problem — the plate was
 *
 * `dock.setIcon` gets no squircle from the system, so this asset has to arrive
 * already the right shape. The hand-drawn original did: an **852px plate in a
 * 1024 square**, transparent outside it, with her at **62% of the plate**.
 *
 * When the assets moved to this generator the plate became a full-bleed square,
 * because a full-bleed square was all `svg.ts` could draw. Her width was
 * sampled off the original and is correct — 0.5146 of the canvas is the same
 * 528px mark the original has. What changed is what it sits on: the plate grew
 * from 852 to 1024 and she stayed put, so she went from filling 62% of a tile
 * to 51% of one. Measured off a screenshot of the real Dock she came out at
 * 50.8%, which is that number arriving on screen.
 *
 * ## The numbers, measured off the original
 *
 * | | original | as a fraction |
 * | --- | --- | --- |
 * | plate | 852px in 1024 | **0.832** |
 * | corner radius | ~196px on the plate | **0.230** |
 * | her width | 528px in 1024 | 0.5146 |
 *
 * The radius was fitted to the plate's own silhouette — half-width at each 5%
 * of its height — rather than eyeballed. It lands within half a percent of
 * Apple's published macOS grid, 185.4 on 824, which is the corroboration that
 * the artwork was drawn to spec and this reproduces it rather than redesigns it.
 */
const DOCK: Treatment = {
  ...APP,
  background: { from: '#f3f2f2', to: '#e2e1e1', size: 0.832, radius: 0.23 },
  width: 0.5146,
}

/** In-window, on nothing: her real colours, because this one sits beside her. */
const WINDOW: Treatment = {
  body: MOCHI.colBody,
  shadow: MOCHI.colShadow,
  background: null,
  width: 0.875,
}

/**
 * How wide the mark sits in a 22pt menu-bar slot.
 *
 * ## Measured off the artwork, which the generator had been shrinking
 *
 * The hand-drawn originals, before every asset came from one number:
 *
 * | asset | canvas | mark | fraction |
 * | --- | --- | --- | --- |
 * | `trayTemplate.png` | 22 | 18×14 | 0.818 |
 * | `trayTemplate@2x.png` | 44 | 34×26 | 0.773 |
 * | `trayTemplate@3x.png` | 66 | 50×38 | 0.758 |
 *
 * They disagree because they were hinted by hand — bigger at 22px, where a
 * mark has no room to be polite. A generator has one number for all three, so
 * it takes the **retina** pair, which is what actually renders on the machines
 * this ships to.
 *
 * 0.7045 was below all three and made her smaller than she was drawn. A pass
 * at matching her lit-pixel count against her neighbours took her to 0.55,
 * which was smaller again and wrong twice over: the neighbours in a menu bar
 * are outlines and she is a filled dome, so equal ink means unequal size, and
 * there was never a reason to think her own artwork was the thing that needed
 * correcting.
 */
const MENU_BAR_WIDTH = 0.766

/**
 * A menu-bar template: black plus alpha, and macOS recolours it.
 *
 * Flat — `shadow` is the same colour as `body`, so the two-fill trick collapses
 * into one silhouette. A template image with a lit side would be recoloured to
 * two shades of the same grey and read as a printing error.
 */
const TEMPLATE: Treatment = {
  body: '#000000',
  shadow: '#000000',
  background: null,
  width: MENU_BAR_WIDTH,
}

/** The macOS colour fallback, for anyone running with template images off. */
const TRAY_MAC: Treatment = {
  body: MOCHI.colBody,
  shadow: MOCHI.colBody,
  background: null,
  // The same slot, so the same size. These two differing is somebody seeing a
  // different icon for having turned template images off.
  width: MENU_BAR_WIDTH,
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
