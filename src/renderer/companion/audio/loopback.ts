/**
 * Whether her own voice is coming back into the microphone.
 *
 * ## Why this is measured rather than detected
 *
 * The setting it replaces asked the user which they were on, speakers or
 * earphones, and expected them to change it every time they plugged something
 * in. Nobody maintains a setting like that.
 *
 * The obvious alternative -- ask the system what kind of device it is -- is not
 * available and would be the wrong question anyway. `MediaDeviceInfo` carries
 * four fields (`deviceId`, `groupId`, `kind`, `label`) and none of them says
 * what a device IS; that was checked against the compiler rather than
 * remembered. Native APIs do expose it, differently on each of three platforms,
 * and would still answer wrongly: an external USB speaker is not "built-in" and
 * feeds back just as hard, and a headset hanging around somebody's neck reports
 * as headphones while behaving as a speaker.
 *
 * So this measures the thing that actually matters. Her voice reaching the
 * microphone is an acoustic fact with an acoustic signature, and it is the same
 * fact on every platform and every device.
 *
 * ## The signature
 *
 * Echo is her output arriving at the microphone a few milliseconds later. So it
 * is not "the microphone is loud while she talks" -- somebody answering her is
 * also that. It is "the microphone gets loud exactly WHEN she does, quiet
 * exactly when she stops, over and over".
 *
 * That is correlation, and correlation is what separates the two cases:
 *
 * - Speakers: her level and the microphone's rise and fall together. Strongly
 *   positive.
 * - Earphones, room quiet: the microphone sits on its noise floor and does not
 *   move with her. Near zero.
 * - Earphones, somebody talking over her: the microphone moves a lot, and not
 *   with her. Near zero, sometimes negative.
 *
 * The third case is the one a level threshold gets wrong, and it is the case
 * that matters most: a person interrupting is exactly who must not be muted.
 */

/** One moment: how loud she was, and how loud the microphone was. */
export interface Pair {
  readonly her: number
  readonly mic: number
}

/**
 * How many pairs to decide on.
 *
 * At one sample per animation frame this is about a second and a half of her
 * speaking. Short enough to settle within the first utterance; long enough that
 * a single syllable landing next to a door closing cannot carry it.
 */
export const WINDOW = 90

/**
 * Above this, the two envelopes are judged to be the same sound.
 *
 * Not derived from a measurement -- it is a threshold on a correlation
 * coefficient, and the honest thing to say is that it was chosen to sit well
 * clear of both ends: echo through a laptop speaker correlates near 1, and two
 * unrelated sounds hover around 0. Anything from roughly 0.4 to 0.8 would
 * behave the same on those two cases. It is exposed so a real measurement can
 * replace it rather than being buried in an `if`.
 */
export const CORRELATED = 0.6

/**
 * Ignore moments when she is not actually making a sound.
 *
 * Silence on both sides correlates perfectly and means nothing: a pause with a
 * quiet room is two flat lines. Only moments where she is audible carry any
 * information about whether her audio comes back.
 */
const AUDIBLE = 0.02

/** Below this standard deviation, an envelope is a straight line. See below. */
const FLAT = 1e-6

/**
 * Pearson correlation of the two envelopes, over the moments she was audible.
 *
 * `null` when there is not enough of her speech to say -- which is the answer
 * before the first utterance, and is deliberately not `false`: "no echo" and
 * "nobody has looked yet" are different, and treating them the same is how a
 * detector reports a confident answer about a session that has not made a
 * sound.
 */
export function correlation(pairs: readonly Pair[]): number | null {
  const loud = pairs.filter((pair) => pair.her >= AUDIBLE)
  // Half the window, so a decision rests on her having actually talked rather
  // than on a couple of frames at the edge of audibility.
  if (loud.length < WINDOW / 2) return null

  const mean = (of: (pair: Pair) => number): number =>
    loud.reduce((sum, pair) => sum + of(pair), 0) / loud.length
  const herMean = mean((pair) => pair.her)
  const micMean = mean((pair) => pair.mic)

  let covariance = 0
  let herVariance = 0
  let micVariance = 0
  for (const pair of loud) {
    const her = pair.her - herMean
    const mic = pair.mic - micMean
    covariance += her * mic
    herVariance += her * her
    micVariance += mic * mic
  }
  // A flat envelope on either side has no correlation to report.
  //
  // Compared against a floor rather than against zero, because zero is
  // unreachable: the mean of ninety copies of 0.3 is 0.30000000000000004, so a
  // perfectly constant envelope has deviations around 1e-17 rather than 0 --
  // and the correlation of two sets of pure rounding error is a clean +1 or -1.
  // An exact test lets that through as a confident verdict about noise.
  //
  // The floor is a standard deviation of a millionth, six orders below the
  // quietest thing these envelopes carry, so it can only catch a line that
  // never moved.
  const varies = (variance: number): boolean => Math.sqrt(variance / loud.length) > FLAT
  if (!varies(herVariance) || !varies(micVariance)) return null
  return covariance / Math.sqrt(herVariance * micVariance)
}

/**
 * Collect pairs and answer when there are enough of them.
 *
 * Stateful because the caller samples one frame at a time, and deliberately
 * thin: everything with a rule in it is `correlation` above, which is pure.
 */
export interface LoopbackDetector {
  /** Feed one frame. */
  sample(her: number, mic: number): void
  /**
   * Whether her voice is coming back, or `null` while it is still unknown.
   *
   * Sticky once decided: it is answered per WINDOW, and the answer only
   * changes when a fresh window disagrees. Re-deciding every frame would let
   * one quiet pause flip the microphone open in the middle of her sentence.
   */
  verdict(): boolean | null
  /** Throw away what was learned -- the devices changed underneath us. */
  reset(): void
}

export function createLoopbackDetector(): LoopbackDetector {
  let pairs: Pair[] = []
  let answer: boolean | null = null

  return {
    sample(her, mic) {
      pairs.push({ her, mic })
      if (pairs.length < WINDOW) return
      const score = correlation(pairs)
      // The window is consumed whether or not it decided anything. Keeping it
      // would mean the next verdict was mostly the same frames again.
      pairs = []
      if (score !== null) answer = score >= CORRELATED
    },
    verdict() {
      return answer
    },
    reset() {
      pairs = []
      answer = null
    },
  }
}
