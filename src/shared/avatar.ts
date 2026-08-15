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
   * Gaze target in normalised viewport coordinates, origin at the top-left.
   * Finite values are clamped to 0..1.
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

/**
 * Which expressions can actually be RENDERED right now.
 *
 * The shape for the mouth: the gate is a conjunction
 * of three conditions, not one capability flag, and the third -- does the
 * thing currently loaded actually have these presets? -- is the one that gets
 * dropped. Dropped, `setEmotion('shy')` reaches a model with no `shy`, every
 * flag reports success, and her face does not move. The previous codebase kept
 * all three in one function for exactly this reason.
 *
 * This is that function for expressions. Two conditions today, because a
 * persona package may declare a subset of what the format defines:
 *
 *   1. the backend can render preset expressions at all
 *   2. the loaded persona declares this one
 *
 * A package declaring NOTHING gets everything the format defines, which is the
 * ordinary case: `looks.ts` gives all eight, and a persona that says nothing
 * about expressions is not opting out of them.
 */
export function renderableExpressions(
  caps: Pick<AvatarBackendCaps, 'presetExpressions'>,
  declared: readonly Emotion[] | null,
): readonly Emotion[] {
  if (!caps.presetExpressions) return []
  if (declared === null) return EMOTIONS
  // INTERSECTED, and ordered by the canonical list rather than by whatever the
  // package wrote. A tool schema built from this must not change shape because
  // somebody reordered a JSON array.
  return EMOTIONS.filter((emotion) => declared.includes(emotion))
}

/**
 * Which motions can be played.
 *
 * Same conjunction, and today the first condition is false for every backend
 * this app ships: `mochi.ts` has no motion library, so `caps.supportsMotions`
 * is false and this returns nothing whatever a package declares.
 *
 * That is the honest state rather than a gap. A package CAN name motions --
 * the field exists so a format written later does not have to be retrofitted
 * into manifests already on disk -- and naming one buys nothing until a
 * backend can play it. The gate is what stops that being a silent failure:
 * without it, a persona would declare `wave`, nothing would happen, and every
 * flag involved would report success.
 */
export function renderableMotions(
  caps: Pick<AvatarBackendCaps, 'supportsMotions'>,
  declared: readonly string[] | null,
): readonly string[] {
  if (!caps.supportsMotions || declared === null) return []
  return declared
}
