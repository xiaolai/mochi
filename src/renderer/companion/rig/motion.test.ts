/**
 * The format, tested against both built-ins.
 *
 * The reason it exists at all: a format designed against ONE motion comes out
 * shaped like that motion. So there are two, deliberately unalike, and every
 * assertion below is something the pair required and a single clip would not
 * have shown.
 */

import { describe, expect, it } from 'vitest'
import {
  BUILT_IN_MOTIONS,
  MOTION_CHANNELS,
  builtInReach,
  motionReach,
  parseMotionClip,
  poseAt,
  progress,
} from './motion'

const nod = BUILT_IN_MOTIONS['nod']!
const sway = BUILT_IN_MOTIONS['sway']!

describe('the two built-ins are actually different', () => {
  it('differ in loop, length and channels', () => {
    // Guarding the instrument. If the pair ever collapsed into two variations
    // of one shape, every claim this file makes about the format would be
    // untested -- the format would have been designed against one clip again.
    expect(nod.loop).not.toBe(sway.loop)
    expect(sway.durationMs / nod.durationMs).toBeGreaterThan(5)
    const channelsOf = (clip: typeof nod): string[] =>
      MOTION_CHANNELS.filter((c) => clip.keys.some((k) => k[c] !== undefined))
    expect(channelsOf(nod)).not.toEqual(channelsOf(sway))
  })
})

describe('progress', () => {
  it('runs 0 to 1 through a clip', () => {
    expect(progress(nod, 0)).toBe(0)
    expect(progress(nod, 310)).toBeCloseTo(0.5, 5)
  })

  it('ends a one-shot rather than holding its last frame', () => {
    // Null, not 1. A finished clip contributes NOTHING -- holding the last key
    // would leave her permanently leaning if a clip ended away from neutral.
    expect(progress(nod, nod.durationMs)).toBeNull()
    expect(progress(nod, nod.durationMs * 3)).toBeNull()
  })

  it('wraps a looping one forever', () => {
    expect(progress(sway, sway.durationMs)).toBeCloseTo(0, 5)
    expect(progress(sway, sway.durationMs * 2.5)).toBeCloseTo(0.5, 5)
  })
})

