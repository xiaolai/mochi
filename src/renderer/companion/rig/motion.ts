/**
 * A motion: the layer between idle and expression.
 *
 * ## Why this format exists now, having been refused twice
 *
 * The argument for not writing it was that a format designed against ONE
 * motion set comes out shaped like that set. That was right, and it made the
 * missing input sound external when it was not: the answer is to author a
 * second motion, not to wait for one. So there are two below, deliberately
 * unalike — `nod` is short, one-shot and postural; `sway` loops and moves her
 * gaze. Everything here is a thing both of them needed.
 *
 * What that shook out, which one clip would not have:
 *
 *   - `loop`, because one of them does and one must not
 *   - keys with OPTIONAL channels, because `nod` never touches gaze and a
 *     format forcing it to write zeros would make every clip claim every
 *     channel, and then "unset" and "zero" would be the same thing
 *   - normalised time, because the two differ in duration by 6x and keys
 *     written in milliseconds cannot be retimed without rewriting them all
 *
 * ## Four channels, and the mouth is not among them
 *
 * The layer order is idle -> motion -> expression -> mouth, and no layer may
 * overwrite the mouth. A motion that could write `mouthOpen` would be able to
 * hold her jaw shut while audio is playing, which reads as broken. The
 * channels here are POSTURAL -- squash, lean, and where she is looking -- so
 * the rule is a property of the vocabulary rather than something each clip has
 * to respect.
 */

/**
 * Everything a motion is allowed to move. See the header.
 *
 * ## The three that were added, and why they are not more
 *
 * `squash`, `lean`, `gazeX`, `gazeY` are postural and could not express a
 * character who goes anywhere: a hop with no vertical channel is a crouch, and
 * a wander with no horizontal one is a lean. So:
 *
 * - `lift` — up, in fractions of her body HEIGHT. Positive leaves the ground.
 * - `shift` — right, in fractions of her body WIDTH.
 * - `turn` — -1..1, how far her features have slid toward one side.
 *
 * `turn` is NOT a rotation and cannot become one. One front-facing silhouette
 * is drawn; there is no second view and no yaw. What it does is slide the
 * features across the body, and everything is clipped to the silhouette
 * already, so the far eye passes out of sight around her edge. That reads as
 * turning to look at something and does not read as turning around. Anyone
 * wanting the second thing has to draw her from behind, which is art rather
 * than a channel.
 *
 * The mouth is still not among these, for the reason the header gives.
 *
 * ## Translation is a channel, not a window move
 *
 * `lift` and `shift` move her INSIDE her own window, and `paint` applies them
 * by offsetting the origin every other coordinate is derived from -- so the
 * outline, the features and the hit-test silhouette all travel together, and
 * click-through keeps following her painted pixels for free.
 *
 * Moving the WINDOW was the alternative and is worse: `setPosition` from main
 * on every frame of a renderer-driven animation is two processes disagreeing
 * about where she is sixty times a second, which is the problem `drag.ts`
 * already needs a cursor poll to solve.
 */
export const MOTION_CHANNELS = [
  'squash',
  'lean',
  'gazeX',
  'gazeY',
  'lift',
  'shift',
  'turn',
] as const
export type MotionChannel = (typeof MOTION_CHANNELS)[number]

/** What the layer contributes at one instant. Absent means "not moved". */
export type MotionPose = Partial<Record<MotionChannel, number>>

export interface MotionKey extends MotionPose {
  /**
   * Where in the clip, 0..1.
   *
   * NORMALISED rather than milliseconds. The two built-ins differ in length by
   * six times, and a clip timed in absolute units cannot be slowed down
   * without rewriting every key in it.
   */
  readonly t: number
}

export interface MotionClip {
  readonly durationMs: number
  /** Whether it starts again. `sway` does; `nod` must not. */
  readonly loop: boolean
  /** Sorted by `t`, which `parseMotionClip` checks rather than assumes. */
  readonly keys: readonly MotionKey[]
}

/**
 * How far through a clip we are, or null once a one-shot has finished.
 *
 * Null rather than 1: a finished one-shot contributes NOTHING, and holding its
 * last key would leave her permanently leaning if a clip happened to end away
 * from neutral. The caller stops mixing the layer in at all.
 */
export function progress(clip: MotionClip, elapsedMs: number): number | null {
  if (elapsedMs < 0) return 0
  const raw = elapsedMs / clip.durationMs
  if (raw < 1) return raw
  return clip.loop ? raw % 1 : null
}

