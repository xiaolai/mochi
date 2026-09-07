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
   The animated hero: breathing, with an occasional blink.

   ## The two timescales are the whole problem

   A breath is 3400ms and a blink is 130ms. One frame rate has to serve both, so
   fast enough to render a blink as a blink rather than as a dropped frame means
   about 200 frames for a two-breath loop, and a file nobody should have at the
   top of a page.

   APNG carries a delay PER FRAME, which is the way out: hold long frames through
   the quiet breathing and go dense only across the blink. Sixty-odd frames
   instead of two hundred, for the same clip.

   ## The blink is found, not assumed

   `IdleLayer` takes its random source by injection, so the schedule is
   reproducible — but where it puts the blink is arithmetic inside the engine,
   and hard-coding a timestamp here would be a second copy of that arithmetic,
   free to drift. So the clip is scanned at 10ms first and the blink is located
   by watching the eyes close. If the engine ever reschedules, this follows.

   ## Two breaths, not one

   The loop has to be a whole number of breath periods or it does not close. One
   period would blink every 3.4 seconds — inside the natural range, but perfectly
   regular, which is the metronome the engine's Poisson gap exists to avoid. Two
   periods put it at 6.8s, rare enough to read as occasional.

   ## APNG rather than GIF

   GIF has one bit of transparency, which would put a hard fringe on every
   antialiased edge she has, against both the light and dark page she has to sit
   on. APNG carries the full alpha channel and is a valid PNG, so a renderer that
   does not animate it shows the first frame instead of nothing.
--------------------------------------------------------------------------- */

const BREATH_MS = 3400
const LOOP_MS = BREATH_MS * 2
/*
  A CONSTANT 40ms rate, with long holds expressed as repeated frames.

  Variable per-frame delays were the obvious answer and they do not survive the
  toolchain. ffmpeg's APNG muxer writes delays against a fixed 1/25 timebase —
  neither `-enc_time_base` nor `-video_track_timescale` moves it — so 25ms and
  100ms came back as 40ms and 80ms, and the concat demuxer's duration handling
  put the loop 40 to 80ms out of phase with the breath it repeats, sliding
  further on every pass.

  Repeating a frame instead is exact by construction: 170 ticks of 40ms is
  6800ms, full stop. It costs nothing, because a repeated frame is byte-identical
  to the one before it and inter-frame compression is very good at that — which
  is the same property that made this file EXPENSIVE when every frame differed.

  A distinct render every third tick through the quiet breathing, every tick
  across the blink.
*/
const TICK_MS = 40
/** Three ticks through the quiet breathing. It is a slow, smooth motion. */
const CALM_MS = TICK_MS * 3
/** One tick across the blink, the finest this container allows. */
const QUICK_MS = TICK_MS
/** Blink schedule, pinned. Where it lands is measured below, not assumed here. */
const BLINK_SEED = 0.94

function haveFfmpeg() {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function makeAvatar(width, height, scale) {
  const canvas = createCanvas(width * scale, height * scale)
  const ctx = canvas.getContext('2d')
  const avatar = new DoughAvatar(ctx, { face: MOCHI, size: 'fit-canvas', random: () => BLINK_SEED })
  avatar.resize(width, height, scale)
  // Breathing and blinking only. The sway is a third thing and this is a still
  // frame on a page, not a companion on a desktop.
  avatar.setDrift(false)
  return { canvas, ctx, avatar }
}

/** How much dark ink is on screen. The eyes are most of it; a blink drops it. */
function inkAt(ctx, canvas, avatar, t) {
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  avatar.render(t)
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
  let ink = 0
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] > 128 && data[i] < 80 && data[i + 1] < 110) ink++
  }
  return ink
}

