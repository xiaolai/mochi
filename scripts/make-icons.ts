/**
 * One generator, from the geometry she is actually drawn with.
 *
 * There is a single graphical source. The previous codebase had three
 * mechanisms for one mark -- a shell script producing PNGs, a TypeScript module
 * redrawing the outline pixel by pixel for the tray, and a runtime path
 * resolver choosing between dev and packaged layouts -- plus three hardcoded
 * colour constants annotated "sampled from the icon". A sampled value that has
 * left its source can only be noticed by eye.
 *
 * The source here is `rig/geometry.ts` rather than an SVG, which is a deliberate
 * deviation from what that rule first said (an SVG) and a stronger version of
 * what it wanted:
 * the tray mark is literally her silhouette, computed by the same function that
 * draws her, so the two cannot drift. If a hand-drawn SVG ever supersedes the
 * generated shape, this is the file that changes.
 *
 * Run: node scripts/make-icons.ts   (Node strips the types; no build step)
 */

import { createCanvas } from '@napi-rs/canvas'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { MOCHI } from '../src/shared/avatar-spec.ts'
import { contrast, parseHex, shade, toHex } from '../src/renderer/design/accent.ts'
import { domeOutline } from '../src/renderer/companion/rig/geometry.ts'

/**
 * Where the output goes.
 *
 * Overridable so a test can run this whole file into a temporary directory.
 * That test exists because the generator broke -- a rig module gained an
 * `@shared` alias import, which `node` cannot resolve -- and NOTHING noticed:
 * `pnpm verify` does not run the generator, and the test that checks the icons
 * reads the committed PNGs, which were still perfectly valid and increasingly
 * out of date.
 */
const OUT = process.env['MOCHI_ICON_OUT']
const TRAY = OUT ? `${OUT}/tray` : fileURLToPath(new URL('../resources/tray', import.meta.url))
const APP = OUT ? `${OUT}/icons` : fileURLToPath(new URL('../resources/icons', import.meta.url))

/**
 * macOS menu-bar art is 22pt tall at most, and a shape that fills its box reads
 * as a blob next to the system's own glyphs. 16 of 22 leaves the optical margin
 * everything else in the bar has.
 */
const TRAY_POINTS = 22
const TRAY_INSET = 0.74

/**
 * Windows notification-area icons FILL their box.
 *
 * The 0.74 above is a macOS convention: the menu bar's own glyphs all carry an
 * optical margin, and a mark that fills its box reads as a blob beside them.
 * Windows has the opposite convention -- its tray icons run to the edges -- so
 * inheriting the Mac inset made her visibly smaller than every neighbour.
 * Measured effect: at 0.74 she was 74% of the box wide and, being 1.28 times
 * wider than tall, only 58% of it high; scaled into a 16px slot that is about
 * 12 x 9 pixels against neighbours filling 16 x 16.
 *
 * Not 1.0: the outline is antialiased and a shape flush to the edge loses its
 * far pixel to rounding.
 */
const WIN_TRAY_FILL = 0.96

/**
 * Every scale Windows actually offers, not just the three obvious ones.
 *
 * The display-scale list in Settings is 100, 125, 150, 175, 200, 225, 250 and
 * 300 percent, and a 16px tray slot scales with it: 16, 20, 24, 28, 32, 36, 40,
 * 48. Shipping 16/24/32 alone covered 100, 150 and 200 and left every other
 * scale resampling -- and 125% is the default on a great many laptops, so the
 * most common non-default scale was one of the resampled ones.
 *
 * 22 is a macOS point size and lands on none of these, which is why the old
 * shared asset was a resample at every Windows scale.
 */
const WIN_TRAY_SIZES = [16, 20, 24, 28, 32, 36, 40, 48] as const

/**
 * The two taskbar colours she has to survive.
 *
 * Approximations: Windows 11 draws the taskbar in acrylic, so the real
 * backdrop is these tinted by whatever wallpaper is behind them. That is an
 * argument for MORE contrast margin than the minimum, not less.
 */
const WIN_TASKBAR_DARK = '#202020'
const WIN_TASKBAR_LIGHT = '#f3f3f3'

/**
 * WCAG asks 3:1 of a graphical object. 4.5 is the body-text bar, and this aims
 * at it anyway: the mark is 16px on a translucent surface, which is a harder
 * job than a paragraph.
 */
const WIN_TRAY_CONTRAST = 4.5

