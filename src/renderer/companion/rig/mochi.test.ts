import { createCanvas, type Canvas, type SKRSContext2D } from '@napi-rs/canvas'
import { describe, expect, it } from 'vitest'
import { EMOTIONS, type Emotion } from '@shared/avatar'
import { FACE_BOUNDS, MOCHI } from '@shared/avatar-spec'
import { MochiAvatar } from './mochi'
import { BUILT_IN_MOTIONS } from './motion'
import { BLINK_DURATION_MS, BREATH_PERIOD_MS, nextBlinkGap } from './idle'
import { SIZE_PERCENT, layoutFor } from '@shared/avatar-layout'

const WIDTH = 240
const HEIGHT = 220
/** Wide enough that a travelling clip does not meet the edge. See `wide()`. */
const WIDE_W = 620

interface Rig {
  readonly canvas: Canvas
  readonly ctx: SKRSContext2D
  readonly avatar: MochiAvatar
}

/**
 * A rig over a real rasteriser.
 *
 * The cast is the one place this project pretends: SKRSContext2D implements the
 * same drawing surface the browser does, but the two type declarations are
 * separate. Casting here keeps the production module typed against the DOM,
 * which is where it actually runs.
 */
function rig(dpr = 1): Rig {
  const canvas = createCanvas(WIDTH * dpr, HEIGHT * dpr)
  const ctx = canvas.getContext('2d')
  const avatar = new MochiAvatar(ctx as unknown as CanvasRenderingContext2D, {
    // `fit-canvas`, not a percentage: these tests are about what the rig DRAWS,
    // so she should fill the surface they were given. The app's own sizing is
    // covered in `avatar-layout.test.ts`, where it belongs.
    size: 'fit-canvas',
    // Pinned so a blink cannot land mid-assertion and change the pixels.
    random: () => 0.5,
  })
  avatar.resize(WIDTH, HEIGHT, dpr)
  return { canvas, ctx, avatar }
}

/**
 * A device pixel, and the CSS-space point at its CENTRE.
 *
 * The half-pixel matters and getting it wrong looks exactly like a geometry
 * bug: `getImageData(x, y)` reads the pixel spanning [x, x+1), whose centre is
 * at x + 0.5, while `hitTest(x, y)` asks about the corner. Where the silhouette
 * edge runs near-horizontally — the whole top of the dome — half a pixel is the
 * difference between inside and outside, so comparing a corner against a pixel
 * area reports disagreements that are not there.
 */
function samplePixel(
  ctx: SKRSContext2D,
  deviceX: number,
  deviceY: number,
  dpr: number,
): { alpha: number; x: number; y: number } {
  const data = ctx.getImageData(deviceX, deviceY, 1, 1).data
  return { alpha: data[3] ?? 0, x: (deviceX + 0.5) / dpr, y: (deviceY + 0.5) / dpr }
}

/**
 * The highest alpha found anywhere on the one-pixel frame around the canvas.
 *
 * Non-zero means she was painted past the edge and the missing part was cropped
 * flat by the surface. Read as four strips rather than pixel by pixel: a
 * per-pixel `getImageData` over the border, at every sample of a breath cycle,
 * for every emotion, costs more than the rest of this file put together.
 */
function borderAlpha(ctx: SKRSContext2D): number {
  let worst = 0
  const scan = (x: number, y: number, width: number, height: number): void => {
    const { data } = ctx.getImageData(x, y, width, height)
    for (let i = 3; i < data.length; i += 4) worst = Math.max(worst, data[i] ?? 0)
  }
  scan(0, 0, WIDTH, 1)
  scan(0, HEIGHT - 1, WIDTH, 1)
  scan(0, 0, 1, HEIGHT)
  scan(WIDTH - 1, 0, 1, HEIGHT)
  return worst
}

/**
 * Pixels of the catchlight.
 *
 * Near-white and opaque, which nothing else on her is: the body is #8ec8a8, the
 * ink #24463a and the cheeks #ef8f86, so the count needs no mask and cannot be
 * confused by a wide eye or a flushed cheek.
 */
function glintPixels(ctx: SKRSContext2D): number {
  const { data } = ctx.getImageData(0, 0, WIDTH, HEIGHT)
  let count = 0
  for (let i = 0; i < data.length; i += 4) {
    if ((data[i + 3] ?? 0) < 200) continue
    if ((data[i] ?? 0) > 235 && (data[i + 1] ?? 0) > 235 && (data[i + 2] ?? 0) > 235) count++
  }
  return count
}

/**
 * Ink BELOW a horizontal line, which is the mouth region and nothing else.
 *
 * A plain total cannot answer "is the mouth gone" — `sleepy` also narrows the
 * eyes, so a smaller count is ambiguous between the two. The eyes sit at 0.46
 * of her height and the mouth at 0.24, so a line between them separates the
 * question cleanly.
 */
function inkBelow(ctx: SKRSContext2D, y: number): number {
  const { data } = ctx.getImageData(0, y, WIDTH, HEIGHT - y)
  let count = 0
  for (let i = 0; i < data.length; i += 4) {
    if ((data[i + 3] ?? 0) > 200 && (data[i + 1] ?? 255) < 110) count++
  }
  return count
}

function inkPixels(ctx: SKRSContext2D, dpr: number): number {
  const { data } = ctx.getImageData(0, 0, WIDTH * dpr, HEIGHT * dpr)
  let count = 0
  // The ink is a dark green; the body is light. Counting dark opaque pixels
  // measures how much face is showing without depending on exact colours.
  for (let i = 0; i < data.length; i += 4) {
    if ((data[i + 3] ?? 0) > 200 && (data[i + 1] ?? 255) < 110) count++
  }
  return count
}

/** Her painted extent, and where her base landed. */
function paintedBox(
  ctx: SKRSContext2D,
  width: number,
  height: number,
): { width: number; bottom: number } {
  const { data } = ctx.getImageData(0, 0, width, height)
  let minX = width
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if ((data[(y * width + x) * 4 + 3] ?? 0) <= 128) continue
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }
  return { width: maxX - minX + 1, bottom: maxY + 1 }
}

