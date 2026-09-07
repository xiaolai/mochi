/**
 * The images in the README, rendered by the engine that ships.
 *
 * ## Why a generator and not a drawing
 *
 * The hero used to be `mochi-icon.png` — the reference artwork, which is a
 * silhouette with no face on it at all. A character package whose first image
 * shows no character is the wrong first impression, and hand-making a
 * replacement would put a second Mochi in the repository: one drawn, one
 * computed, free to drift apart. Everything here comes out of `domeOutline` and
 * `MOCHI`, so if her geometry changes these change with her.
 *
 * ## It imports the BUILT package on purpose
 *
 * `./dist/index.js`, not `./src`. That makes this script one more consumer of
 * the published entry point: if the build is broken or the surface is missing
 * an export, the images cannot be made, and the failure is loud here rather
 * than silent for whoever installs it.
 *
 * Deterministic by construction — a pinned random source so no blink lands
 * mid-frame, and `render(0)`, where the breath curve is at rest. Re-running this
 * on an unchanged engine produces identical bytes.
 */

import { createCanvas, Path2D } from '@napi-rs/canvas'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// The rig builds its silhouette as a Path2D at module scope; in a browser that
// is global, and under Node it ships with the rasteriser.
globalThis.Path2D ??= Path2D

const { DoughAvatar, MOCHI, COLOURWAYS, EMOTIONS, mochiIn } = await import('../dist/index.js')

const OUT = fileURLToPath(new URL('../assets/', import.meta.url))
mkdirSync(OUT, { recursive: true })

/** One mochi, on a transparent background, at whatever scale is asked for. */
function draw(face, emotion, width, height, scale = 2) {
  const canvas = createCanvas(width * scale, height * scale)
  const ctx = canvas.getContext('2d')
  const avatar = new DoughAvatar(ctx, { face, size: 'fit-canvas', random: () => 0.5 })
  avatar.resize(width, height, scale)
  if (emotion !== 'neutral') avatar.setEmotion({ emotion, intensity: 1 })
  // Time zero: the breath is one-sided and starts at rest, so this is her
  // resting silhouette rather than a frame part-way through a breath.
  avatar.render(0)
  return canvas
}

/**
 * Trim the transparent margin, then give back a uniform one.
 *
 * `fit-canvas` sizes her against the WORST case — the widest, tallest frame any
 * breath, lean or motion clip can reach — so a resting mochi sits low in it with
 * headroom nothing is using. Correct for a window that must not clip her mid-hop,
 * wrong for a still. Measured from the alpha channel rather than assumed, so it
 * stays right whatever the pose does.
 */
function trim(canvas, pad = 0) {
  const ctx = canvas.getContext('2d')
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
  let minX = canvas.width,
    maxX = -1,
    minY = canvas.height,
    maxY = -1
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      if (data[(y * canvas.width + x) * 4 + 3] < 8) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  if (maxX < 0) return canvas
  const w = maxX - minX + 1
  const h = maxY - minY + 1
  const out = createCanvas(w + pad * 2, h + pad * 2)
  out.getContext('2d').drawImage(canvas, minX, minY, w, h, pad, pad, w, h)
  return out
}

function write(name, canvas) {
  writeFileSync(OUT + name, canvas.toBuffer('image/png'))
  console.log(`  assets/${name}`.padEnd(34), `${canvas.width}x${canvas.height}`)
}

console.log('rendering from dist/:')

// The hero: her whole self, neutral, with the face on.
write('mochi.png', trim(draw(MOCHI, 'neutral', 320, 320), 24))

// The eight expressions, in one strip. Named in EMOTIONS order so the strip and
// the list in the README cannot disagree about what exists.
const CELL = 150
const strip = createCanvas(CELL * EMOTIONS.length * 2, CELL * 2)
const stripCtx = strip.getContext('2d')
EMOTIONS.forEach((emotion, i) => {
  stripCtx.drawImage(draw(MOCHI, emotion, CELL, CELL), CELL * i * 2, 0, CELL * 2, CELL * 2)
})
write('expressions.png', trim(strip, 16))

// The six colourways, same geometry throughout — which is the claim the image
// is making: she is the shape, not the colour.
const names = Object.keys(COLOURWAYS)
const flavours = createCanvas(CELL * names.length * 2, CELL * 2)
const flavourCtx = flavours.getContext('2d')
names.forEach((name, i) => {
  const face = mochiIn(name, MOCHI)
  flavourCtx.drawImage(draw(face, 'happy', CELL, CELL), CELL * i * 2, 0, CELL * 2, CELL * 2)
})
write('colourways.png', trim(flavours, 16))

