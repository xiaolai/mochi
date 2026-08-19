/**
 * The mochi, drawn.
 *
 * This is the composition root for the rig: it owns time and state, and defers
 * every shape to the pure modules beside it. The layer order is the one the
 * architecture fixes -- idle, then expression, then the mouth, always last.
 * Nothing above the mouth may write to it, because a gesture that holds her
 * jaw shut while audio is still playing reads as broken rather than as angry.
 *
 * The silhouette is kept as a Path2D and used for BOTH filling and hit testing,
 * so "only what you can see takes the mouse" is true by construction rather
 * than by two pieces of geometry agreeing. Everything drawn is clipped to it.
 */

import {
  clamp01,
  type AvatarBackend,
  type AvatarBackendCaps,
  type AvatarKind,
  type EmotionSignal,
  type MonotonicMs,
  type VisemeWeights,
} from '@shared/avatar'
import { MOCHI, type FaceSpec } from '@shared/avatar-spec'
import {
  BREATHING_UNITS,
  FEET_FROM_TOP,
  SQUASH_LIMIT,
  feetY,
  fitToCanvas,
  layoutFor,
} from '@shared/avatar-layout'
import { IdleLayer } from './idle'
import { blendLook, type Look } from './looks'
import { BUILT_IN_MOTIONS, poseAt, progress, type MotionClip, type MotionPose } from './motion'
import { Spring } from './spring'
import { paintCheeks, paintEyes, paintMouth } from './face'
import { toPath } from './paths'
import { domeOutline, placeFeature, squashed, type BodyShape, type Point } from './geometry'

const NEUTRAL_SIGNAL: EmotionSignal = { emotion: 'neutral', intensity: 0 }

/** How fast the gaze follows the cursor. A hard snap reads as a machine. */
const GAZE_TIME_CONSTANT_MS = 120

/**
 * How fast a poke fades, per SECOND.
 *
 * Per second rather than per frame. The old `impulse *= 0.86` made the length
 * of a poke a property of the display: the same tap lasted twice as long on a
 * 120Hz panel and stretched out again whenever the tab was throttled, while the
 * spring and the gaze beside it were already time-based. The value is the exact
 * continuous equivalent of that per-frame constant at 60Hz -- `0.86^60`, so at
 * the rate it was tuned on she decays as she always did.
 */
const IMPULSE_DECAY_PER_S = -Math.log(0.86) * 60

export interface MochiOptions {
  readonly face?: FaceSpec
  /**
   * Her size: a percentage of the base scale, or "fill the canvas".
   *
   * REQUIRED, and a union rather than an optional number, because the two
   * cases are a real choice and defaulting silently picked the wrong one. The
   * companion window forgot to pass a percentage and fell through to the
   * canvas fit -- which LOOKED right, because main had sized that canvas from
   * the layout, so the renderer was re-deriving main's answer from main's
   * output instead of computing the same answer from the same input. They
   * agreed to within a rounding error rather than by construction. Making this
   * mandatory turns that omission into a compile error.
   *
   * `'fit-canvas'` is for the tuner, which lays out a grid of cells and cannot
   * be told how big to be.
   */
  readonly size: number | 'fit-canvas'
  /** Injected so a test can pin the blink schedule. */
  readonly random?: () => number
}

export class MochiAvatar implements AvatarBackend {
  readonly kind: AvatarKind = 'mochi'
  readonly caps: AvatarBackendCaps = {
    presetExpressions: true,
    customExpressions: false,
    licenseMetadata: false,
    supportsPhysics: false,
    // TRUE now, because there is a library: `BUILT_IN_MOTIONS`. It was false
    // while `playMotion` was a no-op, which is the honest pairing -- a flag
    // claiming a capability with nothing behind it makes every call report
    // success over a face that does not move. `playMotion` says so out loud
    // for a name it does not have, which is the check that survives.
    supportsMotions: true,
    // The lens primitive could distinguish five vowels, but nothing emits
    // phoneme timings yet -- the cloud speech-to-speech path carries none. A
    // `true` here would route callers down the precise path to a mouth driven
    // by weights nobody sends, which is worse than the honest envelope.
    visemes: false,
  }

