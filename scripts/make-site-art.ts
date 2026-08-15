/**
 * The pictures on the website, drawn by the rig that draws her.
 *
 * One surface further out: ONE graphical source, and
 * everything else generated from it. `make-icons.ts` traces `domeOutline` for
 * the tray and the app icon; this file goes further and runs the whole
 * `MochiAvatar` — face, cheeks, gaze, the lot — against a headless rasteriser.
 *
 * The alternative was an illustrator's mochi in an SVG, and it is the exact
 * failure that rule exists to prevent: a fourth likeness, drawn by eye, that
 * looks right on the day and silently stops matching the product the first time
 * anybody touches a shoulder exponent. The website would then be advertising a
 * character the download does not contain.
 *
 * That the rig renders headlessly is not a trick invented here — `mochi.test.ts`
 * has driven it against `@napi-rs/canvas` since it was written, and the class's
 * own `resize` comment says so: "the same class render in the browser, in the
 * tuner, and in a test against a headless rasteriser."
 *
 * ## Why this one needs a bundler and `make-icons.ts` does not
 *
 * That script imports `geometry.ts` and `accent.ts`, which are plain functions
 * over numbers, so `node` can strip their types and run them. This one pulls in
 * `MochiAvatar`, and the class uses a TypeScript PARAMETER PROPERTY in its
 * constructor -- syntax that Node's strip-only mode refuses, because it emits
 * code rather than only deleting it. The rig also imports through the `@shared`
 * alias, which `node` cannot resolve at all.
 *
 * So: `pnpm site:art`, which bundles with the esbuild that Vite already brings
 * and then runs the bundle. Not a new dependency, and not a second copy of the
 * drawing -- which is the trade this file exists to make.
 */

import { Path2D as NodePath2D, createCanvas, type Canvas } from '@napi-rs/canvas'
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { MOCHI } from '../src/shared/avatar-spec.ts'
import { THEME_IDS, paletteFor } from '../src/shared/theme.ts'
import { PHASES, POSTURE } from '../src/shared/posture.ts'
import { MochiAvatar } from '../src/renderer/companion/rig/mochi.ts'

/**
 * `Path2D`, in Node.
 *
 * The rig builds its silhouette as one, because that is the only object a
 * canvas will both fill and hit-test against. In a browser it is global; under
 * Node it ships with the rasteriser. `src/test/canvas-globals.ts` installs it
 * for the test run and this is the same line for the same reason -- restated
 * rather than imported, because that file is a Vitest setup hook and importing
 * a test fixture into a build script would tie the two together in the wrong
 * direction.
 *
 * Before the import of `mochi.ts` below could paint, which is why it sits above
 * everything that touches it.
 */
globalThis.Path2D ??= NodePath2D as unknown as typeof globalThis.Path2D

/**
 * Where the art goes, resolved from the WORKING DIRECTORY.
 *
 * Not from `import.meta.url`, which `make-icons.ts` can use because it runs
 * where it lives. This file is bundled into `node_modules/.cache` first, so a
 * path relative to the module would put the site's pictures inside
 * `node_modules` -- which is exactly what it did, silently, and reported
 * success.
 */
const OUT = process.env['MOCHI_SITE_OUT'] ?? resolve(process.cwd(), 'site/art')

/**
 * Drawn at 2x and displayed at half, like every other bitmap that has to
 * survive a Retina screen. She is wider than tall (see `MOCHI`), so the box is
 * too — a square would be mostly transparent margin.
 */
const WIDTH = 320
const HEIGHT = 260
const SCALE = 2

/**
 * Enough frames for the spring to settle, at a fixed step.
 *
 * `render` integrates against wall-clock deltas, so a single frame draws her
 * part-way into the squash the expression asked for. A fixed 60fps ladder is
 * both settled and DETERMINISTIC: the same bytes come out on every machine,
 * which is what makes the committed PNGs reviewable in a diff.
 */
const FRAMES = 120
const STEP_MS = 1000 / 60

