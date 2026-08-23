/**
 * The rendering contract.
 *
 * Implementations live in the renderer. There is exactly one, and the enum says
 * so: a value nothing will ever return is a promise the type system keeps
 * forcing call sites to honour. mochi used that argument to refuse a `live2d`
 * member, then shipped a `vrm` one with no VRM backend behind it -- and this
 * file inherited it. Removed. It comes back the day something returns it.
 *
 * There is no `placeholder` member either, and that absence is the decision.
 * In the previous codebase the placeholder outlived the "real"
 * backend it stood in for, because a third-party VRM cannot be redistributed
 * and so no model ever shipped. A stand-in that is the only thing anyone ever
 * sees is not a stand-in; naming it `mochi` is what stops it being treated as
 * disposable.
 */

export type AvatarKind = 'mochi'

/**
 * The canonical emotion list.
 *
 * A tuple, not a bare union, because the tool schema in voice.ts needs the same
 * values at runtime. Deriving both from here means adding an emotion cannot
 * leave the schema stale -- which a hand-written array plus `satisfies` would
 * allow, since `satisfies` rejects wrong entries but never notices missing ones.
 */
export const EMOTIONS = [
  'neutral',
  'happy',
  'shy',
  'sad',
  'angry',
  'surprised',
  'thinking',
  'sleepy',
] as const

export type Emotion = (typeof EMOTIONS)[number]

/**
 * The canonical viseme set: VRM 1.0's five vowel presets.
 *
 * A tuple for the same reason EMOTIONS is one -- both the avatar contract and
 * the provider's VisemeFrame need these values, and a bare string union would
 * let a provider emit `ah` or `A` and have it silently ignored while every
 * capability flag still claimed the precise lip-sync path was working.
 *
 * Consonants are deliberately absent. VRM defines no consonant presets, and
 * inventing some would produce a set no model can render.
 */
export const VISEMES = ['aa', 'ih', 'ou', 'ee', 'oh'] as const

export type Viseme = (typeof VISEMES)[number]

/** A complete snapshot. Coarticulation genuinely overlaps vowels, so these do not sum to 1. */
export type VisemeWeights = Readonly<Record<Viseme, number>>

export interface EmotionSignal {
  readonly emotion: Emotion
  /** 0..1, normalised through clamp01 -- non-finite becomes 0. */
  readonly intensity: number
  /**
   * Drift back to neutral after this many milliseconds. Finite and >= 0.
   * Omitted means hold until the next signal.
   *
   * Each setEmotion() supersedes any pending reset, so a newer signal is never
   * cut short by an older signal's timer.
   */
  readonly holdMs?: number
}

/** Clamp to 0..1 with an explicit non-finite policy, so every backend agrees. */
export function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0
}

/**
 * Clamp to -1..1, for a signed OFFSET rather than a magnitude.
 *
 * Beside `clamp01` and deliberately not derived from it: the two answer
 * different questions, and using the 0..1 one on a position is the whole of the
 * gaze bug `AvatarBackend.lookAt` describes — centre came out as the top-left
 * corner and half the input range collapsed onto it.
 *
 * Non-finite returns 0 here, which is CENTRE for a signed offset. Callers that
 * must not move on a bad sample check finiteness before calling, as `lookAt`
 * does; this is the floor rather than that policy.
 */
export function clampSigned(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(-1, value)) : 0
}

/**
 * Differences a call site would otherwise have to branch on. Nothing goes in
 * here speculatively -- each field marks a divergence that is already known.
 *
 * These describe the BACKEND, not whichever model happens to be loaded.
 */
export interface AvatarBackendCaps {
  /** Fixed expression names the format defines (VRM's Joy/Angry/...). */
  readonly presetExpressions: boolean
  /** Arbitrary expression identifiers authored into the model. */
  readonly customExpressions: boolean
  /** Whether load() can return non-null licence metadata. */
  readonly licenseMetadata: boolean
  /** Whether the backend can run physics at all; a given model may still carry none. */
  readonly supportsPhysics: boolean
  /** Whether playMotion() does anything. A backend with no motion library reports false. */
  readonly supportsMotions: boolean
  /**
   * Whether setVisemes() can drive anything at all.
   *
   * Independent of the provider's caps.phonemeTimings: timings are useless
   * without a backend that can render them, and a backend that can render them
   * sits idle behind a provider that emits none.
   */
  readonly visemes: boolean
}