/**
 * Where she is PAINTED and where the window says she is, as one number.
 *
 * The failure this pins, measured off a screenshot: the halo sat 241px above
 * her head, the speech bubble pointed at empty desktop, and her face was alone
 * in the middle of the window. Nothing had crashed. Her standing height is held
 * twice — here, and as `feet` in `face.ts` — and one update reached only this
 * copy, so `herBox()` measured a body at `pad.top` (26) while the rig drew one
 * at `FEET_FROM_TOP - bodyHeight` (267).
 *
 * The setter's silence is what made it absurd rather than obviously broken: a
 * refused value left the two describing different bodies and said nothing.
 */
describe('her standing height', () => {
  it('refuses a value that is not a length, and SAYS so', () => {
    const { avatar } = rig()
    const warned: unknown[] = []
    const before = console.warn
    console.warn = (...args: unknown[]) => warned.push(args[0])
    try {
      avatar.setFeet(Number.NaN)
      avatar.setFeet(0)
      avatar.setFeet(-40)
    } finally {
      console.warn = before
    }
    // Three refusals, three lines. A guard that returns quietly is a guard that
    // desynchronises two copies of a number with nothing anywhere to read.
    expect(warned).toHaveLength(3)
    for (const line of warned) expect(String(line)).toContain('standing height')
  })

  it('takes an ordinary one', () => {
    const { avatar } = rig()
    const warned: unknown[] = []
    const before = console.warn
    console.warn = (...args: unknown[]) => warned.push(args[0])
    try {
      avatar.setFeet(100)
    } finally {
      console.warn = before
    }
    expect(warned).toEqual([])
  })
})

describe('her drawn size follows the layout main sized the window from', () => {
  const draw = (percent: number, resizeTo?: number) => {
    const first = layoutFor(MOCHI, percent)
    const final = layoutFor(MOCHI, resizeTo ?? percent)
    const canvas = createCanvas(final.width, final.height)
    const ctx = canvas.getContext('2d')
    const avatar = new MochiAvatar(ctx as unknown as CanvasRenderingContext2D, {
      size: percent,
      random: () => 0.5,
    })
    avatar.resize(first.width, first.height, 1)
    if (resizeTo !== undefined) {
      // Exactly what main does: resize the window, then push the new size.
      avatar.setSizePercent(resizeTo)
      avatar.resize(final.width, final.height, 1)
    }
    // Idle off and neutral, so the spring is at rest and this measures her
    // resting body rather than a frame of the breath.
    avatar.setIdle(false)
    avatar.render(0)
    return { box: paintedBox(ctx, final.width, final.height), layout: final }
  }

  it.each([SIZE_PERCENT.min, 100, 150, SIZE_PERCENT.max])('draws her at %i%%', (percent) => {
    const { box, layout } = draw(percent)
    expect(box.width, 'painted width').toBeCloseTo(layout.bodyWidth, -0.4)
    expect(box.bottom, 'resting on the ground line').toBeCloseTo(
      layout.height * layout.ground,
      -0.4,
    )
  })

  it('follows a size change without being rebuilt', () => {
    // The failure this guards is NEW, and it is mine: the rig used to infer its
    // scale from the canvas, which self-corrected on any resize. Taking the
    // size as an explicit input is the right call -- the renderer should read
    // the same input main did, not re-derive main's rounded output -- but it
    // means a resize that does not deliver the new percentage draws her at the
    // old size inside the new window. Nothing else checks that the push
    // actually reaches the rig.
    const { box, layout } = draw(100, SIZE_PERCENT.max)
    expect(box.width).toBeCloseTo(layout.bodyWidth, -0.4)
    expect(box.width).toBeGreaterThan(layoutFor(MOCHI, 100).bodyWidth * 1.5)
  })
})