/**
 * Darken a colour until it is legible on a background, and no further.
 *
 * DERIVED rather than a hardcoded hex, for the same reason the accent is:
 * `colBody` belongs to the face and anyone may retune it. A fixed "dark green"
 * would silently stop clearing contrast the first time she changes colour --
 * and the failure is invisible on the developer's own machine unless they
 * happen to run a light taskbar.
 *
 * Moves in WHICHEVER direction needs less change, so a dark avatar lightens
 * against a dark bar rather than being darkened into it. Her own hue the whole
 * way; this never reaches for black or white. If nothing clears the target it
 * returns the furthest it tried -- an over-corrected mark is a worse icon and a
 * far better one than an invisible mark.
 */
function legibleOn(hex: string, background: string, target: number): string {
  const colour = parseHex(hex)
  const bg = parseHex(background)
  if (colour === null || bg === null) return hex
  // Her OWN colour, unchanged, when it already clears the target. The search
  // started at k = 0.01 unconditionally, so a colour that was already legible
  // came back shifted for nothing: #8ec8a8 has 8.52:1 on a dark taskbar and was
  // being handed back as #8dc6a6. Invisible, harmless, and exactly the kind of
  // needless difference that makes a regenerated asset show up in a diff.
  if (contrast(colour, bg) >= target) return hex

  // The BEST candidate, not the last one tried. `furthest` was overwritten on
  // every iteration and the loop ends on a lighten, so an unreachable target
  // returned the lightest colour attempted even when darkening had got closer
  // -- the one case this function exists for, answered with the worse of its
  // two directions. It searches both ways; it must report both ways.
  let best = { colour, ratio: contrast(colour, bg) }
  for (let k = 0.01; k <= 0.9; k += 0.01) {
    for (const candidate of [shade(colour, -k), shade(colour, k)]) {
      const ratio = contrast(candidate, bg)
      if (ratio >= target) return toHex(candidate)
      if (ratio > best.ratio) best = { colour: candidate, ratio }
    }
  }
  return toHex(best.colour)
}

/**
 * How much of the app icon's square she may occupy.
 *
 * The system masks the canvas to a squircle, so the corners are cut and the
 * usable region is smaller than the square. This keeps her clear of the
 * curvature with room left for the icon to read as a tile with a mark on it
 * rather than as a shape crammed into a box.
 *
 * The prose said 0.62 while the code said 0.64 — the value was nudged and the
 * sentence was not, which leaves a reader unable to tell which one was the
 * intention. The number is the only statement of it now.
 */
const APP_SAFE_AREA = 0.64

/**
 * The tile's paper, which is `--paper`'s LIGHT value from tokens.css.
 *
 * Written out because a Node script cannot read a stylesheet -- and written out
 * is precisely how the old "sampled from the icon" constants rotted, so
 * `tray-icon.test.ts` parses the token and compares it against the pixel this
 * produces. Retune the token and the test fails until `pnpm icons` is re-run.
 *
 * The light value specifically: a PNG has no colour scheme, and an app icon
 * does not follow the system appearance.
 */
const PAPER = '#f3f2f2'

/** How far the tile darkens toward its bottom edge. See `paintTileBackground`. */
const PAPER_WASH = 0.07

/**
 * How far the mark must stand off its own tile.
 *
 * WCAG 1.4.11 asks 3:1 of a graphical object, and unlike the Windows tray this
 * surface actually gets it: the tile is opaque and its colour is known, so
 * there is no acrylic backdrop to leave margin for. The 4.5 next door buys off
 * a specific hazard; spending it here would push her from sage into olive
 * against a hazard this surface does not have.
 */
const APP_MARK_CONTRAST = 3

/**
 * Her palette, dark enough to read on paper and still lit the way she is lit.
 *
 * ONE amount applied to BOTH, rather than `legibleOn` per colour. Her entire
 * form is the difference between the two -- the shadow shape with the lit copy
 * displaced over it -- and correcting them independently drives both to the
 * SAME ratio: #8ec8a8 over #7dbd99 comes back as #69947c over #64977a, which is
 * one flat shape with a seam in it. The lit colour sets the amount because it
 * is the lighter of the pair and so the one at risk; the shadow follows it down
 * and stays a shadow.
 *
 * Derived, never written out. Her green is hers to retune, and a hardcoded
 * "dark green" goes quietly illegible the first time she changes -- on white,
 * where illegible means a smudge rather than an absence, so nobody notices.
 */
