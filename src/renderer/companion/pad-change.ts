import type { Pad } from '@shared/avatar-layout'

/** How long a shrink must stay wanted before the window actually shrinks. */
const SHRINK_SETTLE_MS = 400

/** Whether the pad change is applied now, and what the shrink clock becomes. */
export interface PadSettling {
  readonly apply: boolean
  readonly shrinkWantedSince: number | null
}

/**
 * Grow at once, shrink only after it has stayed wanted.
 *
 * A bubble appearing and going is two resizes, and back-to-back utterances
 * would be four in a couple of seconds -- a window changing size that often is
 * the flicker this whole arrangement exists to avoid. Growing late clips what
 * is being drawn, so growth is immediate and only shrinking waits.
 *
 * `now` is passed in rather than read, and the clock is a wall clock rather
 * than a frame count: the render loop runs at whatever rate the compositor
 * gives it, and "a quarter of a second" should not mean something different
 * when she is occluded. Taking it as an argument is also what makes this
 * testable at all -- it used to sit inside a closure in a module that resolves
 * a palette off `document` at load, so no test could reach the rule.
 */
export function padChange(
  pad: Pad,
  wanted: Pad,
  shrinkWantedSince: number | null,
  now: number,
): PadSettling {
  const same =
    pad.left === wanted.left &&
    pad.top === wanted.top &&
    pad.right === wanted.right &&
    pad.bottom === wanted.bottom
  if (same) return { apply: false, shrinkWantedSince: null }

  const grows =
    wanted.left > pad.left ||
    wanted.top > pad.top ||
    wanted.right > pad.right ||
    wanted.bottom > pad.bottom
  if (!grows) {
    const since = shrinkWantedSince ?? now
    if (now - since < SHRINK_SETTLE_MS) return { apply: false, shrinkWantedSince: since }
  }
  return { apply: true, shrinkWantedSince: null }
}
