/**
 * Every mood and every motion she has, driven and captured.
 *
 * The running app has no automation surface — no remote debugging port, no
 * scripting channel — so this drives the RIG rather than the window: the same
 * `MochiAvatar` the companion constructs, stepped by hand and rasterised at each
 * frame. What comes out is what she does, because it is the same code doing it.
 *
 *   pnpm showreel
 *
 * Writes a self-contained page to `dev-docs/artifacts/`. Sprite strips rather
 * than one file per frame: 150 loose PNGs inlined as data URIs is a document
 * nothing wants to open.
 */
import { createCanvas } from '@napi-rs/canvas'
import { Path2D as NodePath2D } from '@napi-rs/canvas'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

// The rig builds its silhouette as a Path2D at module scope, so this has to
// exist before the module is loaded — the same reason the tests use a setup file.
globalThis.Path2D ??= NodePath2D

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const OUT = join(ROOT, 'dev-docs/artifacts')

const vite = await createServer({
  root: ROOT,
  configFile: false,
  logLevel: 'error',
  appType: 'custom',
  server: { middlewareMode: true },
  resolve: { alias: { '@shared': join(ROOT, 'src/shared') } },
})
const { EMOTIONS } = await vite.ssrLoadModule('/src/shared/avatar.ts')
const { MochiAvatar } = await vite.ssrLoadModule('/src/renderer/companion/rig/mochi.ts')
const { BUILT_IN_MOTIONS } = await vite.ssrLoadModule('/src/renderer/companion/rig/motion.ts')
const repose = await vite.ssrLoadModule('/src/renderer/companion/repose.ts')

/** Big enough to read, small enough that a strip of 30 is not a poster. */
const CELL = 200
/** Frames per animation. 30 at 20fps is a second and a half of clip. */
const FRAMES = 30
/** Rendered at 2x so the still frames stay sharp on a retina display. */
const DPR = 2

/**
 * Motion strips at 1x, which is a size decision rather than a quality one.
 *
 * Thirty frames of a 480x200 cell at 2x is 28,800 pixels across, seven times
 * over, and the whole page is inlined as data URIs — it came to 6.5MB, which is
 * a document that takes a moment to open for animation nobody inspects a pixel
 * of. At 1x the strips are still drawn larger than the card renders them.
 */
const MOTION_DPR = 1

/**
 * Motion cells are WIDE, because travel needs somewhere to travel.
 *
 * `fit-canvas` fills the canvas it is given, so in a square cell `wander`'s
 * 0.42 body widths walk her straight off the edge and the strip shows her cut
 * in half — the same thing that happens in the app when the pad does not
 * reserve room, which is why `padNeeded` reserves it. There is no pad here, so
 * the room is the cell: 2.4:1 leaves about 125px of slack each side against the
 * ~97px the widest clip asks for.
 */
const MOTION_W = 480
const MOTION_H = 200

/**
 * A rig whose BACKING STORE matches the ratio it was told about.
 *
 * `resize(w, h, dpr)` describes CSS pixels and a ratio; the canvas has to be
 * `w * dpr` across or the rig draws into a surface smaller than it believes it
 * has. Getting that wrong does not halve her — it produced a sliver in the
 * corner, because `fit-canvas` fits her to the CSS size and the transform then
 * scales that up into a store that cannot hold it.
 */
function rig(width = CELL, height = CELL, dpr = DPR) {
  const canvas = createCanvas(width * dpr, height * dpr)
  const avatar = new MochiAvatar(canvas.getContext('2d'), {
    size: 'fit-canvas',
    // Pinned, so a blink cannot land in one frame of a strip and not the next
    // and read as a glitch in the animation rather than as her blinking.
    random: () => 0.5,
  })
  avatar.resize(width, height, dpr)
  return { canvas, avatar }
}

/** One strip: `n` cells side by side, painted by `draw(avatar, index)`. */
async function strip(n, draw) {
  const sheet = createCanvas(CELL * n * DPR, CELL * DPR)
  const ctx = sheet.getContext('2d')
  for (let index = 0; index < n; index += 1) {
    const one = rig()
    draw(one.avatar, index)
    ctx.drawImage(one.canvas, index * CELL * DPR, 0)
  }
  return `data:image/png;base64,${sheet.toBuffer('image/png').toString('base64')}`
}

/* ── moods ──────────────────────────────────────────────────────────────── */

const moods = await strip(EMOTIONS.length, (avatar, index) => {
  avatar.setEmotion({ emotion: EMOTIONS[index], intensity: 1 })
  avatar.render(0)
})