/**
 * The pose at a moment, interpolated between the keys around it.
 *
 * Per CHANNEL, not per key. A key that omits `gazeX` is not saying "zero", it
 * is saying nothing -- so the interpolation for that channel runs between the
 * nearest keys that DO mention it, and a channel no key mentions is absent
 * from the result. Blending toward an implied zero instead would make every
 * clip fight every other layer over channels it never meant to touch.
 */
export function poseAt(clip: MotionClip, at: number): MotionPose {
  const pose: MotionPose = {}
  for (const channel of MOTION_CHANNELS) {
    const value = channelAt(clip.keys, channel, at, clip.loop)
    if (value !== null) pose[channel] = value
  }
  return pose
}

function channelAt(
  keys: readonly MotionKey[],
  channel: MotionChannel,
  at: number,
  loop: boolean,
): number | null {
  const stated = keys.filter((key) => key[channel] !== undefined)
  if (stated.length === 0) return null

  const first = stated[0]
  const last = stated[stated.length - 1]
  if (first === undefined || last === undefined) return null
  // HELD outside the stated range rather than fading to zero. A clip that
  // mentions `lean` only in its second half is upright until then, not
  // drifting toward upright from somewhere unspecified.
  if (at <= first.t) return first[channel] ?? null
  if (at >= last.t) return last[channel] ?? null

  for (let i = 1; i < stated.length; i += 1) {
    const before = stated[i - 1]
    const after = stated[i]
    if (before === undefined || after === undefined || after.t < at) continue
    return hermite(stated, i, channel, at, loop)
  }
  return last[channel] ?? null
}

/**
 * A cubic through the keys, rather than a straight line between them.
 *
 * ## What linear interpolation actually looks like
 *
 * It was `a*(1-k) + b*k`, which is exact and correct and moves like a machine.
 * Every key is a VELOCITY DISCONTINUITY: she travels at a constant speed to the
 * key, changes speed instantaneously, and travels at another constant speed
 * away from it. Nothing physical does that, and the eye reads the corners
 * immediately -- reported, in as many words, as the motions being crude.
 *
 * This is Catmull-Rom, expressed as a Hermite with finite-difference tangents:
 * the speed at each key is estimated from its NEIGHBOURS, so velocity carries
 * through a key instead of restarting at it. The curve still passes exactly
 * through every authored value, which is what keeps a clip an authored thing
 * rather than a suggestion.
 *
 * ## Why not ease each segment instead
 *
 * A smoothstep per segment is one line and is wrong for half the library. It
 * forces velocity to ZERO at every key, so `sway` -- which crosses zero at its
 * midpoint on the way from one extreme to the other -- would stop dead in the
 * middle of a continuous lean. Easing is a property of a segment; smoothness is
 * a property of the curve, and the complaint was about the curve.
 *
 * ## Time is NON-UNIFORM, so the tangents are scaled by it
 *
 * Keys are placed where the motion needs them, not on a grid: `hop` has eight
 * keys with gaps from 0.12 to 0.16, and `wander` has eleven. The textbook
 * uniform Catmull-Rom assumes even spacing and produces a visible surge either
 * side of a short segment. Dividing each difference by the real time it spans
 * is what makes the curve independent of where the keys happen to sit.
 *
 * ## Loops wrap; one-shots do not
 *
 * A looping clip takes its neighbours from the other end, so the seam is as
 * smooth as everywhere else -- otherwise `sway` and `wander` would kink once
 * per cycle, forever, which is the defect the loop-closure check exists to
 * prevent in its cruder form. A one-shot uses a one-sided difference at its
 * ends, so it starts and finishes without being dragged by a key that is not
 * there.
 *
 * Overshoot between keys is possible and is deliberate: it is what gives a
 * landing its weight. `squashed` clamps the body scale, so the one channel
 * where an overshoot could be structural is already bounded.
 */