interface Shot {
  /** The file it becomes, and the state the page names it by. */
  readonly name: string
  /** The phase whose posture she wears. Read from the table, never chosen. */
  readonly phase: (typeof PHASES)[number]
  /** Where she is looking, in normalised viewport coordinates. */
  readonly gaze: readonly [number, number]
  /**
   * How open her mouth is.
   *
   * NOT a posture, which is why it is a field here rather than in `POSTURE`.
   * `EnvelopeMouth` opens her mouth from the audio while she is `awake`, so
   * "talking" is that phase plus a mouth — not a fifth state.
   */
  readonly mouth: number
}

/**
 * One picture per phase, walked from `PHASES` rather than listed.
 *
 * The previous version chose from `LOOKS` by hand and got two of four wrong: a
 * `happy` face with an eye glint for "talking", when she is `neutral` for the
 * whole of `awake`; and a `thinking` face, which nothing in the app has ever
 * set. Reading the table makes both of those unrepresentable.
 *
 * The gaze is still chosen here, and legitimately: it is driven at runtime by
 * the pointer, so there is no canonical value to read. Slightly off-centre,
 * because a straight-ahead gaze reads as a logo and she is meant to read as
 * somebody in the room.
 */
const SHOTS: readonly Shot[] = [
  ...PHASES.map((phase) => ({
    name: phase,
    phase,
    gaze: [0.58, 0.42] as const,
    mouth: 0,
  })),
  // The fifth picture, and the only one that is not simply a phase: awake with
  // the mouth an audio envelope has opened. It is the state the whole product
  // is about, and it is `awake` — the same neutral face, talking.
  { name: 'talking', phase: 'awake', gaze: [0.5, 0.45], mouth: 0.62 },
]

// `Canvas` comes from the rasteriser rather than from `ReturnType<typeof
// createCanvas>`: that helper picks the SVG overload, which has no `toBuffer`.

/** The smallest box containing every pixel that was actually painted. */
interface Box {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
}

function draw(shot: Shot, theme: (typeof THEME_IDS)[number]): Canvas {
  const canvas = createCanvas(WIDTH * SCALE, HEIGHT * SCALE)
  const ctx = canvas.getContext('2d')
  const avatar = new MochiAvatar(ctx as unknown as CanvasRenderingContext2D, {
    // Her colour is a PERSONA field, so the site showing eight of her is
    // showing a real feature rather than a marketing palette.
    face: { ...MOCHI, ...paletteFor(theme) },
    // She fills the box she was given. The app's own sizing is a function of
    // the screen and has no meaning here.
    size: 'fit-canvas',
    // Pinned, so a blink cannot land on the frame that gets written out.
    random: () => 0.5,
  })
  avatar.resize(WIDTH, HEIGHT, SCALE)
  // OFF. Breathing and blinking are the reason to look at her moving, and the
  // reason a still of her mid-breath looks like a mistake.
  avatar.setIdle(false)
  // From the table the lifecycle assigns from, with `holdMs` DROPPED.
  //
  // That field is a decay timer, and a still is of the expression she holds,
  // not of what she relaxes into afterwards. Carrying it through rendered
  // `waking` and `farewell` as plain neutral faces — the settle below advances
  // a simulated two seconds, which outruns both the 700ms perk and the 1400ms
  // sign-off. The bug shipped behind a comment of mine asserting it could not
  // happen; the picture is what disproved it.
  const { emotion, intensity } = POSTURE[shot.phase]
  avatar.setEmotion({ emotion, intensity })
  avatar.lookAt(shot.gaze[0], shot.gaze[1])
  avatar.setMouthOpen(shot.mouth)

  for (let frame = 0; frame < FRAMES; frame += 1) {
    // Cleared between frames, or every frame composites onto the last and the
    // settling squash leaves a stack of ghosts around her edge.
    ctx.clearRect(0, 0, WIDTH * SCALE, HEIGHT * SCALE)
    avatar.render(frame * STEP_MS)
  }
  return canvas
}

