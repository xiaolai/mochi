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

/** Everything a motion is allowed to move. See the header. */
export const MOTION_CHANNELS = ['squash', 'lean', 'gazeX', 'gazeY'] as const
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
    const value = channelAt(clip.keys, channel, at)
    if (value !== null) pose[channel] = value
  }
  return pose
}

function channelAt(keys: readonly MotionKey[], channel: MotionChannel, at: number): number | null {
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
    const span = after.t - before.t
    const k = span === 0 ? 1 : (at - before.t) / span
    const a = before[channel] ?? 0
    const b = after[channel] ?? 0
    // `a*(1-k) + b*k`, not `a + (b-a)*k`. The second gives 1.1000000000000001
    // at k=1 -- the same defect `blendLook` was fixed for, and the same
    // consequence: a tuned value never reaching the renderer exactly.
    return a * (1 - k) + b * k
  }
  return last[channel] ?? null
}

/**
 * A short agreement, and a long one that repeats.
 *
 * Two, and unalike on purpose -- see the header. They are also the only
 * motions this app has, which is why `caps.supportsMotions` can finally be
 * true: a backend claiming the capability with an empty library would be the
 * flag lying, which is what the gate in `shared/avatar.ts` exists to catch.
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
