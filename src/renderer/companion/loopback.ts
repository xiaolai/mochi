/**
 * How much of her own voice comes back into the microphone — measured, not fixed.
 *
 * ## What this is for, and what it deliberately is not
 *
 * §17 recorded a real defect: on the built-in speakers she is periodically
 * interrupted by her own voice, stopping mid-sentence to listen. All three
 * links in the chain were already correct — `echoCancellation` is requested and
 * `getSettings()` confirms it, playback goes through the `Audio` element path
 * AEC3 can reference, and the session runs `far_field` noise reduction with
 * `semantic_vad`. So what is left can only be **physical residue**: AEC cancels
 * most of her and what survives is still speech-shaped, which the server's
 * turn detector reads as somebody taking a turn.
 *
 * That entry's fix — close the microphone while she speaks, later an automatic
 * version of the same — did not survive into v2, and no finding overturned it.
 * But §17 also names, in its own words, the one thing nobody has ever done:
 *
 * > `CORRELATED = 0.6` has never been checked against **post-AEC residual** on
 * > real hardware. … So the instrument may be systematically reading low. That
 * > is a measurement (log `correlation()` per window on speakers and on
 * > earphones, and compare), not a threshold to nudge.
 *
 * **This is that measurement and nothing more.** It changes no behaviour, opens
 * and closes no microphone, and carries no threshold. Shipping v1's detector
 * instead would mean shipping 0.6 — the exact number that sentence says must be
 * measured rather than guessed — and a companion that stops hearing you because
 * an unvalidated constant fired is a worse failure than the one being fixed.
 *
 * ## The window is measured in EVIDENCE, not in time
 *
 * This is the correction §17's addendum paid for. v1 fed a sample on every
 * animation frame, silence included, while the verdict needed half of a
 * 90-frame window to be audible — and ordinary speech is phrase, breath,
 * phrase, which misses that bar. Window after window was consumed deciding
 * nothing, and on a Studio Display the detector took about ninety seconds to
 * notice an echo that was cutting her off every eleven seconds.
 *
 * So only frames where SHE IS AUDIBLE fill the window, and the gate is the
 * envelope's own `speaking` rather than a second threshold invented here. The
 * mouth already answers "is she making sound"; asking it twice, differently, is
 * how the two come to disagree.
 *
 * ## Why the correlation is between LEVELS, not waveforms
 *
 * AEC removes her waveform by design — that is the whole point of it — so a
 * waveform correlation measures how well cancellation worked and not what
 * survived it. What survives is a residue whose LOUDNESS still rises and falls
 * with hers, and that is what a turn detector hears. Two envelopes moving
 * together is the observable; the raw signal is not.
 */

/** Frames of her actually sounding that fill one window. About 1.5s of speech. */
const WINDOW = 90

/** Windows folded into one reported summary, so a conversation is a few lines. */
const PER_SUMMARY = 10

/** One window: how her level and the microphone's moved together. */
export interface Window {
  /**
   * Pearson correlation of the two level series, −1 to 1.
   *
   * Zero when either series never varies — a constant tells you nothing about
   * what it might be driving, and inventing a number there would put a
   * confident value on the least informative window there is.
   */
  readonly correlation: number
  /**
   * The microphone's mean level over hers.
   *
   * The other half, and the one a correlation cannot give: two signals can move
   * together perfectly at a thousandth of the amplitude. `semantic_vad` needs
   * something loud enough to look like speech, so the ratio is what says
   * whether there is anything for it to mistake.
   */
  readonly residual: number
}

export interface Summary {
  readonly windows: number
  readonly correlation: { readonly min: number; readonly median: number; readonly max: number }
  readonly residual: { readonly min: number; readonly median: number; readonly max: number }
}

export interface Loopback {
  /**
   * One animation frame.
   *
   * `speaking` is the envelope's, and it is what makes this a window of
   * evidence. Returns a summary when `PER_SUMMARY` windows have completed,
   * otherwise null.
   */
  observe(hers: number, mic: number, speaking: boolean): Summary | null
  /** A new session, or she went to sleep. Half-filled windows say nothing. */
  reset(): void
}

function median(sorted: readonly number[]): number {
  if (sorted.length === 0) return 0
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
}

function spread(values: readonly number[]): Summary['correlation'] {
  const sorted = [...values].sort((a, b) => a - b)
  return { min: sorted[0] ?? 0, median: median(sorted), max: sorted[sorted.length - 1] ?? 0 }
}

/** Pearson, with the zero-variance case answered rather than divided by. */
export function correlationOf(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length)
  if (n < 2) return 0
  let sumA = 0
  let sumB = 0
  for (let i = 0; i < n; i += 1) {
    sumA += a[i] ?? 0
    sumB += b[i] ?? 0
  }
  const meanA = sumA / n
  const meanB = sumB / n
  let cov = 0
  let varA = 0
  let varB = 0
  for (let i = 0; i < n; i += 1) {
    const da = (a[i] ?? 0) - meanA
    const db = (b[i] ?? 0) - meanB
    cov += da * db
    varA += da * da
    varB += db * db
  }
  if (varA === 0 || varB === 0) return 0
  return cov / Math.sqrt(varA * varB)
}

export function createLoopback(): Loopback {
  let hers: number[] = []
  let mics: number[] = []
  let windows: Window[] = []

  function closeWindow(): void {
    const herMean = hers.reduce((total, one) => total + one, 0) / (hers.length || 1)
    const micMean = mics.reduce((total, one) => total + one, 0) / (mics.length || 1)
    windows.push({
      correlation: correlationOf(hers, mics),
      residual: herMean === 0 ? 0 : micMean / herMean,
    })
    hers = []
    mics = []
  }

  return {
    observe(her: number, mic: number, speaking: boolean) {
      if (!speaking) return null
      hers.push(her)
      mics.push(mic)
      if (hers.length < WINDOW) return null
      closeWindow()
      if (windows.length < PER_SUMMARY) return null
      const summary: Summary = {
        windows: windows.length,
        correlation: spread(windows.map((one) => one.correlation)),
        residual: spread(windows.map((one) => one.residual)),
      }
      windows = []
      return summary
    },
    reset() {
      hers = []
      mics = []
      windows = []
    },
  }
}