describe('MochiAvatar', () => {
  it('reports its kind and tells the truth about visemes', () => {
    const { avatar } = rig()
    expect(avatar.kind).toBe('mochi')
    // A `true` here would route callers down the precise lip-sync path to a
    // mouth driven by weights nothing currently sends.
    expect(avatar.caps.visemes).toBe(false)
    expect(avatar.caps.presetExpressions).toBe(true)
  })

  it('hitTest agrees with what was actually painted', () => {
    // The contract the whole click-through feature rests on. A backend that
    // reports hits on pixels it does not paint makes the window swallow clicks
    // over apparently empty desktop.
    const { ctx, avatar } = rig()
    avatar.render(0)

    let solidChecked = 0
    for (let deviceY = 2; deviceY < HEIGHT; deviceY += 4) {
      for (let deviceX = 2; deviceX < WIDTH; deviceX += 4) {
        const { alpha, x, y } = samplePixel(ctx, deviceX, deviceY, 1)
        const hit = avatar.hitTest(x, y)
        // Antialiasing makes the boundary a band rather than a line, so the
        // two directions are asserted at the ends where both are unambiguous.
        if (alpha > 250) {
          expect(hit, `painted pixel at ${x},${y} was not hittable`).toBe(true)
          solidChecked++
        }
        if (hit) expect(alpha, `hit at ${x},${y} over blank canvas`).toBeGreaterThan(0)
      }
    }
    expect(solidChecked).toBeGreaterThan(200)
  })

  it('hitTest stays correct at a device pixel ratio of 2', () => {
    // Path2D coordinates are untransformed until the path is used, so the
    // transform in force at isPointInPath decides the answer. Getting this
    // wrong offsets the clickable region by the pixel ratio — invisible on a
    // 1x display and broken on every Retina one.
    const { ctx, avatar } = rig(2)
    avatar.render(0)
    let checked = 0
    for (let deviceY = 4; deviceY < HEIGHT * 2; deviceY += 8) {
      for (let deviceX = 4; deviceX < WIDTH * 2; deviceX += 8) {
        const { alpha, x, y } = samplePixel(ctx, deviceX, deviceY, 2)
        if (alpha > 250) {
          expect(avatar.hitTest(x, y), `retina miss at ${x},${y}`).toBe(true)
          checked++
        }
      }
    }
    expect(checked).toBeGreaterThan(200)
  })

  it('does not claim hits before the first frame', () => {
    // Judgement not yet possible must let the click through, not swallow it.
    const { avatar } = rig()
    expect(avatar.hitTest(WIDTH / 2, HEIGHT * 0.8)).toBe(false)
  })

  it('stops claiming hits after dispose', () => {
    const { avatar } = rig()
    avatar.render(0)
    expect(avatar.hitTest(WIDTH / 2, HEIGHT * 0.8)).toBe(true)
    avatar.dispose()
    expect(avatar.hitTest(WIDTH / 2, HEIGHT * 0.8)).toBe(false)
  })

  it('dispose clears the frame and is idempotent', () => {
    const { ctx, avatar } = rig()
    avatar.render(0)
    avatar.dispose()
    avatar.dispose()

    // ONE assertion over the scan, not one per pixel.
    //
    // This ran `expect(data[i]).toBe(0)` inside the loop: 52,800 assertion
    // objects to establish a single property, which cost 1.6s of pure overhead
    // and pushed the test past vitest's 5s default under full-suite load. It
    // failed once in CI-like conditions and passed every time it was re-run
    // alone, which is the worst shape a test can have -- the colour depends on
    // how busy the machine is, so a real failure would be re-run and believed.
    //
    // The scan also reports WHERE, which the per-pixel version could not: its
    // message was "expected 255 to be 0" with no coordinate attached.
    const { data } = ctx.getImageData(0, 0, WIDTH, HEIGHT)
    let painted = 0
    let firstAt = -1
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] !== 0) {
        painted++
        if (firstAt < 0) firstAt = (i - 3) / 4
      }
    }
    const where =
      firstAt < 0 ? '' : ` first at (${firstAt % WIDTH}, ${Math.floor(firstAt / WIDTH)})`
    expect(painted, `${painted} pixels still opaque after dispose${where}`).toBe(0)
  })

  it('renders nothing before it has been given a size', () => {
    const canvas = createCanvas(WIDTH, HEIGHT)
    const ctx = canvas.getContext('2d')
    const avatar = new MochiAvatar(ctx as unknown as CanvasRenderingContext2D, {
      size: 'fit-canvas',
    })
    avatar.render(0)
    expect(avatar.hitTest(WIDTH / 2, HEIGHT / 2)).toBe(false)
  })

  it('opens the mouth when told to, and the mouth survives every expression', () => {
    // The layer rule: the mouth is written last and nothing above it may cover
    // it. Asserted against each emotion because that is exactly where a layer
    // ordering bug hides — a wide expression that happens to paint over the jaw.
    for (const emotion of EMOTIONS) {
      const shut = rig()
      shut.avatar.setEmotion({ emotion, intensity: 1 })
      shut.avatar.render(0)
      const closedInk = inkPixels(shut.ctx, 1)

      const open = rig()
      open.avatar.setEmotion({ emotion, intensity: 1 })
      open.avatar.setMouthOpen(1)
      open.avatar.render(0)
      expect(inkPixels(open.ctx, 1), `${emotion} swallowed the open mouth`).toBeGreaterThan(
        closedInk,
      )
    }
  })

  it('draws every emotion differently from neutral', () => {
    const frame = (emotion: (typeof EMOTIONS)[number]): number => {
      const { ctx, avatar } = rig()
      avatar.setEmotion({ emotion, intensity: 1 })
      avatar.render(0)
      return inkPixels(ctx, 1)
    }
    const neutral = frame('neutral')
    for (const emotion of EMOTIONS) {
      if (emotion === 'neutral') continue
      expect(frame(emotion), emotion).not.toBe(neutral)
    }
  })

  it('honours a hold set BEFORE the first frame', () => {
    // `now()` used to return `lastRenderMs ?? 0`, so a hold set during startup
    // was measured from zero -- and the first RAF timestamp is already far past
    // any plausible hold, so the emotion expired on the frame it first drew.
    const { ctx, avatar } = rig()
    avatar.setEmotion({ emotion: 'surprised', intensity: 1, holdMs: 500 })
    avatar.render(90_000)
    const held = inkPixels(ctx, 1)

    const control = rig()
    control.avatar.setEmotion({ emotion: 'surprised', intensity: 1 })
    control.avatar.render(90_000)
    // Still surprised, not decayed to neutral by a clock that started at zero.
    expect(held).toBe(inkPixels(control.ctx, 1))
  })

  it('honours a hold set while rendering was throttled', () => {
    // The same bug as the one above, at the other end of a session. Holds were
    // stamped `lastRenderMs + holdMs`, and requestAnimationFrame is throttled
    // to a crawl for a hidden window and stopped entirely for an unfocused one
    // on some platforms -- so an emotion set while she was off screen carried a
    // timestamp minutes old and expired on the first frame after she came back.
    // The reaction never appeared.
    const { ctx, avatar } = rig()
    avatar.render(1_000)
    // Nothing renders for a minute: the window was hidden.
    avatar.setEmotion({ emotion: 'surprised', intensity: 1, holdMs: 500 })
    avatar.render(61_000)
    const held = inkPixels(ctx, 1)

    const control = rig()
    control.avatar.render(1_000)
    control.avatar.setEmotion({ emotion: 'surprised', intensity: 1 })
    control.avatar.render(61_000)
    expect(held).toBe(inkPixels(control.ctx, 1))
  })

  it('does not blink on the very first frame', () => {
    /*
      idle.ts is explicit that seeding the blink schedule from zero puts the
      first blink in the past whenever startup outlasts the minimum gap. The
      layer was being constructed with 0 and only re-armed on a later toggle,
      so she blinked the instant she appeared.

      This used to compare against `setIdle(false)` and expect the pixel counts
      to be EQUAL. That stopped being a clean control when the idle layer grew
      a drift: idle-off now means no blink AND no drift, so the two frames
      differ by a couple of pixels of antialiasing whatever the eyes are doing.

      So the tolerance is calibrated rather than chosen — a blink's own effect
      on the ink is measured first, and the first frame has to be nowhere near
      it. `idle.test.ts` owns the layer-level property; this owns the rig
      remembering to seed it.
    */
    const seen: number[] = []
    const sampler = rig()
    for (let t = 0; t <= 12_000; t += 40) {
      sampler.avatar.render(600_000 + t)
      seen.push(inkPixels(sampler.ctx, 1))
    }
    const blinkDepth = Math.max(...seen) - Math.min(...seen)
    // A blink shuts both eyes, which are the darkest pixels she has, so it has
    // to move the count by a good deal more than a two-pixel shift does.
    expect(blinkDepth).toBeGreaterThan(20)

    const first = rig()
    first.avatar.render(600_000)
    const open = rig()
    open.avatar.setIdle(false)
    open.avatar.render(600_000)
    expect(Math.abs(inkPixels(first.ctx, 1) - inkPixels(open.ctx, 1))).toBeLessThan(blinkDepth / 3)
  })

  it('wears the sleepy pose while asleep, whatever face she was carrying', () => {
    /*
      `sleepy` is drawn for exactly one state, and for a while nothing wore it:
      rest shut the eyes and left the BODY in whatever look was current, so a
      sleeping mochi was an awake one with its eyes closed.

      Against a control that is asleep having chosen nothing, rather than
      against neutral-awake: the eyes are shut in both, so anything left over
      is the posture this is about.
    */
    const carrying = rig()
    carrying.avatar.setEmotion({ emotion: 'angry', intensity: 1 })
    carrying.avatar.setAsleep(true)
    carrying.avatar.render(0)

    const nothing = rig()
    nothing.avatar.setAsleep(true)
    nothing.avatar.render(0)

    // Asleep is a POSE and it outranks the slot `set_expression` writes to, so
    // these two are the same picture.
    expect(inkPixels(carrying.ctx, 1)).toBe(inkPixels(nothing.ctx, 1))

    // And it is genuinely the sleepy look rather than whatever was there: an
    // awake mochi carrying nothing draws differently.
    const awake = rig()
    awake.avatar.render(0)
    expect(inkPixels(nothing.ctx, 1)).not.toBe(inkPixels(awake.ctx, 1))
  })

  it('gives the face she chose back when she wakes', () => {
    /*
      The pose is RENDERED from `asleep`, never assigned to the emotion slot —
      so waking restores whatever was in that slot rather than having to guess
      which of the two put `sleepy` there.

      Two rigs through the identical frame sequence, differing only in the face
      they carried into sleep. Comparing one rig against its own earlier frame
      does not work here and the reason is worth keeping: the squash spring and
      the breath both carry state across frames, so the same look drawn at two
      timestamps is legitimately a pixel or two apart. Matched sequences hold
      those equal and leave only the thing being asked about.
    */
    const carrying = rig()
    carrying.avatar.setEmotion({ emotion: 'angry', intensity: 1 })
    const empty = rig()

    for (const one of [carrying, empty]) {
      one.avatar.render(0)
      one.avatar.setAsleep(true)
      one.avatar.render(16)
    }
    // Asleep they are the same picture — the pose outranks the slot.
    expect(inkPixels(carrying.ctx, 1)).toBe(inkPixels(empty.ctx, 1))

    for (const one of [carrying, empty]) {
      one.avatar.setAsleep(false)
      one.avatar.render(32)
    }
    // Awake they are not: `angry` survived the sleep rather than being cleared
    // by it. Clearing is `face.ts`'s job on the way DOWN, and it writes to the
    // slot; nothing here does.
    expect(inkPixels(carrying.ctx, 1)).not.toBe(inkPixels(empty.ctx, 1))
  })

  it('lets an emotion expire back to neutral', () => {
    const { ctx, avatar } = rig()
    avatar.render(0)
    avatar.setEmotion({ emotion: 'surprised', intensity: 1, holdMs: 100 })
    avatar.render(10)
    const held = inkPixels(ctx, 1)
    avatar.render(500)
    expect(inkPixels(ctx, 1)).not.toBe(held)
  })

  it('ignores a non-finite gaze rather than snapping to a corner', () => {
    // Against a control rather than against its own previous frame: idle
    // breathing changes the pixel count between any two instants, so comparing
    // successive frames of one rig measures the breath, not the gaze. Two rigs
    // on identical timelines isolate the only difference that matters — whether
    // the NaN was absorbed or acted on.
    const control = rig()
    const poisoned = rig()
    for (const each of [control, poisoned]) {
      each.avatar.setIdle(false)
      each.avatar.lookAt(0.8, 0.2)
      each.avatar.render(0)
    }
    poisoned.avatar.lookAt(Number.NaN, Number.NaN)
    control.avatar.render(16)
    poisoned.avatar.render(16)
    expect(inkPixels(poisoned.ctx, 1)).toBe(inkPixels(control.ctx, 1))
  })

  // 120s, and the number is not arbitrary. This paints 1104 frames (8 emotions
  // x 2 poke directions x a full breath sampled every 50ms) and reads the
  // border of each: measured at 1.4s with the file to itself, 7-8s inside a
  // full `pnpm verify`, and observed once at 35s on a loaded machine, which
  // tripped the 30s it used to carry.
  //
  // Raising it buys nothing false. The loop is bounded, pure CPU, and touches
  // no clock, socket or file, so it cannot hang -- a long run means the machine
  // was busy and nothing else. At 30s the only thing this timeout could report
  // was load, which is not a defect in the rig. The assertion below is the
  // signal; the border is either clean or it is not.
  it('never paints past the edge of the canvas, in any posture', { timeout: 120_000 }, () => {
    // The bug this pins: the fit was computed for her RESTING size and the
    // comment beside it claimed to leave room for the squash, which it did not.
    // Sleepy posture (0.19) at the top of a breath (+0.045) made her 145px wide
    // each side of centre in a 280px window, and the 5px that did not fit were
    // painted as two flat vertical edges down her sides.
    //
    // The border is swept rather than the arithmetic re-derived, because the
    // arithmetic is exactly what was wrong. Only the canvas can say whether the
    // fit and the deformation agree.
    for (const impulse of [-5, 5]) {
      for (const emotion of EMOTIONS) {
        const { ctx, avatar } = rig()
        avatar.setEmotion({ emotion, intensity: 1 })
        for (let t = 0; t <= BREATH_PERIOD_MS; t += 50) {
          // Re-poked so the impulse never decays away, and far past anything
          // the app asks for: `poke` is bounded by the rig rather than by its
          // callers, and a downloaded avatar picks the spring constants.
          if (t % 400 === 0) avatar.poke(impulse)
          avatar.render(t)
          expect(borderAlpha(ctx), `${emotion}, poke ${impulse}, t=${t}ms`).toBe(0)
        }
      }
    }
  })

  it('lights her eyes up when she is delighted, and not otherwise', () => {
    // The catchlight is a property of the EMOTION, which is the whole
    // of why it means anything -- a highlight painted unconditionally would be
    // a shading detail and would still pass a test that only looked for it on a
    // happy face. Both directions are asserted for that reason.
    const glint = (emotion: Emotion): number => {
      const { ctx, avatar } = rig()
      // No blink can land mid-assertion and half-close the eye it lives in.
      avatar.setIdle(false)
      avatar.setEmotion({ emotion, intensity: 1 })
      avatar.render(0)
      return glintPixels(ctx)
    }
    expect(glint('happy')).toBeGreaterThan(0)
    expect(glint('surprised')).toBeGreaterThan(0)
    expect(glint('neutral')).toBe(0)
    expect(glint('sleepy')).toBe(0)
    expect(glint('sad')).toBe(0)
  })

  it('takes the catchlight down with the lid', () => {
    // A highlight that stayed put through a blink would sit on her cheek for
    // the 130ms the eye is shut -- long enough to see, too short to catch in a
    // still, which is the worst combination a visual bug can have.
    const gap = nextBlinkGap(() => 0.5)
    const at = (now: number): number => {
      const { ctx, avatar } = rig()
      avatar.setEmotion({ emotion: 'surprised', intensity: 1 })
      avatar.render(0)
      avatar.render(now)
      return glintPixels(ctx)
    }
    const open = at(gap)
    // 0.35 of the duration is where `idle.ts` puts full closure.
    const shut = at(gap + BLINK_DURATION_MS * 0.35)
    expect(open).toBeGreaterThan(0)
    expect(shut).toBeLessThan(open * 0.5)
  })

  it('cannot paint the catchlight outside the eye, at any size', () => {
    // The containment claim, tested where it can actually fail: an `eyeGlint`
    // far larger than the eye. A user avatar chooses this number, and the
    // format deliberately does not bound it against the eye -- the clip is what
    // makes that safe, so the clip is what is asserted.
    //
    // Conservation is the measurement. White replaces ink exactly where the eye
    // was, so ink + glint can only ever be LESS than the ink alone (the eye's
    // antialiased rim blends to neither) -- unless the highlight escaped, in
    // which case it is more.
    const paint = (eyeGlint: number): { ink: number; glint: number } => {
      const canvas = createCanvas(WIDTH, HEIGHT)
      const ctx = canvas.getContext('2d')
      const avatar = new MochiAvatar(ctx as unknown as CanvasRenderingContext2D, {
        face: { ...MOCHI, eyeGlint },
        size: 'fit-canvas',
        random: () => 0.5,
      })
      avatar.resize(WIDTH, HEIGHT, 1)
      avatar.setIdle(false)
      avatar.setEmotion({ emotion: 'surprised', intensity: 1 })
      avatar.render(0)
      return { ink: inkPixels(ctx, 1), glint: glintPixels(ctx) }
    }
    const none = paint(0)
    const flooded = paint(FACE_BOUNDS.eyeGlint.max)
    expect(none.glint).toBe(0)
    expect(flooded.glint).toBeGreaterThan(0)
    expect(flooded.glint + flooded.ink).toBeLessThanOrEqual(none.ink)
  })

  it('takes her mouth away while she sleeps', () => {
    // A resting mochi is a shape with two closed eyes. Leaving the mouth on it
    // reads as awake-but-quiet rather than asleep.
    const mouthInk = (emotion: Emotion, mouthOpen: number): number => {
      const { ctx, avatar } = rig()
      avatar.setIdle(false)
      avatar.setEmotion({ emotion, intensity: 1 })
      avatar.setMouthOpen(mouthOpen)
      avatar.render(0)
      // Between the eyes (0.46 of her height) and the mouth (0.24).
      return inkBelow(ctx, 155)
    }
    expect(mouthInk('neutral', 0), 'awake and silent should still have a mouth').toBeGreaterThan(0)
    expect(mouthInk('sleepy', 0)).toBe(0)
  })

  it('opens her eyes the instant she makes a sound, even asleep', () => {
    /*
      She cannot talk with her eyes shut, and this is the property rather than
      the cause.

      `setAsleep` held `blink: 1` for the whole of the state, and there were
      live paths to her speaking inside it: `voice:config` handed back a
      greeting whenever the `speak_first` grant was on without consulting rest,
      and a session is re-opened every hour (§53) — each one a NEW session, so
      each one greeted. Nobody saw it because it happened to an empty room.

      Main no longer asks for a greeting while she rests, which is the cause.
      This is what makes the picture impossible for any path anybody adds later.

      Measured ABOVE the mouth line the two tests around this one use, so the
      mouth cannot be what moved the count.
    */
    const eyeInk = (speaking: boolean): number => {
      const { ctx, avatar } = rig()
      avatar.setIdle(false)
      avatar.setAsleep(true)
      avatar.setSpeaking(speaking)
      avatar.render(0)
      const { data } = ctx.getImageData(0, 0, WIDTH, 155)
      let count = 0
      for (let i = 0; i < data.length; i += 4) {
        if ((data[i + 3] ?? 0) > 200 && (data[i + 1] ?? 255) < 110) count++
      }
      return count
    }
    // A held blink is a hairline; open eyes are two whole shapes. The direction
    // is what matters, and it inverts if `setSpeaking` stops being consulted.
    expect(eyeInk(true)).toBeGreaterThan(eyeInk(false))
  })

  it('gives the mouth back the instant she makes a sound, even asleep', () => {
    // No layer above the mouth may overwrite it, because a
    // look that held her jaw shut while audio was playing would read as broken.
    // `sleepy` hiding the mouth is only safe because anything driving the mouth
    // outranks it — asleep-and-speaking is not supposed to happen, and "not
    // supposed to" is exactly the assumption that stops holding one refactor
    // later.
    const { ctx, avatar } = rig()
    avatar.setIdle(false)
    avatar.setEmotion({ emotion: 'sleepy', intensity: 1 })
    // The faintest sound there is.
    avatar.setMouthOpen(0.001)
    avatar.render(0)
    expect(inkBelow(ctx, 155)).toBeGreaterThan(0)
  })

  it('survives a frame gap of seconds without painting garbage', () => {
    // The squash spring integrates real time. A window that was backgrounded
    // for a minute must resume, not diverge.
    const { ctx, avatar } = rig()
    avatar.setEmotion({ emotion: 'happy', intensity: 1 })
    avatar.render(0)
    avatar.render(60_000)
    expect(inkPixels(ctx, 1)).toBeGreaterThan(0)
    expect(avatar.hitTest(WIDTH / 2, HEIGHT * 0.8)).toBe(true)
  })
})