  private face: FaceSpec
  private sizePercent: number | 'fit-canvas'
  private readonly idleLayer: IdleLayer
  private readonly squashSpring = new Spring(0)
  /** The clip playing, and when it began. Null start = begins on the next frame. */
  private motion: MotionClip | null = null
  private motionStartedAt: MonotonicMs | null = null

  private cssWidth = 0
  private cssHeight = 0
  /** How far into the canvas she stands. See `setFeet`. */
  private feetFromTop = FEET_FROM_TOP
  private pixelRatio = 1
  private disposed = false

  private mouthOpen = 0
  private idle = true
  private emotion: EmotionSignal = NEUTRAL_SIGNAL
  private emotionExpiresAt: number | null = null
  /** A hold requested before the first frame, when there was no clock to add it to. */
  private pendingHoldMs: number | null = null
  /** When the blink schedule was last armed against a real timestamp. */
  private idleSeededAt: MonotonicMs | null = null
  private impulse = 0

  private gaze = { x: 0, y: 0 }
  private gazeTarget = { x: 0, y: 0 }
  private lastRenderMs: MonotonicMs | null = null

  /** This frame's outline. Filled and hit-tested, so the two cannot disagree. */
  private silhouette: Path2D | null = null

  constructor(
    private readonly ctx: CanvasRenderingContext2D,
    options: MochiOptions,
  ) {
    this.face = options.face ?? MOCHI
    this.sizePercent = options.size
    this.idleLayer = new IdleLayer(0, options.random)
  }

  /**
   * Tell the rig how big it is, in CSS pixels.
   *
   * Explicit rather than read from the canvas element, because the backend has
   * no element -- it has a context. That is what lets the same class render in
   * the browser, in the tuner, and in a test against a headless rasteriser.
   */
  resize(cssWidth: number, cssHeight: number, pixelRatio = 1): void {
    // FINITE, not merely non-negative. `Math.max(0, NaN)` is `NaN` and
    // `Math.max(0, Infinity)` is `Infinity`, and `Infinity > 0` passes the ratio
    // check -- so all three fields could hold a value that is not a length, and
    // `lookAt` a few lines below already refuses exactly that. This is the same
    // rule applied to the geometry.
    //
    // UNTESTED, deliberately, and worth saying so. Against `@napi-rs/canvas` a
    // NaN or Infinity size is indistinguishable from the guarded behaviour:
    // both draw nothing, both report no hit, and both recover completely on the
    // next good resize. Chromium may well differ -- these values reach a real
    // `setTransform` there -- but no test here can tell the two apart, so
    // nothing pins this and a test asserting otherwise would be theatre.
    this.cssWidth = finiteOrZero(cssWidth)
    this.cssHeight = finiteOrZero(cssHeight)
    this.pixelRatio = Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1
    // Stale geometry would keep reporting hits on a shape no longer drawn.
    this.silhouette = null
  }

  /**
   * Resize her without rebuilding the rig.
   *
   * A setter because the window can be resized while she is awake and mid
   * sentence; recreating the backend would drop the session's mouth state and
   * restart the blink schedule.
   */
  /**
   * How far into the canvas she stands.
   *
   * Set by main during a drag: against the top of the display the window can
   * rise no further, so she rises inside it instead. See `dragTo`.
   */
  setFeet(feetFromTop: number): void {
    if (!Number.isFinite(feetFromTop) || feetFromTop <= 0) return
    this.feetFromTop = feetFromTop
  }