function hermite(
  stated: readonly MotionKey[],
  index: number,
  channel: MotionChannel,
  at: number,
  loop: boolean,
): number {
  const n = stated.length
  const value = (key: MotionKey | undefined): number => key?.[channel] ?? 0

  const p1 = stated[index - 1]
  const p2 = stated[index]
  if (p1 === undefined || p2 === undefined) return value(p2 ?? p1)

  const span = p2.t - p1.t
  if (span <= 0) return value(p2)

  /*
    The neighbour outside the segment, and how far away in time it is.

    For a loop that is the key at the other end, one period away — the first and
    last keys hold the same value (the closure check enforces it), so the wrap
    skips one of them to avoid a zero-length span that would make the tangent
    infinite.
  */
  const before =
    index >= 2
      ? { key: stated[index - 2], dt: p1.t - (stated[index - 2]?.t ?? 0) }
      : loop && n >= 3
        ? { key: stated[n - 2], dt: p1.t + (1 - (stated[n - 2]?.t ?? 1)) }
        : null
  const after =
    index + 1 < n
      ? { key: stated[index + 1], dt: (stated[index + 1]?.t ?? 1) - p2.t }
      : loop && n >= 3
        ? { key: stated[1], dt: 1 - p2.t + (stated[1]?.t ?? 0) }
        : null

  // Finite differences over real time. With no neighbour the difference is
  // one-sided, which is the segment's own slope — an end that neither
  // accelerates into nothing nor is pulled by a key that does not exist.
  const m1 =
    before === null || before.dt <= 0
      ? (value(p2) - value(p1)) / span
      : (value(p2) - value(before.key)) / (span + before.dt)
  const m2 =
    after === null || after.dt <= 0
      ? (value(p2) - value(p1)) / span
      : (value(after.key) - value(p1)) / (span + after.dt)

  const u = (at - p1.t) / span
  const uu = u * u
  const uuu = uu * u
  return (
    (2 * uuu - 3 * uu + 1) * value(p1) +
    (uuu - 2 * uu + u) * span * m1 +
    (-2 * uuu + 3 * uu) * value(p2) +
    (uuu - uu) * span * m2
  )
}

/**
 * A short agreement, and a long one that repeats.
 *
 * Two, and unalike on purpose -- see the header. They are also the only
 * motions this app has, which is why `caps.supportsMotions` can finally be
 * true: a backend claiming the capability with an empty library would be the
 * flag lying, and `playMotion` would report success over a face that never
 * moved.
 */