describe('the clock and the cached silhouette', () => {
  it('drops a non-finite timestamp instead of letting it poison the clock', () => {
    // `lastRenderMs` used to take whatever it was handed. One NaN -- a clock
    // read that failed, a caller doing arithmetic on an undefined -- made every
    // later `dt` NaN for the rest of the session, with no way back.
    //
    // Asserted on her EYES, not on her body. The first version of this test
    // checked that she still painted and still answered a hit test, and it
    // passed against the bug: the body geometry does not depend on `dt` at all.
    // What the poison actually destroys is everything integrated over time --
    // `advanceGaze` computes `1 - exp(-NaN/120)`, the gaze goes NaN, and the
    // eyes are placed at NaN coordinates, so the canvas silently loses her
    // face while her outline looks perfectly healthy.
    const good = rig()
    const bad = rig()
    for (const r of [good, bad]) {
      r.avatar.setIdle(false)
      r.avatar.render(0)
    }
    bad.avatar.render(Number.NaN)
    bad.avatar.render(Number.POSITIVE_INFINITY)
    for (const r of [good, bad]) r.avatar.render(50)

    // Idle is off and the gaze target is the origin, so the two rigs have seen
    // the same time pass and must be pixel-identical. `0 * NaN` is NaN, so even
    // a gaze that is not moving is enough to lose the eyes.
    expect(inkPixels(good.ctx, 1)).toBeGreaterThan(0)
    expect(inkPixels(bad.ctx, 1)).toBe(inkPixels(good.ctx, 1))
  })

  it('fades a poke by elapsed time, not by frame count', () => {
    // The decay was `impulse *= 0.86` once per render, so how long a poke
    // lasted was a property of the DISPLAY: half as long on a 120Hz panel,
    // stretched out under throttling -- while the spring it feeds had been
    // integrating real seconds all along.
    //
    // Compared at equal elapsed time and unequal frame counts, using frames of
    // zero duration. That isolates the decay: `Spring.step` returns early on a
    // non-positive dt, so the extra renders move nothing else, and any
    // difference in the result belongs to the impulse alone. It also avoids
    // comparing two different frame rates through a semi-implicit integrator,
    // which under-integrates differently at each and would muddy the reading.
    const poked = (extraFrames: number): { width: number; bottom: number } => {
      const { ctx, avatar } = rig()
      avatar.setIdle(false)
      avatar.render(0)
      avatar.poke(-0.4)
      for (let i = 0; i < extraFrames; i++) avatar.render(0)
      avatar.render(16)
      return paintedBox(ctx, WIDTH, HEIGHT)
    }
    const straight = poked(0)
    const stalled = poked(20)
    expect(stalled.width).toBe(straight.width)
    expect(stalled.bottom).toBe(straight.bottom)

    // ...and the measurement is sensitive enough for that to mean something: a
    // poke of this size visibly changes her outline.
    const { ctx, avatar } = rig()
    avatar.setIdle(false)
    avatar.render(0)
    avatar.render(16)
    expect(paintedBox(ctx, WIDTH, HEIGHT).width).not.toBe(straight.width)
  })

  it('stops answering hit tests until the next frame after a resize', () => {
    // `setSizePercent` left the cached path alone, so a click arriving before
    // the next frame was answered from the shape she was last drawn as. Null is
    // the honest state: no hits, so the click reaches the desktop instead of
    // the wrong region of her.
    const canvas = createCanvas(WIDTH, HEIGHT)
    const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D
    const avatar = new MochiAvatar(ctx, { size: 100, random: () => 0.5 })
    avatar.resize(WIDTH, HEIGHT, 1)
    avatar.render(0)
    expect(avatar.hitTest(WIDTH / 2, HEIGHT * 0.8)).toBe(true)

    avatar.setSizePercent(60)
    expect(avatar.hitTest(WIDTH / 2, HEIGHT * 0.8)).toBe(false)
    avatar.render(16)
    expect(avatar.hitTest(WIDTH / 2, HEIGHT * 0.85)).toBe(true)
  })

  it('ignores a resize to the size it already is', () => {
    const canvas = createCanvas(WIDTH, HEIGHT)
    const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D
    const avatar = new MochiAvatar(ctx, { size: 100, random: () => 0.5 })
    avatar.resize(WIDTH, HEIGHT, 1)
    avatar.render(0)
    avatar.setSizePercent(100)
    expect(avatar.hitTest(WIDTH / 2, HEIGHT * 0.8)).toBe(true)
  })
})

