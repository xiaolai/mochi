import { FLOOR_MS, whenToReconnect } from '@shared/realtime/reconnect'

/**
 * When she opens her next session — and the guarantee that she opens one.
 *
 * ## The failure this exists for
 *
 * The reconnect had exactly ONE trigger: the `expiry` report, which the
 * renderer sends on `session.created`. That frame is the first one a session
 * produces, so anything that kills a session before it — a mint that
 * succeeded and an ICE negotiation that did not, a data channel that opened
 * and aborted, a network that went away during the handshake — announced no
 * deadline, and the only code that ever set a timer never ran.
 *
 * There is nothing to see when this happens. No timer is set, so no timer
 * fires; nothing throws, so nothing is logged. She simply never comes back,
 * and the state is indistinguishable from a room nobody is talking in.
 *
 * ## What replaces it
 *
 * Two triggers, and the weaker one is unconditional:
 *
 *   - `opened()` arms a FLOOR the moment a session is minted, before any frame
 *     has been seen. Blind, generous (50 minutes), and always set.
 *   - `announced()` replaces it with the precise schedule when `expires_at`
 *     actually arrives. This is the good path and it is unchanged.
 *
 * A floor that is merely *early* costs one extra reconnect nobody notices. A
 * missing floor costs the session. The asymmetry is why the fallback is
 * arm-always rather than arm-on-suspicion.
 *
 * ## And why waking the machine re-asks
 *
 * `setTimeout` does not run while the machine is asleep, and it does not catch
 * up afterwards: a laptop closed for two hours reopens with a timer that still
 * believes it has forty minutes left, on a session that expired ninety minutes
 * ago. `resumed()` re-evaluates against the wall clock, which is the only
 * thing that knows time passed.
 */

/**
 * Whatever `setTimeout` hands back here.
 *
 * Written as the UNION rather than as `NodeJS.Timeout`, and rather than as
 * `ReturnType<typeof setTimeout>`. The test project loads both the DOM and the
 * Node libs, so `setTimeout` there is a genuine overload set returning
 * `number | NodeJS.Timeout` — and `ReturnType` on an overloaded function
 * resolves to the LAST signature only, which is how a type that looked derived
 * ended up narrower than the values it had to hold.
 *
 * `clearTimeout` accepts either, so stating the union costs nothing and no
 * cast is needed anywhere.
 */
type Timer = NodeJS.Timeout | number

/**
 * The largest delay `setTimeout` actually honours.
 *
 * Past 2^31-1 milliseconds the delay overflows a signed 32-bit int and Node
 * coerces it to **1** — so an absurdly distant deadline fires at once rather
 * than never, which is the exact inversion of what the caller asked for. Here
 * that means an immediate reconnect, and the reconnect arms another timer, so
 * the failure is a loop rather than a single mistake.
 *
 * `expiresAt` is renderer-supplied Unix seconds. `readVoiceReport` bounds it to
 * a safe integer, which still leaves values thousands of years out — a bound on
 * *representability* is not a bound on *plausibility*, and this is the second
 * of the two.
 */
const LONGEST_DELAY_MS = 2_147_483_647

export interface NextSession {
  /**
   * A session was minted. Arm the blind floor.
   *
   * Called on every open, including the ones that go on to fail — a session
   * that failed still needs a next one.
   */
  opened(): void
  /**
   * The service announced when this session ends. Replace the floor with the
   * real schedule.
   *
   * `expiresAt` is absolute Unix **seconds**, as `session.created` sends it.
   */
  announced(expiresAt: number): void
  /**
   * The machine woke up. Re-decide, because the timer slept too.
   *
   * Does nothing when no session is pending, so a resume while she is resting
   * is not a way to wake her.
   */
  resumed(): void
  /** She is resting, or shutting down. Nothing is pending. */
  cancel(): void
  /** For tests and for the log: is a reconnect currently pending? */
  pending(): boolean
}

export interface NextSessionDeps {
  /** Open the next session. Called on the main thread when the timer fires. */
  readonly reconnect: () => void
  /** Whether she may reconnect at all right now. Checked AT the firing. */
  readonly awake: () => boolean
  /** Say something is wrong, where somebody will see it. */
  readonly note: (why: string) => void
  readonly log?: (line: string) => void
  readonly now?: () => number
  readonly setTimer?: (run: () => void, ms: number) => Timer
  readonly clearTimer?: (timer: Timer) => void
}