  setSizePercent(percent: number | 'fit-canvas'): void {
    if (percent === this.sizePercent) return
    this.sizePercent = percent
    // The same reason `resize()` clears it: the cached path is the shape she was
    // last PAINTED as, and between this call and the next frame it describes a
    // body of the previous size. A click in the gap would be answered from
    // geometry nothing is drawing. Null means "no hits until the next render",
    // which sends the click to the desktop rather than to the wrong place.
    this.silhouette = null
  }

  /**
   * Recolour her, or reshape her, without rebuilding the rig.
   *
   * The same argument as `setSizePercent`: the window can be open and mid
   * sentence when a theme changes, and recreating the backend would drop the
   * session's mouth state and restart the blink schedule. The silhouette is
   * dropped because a face carries geometry as well as colour — a themed face
   * changes only the palette today, but nothing in this signature promises
   * that, and a cached hit region from the previous shape is exactly the bug
   * `setSizePercent` already had.
   */
  setFace(next: FaceSpec): void {
    this.face = next
    this.silhouette = null
  }

  setMouthOpen(value: number): void {
    this.mouthOpen = clamp01(value)
  }

  /** No-op, per caps.visemes === false. Explicitly does not fall back to driving
   * mouthOpen from the loudest vowel: a caller that sent visemes and saw the
   * mouth move would conclude the precise path works here. */
  setVisemes(_weights: VisemeWeights): void {}

  setEmotion(signal: EmotionSignal): void {
    this.emotion = { ...signal, intensity: clamp01(signal.intensity) }
    const hold = signal.holdMs
    const valid = typeof hold === 'number' && Number.isFinite(hold) && hold >= 0 ? hold : null

    if (valid === null) {
      this.emotionExpiresAt = null
      this.pendingHoldMs = null
      return
    }
    // ALWAYS deferred to the next frame, never measured from the last one.
    //
    // Before the first frame there is obviously no clock to add the hold to --
    // an earlier version added it to zero and the emotion expired on the very
    // first render, because a RAF timestamp is already well past any plausible
    // hold. But `lastRenderMs` is the wrong base at every other moment too:
    // rendering is driven by requestAnimationFrame, which the browser throttles
    // to a crawl for a hidden or occluded window, and stops entirely for an
    // unfocused one on some platforms. A 1400ms smile set while she was hidden
    // was therefore stamped with a timestamp seconds or minutes old, and
    // expired on the first frame after she came back -- the reaction the
    // lifecycle set it for never appeared.
    //
    // Deferring costs nothing: the next `render` resolves it against that
    // frame's own timestamp, which is the moment she is actually seen.
    this.pendingHoldMs = valid
    this.emotionExpiresAt = null
  }

  /**
   * Start a motion, or say nothing happened.
   *
   * An unknown name is reported rather than ignored: a motion that silently
   * does nothing is indistinguishable from one that played and was too subtle
   * to see, and the second is what somebody will assume.
   */
  playMotion(name: string): void {
    const clip = BUILT_IN_MOTIONS[name]
    if (clip === undefined) {
      console.warn(`[rig] no motion called ${JSON.stringify(name)}`)
      return
    }
    this.motion = clip
    this.motionStartedAt = null
  }

  lookAt(nx: number, ny: number): void {
    // Non-finite leaves the previous target alone. Coercing to 0 would snap her
    // gaze to a corner on one bad sample.
    if (!Number.isFinite(nx) || !Number.isFinite(ny)) return
    this.gazeTarget = { x: (clamp01(nx) - 0.5) * 2, y: (clamp01(ny) - 0.5) * 2 }
  }

  setIdle(on: boolean): void {
    if (on === this.idle) return
    this.idle = on
    // Re-armed at the next render rather than here, because here there may be
    // no clock yet -- and `idle.ts` is explicit that seeding the blink schedule
    // from zero puts the first blink in the past whenever startup took longer
    // than the minimum gap, so she blinks the instant she appears. Porting that
    // module while passing it a zero is exactly the mistake its comment warns
    // about.
    if (on) this.idleSeededAt = null
    else this.gazeTarget = { x: 0, y: 0 }
  }