describe('a motion that loops, and the only thing that ends it', () => {
  /**
   * Two rigs, rendered at the same timestamps, compared pixel for pixel.
   *
   * Measured this way rather than by her bounding box, which was the first
   * attempt and reported ZERO for a clip that is plainly moving: `sway` leans,
   * and a lean SHEARS the apex — the widest point of her body does not move, so
   * the box does not either. Everything else here is time-driven and both rigs
   * pin their randomness, so two frames at one timestamp differ only because of
   * the motion layer.
   */
  function differingPixels(a: SKRSContext2D, b: SKRSContext2D): number {
    const left = a.getImageData(0, 0, WIDTH, HEIGHT).data
    const right = b.getImageData(0, 0, WIDTH, HEIGHT).data
    let differ = 0
    for (let i = 0; i < left.length; i += 4) {
      if (left[i + 3] !== right[i + 3] || left[i] !== right[i]) differ += 1
    }
    return differ
  }

  /** One playing a clip, one never asked to. */
  function pair(): { moving: Rig; still: Rig; at: (ms: number) => number } {
    const moving = rig()
    const still = rig()
    return {
      moving,
      still,
      at(ms: number) {
        moving.avatar.render(ms)
        still.avatar.render(ms)
        return differingPixels(moving.ctx, still.ctx)
      },
    }
  }

  /**
   * A quarter through `sway`'s 3800ms cycle, which is its furthest lean.
   *
   * Measured from `LATCH` rather than from zero. `motionStartedAt` is taken on
   * the first frame AFTER `playMotion` — deliberately, so the first visible
   * frame is not already part-way in — so a clip measured from the call itself
   * reads as neutral, which is what the first version of this asserted against
   * and why it saw no movement at all.
   */
  const LATCH = 16
  const LEANING = LATCH + 950

  it('actually moves her, so the rest of this is measuring something', () => {
    const { moving, at } = pair()
    at(0)
    moving.avatar.playMotion('sway')
    at(LATCH)
    expect(at(LEANING)).toBeGreaterThan(0)
  })

  it('keeps playing for as long as nothing stops it', () => {
    // `sway` is `loop: true`, and `progress` wraps a looping clip forever
    // rather than returning null. So it does not end on its own — which is
    // fine, and is exactly why the caller needs a way to say when.
    const { moving, at } = pair()
    at(0)
    moving.avatar.playMotion('sway')
    at(LATCH)
    at(LEANING)
    expect(at(LEANING + 3800 * 8)).toBeGreaterThan(0)
  })

  /*
    TIMED EXPLICITLY, because the cost is real and the five-second default is
    not a property of anything.

    This renders about 190 frames on each of two rigs and compares the pixels
    every step — the loop runs to three full seconds of clock because springs
    carry her back rather than snapping, and stopping at the first zero would
    stop asserting that she STAYS there. It is deterministic and it is heavy,
    and it went red once under the parallel load of a full run rather than
    because anything moved.

    Same treatment `shipped-icons.test.ts` gives its per-asset case, and for the
    same reason: a slow test that is near the default is a red gate waiting for
    a busier machine.
  */
  it(
    'settles back to exactly what she would look like having never played it',
    { timeout: 30_000 },
    () => {
      // THE assertion `stopMotion` exists for. Without it the beat's sway played
      // from the first turn to the end of the session, and a state whose
      // animation outlives it has stopped meaning anything.
      const { moving, at } = pair()
      at(0)
      moving.avatar.playMotion('sway')
      at(LATCH)
      expect(at(LEANING)).toBeGreaterThan(0)

      moving.avatar.stopMotion()
      // Springs carry her back rather than snapping, so this is given time.
      let differ = -1
      for (let ms = LEANING + 16; ms <= LEANING + 3000; ms += 16) differ = at(ms)
      expect(differ).toBe(0)
    },
  )

  it('is safe to stop when nothing is playing', () => {
    const { avatar } = rig()
    expect(() => {
      avatar.stopMotion()
    }).not.toThrow()
  })
})