describe('poseAt', () => {
  it('moves only the channels a clip mentions', () => {
    // `nod` never touches gaze. Reporting 0 for it would make the layer fight
    // the cursor-follow over a channel it never meant to have an opinion on.
    const pose = poseAt(nod, 0.28)
    expect(pose.squash).toBeCloseTo(0.1, 5)
    expect('gazeX' in pose).toBe(false)
    expect('gazeY' in pose).toBe(false)
  })

  it('hits a key exactly, with no floating-point drift', () => {
    // `a*(1-k) + b*k`, not `a + (b-a)*k`. The second gives 1.1000000000000001
    // at the endpoint -- the defect `blendLook` was fixed for, where a tuned
    // value never reaches the renderer as written.
    for (const key of sway.keys) {
      expect(poseAt(sway, key.t).lean).toBe(key.lean)
    }
  })

  it('moves between the keys, and past the straight line between them', () => {
    /*
      This used to assert the LINEAR midpoint — 0.03 at t=0.125, exactly half of
      0.06 — and that was the whole problem: a straight line between keys makes
      every key a velocity discontinuity, so a clip is a chain of segments with
      corners in it. Reported as the motions being crude, and it was.

      The curve passes through the authored values (above) and bulges between
      them, which is what carrying velocity through a key looks like.
    */
    const half = poseAt(sway, 0.125)
    expect(half.lean).toBeGreaterThan(0.03)
    expect(half.gazeX).toBeGreaterThan(0.09)
    // Still bounded by the neighbouring keys' magnitude — a bulge, not a spike.
    expect(half.lean).toBeLessThan(0.06)
    expect(half.gazeX).toBeLessThan(0.18)
  })

  it('carries velocity THROUGH a key instead of restarting at it', () => {
    /*
      The property the complaint was about, measured rather than described.

      Speed just before a key and just after it, on a channel that is plainly
      still moving there: `sway` crosses zero at t=0.5 on its way from one
      extreme to the other, so the velocity there should be at its largest and
      the two sides should agree. Linear interpolation also agrees across THIS
      key by luck of symmetry, so the test uses `wander`, whose keys are
      unevenly spaced and unevenly valued.
    */
    const wander = BUILT_IN_MOTIONS['wander']!
    const shift = (t: number): number => poseAt(wander, t).shift ?? 0
    // ONE-SIDED, and taken right at the key rather than a few frames out. A
    // central difference straddling a turning point measures the curvature of
    // the segment as well as the joint, which is why an earlier version of this
    // failed at `t = 0.84` — the one key where `shift` reverses.
    const h = 1e-4
    for (const key of wander.keys.slice(1, -1)) {
      const before = (shift(key.t) - shift(key.t - h)) / h
      const after = (shift(key.t + h) - shift(key.t)) / h
      /*
        Under linear interpolation these are two unrelated constants: at
        `t = 0.84` they are -0.6 and +2.2, a gap of 2.8. Under a cubic through
        the keys they agree to within the curvature over one step.
      */
      expect(Math.abs(after - before), `at t=${String(key.t)}`).toBeLessThan(0.05)
    }
  })

  it('is smooth across the seam of a loop, not only inside it', () => {
    // Otherwise it kinks once per cycle for as long as it plays -- the same
    // failure the loop-closure check prevents in its cruder form, where the
    // POSE jumps rather than the velocity.
    const speed = (t: number, d = 0.001): number =>
      ((poseAt(sway, t + d).lean ?? 0) - (poseAt(sway, t - d).lean ?? 0)) / (2 * d)
    // Just after the start and just before the end are the same instant in a
    // loop, so the speed at both has to match.
    expect(speed(0.004)).toBeCloseTo(speed(0.996), 1)
  })

  it('holds outside the stated range rather than fading toward zero', () => {
    // A clip mentioning a channel only in its second half is at rest until
    // then, not drifting toward rest from somewhere unspecified.
    const late = {
      durationMs: 100,
      loop: false,
      keys: [
        { t: 0.5, lean: 0.2 },
        { t: 1, lean: 0.2 },
      ],
    }
    expect(poseAt(late, 0).lean).toBeCloseTo(0.2, 5)
    expect(poseAt(late, 0.25).lean).toBeCloseTo(0.2, 5)
  })

  it('never writes the mouth, whatever a clip contains', () => {
    // The layering rule as a property of the VOCABULARY rather than something
    // each clip has to respect. A motion able to write the mouth could hold
    // her jaw shut while audio plays, which reads as broken.
    expect(MOTION_CHANNELS).not.toContain('mouthOpen')
    expect(MOTION_CHANNELS).not.toContain('mouthUpper')
    for (const clip of Object.values(BUILT_IN_MOTIONS)) {
      for (const key of clip.keys) {
        for (const channel of Object.keys(key)) {
          expect(channel === 't' || MOTION_CHANNELS.includes(channel as never), channel).toBe(true)
        }
      }
    }
  })
})

describe('a looping clip has to end where it began', () => {
  it('starts and ends at the same pose', () => {
    // Otherwise it jumps on every cycle -- once every 3.8 seconds, forever,
    // which is the kind of thing that reads as the app stuttering.
    const start = poseAt(sway, 0)
    const end = poseAt(sway, 1)
    expect(end).toEqual(start)
  })

  it('is checked for every looping built-in, not just this one', () => {
    for (const [name, clip] of Object.entries(BUILT_IN_MOTIONS)) {
      if (!clip.loop) continue
      expect(poseAt(clip, 1), name).toEqual(poseAt(clip, 0))
    }
  })
})