/** The same eight at half strength, because intensity is a real axis. */
const half = await strip(EMOTIONS.length, (avatar, index) => {
  avatar.setEmotion({ emotion: EMOTIONS[index], intensity: 0.5 })
  avatar.render(0)
})

/* ── motions ────────────────────────────────────────────────────────────── */

const CLIPS = Object.keys(BUILT_IN_MOTIONS)

const motions = []
for (const name of CLIPS) {
  const clip = BUILT_IN_MOTIONS[name]
  const sheet = createCanvas(MOTION_W * FRAMES * MOTION_DPR, MOTION_H * MOTION_DPR)
  const ctx = sheet.getContext('2d')
  // ONE avatar across the whole strip, not one per frame: the squash spring and
  // the idle breath carry state, so a fresh rig every frame would show the pose
  // the clip asks for with none of the settling that makes it read as movement.
  const one = rig(MOTION_W, MOTION_H, MOTION_DPR)
  one.avatar.playMotion(name)
  for (let frame = 0; frame < FRAMES; frame += 1) {
    one.avatar.render((frame / FRAMES) * clip.durationMs)
    ctx.drawImage(one.canvas, frame * MOTION_W * MOTION_DPR, 0)
  }
  motions.push({
    name,
    ms: clip.durationMs,
    loop: clip.loop,
    channels: [...new Set(clip.keys.flatMap((k) => Object.keys(k).filter((c) => c !== 't')))],
    src: `data:image/png;base64,${sheet.toBuffer('image/png').toString('base64')}`,
  })
}

/* ── the two composites the app actually plays ──────────────────────────── */

/** Waking: the perk and the hop together, which is what `sleeps(false)` does. */
const wakingSheet = createCanvas(MOTION_W * FRAMES * MOTION_DPR, MOTION_H * MOTION_DPR)
{
  const ctx = wakingSheet.getContext('2d')
  const one = rig(MOTION_W, MOTION_H, MOTION_DPR)
  one.avatar.setAsleep(true)
  one.avatar.render(0)
  one.avatar.setAsleep(false)
  one.avatar.setEmotion({ emotion: 'surprised', intensity: 0.6, holdMs: 1400 })
  one.avatar.playMotion('hop')
  for (let frame = 0; frame < FRAMES; frame += 1) {
    one.avatar.render((frame / FRAMES) * 1600)
    ctx.drawImage(one.canvas, frame * MOTION_W * MOTION_DPR, 0)
  }
}
const waking = `data:image/png;base64,${wakingSheet.toBuffer('image/png').toString('base64')}`

/**
 * The DRIFT alone: no clip playing, just her standing there.
 *
 * Long and slow — 24 seconds of it — because the point is that it never
 * repeats and never goes anywhere. If this strip reads as a loop, the periods
 * in `idle.ts` are too close together.
 */
const idleSheet = createCanvas(MOTION_W * FRAMES * MOTION_DPR, MOTION_H * MOTION_DPR)
{
  const ctx = idleSheet.getContext('2d')
  const one = rig(MOTION_W, MOTION_H, MOTION_DPR)
  for (let frame = 0; frame < FRAMES; frame += 1) {
    one.avatar.render((frame / FRAMES) * 24_000)
    ctx.drawImage(one.canvas, frame * MOTION_W * MOTION_DPR, 0)
  }
}
const idling = `data:image/png;base64,${idleSheet.toBuffer('image/png').toString('base64')}`

/** Resting: the pose the rig applies from `asleep`, not an expression. */
const sleeping = await strip(2, (avatar, index) => {
  if (index === 1) avatar.setAsleep(true)
  avatar.render(0)
})

const html = page({
  moods,
  half,
  motions,
  waking,
  sleeping,
  idling,
  emotions: [...EMOTIONS],
  repose,
})
await mkdir(OUT, { recursive: true })
const path = join(OUT, 'showreel.html')
await writeFile(path, html)
console.log(`wrote ${path}`)
await vite.close()

/* ── the page ───────────────────────────────────────────────────────────── */

