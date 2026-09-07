/**
 * Mochi as a Codex CLI pet — the frame renderer.
 *
 * Codex pets are a sprite atlas: fixed-size cells, one row per animation state.
 * That is about as far from this package's usual job as a consumer gets — no
 * canvas on screen, no frame loop, no clock. It asks for a specific pose at a
 * specific instant and gets pixels back, which the core is built to do because
 * everything in it is a pure function.
 *
 * ## Why this reaches for the primitives instead of `DoughAvatar`
 *
 * `DoughAvatar` owns time. It runs the idle layer, schedules its own blinks and
 * decides how far through a breath it is — exactly right on a desktop, and
 * exactly wrong for an exporter that has to say "frame 3 of 6, eyes 70% shut".
 * So this composes the frame itself from `domeOutline`, `placeFeature` and the
 * three paint functions.
 *
 * The cost is the body compositing below — the clip, the shadow fill, the lit
 * copy displaced — which is a copy of what `DoughAvatar.paint` does internally.
 * It is about six lines and it is the one part of this file that could drift
 * from the engine. If you are writing an exporter of your own, this is the part
 * to watch.
 *
 * ## Provenance
 *
 * Originally written by OpenAI Codex against this repository when it was still
 * a desktop application, and adapted here to import the published package
 * instead of loading source files through a Vite dev server. The pose table is
 * unchanged. No generated artwork is involved: every pixel comes out of
 * `domeOutline` and `MOCHI`, so this is a rendering of the character rather
 * than an imitation of her.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createCanvas, Path2D } from '@napi-rs/canvas'
import {
  COLOURWAYS,
  MOCHI,
  NEUTRAL,
  domeOutline,
  mochiIn,
  paintCheeks,
  paintEyes,
  paintMouth,
  placeFeature,
  squashed,
  toPath,
} from 'mochi-avatar'

// The rig builds its silhouette as a Path2D at module scope; in a browser that
// is global, and under Node it ships with the rasteriser.
globalThis.Path2D ??= Path2D

/**
 * Which colourway to export. `matcha` is her original green and keeps the pet id
 * `mochi`; the rest get `mochi-<flavour>`, so several can be installed at once
 * without one overwriting another.
 */
const FLAVOUR = process.argv[2] ?? 'matcha'
if (!Object.hasOwn(COLOURWAYS, FLAVOUR)) {
  console.error(`unknown colourway ${JSON.stringify(FLAVOUR)}`)
  console.error(`try one of: ${Object.keys(COLOURWAYS).join(', ')}`)
  process.exit(1)
}
const PET_ID = FLAVOUR === 'matcha' ? 'mochi' : `mochi-${FLAVOUR}`

// Five colour fields over identical geometry. Every frame below is the same
// shape whichever flavour this is — which is the claim the package makes, and
// the atlas is a decent place to hold it to.
const FACE = mochiIn(FLAVOUR, MOCHI)

const OUT = fileURLToPath(new URL(`./build/${FLAVOUR}/`, import.meta.url))

/** One atlas cell, and where she stands in it. */
const W = 192
const H = 208
/** Rendered at 4x and downsampled once, which is what keeps the edge smooth. */
const DPR = 4
const SCALE = 1.6
const BASELINE = 183

/** Row order is the atlas contract: each state, and how many frames it holds. */
const STATES = [
  ['idle', 6],
  ['running-right', 8],
  ['running-left', 8],
  ['waving', 4],
  ['jumping', 5],
  ['failed', 8],
  ['waiting', 6],
  ['running', 6],
  ['review', 6],
]

/**
 * One frame.
 *
 * `p.x` and `p.y` move the FEATURES, not the body — the silhouette is identical
 * in every look direction, which the assembler asserts. A pet that turned its
 * whole body would need a second view, and there is only one.
 */