export function createNextSession(deps: NextSessionDeps): NextSession {
  const now = deps.now ?? Date.now
  const setTimer = deps.setTimer ?? setTimeout
  const clearTimer = deps.clearTimer ?? clearTimeout
  const log =
    deps.log ??
    ((line: string) => {
      console.log(line)
    })

  let timer: Timer | null = null
  /**
   * The announced deadline, kept so `resumed()` can re-decide against it.
   *
   * Null while running on the floor — there is nothing to recompute from, so a
   * resume re-arms the floor rather than pretending to know better.
   */
  let expiresAt: number | null = null

  function clear(): void {
    if (timer !== null) clearTimer(timer)
    timer = null
  }

  function arm(ms: number): void {
    clear()
    /*
      CLAMPED BOTH WAYS before it reaches `setTimeout`.

      Above `LONGEST_DELAY_MS` the delay overflows and fires immediately, which
      would open a session at once and arm another timer -- a loop, not a
      mistake. Below zero is `setTimeout`'s own "run now", which is wanted for
      an overdue reconnect and never for anything else.
    */
    const delay = Math.min(Math.max(ms, 0), LONGEST_DELAY_MS)
    if (delay !== ms) {
      log(`[voice] a reconnect delay of ${String(ms)}ms was clamped to ${String(delay)}ms`)
    }
    timer = setTimer(() => {
      timer = null
      /*
        Checked AT THE FIRING, not only when it was set.

        An hour is long enough for her to have been put to rest since -- by the
        key, the menu, or the idle timeout -- and `cancel` clears this, so the
        two agree. Checking again closes the window between "the timer is about
        to fire" and "the clear arrives".
      */
      if (!deps.awake()) {
        log('[voice] reconnect due, and she is resting; nothing opened')
        return
      }
      log('[voice] reconnect due')
      /*
        GUARDED, AND RE-ARMED ON FAILURE.

        `timer` is already null by the time this runs, so a throw from
        `reconnect()` escaped the callback and left NOTHING scheduled -- which
        is this module's own defect returning by another route: no timer, no
        log about a timer, and she never comes back.

        It is reachable. `reconnect` reaches `webContents.send` on a window
        that can die between its destroyed-check and the send.

        Re-armed at the floor rather than immediately: a window that is gone
        stays gone for a while, and retrying with no delay turns one failure
        into a loop that fills the log and the problems pane.
      */
      try {
        deps.reconnect()
      } catch (error: unknown) {
        deps.note(`the next session could not be opened: ${String(error)}`)
        arm(FLOOR_MS)
      }
    }, delay)
  }

  return {
    opened() {
      // Only if nothing better is already set. A reconnect that opens a session
      // would otherwise throw away the precise schedule it just computed and
      // replace it with the blind one.
      if (expiresAt !== null) return
      log(`[voice] no deadline yet; a floor reconnect is set for ${String(FLOOR_MS / 60_000)}min`)
      arm(FLOOR_MS)
    },

    announced(at) {
      const schedule = whenToReconnect({ expiresAt: at, now: now() })
      if (schedule.kind === 'unusable') {
        /*
          NOT silence, and not the floor being dropped either.

          `Schedule` says this case is "never silently treated as never
          reconnect". Before this module that promise was only half kept: the
          caller noted the problem and returned, leaving whatever timer existed
          -- which, on the path where the first frame was also the broken one,
          was none. Keeping the floor is what makes the promise true.
        */
        deps.note(`cannot schedule a reconnect: ${schedule.why}`)
        if (timer === null) arm(FLOOR_MS)
        return
      }
      expiresAt = at
      const ms = schedule.kind === 'in' ? schedule.ms : 0
      log(
        `[voice] session expires in ${String(at - now() / 1_000)}s; reconnect in ${String(Math.round(ms / 1_000))}s`,
      )
      arm(ms)
    },

    resumed() {
      // Nothing pending means she is resting or has not opened anything. A
      // resume is not a wake.
      if (timer === null) return
      if (expiresAt === null) {
        // Running blind. The wall clock cannot improve on a floor we have no
        // deadline for, so re-arm it rather than invent one.
        log('[voice] woke with no announced deadline; the floor is re-armed')
        arm(FLOOR_MS)
        return
      }
      const schedule = whenToReconnect({ expiresAt, now: now() })
      if (schedule.kind === 'unusable') {
        deps.note(`cannot reschedule after waking: ${schedule.why}`)
        arm(FLOOR_MS)
        return
      }
      if (schedule.kind === 'now') {
        // The ordinary laptop-lid case: the deadline passed while the machine
        // was asleep and the timer never ran.
        log(`[voice] woke ${String(Math.round(schedule.overdueMs / 1_000))}s past the reconnect`)
        arm(0)
        return
      }
      arm(schedule.ms)
    },

    cancel() {
      clear()
      expiresAt = null
    },

    pending() {
      return timer !== null
    },
  }
}