export const BUILT_IN_MOTIONS: Readonly<Record<string, MotionClip>> = {
  // Down, past centre, and settle. The overshoot is what makes it read as a
  // nod rather than as a lurch -- the same reason `spring.ts` is second order.
  nod: {
    durationMs: 620,
    loop: false,
    keys: [
      { t: 0, squash: 0, lean: 0 },
      { t: 0.28, squash: 0.1, lean: 0.05 },
      { t: 0.62, squash: -0.04, lean: -0.02 },
      { t: 1, squash: 0, lean: 0 },
    ],
  },
  // A slow lean with her gaze trailing it, repeating. Nothing about her body
  // returns to centre at the ends, because a looping clip whose first and last
  // keys differ jumps every cycle.
  sway: {
    durationMs: 3800,
    loop: true,
    keys: [
      { t: 0, lean: 0, gazeX: 0 },
      { t: 0.25, lean: 0.06, gazeX: 0.18 },
      { t: 0.5, lean: 0, gazeX: 0 },
      { t: 0.75, lean: -0.06, gazeX: -0.18 },
      { t: 1, lean: 0, gazeX: 0 },
    ],
  },

  /**
   * A small hop: crouch, launch, hang, land, settle.
   *
   * The ANTICIPATION is what makes it read as a jump rather than a twitch --
   * she compresses before she leaves the ground, and lands compressed again.
   * Squash and lift are deliberately out of phase: at the apex she is stretched
   * (negative squash) and highest, and the two return to zero at different
   * times so the landing has weight.
   *
   * `lift: 0.16` is about eleven pixels at her default size. Small on purpose
   * -- this is a gesture, not a jump, and the room for it has to be reserved in
   * her window before she can use it.
   */
  hop: {
    // Quick. A jump is over before you have finished noticing it started, and
    // 560ms of it read as her being hoisted rather than jumping.
    durationMs: 420,
    loop: false,
    keys: [
      { t: 0, squash: 0, lift: 0 },
      // The crouch is FAST and the launch is faster: most of the clip is air.
      { t: 0.14, squash: 0.17, lift: 0 },
      { t: 0.26, squash: -0.1, lift: 0.11 },
      { t: 0.44, squash: -0.04, lift: 0.22 },
      { t: 0.62, squash: 0.03, lift: 0.11 },
      { t: 0.72, squash: 0.15, lift: 0 },
      { t: 0.86, squash: -0.05, lift: 0 },
      { t: 1, squash: 0, lift: 0 },
    ],
  },

  /**
   * A pendulum: her body goes where it leans, repeating.
   *
   * The difference from `sway`, which is worth saying because they are easy to
   * confuse: `sway` moves her GAZE and leaves her body where it is, and reads
   * as attention wandering. This moves her body and leaves her gaze alone, and
   * reads as contentment. Lean and shift are IN PHASE -- a pendulum travels the
   * way it tilts, and putting them out of phase produces a body sliding out
   * from under its own head.
   */
  swing: {
    durationMs: 2200,
    loop: true,
    keys: [
      { t: 0, lean: 0, shift: 0 },
      { t: 0.25, lean: 0.095, shift: 0.17 },
      { t: 0.5, lean: 0, shift: 0 },
      { t: 0.75, lean: -0.095, shift: -0.17 },
      { t: 1, lean: 0, shift: 0 },
    ],
  },

  /**
   * Turning to look at something beside her, and coming back.
   *
   * Not a rotation -- see the note on `MOTION_CHANNELS`. The features slide
   * toward one edge and the silhouette clips the far one, which is what a flat
   * character turning looks like. The lean and the gaze go with it because a
   * head that turns without the body reads as a glance, and a glance is what
   * the gaze channel alone already does.
   *
   * One-shot, and it returns to zero: a turn that stayed turned would leave her
   * facing away for the rest of the session, and there is no view of her from
   * that angle to make it worth looking at.
   */
  turn: {
    // A head turn is quick and the RETURN is slower than the going, which is
    // what makes it read as looking at something rather than as scanning.
    durationMs: 950,
    loop: false,
    keys: [
      // Her face LEADS and TRAILS her body, which is how a head turn actually
      // goes: the features start moving before the shoulders commit, and they
      // are the last thing to come back. It also leaves a moment near the end
      // where the lean is exactly zero and the turn is not, which is the only
      // instant at which this channel can be measured on its own -- a clip
      // whose channels all move together can only ever be tested as a whole.
      { t: 0, turn: 0, lean: 0, gazeX: 0 },
      { t: 0.12, turn: 0.4, lean: 0.02, gazeX: 0.16 },
      { t: 0.26, turn: 0.72, lean: 0.06, gazeX: 0.34 },
      { t: 0.58, turn: 0.7, lean: 0.07, gazeX: 0.36 },
      { t: 0.82, turn: 0.42, lean: 0, gazeX: 0 },
      { t: 1, turn: 0, lean: 0, gazeX: 0 },
    ],
  },

  /**
   * Wandering: a slow drift one way, a pause, and back.
   *
   * LONG and slow on purpose. Everything else in this app is built so she can
   * be ignored -- click-through by default, a halo rather than a spinner -- and
   * a companion who crosses your screen quickly is one you have to attend to.
   * Eleven seconds for less than half a body width each way is movement you
   * notice only if you look.
   *
   * The bob is on `lift` at twice the drift's frequency, so her step and her
   * travel are not the same beat. Both return to zero at `t: 1`, which the
   * loop-closure check enforces for every channel rather than for the one the
   * author was thinking about.
   *
   * She leans INTO the direction of travel at the start of each leg and out of
   * it at the end, which is what a body does when it starts and stops.
   */
  wander: {
    durationMs: 7_200,
    loop: true,
    keys: [
      { t: 0, shift: 0, lean: 0, lift: 0 },
      { t: 0.1, shift: 0.14, lean: 0.05, lift: 0.025 },
      { t: 0.2, shift: 0.3, lean: 0.03, lift: 0 },
      { t: 0.3, shift: 0.4, lean: -0.03, lift: 0.025 },
      { t: 0.38, shift: 0.42, lean: 0, lift: 0 },
      { t: 0.5, shift: 0.34, lean: -0.05, lift: 0.025 },
      { t: 0.62, shift: 0, lean: -0.05, lift: 0 },
      { t: 0.74, shift: -0.3, lean: -0.03, lift: 0.025 },
      { t: 0.84, shift: -0.36, lean: 0.04, lift: 0 },
      { t: 0.94, shift: -0.14, lean: 0.05, lift: 0.02 },
      { t: 1, shift: 0, lean: 0, lift: 0 },
    ],
  },
}

/**
 * How far a clip takes her from where she stands, as fractions of her body.
 *
 * The room for a translation has to exist in her window BEFORE she uses it, or
 * she walks into the edge of a transparent rectangle and is clipped by it. This
 * is what `face.ts` reserves against, and it is derived from the keys rather
 * than declared beside them: a number an author has to keep in step with the
 * clip is a number that goes stale the first time somebody retimes it.
 *
 * `up` only, for `lift`. She hops; she does not sink through the floor, and
 * reserving room below her would push her down inside her own window for a
 * clearance nothing uses.
 */
export function motionReach(clip: MotionClip): { readonly x: number; readonly up: number } {
  let x = 0
  let up = 0
  for (const key of clip.keys) {
    x = Math.max(x, Math.abs(key.shift ?? 0))
    up = Math.max(up, key.lift ?? 0)
  }
  return { x, up }
}