function draw(p = {}) {
  const canvas = createCanvas(W * DPR, H * DPR)
  const ctx = canvas.getContext('2d')
  ctx.scale(DPR, DPR)

  const face = { ...FACE, eyeGlint: 0, ...p.face }
  const look = { ...NEUTRAL, ...p.look, sparkle: 0, lean: 0 }

  const base = {
    halfWidth: (face.bodyW * SCALE) / 2,
    height: face.bodyH * SCALE,
    waist: face.waist,
    upperShoulder: face.upperShoulder,
    lowerShoulder: face.lowerShoulder,
    lean: 0,
  }
  const body = squashed(base, p.breath ?? 0)

  // Local space is +y up with the base at 0; the canvas is +y down.
  const map = (q) => ({ x: W / 2 + q.x, y: BASELINE - q.y })
  const outline = domeOutline(body).map(map)
  const clip = toPath(outline)

  // Everything is clipped to the silhouette, so the displaced lit copy cannot
  // spill past her outline on the up-right side. See the note at the top: this
  // mirrors `DoughAvatar.paint`.
  ctx.save()
  ctx.clip(clip)
  ctx.fillStyle = face.colShadow
  ctx.fill(clip)
  ctx.fillStyle = face.colBody
  ctx.fill(
    toPath(
      outline.map((q) => ({
        x: q.x + face.shadowX * body.halfWidth * 2,
        y: q.y - face.shadowY * body.height,
      })),
    ),
  )

  const fixed = (x, y) => map(placeFeature(base, body, x, y, face.gripX, face.gripY))
  paintCheeks(ctx, face, NEUTRAL, fixed, SCALE)

  // Eyes and mouth travel further than the cheeks, and further up than down —
  // a face looking up shows more of itself than one looking down.
  const eyePlace = (x, y) => {
    const q = fixed(x, y)
    return { x: q.x + (p.x ?? 0) * 17, y: q.y + (p.y ?? 0) * ((p.y ?? 0) < 0 ? 28 : 16) }
  }
  const mouthPlace = (x, y) => {
    const q = fixed(x, y)
    return { x: q.x + (p.x ?? 0) * 10, y: q.y + (p.y ?? 0) * ((p.y ?? 0) < 0 ? 36 : 9) }
  }
  paintEyes(ctx, face, look, p.blink ?? 0, { x: 0, y: 0 }, eyePlace, SCALE)
  paintMouth(ctx, face, look, p.open ?? 0, mouthPlace, SCALE)

  ctx.restore()
  return canvas.toBuffer('image/png')
}

/**
 * The pose for frame `i` of `n` in a state.
 *
 * Every state is breathing, eyes and mouth. The atlas asks for rows called
 * `running` and `jumping`, and this answers them with a facial response rather
 * than a literal action — she has no limbs to run with, and inventing some
 * would make her a different character.
 */
function pose(state, i, n) {
  const phase = (2 * Math.PI * i) / n
  const breath = (0.008 * (1 - Math.cos(phase))) / 2
  const p = { breath, x: 0, y: 0 }

  if (state === 'idle') p.blink = [0, 0, 0.15, 1, 0.15, 0][i]

  if (state === 'running-right' || state === 'running-left') {
    p.x = (state === 'running-right' ? 1 : -1) * (0.5 + 0.05 * Math.sin(phase))
    p.blink = i === 5 ? 0.7 : 0
  }

  if (state === 'waving') {
    p.look = {
      eyeUpper: 1,
      // Negative bows the lower lid above the baseline: the crescent eye.
      eyeLower: [1, 0.3, -0.35, 0.3][i],
      mouthLower: [1, 1.3, 1.5, 1.3][i],
    }
  }

  if (state === 'jumping') {
    p.look = { eyeUpper: [1, 1.12, 1.22, 1.12, 1][i], eyeLower: [1, 1.12, 1.22, 1.12, 1][i] }
    p.open = [0, 0.05, 0.12, 0.05, 0][i]
  }

  if (state === 'failed') {
    p.y = 0.25
    p.face = { mouthUpper: 2.4, mouthLower: 0 }
    p.look = { eyeUpper: 0.72, eyeLower: 0.72 }
    p.blink = [0, 0, 0.3, 0.7, 0.85, 0.7, 0.3, 0][i]
  }

  if (state === 'waiting') {
    p.y = -0.22
    p.x = 0.1 * Math.sin(phase)
    p.look = { eyeUpper: 1.05, eyeLower: 1.05, mouthWidth: 0.8 }
    p.open = (0.025 * (1 - Math.cos(phase))) / 2
  }

  if (state === 'running') {
    p.x = [-0.24, -0.12, 0.12, 0.24, 0.12, -0.12][i]
    p.y = 0.08
    p.look = { eyeUpper: 0.85, eyeLower: 0.85, mouthWidth: 0.85 }
  }

  if (state === 'review') {
    p.x = [-0.18, -0.12, 0, 0.12, 0.18, 0][i]
    p.y = 0.15
    p.blink = [0, 0, 0.6, 0, 0, 0][i]
    p.look = { eyeUpper: 0.8, eyeLower: 0.8, mouthWidth: 0.85 }
  }

  return p
}