/**
 * Milliseconds from a monotonic clock with the animation-frame time origin --
 * i.e. what requestAnimationFrame passes and performance.now() returns. Never
 * Date.now(), which can jump backwards.
 */
export type MonotonicMs = number

export interface AvatarBackend {
  readonly kind: AvatarKind
  readonly caps: AvatarBackendCaps

  /**
   * 0 = closed, 1 = fully open. Called every frame. Non-finite input is
   * treated as 0 (see clamp01) rather than left to each backend to invent.
   *
   * The coarse path, and the only one available behind cloud
   * speech-to-speech: an audio stream carries no phoneme timings, so the RMS
   * envelope is not a shortcut there.
   *
   * Supersedes any viseme weights still applied. The two paths write the same
   * mouth, so the last caller wins outright rather than blending -- a provider
   * switch mid-session must not leave a stale vowel held open underneath.
   */
  setMouthOpen(value: number): void

  /**
   * The precise path: a complete weight per canonical viseme, each clamped
   * through clamp01.
   *
   * Total rather than partial: an omitted key would have to mean either "hold
   * the previous value" or "zero", and a caller cannot tell which from the
   * type. No-op when caps.visemes is false.
   */
  setVisemes(weights: VisemeWeights): void

  setEmotion(signal: EmotionSignal): void

  /** No-op when caps.supportsMotions is false. */
  playMotion(name: string): void

  /**
   * Gaze target as a SIGNED offset from centre: -1..1 on each axis, origin in
   * the middle. Finite values are clamped to that range.
   *
   * ## The range is -1..1 because that is what every caller has always sent
   *
   * This said 0..1 with the origin at the top-left, and `MochiAvatar.lookAt`
   * implemented it — `(clamp01(n) - 0.5) * 2` — while `face.ts` passed
   * `(clientX / width) * 2 - 1` from every `mousemove`, `lookAt(0, 0)` to
   * recentre on `mouseleave`, and `lookAt(0.35, -0.5)` for the thinking pose.
   *
   * Measured against the implementation, the whole left and top half of the
   * pointer range collapsed onto one point:
   *
   * | caller meant | backend stored |
   * | --- | --- |
   * | centre `0` | **-1** — hard up-left |
   * | left edge `-1` | -1, identical to centre |
   * | right edge `1` | 1 |
   *
   * So she tracked the cursor only across the right and bottom half, and the
   * `mouseleave` recentre — whose entire job is to put her eyes back to the
   * middle — pinned them to the corner instead.
   *
   * The interface moved rather than the callers, because -1..1 is what the rest
   * of the backend already used: `setAsleep` and the reset path both assign
   * `gazeTarget = { x: 0, y: 0 }` DIRECTLY and mean centre by it, and the
   * per-frame sum adds `look.gazeX` offsets that are signed. 0..1 was the only
   * dissenting statement, and it was in the one place nothing executed.
   *
   * A non-finite coordinate leaves the previous target in place rather than
   * being coerced to 0 -- clamp01's policy is right for a magnitude like mouth
   * openness, but applying it to a position would snap her gaze to the corner
   * on a single bad sample.
   */
  lookAt(nx: number, ny: number): void

  /** Idle animation: breathing, blinking, micro-motion. All of it stops when off. */
  setIdle(on: boolean): void

  /**
   * Is this point on the avatar? CSS pixels from the window's top-left.
   *
   * Drives per-region click-through, so it must agree with what is actually
   * drawn. A backend that reports hits on pixels it does not paint makes the
   * window swallow clicks over apparently empty space.
   */
  hitTest(x: number, y: number): boolean

  render(now: MonotonicMs): void

  /** Idempotent. Clears what was drawn and stops responding to hit tests. */
  dispose(): void
}
