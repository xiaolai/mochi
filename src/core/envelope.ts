/**
 * Audio loudness to mouth openness.
 *
 * The coarse path, and behind cloud speech-to-speech the ONLY path: an audio
 * stream carries no phoneme timings, so this is not a shortcut here -- it is
 * the whole option.
 *
 * ## Why this is relative rather than a fixed threshold
 *
 * mochi's version gated at an absolute 0.01 with a gain of 12. Measured against
 * a live gpt-realtime session (2026-08-11) those
 * constants turn out to WORK -- and to work for a reason nobody wrote down, on
 * a scale nobody had checked:
 *
 *   - the gap floor is 8.4e-5 median, 8.1e-4 at p99. So the gate cleared it by
 *     roughly 12x. Comfortable, but by luck rather than by design.
 *   - speech sits at 0.057 median and 0.137 at p90, while gain 12 saturates at
 *     0.093. So more than a tenth of speech frames were pinned fully open --
 *     a mouth hitting its stop instead of modulating.
 *
 * Both numbers belong to one voice on one provider. A different voice, a
 * provider change, or anyone adding a volume `GainNode` upstream moves them,
 * and nothing in an absolute design would notice: her mouth would simply hang
 * open, or stop moving, with nothing to say why.
 *
 * So openness is expressed against the signal's OWN recent floor and peak. The
 * headline property is scale invariance -- multiply the input by any constant
 * and the output is unchanged -- which is what makes it survive all three of
 * those changes without being retuned.
 *
 * ## What the floor is NOT
 *
 * It is not room tone. There is no microphone on this path. Between phrases the
 * stream carries codec comfort noise at ~1e-4, and it does NOT return to
 * digital silence once media is flowing (measured: exact zero appears only
 * before the first audio arrives). So a gate is genuinely required -- a zero
 * gate leaves the mouth twitching on noise -- but it needs to sit just above a
 * floor three orders of magnitude below speech, not at a hand-picked constant.
 */

export interface EnvelopeSettings {
  /**
   * Gate, as a multiple of the tracked noise floor.
   *
   * 12 puts it at ~1e-3 against the measured floor, just clear of the loudest
   * gap frame at 8.9e-4, and still 50x below median speech.
   */
  readonly floorMargin: number
  /** How much of the reference peak survives one second of quiet. */
  readonly peakDecayPerSecond: number
  /**
   * Floor under the reference peak, as a FRACTION of the loudest she has been.
   *
   * Without a floor, a long quiet passage decays the reference until a murmur
   * throws her mouth wide open. It has to be a fraction rather than a level:
   * an absolute one silently reintroduces exactly the scale dependence this
   * module exists to remove, and it does it invisibly, because the arithmetic
   * still looks relative.
   */
  readonly minPeakFraction: number
  /** How slowly the "loudest so far" reference fades, per second. */
  readonly loudestDecayPerSecond: number
  /**
   * How far the peak must stand above the floor before ANY of this counts as
   * speech.
   *
   * The one thing a purely relative design cannot do on its own is notice that
   * nothing is happening: given only comfort noise it will happily normalise
   * that noise to full scale and mouth silently for as long as the gap lasts.
   * Measured, speech stands ~680x above the floor and noise-only sits within
   * ~2x of it, so the two are not close and this does not need to be delicate.
   *
   * A RATIO rather than a level, so it stays scale invariant -- which is the
   * whole reason the absolute gate was removed.
   */
  readonly speechRatio: number
  /**
   * Headroom above the running peak.
   *
   * Without it the loudest frame of every syllable maps to exactly 1, because
   * it IS the peak -- so the mouth spends a seventh of her speech pinned at the
   * stop instead of modulating. This buys back the top of the range.
   */
  readonly peakHeadroom: number
  /** How fast the tracked noise floor is allowed to rise, per second. */
  readonly floorRisePerSecond: number
  /**
   * How long `speaking` survives the last frame that cleared the ratio.
   *
   * A HOLD, in seconds, rather than a decay -- because bridging the dip between
   * two syllables and dropping promptly at the end of a phrase are a problem
   * about TIME, and every attempt to solve them with one decay rate trades one
   * against the other. The judgement used to read the reference peak, which
   * decays at 0.4 per second: from a 0.057 speech level down to 20x the
   * measured 8.4e-5 floor is `ln(0.02)/ln(0.4)` = 4.27 SECONDS of "still
   * talking" after she has stopped, on top of the caller's own 500ms debounce.
   * The farewell waits on exactly this signal, so she could not finish saying
   * goodbye and settle.
   *
   * 180ms spans an inter-syllable dip comfortably -- those land near a tenth of
   * speech level, two orders above the gate, nowhere near the floor -- while
   * the p99 gap frame at 8.1e-4 can only ever re-arm a hold this short.
   */
  readonly speechHoldSeconds: number
  /**
   * Hard cap on the gate, as a fraction of the usable range.
   *
   * A backstop, not a tuning knob. The floor estimator can be wrong -- if the
   * first audio frame of a session is loud it seeds high, and a signal with no
   * gaps never gives it a chance to fall. Uncapped, the gate then sits above
   * everything and her mouth never opens again, silently, for the rest of the
   * run. This bounds that failure to a slightly insensitive mouth.
   */
  readonly maxGateFraction: number
  /** One-pole smoothing per frame. Raw per-frame RMS makes the mouth buzz. */
  readonly smoothing: number
}