const DESCRIPTIONS = {
  matcha: 'The original smooth mint Mochi: quiet breathing, eyes and mouth, with no limbs.',
  sakura: 'Mochi in cherry blossom. Quiet breathing, eyes and mouth, with no limbs.',
  kinako: 'Mochi in roasted soybean flour. Quiet breathing, eyes and mouth, with no limbs.',
  yuzu: 'Mochi in citrus. Quiet breathing, eyes and mouth, with no limbs.',
  ramune: 'Mochi in soda blue. Quiet breathing, eyes and mouth, with no limbs.',
  budo: 'Mochi in grape. Quiet breathing, eyes and mouth, with no limbs.',
}

const manifest = {
  pet: {
    id: PET_ID,
    displayName: FLAVOUR === 'matcha' ? 'Mochi' : `Mochi (${FLAVOUR})`,
    description: DESCRIPTIONS[FLAVOUR],
    spriteVersionNumber: 2,
    spritesheetPath: 'spritesheet.webp',
  },
  colourway: FLAVOUR,
  renderer: 'mochi-avatar geometry and face paint functions',
  cellWidth: W,
  cellHeight: H,
  supersampling: DPR,
  bodyWidth: 160,
  baseline: BASELINE,
  restrictions:
    'No limbs, protrusions, translation, travel, jumps, props, head turns or dramatic deformation. Only breathing, eyes, mouth.',
  states: {},
}

for (const [state, n] of STATES) {
  await mkdir(`${OUT}raw/${state}`, { recursive: true })
  manifest.states[state] = []
  for (let i = 0; i < n; i++) {
    const p = pose(state, i, n)
    const file = `${String(i).padStart(2, '0')}.png`
    await writeFile(`${OUT}raw/${state}/${file}`, draw(p))
    manifest.states[state].push({ file, pose: p })
  }
}

// Sixteen look directions at 22.5 degrees apart. The body does not move at all;
// only the eyes and mouth travel, which is what keeps every silhouette equal.
await mkdir(`${OUT}raw/look`, { recursive: true })
manifest.look = []
for (let i = 0; i < 16; i++) {
  const angle = (i * Math.PI) / 8
  const p = { x: Math.sin(angle), y: -Math.cos(angle), breath: 0 }
  const label = String(i * 22.5).padStart(3, '0')
  await writeFile(`${OUT}raw/look/${label}.png`, draw(p))
  manifest.look.push({ label, pose: p })
}

await writeFile(`${OUT}render-manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`)
await writeFile(`${OUT}raw/neutral.png`, draw())

const frames = Object.values(manifest.states).reduce((sum, list) => sum + list.length, 0)
console.log(`${FLAVOUR}: rendered ${frames} state frames, 16 look poses and a neutral → ${PET_ID}`)