  /** A squash impulse — a poke, or a reaction. The spring resolves it. */
  poke(amount = -0.3): void {
    if (Number.isFinite(amount)) this.impulse = amount
  }

  hitTest(x: number, y: number): boolean {
    if (this.disposed || this.silhouette === null) return false
    // The transform is restored first, because a Path2D carries no transform of
    // its own: it is transformed by whatever matrix is current when it is used.
    // Filling and hit testing must therefore agree on the matrix, or they are
    // asking about two different shapes.
    this.applyTransform()
    // Device pixels, NOT the CSS pixels this method is given.
    //
    // Measured, not assumed: `isPointInPath` treats its point as being in the
    // canvas coordinate space UNAFFECTED by the current transformation, while
    // the path itself IS transformed by it. Probed against a real rasteriser at
    // dpr 2 -- a point inside the path's own coordinates but outside its
    // painted footprint returns false, and one outside its coordinates but
    // inside the footprint returns true. So the answer tracks painted pixels,
    // which is exactly the contract, provided the point arrives in their space.
    //
    // The two readings coincide at dpr 1, so this is invisible on a non-Retina
    // display and shifts the whole clickable region by a factor of two on every
    // other. The dpr-2 test is what stops it coming back.
    const ratio = this.pixelRatio
    return this.ctx.isPointInPath(this.silhouette, x * ratio, y * ratio)
  }

  render(now: MonotonicMs): void {
    if (this.disposed || this.cssWidth === 0 || this.cssHeight === 0) return
    // A non-finite timestamp is DROPPED, and the last good one is kept.
    // Storing it poisoned the clock permanently: every later `dt` was NaN, the
    // gaze and the spring went to NaN with it, emotions stopped expiring
    // because `now >= expiresAt` is false against NaN, and nothing could bring
    // any of it back. One bad sample cost the rest of the session.
    if (!Number.isFinite(now)) return
    const dt = this.lastRenderMs === null ? 1 / 60 : Math.max(0, (now - this.lastRenderMs) / 1000)
    this.lastRenderMs = now

    // The first real timestamp is where anything deferred gets resolved. Both
    // of these were previously computed against zero, which is not a time.
    if (this.idle && this.idleSeededAt === null) {
      this.idleLayer.reset(now)
      this.idleSeededAt = now
    }
    if (this.pendingHoldMs !== null) {
      this.emotionExpiresAt = now + this.pendingHoldMs
      this.pendingHoldMs = null
    }

    if (this.emotionExpiresAt !== null && now >= this.emotionExpiresAt) {
      this.emotion = NEUTRAL_SIGNAL
      this.emotionExpiresAt = null
    }

    const look = blendLook(this.emotion.emotion, this.emotion.intensity)
    const pose = this.idle ? this.idleLayer.pose(now) : { blink: 0, breath: 0 }

    // Layer 2, motion. The layer order is the ORDER OF THESE LINES:
    // idle feeds the squash target below, motion adds to it, the expression
    // (`look`) is already in it, and the mouth is written last in `paint`.
    // A motion cannot reach the mouth because its vocabulary has no channel
    // for one -- see `MOTION_CHANNELS`.
    const moved = this.motionPose(now)

    // Layer 1, idle: breath feeds the same squash channel a poke does, so they
    // compose instead of fighting over the body scale.
    this.impulse *= Math.exp(-IMPULSE_DECAY_PER_S * dt)
    const target =
      look.squash + (moved.squash ?? 0) + pose.breath * this.face.breathAmp + this.impulse
    const settled = this.squashSpring.step(dt, target, {
      stiffness: this.face.stiffness,
      damping: this.face.damping,
    })
    const squash = Math.max(-SQUASH_LIMIT, Math.min(SQUASH_LIMIT, settled))
    // Snapped, not merely drawn clamped. Letting the spring run on past the
    // wall while only the painting is limited makes her STICK at the limit on
    // the way back, for however long the hidden position takes to unwind --
    // which looks like the animation hanging. `snap` also kills the velocity,
    // which is what hitting a wall does.
    if (squash !== settled) this.squashSpring.snap(squash)

    this.advanceGaze(dt, look, moved)
    this.paint(look, pose.blink, squash, moved)
  }