function onPaper(target: number): { body: string; shadow: string } {
  const paper = parseHex(PAPER)
  const body = parseHex(MOCHI.colBody)
  const shadow = parseHex(MOCHI.colShadow)
  if (paper === null || body === null || shadow === null) {
    throw new Error(
      `the icon palette is not parseable: ${PAPER} ${MOCHI.colBody} ${MOCHI.colShadow}`,
    )
  }
  // Measured against the tile's DARKEST point, not against PAPER.
  //
  // The wash runs down the tile and she sits across its middle and lower half,
  // so the paper actually behind her is darker than the top stop -- and a dark
  // mark on darkening paper loses contrast as it descends. Correcting against
  // the nominal colour put her at 3.07:1 where the tile is lightest and 3.01:1
  // at 16px, which is the floor reached by accident rather than by design.
  // The darkest stop is a bound that holds wherever she is placed, which
  // matters because APP_SAFE_AREA can move her.
  const floor = shade(paper, -PAPER_WASH)
  // Her own colours, untouched, when they already clear the target -- so a
  // retune that needs no correction does not show up as a diff in every icon.
  if (contrast(body, floor) >= target) return { body: MOCHI.colBody, shadow: MOCHI.colShadow }
  let step = 0.9
  for (let k = 0.01; k <= 0.9; k += 0.01) {
    if (contrast(shade(body, -k), floor) >= target) {
      step = k
      break
    }
  }
  return { body: toHex(shade(body, -step)), shadow: toHex(shade(shadow, -step)) }
}

/**
 * Apple's macOS icon grid: the rounded rect is 824 of the 1024 canvas.
 *
 * MEASURED against the real thing rather than assumed. In a Dock screenshot the
 * slot pitch is 152px and every system icon's tile is 118px wide -- 0.776 of
 * the slot. Ours, drawn full-bleed, came out 144px: about 22% too big, sitting
 * proud of every neighbour. 824/1024 is 0.805, which lands within a couple of
 * pixels of 118 once macOS draws it at slot size.
 *
 * This applies ONLY to the tile we hand to `app.dock.setIcon()`. A bundle icon
 * is inset by the system; a programmatic one is drawn as-is, so the inset has
 * to be in the artwork.
 */
const APPLE_TILE_FRACTION = 824 / 1024

/** How much of the window icon she fills. Nothing masks it, so this is generous. */
const WINDOW_ICON_FILL = 0.88

/**
 * The largest ovoid of her aspect ratio that fits inside an inset square.
 *
 * BOTH axes, which is the whole point of the function. The inset used to be
 * applied to the height alone -- and she is 1.28 times wider than she is tall,
 * so the mark ran to 95% of the tray box, arriving in the menu bar with no
 * optical margin at all beside glyphs that all have one. The app icon, at inset
 * 0.82, was worse than tight: 0.82 x 1.28 is 1.05, so it was being CLIPPED at
 * the left and right edges of its own canvas, in every size, silently.
 *
 * Stated as a ratio rather than as two tuned numbers because the aspect comes
 * from MOCHI: retune her body and the margin survives, which is the property a
 * hand-picked pair of insets would not have.
 */
function fitInside(size: number, inset: number, aspect: number): { width: number; height: number } {
  const box = size * inset
  return aspect >= 1 ? { width: box, height: box / aspect } : { width: box * aspect, height: box }
}

/**
 * Her body's outline, as a path on a context.
 *
 * Shared by the tray mark and the app icon so there is still exactly one place
 * her silhouette is computed.
 */