/** The worst case across every built-in, which is what a window has to hold. */
export function builtInReach(): { readonly x: number; readonly up: number } {
  let x = 0
  let up = 0
  for (const clip of Object.values(BUILT_IN_MOTIONS)) {
    const reach = motionReach(clip)
    x = Math.max(x, reach.x)
    up = Math.max(up, reach.up)
  }
  return { x, up }
}

export type MotionParse =
  | { readonly ok: true; readonly clip: MotionClip }
  | { readonly ok: false; readonly problems: readonly string[] }

/**
 * Turn something off disk into a clip, or say what is wrong with all of it.
 *
 * A package may carry motions, so this is a trust boundary and takes the same
 * treatment `parseFaceSpec` gets: every problem reported at once
 * rather than the first, unknown keys refused rather than dropped, and every
 * number range-checked -- `t: 5` and `squash: 400` are both valid JSON numbers
 * that throw nothing and produce a mochi somewhere off the screen.
 *
 * The ordering and loop-closure rules are checked HERE rather than trusted,
 * because `poseAt` is written against them: keys out of order make the
 * interpolation pick the wrong pair, and a loop whose ends differ jumps once
 * per cycle for as long as it plays.
 */
export function parseMotionClip(value: unknown): MotionParse {
  const problems: string[] = []
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, problems: ['a motion must be a JSON object'] }
  }
  const source = value as Record<string, unknown>

  const durationMs = source['durationMs']
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs <= 0) {
    problems.push('durationMs must be a positive number of milliseconds')
  }
  const loop = source['loop']
  if (typeof loop !== 'boolean') problems.push('loop must be true or false')

  for (const key of Object.keys(source)) {
    if (!['durationMs', 'loop', 'keys'].includes(key)) {
      problems.push(`${key} is not a field of a motion`)
    }
  }

  const rawKeys = source['keys']
  if (!Array.isArray(rawKeys)) {
    problems.push('keys must be a list')
    return { ok: false, problems }
  }
  // TWO, not one. A single key is a pose rather than a motion, and it would
  // interpolate against nothing -- which reads as the clip having failed.
  if (rawKeys.length < 2) problems.push('a motion needs at least two keys')

  const keys: MotionKey[] = []
  for (const [index, raw] of rawKeys.entries()) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      problems.push(`keys[${String(index)}] must be an object`)
      continue
    }
    const entry = raw as Record<string, unknown>
    const t = entry['t']
    if (typeof t !== 'number' || !Number.isFinite(t) || t < 0 || t > 1) {
      problems.push(`keys[${String(index)}].t must be between 0 and 1`)
      continue
    }
    const key: Record<string, number> = { t }
    for (const [name, channelValue] of Object.entries(entry)) {
      if (name === 't') continue
      if (!(MOTION_CHANNELS as readonly string[]).includes(name)) {
        // Refused, not dropped: `squahs` silently ignored shows its author a
        // motion that plays and does nothing they asked for.
        problems.push(`keys[${String(index)}].${name} is not a channel a motion may move`)
        continue
      }
      if (typeof channelValue !== 'number' || !Number.isFinite(channelValue)) {
        problems.push(`keys[${String(index)}].${name} must be a finite number`)
        continue
      }
      if (channelValue < -1 || channelValue > 1) {
        // Bounded because these feed body scale and gaze. 400 is a legal
        // number that draws a mochi nobody can see.
        problems.push(`keys[${String(index)}].${name} must be between -1 and 1`)
        continue
      }
      key[name] = channelValue
    }
    keys.push(key as unknown as MotionKey)
  }

  for (let i = 1; i < keys.length; i += 1) {
    if ((keys[i]?.t ?? 0) < (keys[i - 1]?.t ?? 0)) {
      problems.push('keys must be in order of t')
      break
    }
  }

  if (loop === true && keys.length >= 2) {
    const first = keys[0]
    const last = keys[keys.length - 1]
    if (first !== undefined && last !== undefined) {
      for (const channel of MOTION_CHANNELS) {
        if ((first[channel] ?? 0) !== (last[channel] ?? 0)) {
          // A looping clip whose ends differ jumps once per cycle, forever.
          problems.push(`a looping motion must end where it began (${channel} differs)`)
        }
      }
    }
  }

  if (problems.length > 0) return { ok: false, problems }
  return {
    ok: true,
    clip: { durationMs: durationMs as number, loop: loop as boolean, keys },
  }
}