  /**
   * Where the playing clip is now, or nothing.
   *
   * The start is taken on the first frame AFTER `playMotion` rather than in
   * it: `performance.now()` at the moment of the call can be most of a frame
   * before the frame that draws it, so the first visible frame would already
   * be part-way in. Clearing the clip when it finishes is what stops a
   * one-shot holding its last pose forever.
   */
  private motionPose(now: MonotonicMs): MotionPose {
    if (this.motion === null) return {}
    this.motionStartedAt ??= now
    const at = progress(this.motion, now - this.motionStartedAt)
    if (at === null) {
      this.motion = null
      this.motionStartedAt = null
      return {}
    }
    return poseAt(this.motion, at)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    // Clear against the backing store rather than the cached CSS size: after a
    // resize to zero those are 0 while the backing store still holds the last
    // frame, which would reappear if the element became visible again.
    this.ctx.setTransform(1, 0, 0, 1, 0, 0)
    this.ctx.clearRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height)
    this.silhouette = null
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private applyTransform(): void {
    const r = this.pixelRatio
    this.ctx.setTransform(r, 0, 0, r, 0, 0)
  }

  private advanceGaze(dt: number, look: Look, moved: MotionPose): void {
    // Exponential follow from elapsed time, so gaze speed does not vary with
    // refresh rate.
    const alpha = 1 - Math.exp(-(dt * 1000) / GAZE_TIME_CONSTANT_MS)
    // ADDED to the cursor target, like the expression's own bias, rather than
    // replacing it: a motion that swept her gaze absolutely would make her
    // stop following the pointer for its duration, which reads as her having
    // frozen rather than as her having moved.
    const tx = this.gazeTarget.x + look.gazeX + (moved.gazeX ?? 0)
    const ty = this.gazeTarget.y + look.gazeY + (moved.gazeY ?? 0)
    this.gaze = {
      x: this.gaze.x + (tx - this.gaze.x) * alpha,
      y: this.gaze.y + (ty - this.gaze.y) * alpha,
    }
  }