/**
 * The three channels that let her go somewhere.
 *
 * Everything here is measured against a CONTROL rendered at the same
 * timestamps with no motion playing, rather than against the same rig's earlier
 * frame: the breath and the squash spring both carry state, so one pose drawn
 * at two instants is legitimately a few pixels apart. Matched timelines hold
 * that equal and leave only the travel.
 */
describe('going somewhere', () => {
  /**
   * A WIDE rig, because travel needs somewhere to travel.
   *
   * `rig()` is square and `fit-canvas` fills it, so she has no horizontal slack
   * and any shift walks her into the edge — where her extent stops growing and
   * every assertion about having moved quietly stops discriminating. In the app
   * that room is reserved in the pad; here it has to be the canvas.
   */
  function wide(): Rig {
    const canvas = createCanvas(WIDE_W, HEIGHT)
    const ctx = canvas.getContext('2d')
    const avatar = new MochiAvatar(ctx as unknown as CanvasRenderingContext2D, {
      size: 'fit-canvas',
      random: () => 0.5,
    })
    avatar.resize(WIDE_W, HEIGHT, 1)
    return { canvas, ctx, avatar }
  }

  /** Her full painted extent, which `paintedBox` does not give. */
  function extent(
    ctx: SKRSContext2D,
  ): { left: number; right: number; top: number; bottom: number } | null {
    const { data } = ctx.getImageData(0, 0, WIDE_W, HEIGHT)
    let left = WIDE_W
    let right = -1
    let top = HEIGHT
    let bottom = -1
    for (let y = 0; y < HEIGHT; y++) {
      for (let x = 0; x < WIDE_W; x++) {
        if ((data[(y * WIDE_W + x) * 4 + 3] ?? 0) <= 128) continue
        left = Math.min(left, x)
        right = Math.max(right, x)
        top = Math.min(top, y)
        bottom = Math.max(bottom, y)
      }
    }
    return right < 0 ? null : { left, right, top, bottom }
  }

  /** Where her ink sits horizontally, which is what a turn moves. */
  function inkCentroidX(ctx: SKRSContext2D): number {
    const { data } = ctx.getImageData(0, 0, WIDE_W, HEIGHT)
    let sum = 0
    let n = 0
    for (let y = 0; y < HEIGHT; y++) {
      for (let x = 0; x < WIDE_W; x++) {
        const i = (y * WIDE_W + x) * 4
        if ((data[i + 3] ?? 0) > 200 && (data[i + 1] ?? 255) < 110) {
          sum += x
          n += 1
        }
      }
    }
    return n === 0 ? 0 : sum / n
  }

  /**
   * Play `name` and render it at a FRACTION of its own duration.
   *
   * A fraction rather than a millisecond count, because retuning a clip is
   * ordinary and three tests silently reading past the end of one is not: when
   * `turn` went from 1500ms to 950 these all rendered a finished clip and
   * asserted against its resting pose.
   */
  function at(name: string, fraction: number): { moved: Rig; still: Rig } {
    const ms = fraction * (BUILT_IN_MOTIONS[name]?.durationMs ?? 0)
    const moved = wide()
    moved.avatar.playMotion(name)
    moved.avatar.render(0)
    moved.avatar.render(ms)

    const still = wide()
    still.avatar.render(0)
    still.avatar.render(ms)
    return { moved, still }
  }

  /**
   * Where her BASE is, horizontally — the discriminator between the two ways
   * her edges can move.
   *
   * A `lean` shears her: the top travels and the base stays put. A `shift`
   * moves the whole body, base included. The first draft of the test below
   * measured her overall extent, and it passed with the translation deleted —
   * `swing` carries a lean as well, and the lean alone moved the edges. So the
   * assertion has to look at the one place a lean cannot reach.
   */
  function baseLeft(ctx: SKRSContext2D, bottom: number): number {
    const { data } = ctx.getImageData(0, 0, WIDE_W, HEIGHT)
    let left = WIDE_W
    for (let y = Math.max(0, bottom - 3); y <= bottom; y++) {
      for (let x = 0; x < WIDE_W; x++) {
        if ((data[(y * WIDE_W + x) * 4 + 3] ?? 0) > 128) {
          left = Math.min(left, x)
          break
        }
      }
    }
    return left
  }

  it('carries her sideways on `shift`, base and all', () => {
    /*
      `swing`, not `wander`, and the reason is the harness rather than the code:
      `rig()` builds her `fit-canvas`, so she FILLS a 240px canvas and
      `wander`'s 0.42 body widths walk her off the edge of it. In the app that
      room is reserved in the pad; here there is none to reserve.
    */
    const { moved, still } = at('swing', 0.25)
    const a = extent(moved.ctx)
    const b = extent(still.ctx)
    if (a === null || b === null) throw new Error('nothing painted')

    // The BASE, which a lean cannot move. This is what fails if the translation
    // is removed; her overall extent does not, because the lean moves that too.
    expect(baseLeft(moved.ctx, a.bottom)).toBeGreaterThan(baseLeft(still.ctx, b.bottom))
    // She travelled; she did not stretch. An offset applied to one edge and not
    // the other would widen her instead of moving her.
    expect(a.right - a.left).toBeCloseTo(b.right - b.left, -1)
  })

  it('takes her off the ground on `lift`', () => {
    // `hop` is at its apex around t = 0.44.
    const { moved, still } = at('hop', 0.44)
    const a = extent(moved.ctx)
    const b = extent(still.ctx)
    if (a === null || b === null) throw new Error('nothing painted')
    // Up is a SMALLER y. Both edges, or she is being squashed rather than
    // lifted -- and `hop` uses squash too, so only the pair proves travel.
    expect(a.bottom).toBeLessThan(b.bottom)
    expect(a.top).toBeLessThan(b.top)
  })

  it('takes the hit test with her, so clicks follow the pixels', () => {
    /*
      The promise the class makes is that only what you can see takes the
      mouse. Translation applied per-drawing-call rather than to the origin
      would move her pixels and leave the silhouette behind, and then there are
      visible pixels that `hitTest` calls empty desktop -- the click lands on
      whatever is behind her, and nothing looks wrong.
    */
    const { moved, still } = at('wander', 0.38)
    const a = extent(moved.ctx)
    const b = extent(still.ctx)
    if (a === null || b === null) throw new Error('nothing painted')

    /*
      A point on the row it is measured on, not on her overall extent.

      `a.right` is the widest she gets ANYWHERE, and she is a dome — at her
      vertical centre she is narrower than at her shoulders. Sampling the
      overall right edge at the middle row therefore asks about a pixel outside
      her, and the test failed for a reason that had nothing to do with
      translation.
    */
    const y = Math.round(a.bottom - (a.bottom - a.top) * 0.25)
    const rightAt = (ctx: SKRSContext2D): number => {
      const { data } = ctx.getImageData(0, y, WIDE_W, 1)
      for (let x = WIDE_W - 1; x >= 0; x -= 1) if ((data[x * 4 + 3] ?? 0) > 128) return x
      return -1
    }
    const x = rightAt(moved.ctx) - 2
    // She really did move on this row, or the assertion below proves nothing.
    expect(rightAt(still.ctx)).toBeLessThan(x)
    expect(still.avatar.hitTest(x, y), 'the control should be empty there').toBe(false)
    expect(moved.avatar.hitTest(x, y), 'she is painted there now').toBe(true)
  })

  it('slides her features on `turn` without moving her outline', () => {
    // Not a rotation and it cannot become one: there is one silhouette. What
    // turns is what is drawn ON her, and the clip to the outline is what makes
    // the far side pass out of sight rather than stick out.
    const { moved, still } = at('turn', 0.82)
    const a = extent(moved.ctx)
    const b = extent(still.ctx)
    if (a === null || b === null) throw new Error('nothing painted')
    /*
      Read at `t = 0.82`, where the clip's `lean` and `gazeX` are back to ZERO
      and the turn is not — her face trails her body coming back. That instant
      exists so this channel can be measured alone: at any other point the clip
      moves three things at once, and an earlier draft of this test passed with
      the turn deleted because the lean was moving the pixels by itself.

      So the outline is not merely close, it is IDENTICAL. Turning is something
      that happens to what is drawn on her, never to her shape.
    */
    expect(a.left).toBe(b.left)
    expect(a.right).toBe(b.right)
    expect(a.top).toBe(b.top)
    expect(a.bottom).toBe(b.bottom)
    /*
      And the features DID move — measured by where the ink is, not how much of
      it there is.

      `inkPixels` counts; it does not locate. Sliding a face across a body
      preserves the count exactly, so counting reported "no change" for a turn
      that had plainly happened. The centroid is the measure that matches the
      claim.
    */
    expect(inkCentroidX(moved.ctx)).toBeGreaterThan(inkCentroidX(still.ctx) + 1)
  })
})