describe('a clip off disk is checked, not trusted', () => {
  const good = {
    durationMs: 500,
    loop: false,
    keys: [
      { t: 0, lean: 0 },
      { t: 1, lean: 0.2 },
    ],
  }

  it('accepts a well-formed clip', () => {
    expect(parseMotionClip(good).ok).toBe(true)
  })

  it('accepts both built-ins, which is the format checking itself', () => {
    for (const [name, clip] of Object.entries(BUILT_IN_MOTIONS)) {
      const result = parseMotionClip(JSON.parse(JSON.stringify(clip)))
      expect(result.ok, `${name}: ${result.ok ? '' : result.problems.join('; ')}`).toBe(true)
    }
  })

  it('reports every problem at once, not the first', () => {
    // Somebody hand-editing wants the whole list; one per attempt turns a
    // single round of fixes into five.
    const result = parseMotionClip({ durationMs: -1, loop: 'yes', keys: [] })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.problems.length).toBeGreaterThan(2)
  })

  it('refuses a channel a motion may not move', () => {
    // The mouth, most of all: rule 8 says no layer above it may overwrite it,
    // and a clip that could would hold her jaw shut while audio plays.
    const result = parseMotionClip({ ...good, keys: [{ t: 0, mouthOpen: 1 }, { t: 1 }] })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.problems.join(' ')).toContain('mouthOpen')
  })

  it('refuses a typo rather than dropping it', () => {
    const result = parseMotionClip({ ...good, keys: [{ t: 0, squahs: 0.1 }, { t: 1 }] })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.problems.join(' ')).toContain('squahs')
  })

  it('bounds the numbers, because these drive body scale and gaze', () => {
    // 400 is legal JSON and draws a mochi nobody can see.
    const result = parseMotionClip({ ...good, keys: [{ t: 0, squash: 400 }, { t: 1 }] })
    expect(result.ok).toBe(false)
  })

  it('refuses keys out of order, which poseAt is written against', () => {
    const result = parseMotionClip({
      ...good,
      keys: [
        { t: 1, lean: 0 },
        { t: 0, lean: 0 },
      ],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.problems.join(' ')).toContain('order')
  })

  it('refuses a looping clip that does not end where it began', () => {
    // It jumps once per cycle, forever -- which reads as the app stuttering.
    const result = parseMotionClip({
      durationMs: 500,
      loop: true,
      keys: [
        { t: 0, lean: 0 },
        { t: 1, lean: 0.5 },
      ],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.problems.join(' ')).toContain('end where it began')
  })

  it('needs at least two keys, because one is a pose', () => {
    expect(parseMotionClip({ ...good, keys: [{ t: 0 }] }).ok).toBe(false)
  })
})

describe("the built-ins are held to the standard a stranger's clip is", () => {
  it('every one of them survives the parser', () => {
    /*
      They are object literals, so nothing made them face `parseMotionClip` —
      the bounds, the key ordering, the two-key minimum and the loop closure
      are all enforced on a clip off DISK and were enforced on these only by
      whoever typed them.

      That gap grew teeth the moment three channels were added: `lift: 1.4` is a
      legal TypeScript number that puts her outside her own window, and the
      author of the next clip should not be the only check on it.
    */
    for (const [name, clip] of Object.entries(BUILT_IN_MOTIONS)) {
      const parsed = parseMotionClip(JSON.parse(JSON.stringify(clip)))
      expect(parsed.ok, `${name}: ${parsed.ok ? '' : parsed.problems.join('; ')}`).toBe(true)
    }
  })

  it('reserves room for exactly the travel its keys ask for', () => {
    // Derived rather than declared, so retiming a clip cannot leave the number
    // beside it stale. `up` only: she hops rather than sinking.
    expect(motionReach(BUILT_IN_MOTIONS['nod']!)).toEqual({ x: 0, up: 0 })
    expect(motionReach(BUILT_IN_MOTIONS['hop']!).up).toBeCloseTo(
      Math.max(...BUILT_IN_MOTIONS['hop']!.keys.map((k) => k.lift ?? 0)),
    )
    expect(motionReach(BUILT_IN_MOTIONS['hop']!).x).toBe(0)
    expect(motionReach(BUILT_IN_MOTIONS['swing']!).x).toBeCloseTo(
      Math.max(...BUILT_IN_MOTIONS['swing']!.keys.map((k) => Math.abs(k.shift ?? 0))),
    )

    const worst = builtInReach()
    for (const clip of Object.values(BUILT_IN_MOTIONS)) {
      const one = motionReach(clip)
      expect(worst.x).toBeGreaterThanOrEqual(one.x)
      expect(worst.up).toBeGreaterThanOrEqual(one.up)
    }
  })

  it('keeps the worst case small enough to be a gesture', () => {
    // The pad reserves this permanently, so it is transparent window around her
    // for the whole session. A clip that wanted a body width each way would be
    // asking for a window twice as wide as she is, always.
    const worst = builtInReach()
    expect(worst.x).toBeLessThanOrEqual(0.5)
    expect(worst.up).toBeLessThanOrEqual(0.25)
  })
})