/**
 * The window the eyes are shut in, and the instant they are shut hardest —
 * scanned rather than computed.
 *
 * `deepest` is what the loop is then aligned to. A blink is 130ms and the ticks
 * are 40ms, so where the grid falls decides whether the closure is sampled
 * through its lowest point or straddled either side of it. Aligning costs
 * nothing and removes the question: the whole loop simply starts a few
 * milliseconds later, which it is free to do, because the breath is periodic and
 * the clip is a whole number of periods.
 *
 * Measured on the finished file, the eyes lose 89% of their ink at the bottom of
 * the blink. An earlier reading of 60% was the metric's fault, not the clip's —
 * it counted the mouth, which is ink that never closes.
 */
function findBlink(width, height, scale) {
  const { canvas, ctx, avatar } = makeAvatar(width, height, scale)
  const samples = []
  for (let t = 0; t < LOOP_MS; t += 5) samples.push({ t, ink: inkAt(ctx, canvas, avatar, t) })
  const open = samples.map((s) => s.ink).sort((a, b) => b - a)[Math.floor(samples.length * 0.1)]
  const shut = samples.filter((s) => s.ink < open * 0.8)
  if (shut.length === 0) return null
  const deepest = shut.reduce((low, s) => (s.ink < low.ink ? s : low), shut[0])
  return { from: shut[0].t, to: shut[shut.length - 1].t, deepest: deepest.t }
}

/** Timestamps and delays: sparse through the breath, dense across the blink. */
/**
 * One entry per 40ms tick. `render` says whether this tick needs a fresh draw
 * or repeats the last one — a repeat is the same bytes, so it is nearly free.
 */
function timeline(blink) {
  // Wide enough to carry the eye down and back up, not just the shut frames.
  const margin = 80
  const dense = blink === null ? null : { from: blink.from - margin, to: blink.to + margin }
  const ticks = []
  for (let t = 0; t < LOOP_MS; t += TICK_MS) {
    const inBlink = dense !== null && t >= dense.from && t < dense.to
    const every = inBlink ? QUICK_MS : CALM_MS
    ticks.push({ t, render: t % every === 0 })
  }
  return ticks
}

if (!haveFfmpeg()) {
  console.log('\n  skipped mochi-alive.png — ffmpeg not on PATH (the stills above are complete)')
} else {
  const W = 320
  const SCALE = 1
  const blink = findBlink(W, W, SCALE)
  const frames = timeline(blink)
  // Start the loop so the hardest part of the blink falls exactly on a tick.
  const phase = blink === null ? 0 : blink.deepest % TICK_MS

  const { canvas, ctx, avatar } = makeAvatar(W, W, SCALE)
  // One crop box across every frame. Cropping each to its own bounds would make
  // her jitter against the edge as she breathes.
  const shots = []
  let minX = canvas.width
  let maxX = -1
  let minY = canvas.height
  let maxY = -1
  let last = null
  for (const frame of frames) {
    if (frame.render || last === null) {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      avatar.render(frame.t + phase)
      last = ctx.getImageData(0, 0, canvas.width, canvas.height)
    }
    const image = last
    shots.push(image)
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
  shots.forEach((image, i) => {
    sourceCtx.putImageData(image, 0, 0)
    cellCtx.clearRect(0, 0, cell.width, cell.height)
    cellCtx.drawImage(source, minX, minY, w, h, pad, pad, w, h)
    writeFileSync(join(dir, `f${String(i).padStart(4, '0')}.png`), cell.toBuffer('image/png'))
  })

  // A plain constant-rate image sequence. Every hold is already expressed as a
  // repeated frame, so nothing here has to carry a per-frame duration — which
  // is the point, because that was the part the muxer would not honour.
  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-framerate',
      String(1000 / TICK_MS),
      '-i',
      join(dir, 'f%04d.png'),
      '-plays',
      '0',
      '-f',
      'apng',
      OUT + 'mochi-alive.png',
    ],
    { stdio: 'ignore' },
  )
  rmSync(dir, { recursive: true, force: true })
  const blinkNote = blink === null ? 'no blink found' : `blink ${blink.from}-${blink.to}ms`
  console.log(
    `  assets/mochi-alive.png`.padEnd(34),
    `${cell.width}x${cell.height}, ${shots.length} ticks, ${LOOP_MS}ms loop, ${blinkNote}`,
  )
}