/**
 * Where the paint actually is, by ALPHA.
 *
 * `fitToCanvas` leaves headroom for the squash channel, so a still frame sits
 * low in its box with a band of nothing above her. Cropping to what was drawn
 * is the alternative to `object-position` guesses in the stylesheet -- numbers
 * that describe this render and go stale the next time the rig is tuned, in a
 * file that has no way to notice.
 */
function painted(canvas: Canvas): Box {
  const { width, height } = canvas
  const { data } = canvas.getContext('2d').getImageData(0, 0, width, height)
  let left = width
  let top = height
  let right = -1
  let bottom = -1
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      // The ALPHA byte of the RGBA quad, and `> 0` rather than a threshold: her
      // edge is antialiased, and clipping the faint pixels would leave a hard
      // border on a shape whose whole charm is that it does not have one.
      if (data[(y * width + x) * 4 + 3]! === 0) continue
      if (x < left) left = x
      if (x > right) right = x
      if (y < top) top = y
      if (y > bottom) bottom = y
    }
  }
  return { left, top, right, bottom }
}

/** The box that holds all of them, so the crops stay aligned with each other. */
function union(boxes: readonly Box[]): Box {
  return boxes.reduce((a, b) => ({
    left: Math.min(a.left, b.left),
    top: Math.min(a.top, b.top),
    right: Math.max(a.right, b.right),
    bottom: Math.max(a.bottom, b.bottom),
  }))
}

function cropped(canvas: Canvas, box: Box): Buffer {
  const width = box.right - box.left + 1
  const height = box.bottom - box.top + 1
  const out = createCanvas(width, height)
  out.getContext('2d').drawImage(canvas, -box.left, -box.top)
  return out.toBuffer('image/png')
}

/**
 * EMPTIED first, then rebuilt.
 *
 * Writing over the top left the previous run's files behind, which is how
 * `mochi-thinking.png` — a state the app cannot reach — survived the change
 * that stopped generating it, sitting in the published directory looking
 * exactly as valid as the rest. A generator that only ever adds cannot remove
 * a mistake.
 *
 * Safe to wipe because this directory is wholly OURS: `icon.png` is copied in
 * below rather than dropped here by hand, so nothing in `site/art` has any
 * other author.
 */
rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

// The favicon, from the OTHER generator. Copied rather than re-rendered: it is
// the app icon — her silhouette with the shading band, no face — and
// `make-icons.ts` is the one place that shape is produced. Copying keeps
// `site/art` reproducible from a single command without giving the mark a
// second source.
// From the WORKING DIRECTORY, for the reason `OUT` gives above — this file is
// bundled into `node_modules/.cache`, so `import.meta.url` resolves there. I
// wrote that comment and then reintroduced the bug two lines below it.
copyFileSync(resolve(process.cwd(), 'resources/icons/256x256.png'), `${OUT}/icon.png`)

// Every state in her own colour, and every colour in the resting state. Not
// the cross product: the site needs one row of colours and one row of states,
// and forty PNGs to show eight would be weight nobody asked for.
const HERO = SHOTS.find((shot) => shot.phase === 'awake' && shot.mouth === 0)!

const drawn: readonly { readonly file: string; readonly canvas: Canvas }[] = [
  ...SHOTS.map((shot) => ({ file: `mochi-${shot.name}`, canvas: draw(shot, 'moss') })),
  // The colour row wears the RESTING face — `awake`, which is what she looks
  // like for the whole of a conversation. A row of eight farewells would sell
  // the colours on an expression she holds for 1.4 seconds.
  ...THEME_IDS.map((theme) => ({ file: `theme-${theme}`, canvas: draw(HERO, theme) })),
]

// ONE box for all of them, computed after every render. Cropping each to its
// own extent would silently rescale her between the pictures -- an open mouth
// is taller than a closed one -- so a row of colours would breathe as the eye
// moved along it.
const box = union(drawn.map((one) => painted(one.canvas)))
for (const one of drawn) writeFileSync(`${OUT}/${one.file}.png`, cropped(one.canvas, box))

console.log(
  `site art: ${String(drawn.length)} files in ${OUT} (${String(box.right - box.left + 1)}x${String(box.bottom - box.top + 1)})`,
)