function traceBody(
  ctx: ReturnType<ReturnType<typeof createCanvas>['getContext']>,
  width: number,
  height: number,
  originX: number,
  originY: number,
): void {
  const outline = domeOutline({
    halfWidth: width / 2,
    height,
    waist: MOCHI.waist,
    upperShoulder: MOCHI.upperShoulder,
    lowerShoulder: MOCHI.lowerShoulder,
    lean: 0,
  })
  ctx.beginPath()
  outline.forEach((point, index) => {
    const x = originX + point.x
    const y = originY - point.y
    if (index === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  })
  ctx.closePath()
}

/**
 * The APP icon: full-bleed, because macOS 26 masks it itself.
 *
 * This is a different drawing from the tray mark, and the difference is the
 * whole point. The app icon used to be her silhouette alone on a transparent
 * square — and macOS 26 puts any icon that is "not already a squircle" inside a
 * grey one of its own, shrinking the artwork to fit. That is what shipped: a
 * small green blob on a grey tile, sitting next to every other app's
 * edge-to-edge icon.
 *
 * So the canvas is filled corner to corner and the SYSTEM does the rounding.
 * Apple's own instruction for the layered format is the same rule stated from
 * the other side: "Don't export the canvas mask because the system applies that
 * automatically to ensure a perfect crop." Drawing our own rounded rectangle
 * would be masked again and read as a tile inside a tile.
 *
 * Her colours come from MOCHI, like everything else here, so a retune moves the
 * icon with her.
 */
function renderAppIcon(size: number, masked = false): Buffer {
  const canvas = createCanvas(size, size)
  const ctx = canvas.getContext('2d')

  // The one case where we draw the shape ourselves. `app.dock.setIcon()` hands
  // an image straight to the Dock, and the automatic squircle crop is something
  // macOS applies to an app's BUNDLE icon -- there is no promise it also applies
  // to an image set programmatically, in which case a full-bleed square would
  // appear in the Dock as a literal square. Masking here is correct either way:
  // if the system also masks, masking an already-masked squircle changes
  // nothing. The files for packaging stay unmasked, because for those the
  // system's crop is the one that should win.
  // The whole Apple treatment, in the artwork, because nothing else will apply
  // it. `app.dock.setIcon()` draws the image at the slot size as given: no
  // squircle crop, no inset, no shadow. A full-bleed square therefore arrives
  // 22% larger than every neighbour and with square-ish corners.
  const tile = masked ? Math.round(size * APPLE_TILE_FRACTION) : size
  const pad = (size - tile) / 2
  if (masked) applyTileMask(ctx, size, tile, pad)
  paintTileBackground(ctx, tile, pad)

  // Inside the safe area: the visible region after masking is the squircle
  // inscribed in this square, so anything near a corner is cut.
  const { width, height } = fitInside(tile, APP_SAFE_AREA, MOCHI.bodyW / MOCHI.bodyH)
  // Arithmetically centred. There was an `APP_OPTICAL_RISE` term here, fixed at
  // zero: a constant that configures nothing, an expression that computes
  // nothing, and a name promising a correction the icon does not apply. If a
  // rise turns out to be wanted, it comes back with a measurement behind it.
  // Darkened to stand off the paper. `#8ec8a8` on `#f3f2f2` measures 1.71:1 --
  // the same smudge the light Windows taskbar gets -- so a paper tile without
  // this correction is a worse icon than the green one it replaced.
  const { body, shadow } = onPaper(APP_MARK_CONTRAST)
  paintShadedBody(ctx, width, height, size / 2, size / 2 + height / 2, body, shadow)

  return canvas.toBuffer('image/png')
}

/**
 * The tile's own shadow, and the crop everything after it obeys.
 *
 * Shadow first and underneath, so the tile is drawn over its own edge rather
 * than the shadow bleeding across the art. The clip is left in place: the
 * caller draws into it.
 */
function applyTileMask(
  ctx: ReturnType<ReturnType<typeof createCanvas>['getContext']>,
  size: number,
  tile: number,
  pad: number,
): void {
  ctx.save()
  ctx.shadowColor = 'rgba(0, 0, 0, 0.32)'
  ctx.shadowBlur = size * 0.022
  ctx.shadowOffsetY = size * 0.012
  ctx.fillStyle = '#000000'
  traceSquircle(ctx, tile, pad)
  ctx.fill()
  ctx.restore()

  traceSquircle(ctx, tile, pad)
  ctx.clip()
}

/**
 * Paper, with the faintest wash down it.
 *
 * Flat colour reads as unfinished beside icons that all have some depth, and a
 * gradient is the cheapest depth there is -- but on paper it has to stay faint,
 * because a ramp you can see on white reads as a gradient rather than as paper.
 * Hence 0.07 where her green carried 0.30.
 *
 * Both stops derive from PAPER, so retuning the token moves the whole tile
 * rather than half of it.
 */
function paintTileBackground(
  ctx: ReturnType<ReturnType<typeof createCanvas>['getContext']>,
  tile: number,
  pad: number,
): void {
  // THROWS rather than falling back to a colour written out in channels. The
  // input is a constant in this file, so the fallback is only reachable if that
  // constant is malformed — a bug in the source, not a condition to paper over,
  // and papering over it means shipping an icon in a colour nobody chose. A
  // build script is the one place where stopping is unambiguously right.
  const paper = parseHex(PAPER)
  if (paper === null) throw new Error(`PAPER is not a colour: ${PAPER}`)
  const wash = ctx.createLinearGradient(0, pad, 0, pad + tile)
  wash.addColorStop(0, PAPER)
  wash.addColorStop(1, toHex(shade(paper, -PAPER_WASH)))
  ctx.fillStyle = wash
  ctx.fillRect(pad, pad, tile, tile)
}

/**
 * Her, shaded: the shadow shape, then the lit copy displaced over it.
 *
 * ONE implementation, because there were two — the app tile and the window icon
 * each traced, filled, clipped, re-traced and re-filled in the same order with
 * the same constants. Two copies of the lighting model means the day
 * `shadowX`/`shadowY` are retuned, one icon follows her and the other does not,
 * and the difference is a few pixels at 32px that nobody sees until the two are
 * side by side in a taskbar.
 *
 * The clip is what keeps the displaced copy inside her outline; without it the
 * lit shape spills past her up-right edge.
 *
 * The PALETTE is a parameter, because the two callers no longer agree on it:
 * the app tile darkens her to stand off paper, while the window mark sits on
 * transparency over an unknown taskbar and stays her own colour. Passed in
 * rather than branched on inside, so this function keeps knowing only how she
 * is lit and nothing about where she is going.
 */
function paintShadedBody(
  ctx: ReturnType<ReturnType<typeof createCanvas>['getContext']>,
  width: number,
  height: number,
  originX: number,
  originY: number,
  body: string,
  shadow: string,
): void {
  traceBody(ctx, width, height, originX, originY)
  ctx.fillStyle = shadow
  ctx.fill()
  // The same displaced lit copy the renderer paints, so the icon is lit from
  // the direction she is lit from everywhere else.
  ctx.save()
  ctx.clip()
  traceBody(ctx, width, height, originX + MOCHI.shadowX * width, originY - MOCHI.shadowY * height)
  ctx.fillStyle = body
  ctx.fill()
  ctx.restore()
}

/**
 * The tile shape: a SUPERELLIPSE, not a rounded rectangle.
 *
 * `arcTo` gives circular corners, and a circular arc meets the straight edge
 * with a jump in curvature -- which is exactly what makes a rounded rect read
 * as boxy beside macOS's own icons. Apple's shape has continuous curvature, and
 * |x/a|^n + |y/a|^n = 1 at n = 5 is the standard approximation of it.
 *
 * Checked by compositing the result into a real Dock screenshot next to real
 * icons, which is the only way to judge a shape whose whole job is to look like
 * everybody else's.
 */
const SQUIRCLE_EXPONENT = 5

function traceSquircle(
  ctx: ReturnType<ReturnType<typeof createCanvas>['getContext']>,
  size: number,
  offset = 0,
): void {
  const a = size / 2
  const cx = offset + a
  const cy = offset + a
  const power = 2 / SQUIRCLE_EXPONENT
  const steps = 240
  ctx.beginPath()
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2
    const cos = Math.cos(t)
    const sin = Math.sin(t)
    const x = cx + a * Math.sign(cos) * Math.pow(Math.abs(cos), power)
    const y = cy + a * Math.sign(sin) * Math.pow(Math.abs(sin), power)
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()
}

/**
 * The WINDOW icon, for platforms that mask nothing.
 *
 * A third treatment, and the third is not redundancy -- each platform does
 * something different with the pixels and there is no image that satisfies all
 * three:
 *
 *   macOS bundle   full bleed, the system masks and insets it
 *   macOS Dock     pre-masked, because `setIcon()` applies nothing
 *   Windows/Linux  the MARK on transparency, because nothing is applied and a
 *                  full-bleed square renders as a solid colour block beside
 *                  neighbours that are all logos
 *
 * Windows takes the window's icon from `BrowserWindow`'s `icon` option, or
 * from the executable when there is none -- which is why the settings window
 * showed Electron's own logo in the taskbar. The companion window escaped it
 * only by being `skipTaskbar`.
 *
 * Generous inset: with no mask eating the corners there is nothing to protect
 * her from, and a taskbar draws this at about 24px where every wasted pixel
 * is one she does not have.
 */
function renderWindowIcon(size: number): Buffer {
  const canvas = createCanvas(size, size)
  const ctx = canvas.getContext('2d')

  const { width, height } = fitInside(size, WINDOW_ICON_FILL, MOCHI.bodyW / MOCHI.bodyH)
  const originX = size / 2
  const originY = size / 2 + height / 2

  // HER colours, uncorrected: there is no tile here, and the taskbar behind her
  // may be any colour. Correcting for a paper tile she is not sitting on would
  // darken her against a dark taskbar, which is the wrong direction.
  paintShadedBody(ctx, width, height, originX, originY, MOCHI.colBody, MOCHI.colShadow)

  return canvas.toBuffer('image/png')
}

function render(size: number, inset: number, colour: string | null): Buffer {
  const canvas = createCanvas(size, size)
  const ctx = canvas.getContext('2d')

  const { width, height } = fitInside(size, inset, MOCHI.bodyW / MOCHI.bodyH)

  // Local space is +y up with the base at 0; canvas is +y down. Centred on the
  // square, resting on the lower edge of the inset box.
  const originX = size / 2
  const originY = size - (size - height) / 2

  // `traceBody`, not a second hand-written copy of it. This function built the
  // outline and walked it into a path itself — the same geometry, the same
  // coordinate flip, the same closePath, written out again a hundred lines from
  // the helper that does it. A silhouette that can be tuned in one place and
  // not the other is the exact failure the one-graphical-source rule exists to
  // prevent, and the tray icon is where it would have shown up.
  traceBody(ctx, width, height, originX, originY)
  // A template image reads ALPHA only and macOS recolours it for light and dark
  // menu bars, so the fill colour is irrelevant there and load-bearing for the
  // app icon. One function, told which it is making.
  ctx.fillStyle = colour ?? '#000000'
  ctx.fill()

  return canvas.toBuffer('image/png')
}

mkdirSync(TRAY, { recursive: true })
mkdirSync(APP, { recursive: true })

for (const [scale, suffix] of [
  [1, ''],
  [2, '@2x'],
  [3, '@3x'],
] as const) {
  const size = TRAY_POINTS * scale
  writeFileSync(`${TRAY}/trayTemplate${suffix}.png`, render(size, TRAY_INSET, null))
  console.log(`  resources/tray/trayTemplate${suffix}.png  ${size}x${size}`)
  // A second, COLOURED variant for everywhere that is not macOS.
  //
  // Template images are a macOS idea: the system reads their alpha and recolours
  // them per menu-bar appearance. Windows and Linux have no equivalent, so the
  // template -- which is pure black -- is what they would draw, and on a dark
  // taskbar that is an invisible icon. Since the tray is this app's only exit,
  // invisible means unquittable.
  //
  // Her own body colour rather than a second black-or-white pair: it is legible
  // against both light and dark panels, and it comes from the same MOCHI
  // constant the renderer fills her with, so it cannot drift from her.
  writeFileSync(`${TRAY}/tray${suffix}.png`, render(size, TRAY_INSET, MOCHI.colBody))
  console.log(`  resources/tray/tray${suffix}.png  ${size}x${size}`)
}

for (const size of [16, 32, 64, 128, 256, 512, 1024]) {
  writeFileSync(`${APP}/${size}x${size}.png`, renderAppIcon(size))
  console.log(`  resources/icons/${size}x${size}.png`)
}

// The Windows tray set. TWO variants, named for the TASKBAR they sit on rather
// than for their own lightness -- "the light icon" is ambiguous in exactly the
// way that gets them swapped.
//
// Windows has no template mechanism: it draws what you give it, so an app that
// adapts to the taskbar theme does it by hand. Her green is 8.5:1 on a dark
// taskbar and 1.7:1 on a light one, which is a smudge.
for (const size of WIN_TRAY_SIZES) {
  writeFileSync(
    `${TRAY}/trayWin-onDark-${size}.png`,
    render(size, WIN_TRAY_FILL, legibleOn(MOCHI.colBody, WIN_TASKBAR_DARK, WIN_TRAY_CONTRAST)),
  )
  writeFileSync(
    `${TRAY}/trayWin-onLight-${size}.png`,
    render(size, WIN_TRAY_FILL, legibleOn(MOCHI.colBody, WIN_TASKBAR_LIGHT, WIN_TRAY_CONTRAST)),
  )
  console.log(`  resources/tray/trayWin-on{Dark,Light}-${size}.png  ${size}x${size}`)
}

// The window icon for Windows and Linux. See renderWindowIcon.
for (const size of [32, 64, 256]) {
  writeFileSync(`${APP}/window-${size}.png`, renderWindowIcon(size))
  console.log(`  resources/icons/window-${size}.png`)
}

// The Dock tile the dev build sets by hand. See renderAppIcon's `masked`.
writeFileSync(`${APP}/dock.png`, renderAppIcon(1024, true))
console.log('  resources/icons/dock.png  1024x1024 (pre-masked)')