/* ---------------------------------------------------------------------------
   The animated hero.

   A still of a character whose entire point is that she is alive undersells her
   badly. This is one breath — 3400ms, the period the engine actually uses — with
   a blink placed inside it.

   ## Breathing only, and the loop is therefore seamless

   No sway, no blink. `setDrift(false)` stops the going-nowhere motion while
   leaving the breath running — which is the whole reason that method exists;
   `setReducedMotion` would have stopped both.

   The blink is pushed out rather than switched off: `nextBlinkGap` draws from a
   clamped exponential, `IdleLayer` takes its random source by injection, and a
   source pinned at 1 returns the maximum gap of 6200ms — past the end of a
   3400ms clip, so no blink ever lands in it.

   With both gone the only thing moving is the breath, and the breath is exactly
   periodic. A clip of exactly one period therefore joins itself with nothing
   left over — the earlier version drifted a fraction of a pixel at the seam,
   and this one does not.

   ## APNG rather than GIF

   GIF has one bit of transparency, which would put a hard fringe on every
   antialiased edge she has, against both the light and dark page she has to sit
   on. APNG carries the full alpha channel and is a valid PNG, so a renderer
   that does not animate it shows the first frame instead of nothing.
--------------------------------------------------------------------------- */

const BREATH_MS = 3400
/*
  Forty frames of 85ms, which is 3400ms exactly.

  Chosen as a COUNT rather than a frame rate, because a rate has to divide the
  breath period exactly or the clip is a few milliseconds longer than the thing
  it loops — 25fps gives 85 frames of 40ms, which is 3400ms, but 12fps gives
  40.8 frames and no integer rounding of that closes the loop. 85ms per frame is
  1000/85 fps, handed to ffmpeg as the exact fraction 200/17 rather than a
  rounded decimal.

  Slow is affordable here in a way it was not before: with the blink pushed out
  of the clip there is no fast event left to sample, and a breath moving 2.4% of
  her size across 3.4 seconds is smooth at 12fps. That halves the file, which
  the earlier version needed — breathing squashes the whole silhouette, so its
  frames differ everywhere and inter-frame compression has little to work with.
*/
const FRAMES = 40
const FRAME_RATE = '200/17'
/** Pinned at the top of the range: the maximum gap, 6200ms, is past the clip. */
const BLINK_SEED = 1

function haveFfmpeg() {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function animate(width, height, scale = 2) {
  const count = FRAMES
  const canvas = createCanvas(width * scale, height * scale)
  const ctx = canvas.getContext('2d')
  const avatar = new DoughAvatar(ctx, {
    face: MOCHI,
    size: 'fit-canvas',
    random: () => BLINK_SEED,
  })
  avatar.resize(width, height, scale)
  avatar.setDrift(false)

  // Two passes. The first finds ONE crop box covering every frame; cropping
  // each frame to its own bounds would make her jitter against the edge as she
  // breathes, which is the opposite of the intended reading.
  const frames = []
  let minX = canvas.width
  let maxX = -1
  let minY = canvas.height
  let maxY = -1
  for (let i = 0; i < count; i++) {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    avatar.render((i / count) * BREATH_MS)
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
    frames.push(image)
    const { data } = image
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        if (data[(y * canvas.width + x) * 4 + 3] < 8) continue
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }

  const pad = 16
  const w = maxX - minX + 1
  const h = maxY - minY + 1
  const dir = mkdtempSync(join(tmpdir(), 'mochi-frames-'))
  const cell = createCanvas(w + pad * 2, h + pad * 2)
  const cellCtx = cell.getContext('2d')
  const source = createCanvas(canvas.width, canvas.height)
  const sourceCtx = source.getContext('2d')
  frames.forEach((image, i) => {
    sourceCtx.putImageData(image, 0, 0)
    cellCtx.clearRect(0, 0, cell.width, cell.height)
    cellCtx.drawImage(source, minX, minY, w, h, pad, pad, w, h)
    writeFileSync(join(dir, `f${String(i).padStart(3, '0')}.png`), cell.toBuffer('image/png'))
  })
  return { dir, count, size: `${cell.width}x${cell.height}` }
}

if (!haveFfmpeg()) {
  console.log('\n  skipped mochi-alive.png — ffmpeg not on PATH (the stills above are complete)')
} else {
  // Breathing alone leaves consecutive frames almost identical, which is what
  // APNG's inter-frame compression is good at — so this affords a larger, higher
  // frame-rate clip than the earlier version, which also had to encode a blink
  // and several pixels of sway.
  const { dir, count, size } = animate(320, 320, 1)
  execFileSync(
    'ffmpeg',
    // `-plays 0` is APNG for "loop forever"; without it she breathes once and stops.
    [
      '-y',
      '-framerate',
      FRAME_RATE,
      '-i',
      join(dir, 'f%03d.png'),
      '-plays',
      '0',
      '-f',
      'apng',
      OUT + 'mochi-alive.png',
    ],
    { stdio: 'ignore' },
  )
  rmSync(dir, { recursive: true, force: true })
  console.log(
    `  assets/mochi-alive.png`.padEnd(34),
    `${size}, ${count} frames, ${BREATH_MS}ms loop`,
  )
}