export const DEFAULT_ENVELOPE: EnvelopeSettings = {
  floorMargin: 12,
  peakDecayPerSecond: 0.4,
  minPeakFraction: 0.35,
  loudestDecayPerSecond: 0.94,
  speechRatio: 20,
  peakHeadroom: 1.15,
  floorRisePerSecond: 1.6,
  speechHoldSeconds: 0.18,
  maxGateFraction: 0.25,
  smoothing: 0.35,
}

export interface EnvelopeState {
  /** 0..1, what to hand to setMouthOpen. */
  readonly mouthOpen: number
  /** Fast-decaying reference for "as loud as this phrase gets". */
  readonly peak: number
  /** Very slowly decaying reference for "as loud as she ever gets". */
  readonly loudest: number
  /** Slow estimate of the between-phrase noise floor. */
  readonly floor: number
  /**
   * Whether this step judged the signal to be speech.
   *
   * Exposed because it is the only adaptive answer to "is she talking", and it
   * was previously computed here and thrown away -- which left the caller to
   * invent an absolute RMS threshold of its own. That contradicted the entire
   * point of a relative envelope: comfort noise above the constant pinned her
   * as permanently speaking, and quiet speech below it never registered at all.
   */
  readonly speaking: boolean
  /**
   * Seconds since the last frame that stood clear of the floor.
   *
   * Carried in the state because the hold is the only part of this module with
   * a memory measured in time rather than in levels.
   */
  readonly quietFor: number
}

export const SILENT: EnvelopeState = {
  mouthOpen: 0,
  peak: 0,
  loudest: 0,
  floor: 0,
  speaking: false,
  quietFor: Number.POSITIVE_INFINITY,
}

/** Root mean square of a block of samples, in 0..1 for normalised audio. */
export function rms(samples: Float32Array): number {
  let sum = 0
  let counted = 0
  for (const sample of samples) {
    // One bad sample from a decoder glitch would otherwise produce NaN and,
    // through the filter, freeze the mouth for the rest of the session.
    if (!Number.isFinite(sample)) continue
    sum += sample * sample
    counted++
  }
  return counted === 0 ? 0 : Math.sqrt(sum / counted)
}

/**
 * One step. The caller owns the state, so this is pure and testable against a
 * recorded trace rather than against a live session.
 */
export function advanceEnvelope(
  level: number,
  state: EnvelopeState,
  dtSeconds: number,
  settings: EnvelopeSettings = DEFAULT_ENVELOPE,
): EnvelopeState {
  const value = Number.isFinite(level) ? Math.max(0, level) : 0
  const dt = Number.isFinite(dtSeconds) ? Math.min(Math.max(dtSeconds, 0), 0.25) : 0

  // The floor falls to any new minimum at once and rises only slowly. That
  // asymmetry is the point: a quiet moment is evidence about the floor, a loud
  // one is not, so speech must not be able to drag the estimate up after it.
  //
  // A frame of DIGITAL SILENCE is skipped, and that is not a nicety. Zero is
  // doing double duty here as "no estimate yet", and an exact zero -- a muted
  // mic, a gap in the stream, a decoder handing back an empty block -- used to
  // be accepted as a new minimum. The floor then read as uninitialised again,
  // so the next frame with any signal in it seeded the floor AT SPEAKING
  // LEVEL. From there `value > floor * 20` can never be true, and zero is an
  // absorbing state for a multiplicative rise, so she stayed silent-looking
  // through continuous speech with every flag reporting success.
  //
  // Skipping is also the physically honest reading: a dropout is the absence
  // of a measurement, not a measurement of an extremely quiet room.
  const rise = Math.pow(settings.floorRisePerSecond, dt)
  const floor =
    value === 0
      ? state.floor
      : state.floor === 0
        ? value
        : value < state.floor
          ? value
          : Math.min(value, state.floor * rise)

  // The peak rises instantly and decays slowly, so a single loud syllable sets
  // the reference for the phrase around it rather than only for its own frame.
  const peak = Math.max(value, state.peak * Math.pow(settings.peakDecayPerSecond, dt))
  // And a much slower one behind it, so the phrase reference cannot fall so far
  // during a pause that the next murmur reads as a shout.
  const loudest = Math.max(value, state.loudest * Math.pow(settings.loudestDecayPerSecond, dt))

  // Nothing is happening unless the signal stands well clear of the floor. This
  // is the one judgement a relative design cannot derive from the ratio it is
  // currently computing, because on noise alone that ratio is 1.
  //
  // Against the CURRENT value, held open for `speechHoldSeconds`. It used to
  // read `peak`, whose whole purpose is to decay slowly so one loud syllable
  // sets the reference for the phrase around it -- a good property for scaling
  // the mouth and a disastrous one for deciding she has stopped, because the
  // decay outlives the speech by seconds. Two jobs, one number; they are now
  // two numbers.
  const clear = value > floor * settings.speechRatio
  const quietFor = clear ? 0 : state.quietFor + dt
  const speaking = quietFor < settings.speechHoldSeconds

  const ceiling = Math.max(peak * settings.peakHeadroom, loudest * settings.minPeakFraction)
  // Capped, so a floor estimate that seeded high cannot swallow the whole
  // range. Both terms scale with the signal, which is what keeps the result
  // invariant under a change of level.
  const gate = Math.min(floor * settings.floorMargin, ceiling * settings.maxGateFraction)
  const span = ceiling - gate
  const target = !speaking || span <= 0 ? 0 : Math.min(1, Math.max(0, (value - gate) / span))

  const smoothing = Math.min(1, Math.max(0, settings.smoothing))
  const previous = Number.isFinite(state.mouthOpen) ? state.mouthOpen : 0
  return {
    mouthOpen: previous + (target - previous) * smoothing,
    peak,
    loudest,
    floor,
    speaking,
    quietFor,
  }
}