  private paint(look: Look, blink: number, squash: number, moved: MotionPose): void {
    const { ctx, face } = this
    this.applyTransform()
    ctx.clearRect(0, 0, this.cssWidth, this.cssHeight)

    // Her size comes from the LAYOUT, not from a fraction of the canvas. Main
    // sized the window from the same call, so the two cannot disagree about how
    // big she is or where the ground is. `bodyW` and `bodyH` are FULL
    // dimensions; `BodyShape.halfWidth` is a half and `height` is a full,
    // because the shape rests on y = 0 rather than straddling it — mixing those
    // up put the rendered aspect ratio at 2:1 against the icon's 1.28.
    const size = this.sizePercent
    const layout = size === 'fit-canvas' ? null : layoutFor(face, size)
    const scale = layout?.scale ?? fitToCanvas(face, this.cssWidth, this.cssHeight)
    // Nothing to draw, and say so by drawing nothing. A non-positive scale
    // otherwise paints a sub-pixel speck and caches a silhouette around it,
    // which `hitTest` would then answer questions about.
    if (scale <= 0) {
      this.silhouette = null
      return
    }
    const originX = this.cssWidth / 2
    // Measured from the BOTTOM of the canvas she was actually given, so a canvas
    // that is not the size the layout asked for still rests her on a surface
    // rather than floating her.
    /**
     * Where she stands — from `feetY`, which the bubble's anchor also calls.
     *
     * This used to be a FRACTION of her layout height applied to the canvas,
     * while `face.ts` computed the same thing as an offset from the canvas
     * bottom. The two agree only when the canvas happens to be exactly her
     * layout's height, which it never is, so the tail pointed at a head that
     * was not quite there.
     *
     * `fit-canvas` keeps the old fraction: the tuner sizes its own cells and
     * wants her filling each one, not standing at a fixed height in it.
     */
    const originY =
      layout === null
        ? this.cssHeight * (1 - (BREATHING_UNITS * scale) / this.cssHeight)
        : feetY(this.cssHeight, BREATHING_UNITS * scale, this.feetFromTop)

    const base: BodyShape = {
      halfWidth: (face.bodyW / 2) * scale,
      height: face.bodyH * scale,
      waist: face.waist,
      upperShoulder: face.upperShoulder,
      lowerShoulder: face.lowerShoulder,
      // The motion layer adds to the expression's lean rather than replacing
      // it -- a shy tilt and a sway are both true at once.
      lean: look.lean + (moved.lean ?? 0),
    }
    const body = squashed(base, squash)

    // Local space is +y up with the base at 0; the canvas is +y down.
    const toCanvas = (p: Point): Point => ({ x: originX + p.x, y: originY - p.y })

    const outline = domeOutline(body).map(toCanvas)
    this.silhouette = toPath(outline)

    const place = (nx: number, ny: number): Point =>
      toCanvas(placeFeature(base, body, nx, ny, face.gripX, face.gripY))

    // EVERYTHING is clipped to the silhouette, not just the body.
    //
    // This is the promise the class makes: only what you can see takes the
    // mouse. A cheek gradient near the edge, or a wide eye on a squashed frame,
    // paints outside the outline if it is drawn unclipped -- and then there are
    // visible pixels that hitTest calls empty desktop, so the click lands on
    // whatever is behind her. Clipping once here makes that unrepresentable
    // rather than a rule each paint method has to remember.
    ctx.save()
    ctx.clip(this.silhouette)
    this.paintBody(outline, body, this.silhouette)
    // Layer 3, expression. Cheeks under the eyes, so a wide eye covers a cheek
    // rather than being crossed by one.
    paintCheeks(ctx, face, look, place, scale)
    paintEyes(ctx, face, look, blink, this.gaze, place, scale)
    // Layer 4, the mouth. LAST, unconditionally.
    paintMouth(ctx, face, look, this.mouthOpen, place, scale)
    ctx.restore()
  }

  /**
   * Shadow first, then the lit shape on top of it, displaced.
   *
   * Two flat fills and no gradient at all, which is what the artwork turned out
   * to be: its interior luminance is bimodal, 86% at 0.725 against 14% at
   * 0.675, with nothing between the two. So the band has a hard inner edge, and
   * the way to get a hard edge that follows the contour is to cover the shadow
   * with a copy of the SAME outline rather than to fade one colour into
   * another. The crescent the copy fails to cover is the band.
   *
   * Everything here is already clipped to the silhouette by the caller, so the
   * displaced copy cannot spill past her outline on the up-right side.
   */
  private paintBody(outline: readonly Point[], body: BodyShape, shape: Path2D): void {
    const { ctx, face } = this
    // The caller has already built this exact path for the silhouette, so the
    // shadow reuses it. Rebuilding it here traced ~200 points into a second
    // identical Path2D on every frame for no difference in output.
    ctx.fillStyle = face.colShadow
    ctx.fill(shape)

    const dx = face.shadowX * body.halfWidth * 2
    // Canvas y grows downward and the light comes from above, so the lit copy
    // moves toward smaller y.
    const dy = face.shadowY * body.height
    ctx.fillStyle = face.colBody
    ctx.fill(toPath(outline.map((point) => ({ x: point.x + dx, y: point.y - dy }))))
  }
}

/** A non-negative, finite length. Anything else is not a size. */
function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0
}