function page(d) {
  const moodCells = d.emotions
    .map(
      (name, index) => `
      <figure class="cell">
        <div class="sprite" style="--n:${d.emotions.length};--i:${index}">
          <span style="background-image:url(${d.moods})"></span>
        </div>
        <figcaption>${name}</figcaption>
      </figure>`,
    )
    .join('')

  const halfCells = d.emotions
    .map(
      (name, index) => `
      <figure class="cell">
        <div class="sprite" style="--n:${d.emotions.length};--i:${index}">
          <span style="background-image:url(${d.half})"></span>
        </div>
        <figcaption>${name} <em>0.5</em></figcaption>
      </figure>`,
    )
    .join('')

  const clipCards = d.motions
    .map(
      (m) => `
      <figure class="cell wide">
        <div class="sprite play" style="--n:${FRAMES};--ms:${m.ms}ms;--ar:${MOTION_W / MOTION_H}">
          <span style="background-image:url(${m.src})"></span>
        </div>
        <figcaption>
          <b>${m.name}</b>
          <span class="meta">${m.ms}ms · ${m.loop ? 'loops' : 'one-shot'}</span>
          <span class="chan">${m.channels.map((c) => `<code>${c}</code>`).join(' ')}</span>
        </figcaption>
      </figure>`,
    )
    .join('')

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>mochi · every mood and motion</title>
<style>
:root{color-scheme:light;--bg:#f6f5f1;--card:#fcfcfb;--line:#dcd9d1;--ink:#14140f;--dim:#6b6a63;--gold:#a8842c}
@media (prefers-color-scheme:dark){:root{color-scheme:dark;--bg:#121211;--card:#1a1a19;--line:#35352f;--ink:#f4f3ee;--dim:#908f86;--gold:#d2ac53}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif}
.wrap{max-width:1180px;margin:0 auto;padding:0 24px 90px}
header{border-bottom:1px solid var(--line);background:var(--card);padding:52px 0 34px;margin-bottom:8px}
header .wrap{padding-bottom:0}
.eyebrow{font:600 11.5px/1 ui-monospace,Menlo,monospace;letter-spacing:.13em;text-transform:uppercase;color:var(--gold);margin:0 0 14px}
h1{font-size:clamp(28px,5vw,42px);line-height:1.1;letter-spacing:-.02em;margin:0 0 14px;font-weight:650}
p.lede{font-size:18px;color:var(--dim);max-width:66ch;margin:0}
h2{font-size:23px;letter-spacing:-.015em;margin:56px 0 6px;font-weight:640}
h2 .num{font:600 12px/1 ui-monospace,Menlo,monospace;color:var(--gold);letter-spacing:.1em;margin-right:10px}
p{max-width:72ch;color:var(--dim);margin:0 0 20px}
code{font:.86em ui-monospace,Menlo,monospace;background:var(--bg);border:1px solid var(--line);border-radius:5px;padding:1px 5px}
.grid{display:grid;gap:14px;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));margin-bottom:8px}
.grid.wide{grid-template-columns:repeat(auto-fill,minmax(340px,1fr))}
.cell{margin:0;background:var(--card);border:1px solid var(--line);border-radius:11px;padding:10px;text-align:center}
.sprite{width:100%;aspect-ratio:var(--ar,1);overflow:hidden;position:relative;border-radius:8px}
.sprite span{position:absolute;inset:0;background-repeat:no-repeat;background-size:calc(var(--n) * 100%) 100%;
  background-position:calc(var(--i,0) * 100% / (var(--n) - 1)) 0}
.sprite.play span{animation:reel var(--ms) steps(var(--n)) infinite}
@keyframes reel{from{background-position:0 0}to{background-position:100% 0}}
figcaption{font-size:12.5px;color:var(--dim);margin-top:7px;display:flex;flex-direction:column;gap:3px}
figcaption b{color:var(--ink);font-size:13.5px}
figcaption em{font-style:normal;opacity:.6}
.meta{font:11px ui-monospace,Menlo,monospace}
.chan code{font-size:10px;padding:0 4px}
.note{border-left:3px solid var(--gold);background:var(--card);border-radius:0 10px 10px 0;padding:14px 18px;margin:0 0 22px;font-size:14.5px;color:var(--dim);max-width:78ch}
.note b{color:var(--ink)}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:14px;max-width:420px}
footer{margin-top:64px;padding-top:22px;border-top:1px solid var(--line);font-size:13px;color:var(--dim)}
</style></head><body>
<header><div class="wrap">
<p class="eyebrow">mochi · rig showreel</p>
<h1>Every mood and every motion she has</h1>
<p class="lede">Driven headlessly through the same <code>MochiAvatar</code> the companion window constructs — stepped frame by frame and rasterised. The animations below are real frames, not mockups.</p>
</div></header>
<div class="wrap">

<section>
<h2><span class="num">01</span>Moods</h2>
<p>Eight expressions, each a set of multipliers on the neutral face — eye arcs, tilt, mouth, cheek colour, catchlight, gaze bias, squash and lean. She sets these herself by calling <code>set_expression</code>.</p>
<div class="note"><b>She has never once used them.</b> Measured on the real installation: 275 sessions, 914 of her turns, and <code>set_expression</code> called zero times. Everything painted here has been reachable the whole time and unreached.</div>
<div class="grid">${moodCells}</div>
</section>

<section>
<h2><span class="num">02</span>The same eight at half intensity</h2>
<p>Intensity blends toward neutral, so every expression is a dial rather than a switch. <code>0</code> is exactly neutral for all of them — which is what lets a signal fade in without a second set of artwork.</p>
<div class="grid">${halfCells}</div>
</section>

<section>
<h2><span class="num">03</span>Standing still — the drift</h2>
<p>No clip playing. This is what runs <em>continuously</em> whenever she is awake: three sines per channel at periods that do not divide each other, summed, at a few pixels of amplitude. She shifts her weight and goes nowhere.</p>
<div class="note">This is the layer that separates <b>alive</b> from <b>a picture that sometimes moves</b>. Breathing used to be the only thing running between gestures, so she was a still image punctuated by clips — and the clips got blamed for being coarse when what was coarse was the silence around them.</div>
<figure class="cell wide" style="max-width:400px">
  <div class="sprite play" style="--n:${FRAMES};--ms:24000ms;--ar:${MOTION_W / MOTION_H}"><span style="background-image:url(${d.idling})"></span></div>
  <figcaption><b>drift</b><span class="meta">always on · 24s sampled</span><span class="chan"><code>lean</code> <code>shift</code> <code>lift</code></span></figcaption>
</figure>
</section>

<section>
<h2><span class="num">04</span>Motions</h2>
<p>Each plays at its real duration. The four channels a clip may move are postural — <code>squash</code>, <code>lean</code>, <code>gazeX</code>, <code>gazeY</code> — plus the three added for travel: <code>lift</code>, <code>shift</code>, <code>turn</code>. The mouth is deliberately not among them.</p>
<div class="grid wide">${clipCards}</div>
</section>

<section>
<h2><span class="num">05</span>Waking, which is two things at once</h2>
<p>What <code>sleeps(false)</code> actually does: <code>surprised</code> at 0.6 with a 1400ms hold, and <code>hop</code> underneath it. An expression appearing on a body that did not react reads as a texture swap rather than as somebody waking up.</p>
<figure class="cell wide" style="max-width:400px">
  <div class="sprite play" style="--n:${FRAMES};--ms:1600ms;--ar:${MOTION_W / MOTION_H}"><span style="background-image:url(${d.waking})"></span></div>
  <figcaption><b>waking</b><span class="meta">perk + hop</span></figcaption>
</figure>
</section>

<section>
<h2><span class="num">06</span>Awake and resting</h2>
<p>Sleep is a <em>pose</em> the rig renders from <code>asleep</code>, not an expression assigned to her. That is why waking gives back whatever face she had chosen: nothing overwrote it.</p>
<div class="pair">
  <figure class="cell"><div class="sprite" style="--n:2;--i:0"><span style="background-image:url(${d.sleeping})"></span></div><figcaption>awake</figcaption></figure>
  <figure class="cell"><div class="sprite" style="--n:2;--i:1"><span style="background-image:url(${d.sleeping})"></span></div><figcaption>resting</figcaption></figure>
</div>
</section>

<section>
<h2><span class="num">07</span>When each motion plays</h2>
<p>Nothing here waits for her to choose it — that is the mistake the eight unused faces record. Ambient motion climbs a ladder of silence, and the beat outranks all of it.</p>
<div class="note">
<b>glance</b> after ${repose.LOOK_AFTER_S}s of quiet · <b>swing</b> after ${repose.SWING_AFTER_S}s · <b>wander</b> after ${repose.WANDER_AFTER_S}s.<br>
<b>hop</b> on waking. <b>sway</b> and <b>nod</b> belong to the beat — she is waiting on a slow answer, which is information rather than decoration, so ambient motion never overwrites them.
</div>
</section>

<footer>Rendered from <code>src/renderer/companion/rig/</code> by <code>scripts/showreel.mjs</code>. Frames are real output of the shipped rig; blink is pinned so a strip cannot show one mid-animation.</footer>
</div></body></html>`
}
