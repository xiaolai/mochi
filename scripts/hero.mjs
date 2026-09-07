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
import { mkdirSync, writeFileSync } from 'node:fs'
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
