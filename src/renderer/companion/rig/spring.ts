/**
 * A second-order spring.
 *
 * The reason this exists rather than the one-pole filter used elsewhere: a
 * first-order system approaches its target and stops. It CANNOT overshoot, and
 * overshoot is what reads as mass. A mochi that gets squashed should wobble
 * past centre and settle; one that eases back looks like a scaling picture.
 *
 * Pure arithmetic, no clock. The caller owns time, which is what lets the same
 * code run in a render loop and in a test that advances a number.
 */

export interface SpringConfig {
  /** Pull toward the target. Higher is snappier. */
  readonly stiffness: number
  /** Resistance. Below ~2*sqrt(stiffness) the spring is underdamped and overshoots. */
  readonly damping: number
}

export const DEFAULT_SPRING: SpringConfig = { stiffness: 190, damping: 20 }

/**
 * Longest step the integrator will take, in seconds.
 *
 * Semi-implicit Euler is only conditionally stable: past roughly 2/sqrt(k) the
 * correction overshoots further than the error it was correcting and the value
 * diverges to infinity within a few frames. A backgrounded window, a breakpoint
 * or a laptop waking from sleep all deliver exactly that -- a dt of seconds.
 *
 * Clamping means a long gap is under-integrated (she resumes from where she
 * was, a little behind) rather than exploding. Under-integration is invisible;
 * divergence paints a mochi the size of the screen and then NaN, after which
 * every subsequent frame is blank with nothing in the log to say why.
 */
export const MAX_STEP_SECONDS = 1 / 30

export class Spring {
  private position: number
  private velocity = 0

  constructor(initial = 0) {
    this.position = Number.isFinite(initial) ? initial : 0
  }

  /** The current value, without advancing time. */
  get value(): number {
    return this.position
  }

  /**
   * Advance by `dtSeconds` toward `target` and return the new value.
   *
   * Non-finite inputs are ignored rather than propagated: one NaN reaching the
   * velocity would poison the spring permanently, and the symptom -- she simply
   * stops moving, forever, from an arbitrary later frame -- points nowhere near
   * the frame that caused it.
   */
  step(dtSeconds: number, target: number, config: SpringConfig = DEFAULT_SPRING): number {
    if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) return this.position
    if (!Number.isFinite(target)) return this.position

    const dt = Math.min(dtSeconds, MAX_STEP_SECONDS)
    const acceleration =
      -config.stiffness * (this.position - target) - config.damping * this.velocity

    this.velocity += acceleration * dt
    this.position += this.velocity * dt
    return this.position
  }

  /** Jump to a value and kill the velocity. For teleports, not for animation. */
  snap(value: number): void {
    if (!Number.isFinite(value)) return
    this.position = value
    this.velocity = 0
  }

  /** True once the spring has effectively stopped, so a caller can skip work. */
  isAtRest(target: number, epsilon = 1e-3): boolean {
    return Math.abs(this.position - target) < epsilon && Math.abs(this.velocity) < epsilon
  }
}
