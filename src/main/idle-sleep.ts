/**
 * How long a room stays quiet before she stops listening.
 *
 * ## Why zero is checked rather than converted
 *
 * Zero is the opt-out, and it is refused here rather than turned into a very
 * long timer. *"Never"* and *"in a thousand hours"* are different promises, and
 * only one of them survives the machine being awake for a week — which is the
 * case somebody who chose "never" is choosing for.
 *
 * ## Why the minutes are read on ARMING, not held
 *
 * The setting is in a window somebody can open mid-conversation, and this timer
 * is re-armed on every stir. Holding the value would mean a change took effect
 * only after the next restart, and a preference that silently waits for one is
 * indistinguishable from a preference that does not work.
 *
 * ## Why it is a module
 *
 * One binding with a reference span of twelve lines, and the grill report
 * measured it as one of three clusters that leave `index.ts` at zero coupling
 * cost. What comes with it is the arithmetic — minutes to milliseconds, and the
 * bound below — which had no test because it was inside a closure in a file
 * that cannot be imported.
 */

type Timer = NodeJS.Timeout | number

/**
 * The longest delay `setTimeout` honours.
 *
 * Past 2^31-1 milliseconds the delay overflows a signed 32-bit int and Node
 * coerces it to **1** — so a very distant timeout fires at once rather than
 * never. Here that would put her to sleep immediately, which is the exact
 * inverse of what a long idle timeout asks for.
 *
 * `SLEEP_AFTER_MAX` keeps the setting well under this today. The clamp is here
 * anyway because the two numbers live in different files and nothing connects
 * them, so a later change to the maximum would not know to come and look.
 */
const LONGEST_DELAY_MS = 2_147_483_647

export interface IdleSleep {
  /**
   * Something happened. Start the clock again.
   *
   * Does nothing when she is already resting — there is nothing to put to
   * sleep — and nothing when the timeout is off.
   */
  arm(): void
  /** Stop it. She is resting, being woken, or the app is going away. */
  stop(): void
  /** For tests and for the log: is a sleep pending? */
  pending(): boolean
}

export interface IdleSleepDeps {
  /** How many minutes of quiet. Read per arming — see the header. */
  readonly minutes: () => number
  /** Whether she is already resting. */
  readonly asleep: () => boolean
  /** Put her to rest. */
  readonly sleep: () => void
  readonly log: (line: string) => void
  readonly setTimer?: (run: () => void, ms: number) => Timer
  readonly clearTimer?: (timer: Timer) => void
}

export function createIdleSleep(deps: IdleSleepDeps): IdleSleep {
  const setTimer = deps.setTimer ?? setTimeout
  const clearTimer = deps.clearTimer ?? clearTimeout
  let timer: Timer | null = null

  function stop(): void {
    if (timer !== null) clearTimer(timer)
    timer = null
  }

  return {
    stop,

    arm() {
      stop()
      if (deps.asleep()) return
      const minutes = deps.minutes()
      // The opt-out. See the header for why this is not a long timer.
      if (minutes === 0) return
      // A negative or unusable setting is the opt-out too, rather than a timer
      // that fires immediately and puts her to sleep the moment she wakes.
      if (!Number.isFinite(minutes) || minutes < 0) return
      const ms = Math.min(minutes * 60_000, LONGEST_DELAY_MS)
      timer = setTimer(() => {
        timer = null
        deps.log(`[rest] ${String(minutes)} minutes with nothing said`)
        deps.sleep()
      }, ms)
    },

    pending: () => timer !== null,
  }
}
