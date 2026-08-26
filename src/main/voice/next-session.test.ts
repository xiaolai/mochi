import { describe, expect, it } from 'vitest'

import { FLOOR_MS, MARGIN_MS, SETUP_MS } from '@shared/realtime/reconnect'
import { createNextSession } from './next-session'
import type { NextSession } from './next-session'

/**
 * The guarantee: once a session opens, a reconnect is pending.
 *
 * The case that matters most is the one with no `expires_at` at all. Before
 * this module there was a single trigger, downstream of the first frame, so a
 * session that died during the handshake scheduled nothing and she never came
 * back — with nothing logged, because nothing had happened.
 */

/** A controllable clock and timer, so a whole hour costs no wall time. */
function harness(startedAt = 1_700_000_000_000) {
  let clock = startedAt
  let armed: { run: () => void; ms: number } | null = null
  let nextId = 1
  const reconnects: number[] = []
  const notes: string[] = []
  const logs: string[] = []
  let awake = true

  const next: NextSession = createNextSession({
    reconnect: () => reconnects.push(clock),
    awake: () => awake,
    note: (why) => notes.push(why),
    log: (line) => logs.push(line),
    now: () => clock,
    setTimer: (run, ms) => {
      armed = { run, ms }
      return nextId++
    },
    clearTimer: () => {
      armed = null
    },
  })

  return {
    next,
    reconnects,
    notes,
    logs,
    armedMs: () => armed?.ms ?? null,
    /** Move the clock and fire the timer if it is due. */
    advance(ms: number) {
      clock += ms
      const due = armed
      if (due !== null && ms >= due.ms) {
        armed = null
        due.run()
      }
    },
    sleepMachine(ms: number) {
      // Time passes and the timer does NOT fire. This is what macOS does.
      clock += ms
    },
    rest() {
      awake = false
    },
  }
}

/** Seconds, as `session.created` sends it. */
const inAnHour = (clockMs: number): number => (clockMs + 3_600_000) / 1_000

describe('a session that never announces a deadline', () => {
  it('still has a reconnect pending', () => {
    /*
      THE BUG.

      `expires_at` rides `session.created` -- the FIRST frame. A session that
      dies before it announces nothing, and the only trigger never fires.
    */
    const h = harness()
    h.next.opened()
    expect(h.next.pending()).toBe(true)
    expect(h.armedMs()).toBe(FLOOR_MS)
  })

  it('opens the next session when the floor comes due', () => {
    const h = harness()
    h.next.opened()
    h.advance(FLOOR_MS)
    expect(h.reconnects).toHaveLength(1)
  })

  it('does not open one while she is resting', () => {
    const h = harness()
    h.next.opened()
    h.rest()
    h.advance(FLOOR_MS)
    expect(h.reconnects).toHaveLength(0)
  })
})

describe('a session that does announce a deadline', () => {
  it('replaces the floor with the precise schedule', () => {
    const h = harness()
    h.next.opened()
    expect(h.armedMs()).toBe(FLOOR_MS)
    h.next.announced(inAnHour(1_700_000_000_000))
    // An hour, less the setup budget and the margin.
    expect(h.armedMs()).toBe(3_600_000 - SETUP_MS - MARGIN_MS)
  })

  it('does not let a later `opened` throw the precise schedule away', () => {
    // The reconnect itself opens a session. Without this guard the good
    // schedule is replaced by the blind one on every hop.
    const h = harness()
    h.next.announced(inAnHour(1_700_000_000_000))
    const precise = h.armedMs()
    h.next.opened()
    expect(h.armedMs()).toBe(precise)
  })

  it('keeps a floor when the announced deadline is unusable', () => {
    /*
      `Schedule` promises this is "never silently treated as never reconnect".
      The caller used to note the problem and return, which kept the promise
      only when some other timer happened to exist -- and on the path where the
      first frame is the broken one, none does.
    */
    const h = harness()
    h.next.announced(Number.NaN)
    expect(h.notes.join(' ')).toContain('cannot schedule a reconnect')
    expect(h.next.pending()).toBe(true)
    expect(h.armedMs()).toBe(FLOOR_MS)
  })

  it('opens immediately when the deadline has already passed', () => {
    const h = harness()
    h.next.announced((1_700_000_000_000 - 60_000) / 1_000)
    expect(h.armedMs()).toBe(0)
  })
})

describe('a machine that went to sleep', () => {
  it('opens at once when it wakes past the deadline', () => {
    /*
      `setTimeout` does not run while the machine is asleep and does not catch
      up afterwards. A lid closed for two hours reopens with a timer that still
      believes it has forty minutes left, on a session that died ninety minutes
      ago.
    */
    const h = harness()
    h.next.announced(inAnHour(1_700_000_000_000))
    h.sleepMachine(2 * 3_600_000)
    h.next.resumed()
    expect(h.armedMs()).toBe(0)
    expect(h.logs.join(' ')).toContain('past the reconnect')
  })

  it('re-decides from the wall clock when it wakes early', () => {
    const h = harness()
    h.next.announced(inAnHour(1_700_000_000_000))
    h.sleepMachine(600_000)
    h.next.resumed()
    expect(h.armedMs()).toBe(3_600_000 - SETUP_MS - MARGIN_MS - 600_000)
  })

  it('re-arms the floor when it wakes with no announced deadline', () => {
    const h = harness()
    h.next.opened()
    h.sleepMachine(30 * 60_000)
    h.next.resumed()
    expect(h.armedMs()).toBe(FLOOR_MS)
  })

  it('is not a way to wake her when nothing is pending', () => {
    const h = harness()
    h.next.resumed()
    expect(h.next.pending()).toBe(false)
    expect(h.reconnects).toHaveLength(0)
  })

  it('is not a way to wake her after she was put to rest', () => {
    const h = harness()
    h.next.announced(inAnHour(1_700_000_000_000))
    h.next.cancel()
    h.next.resumed()
    expect(h.next.pending()).toBe(false)
  })
})

describe('cancelling', () => {
  it('forgets the deadline as well as the timer', () => {
    // Otherwise a later `opened()` sees a stale `expiresAt`, declines to arm
    // the floor, and leaves nothing pending at all -- the original bug, by a
    // different route.
    const h = harness()
    h.next.announced(inAnHour(1_700_000_000_000))
    h.next.cancel()
    h.next.opened()
    expect(h.next.pending()).toBe(true)
    expect(h.armedMs()).toBe(FLOOR_MS)
  })
})

describe('a deadline so distant the timer cannot hold it', () => {
  /**
   * Past 2^31-1 milliseconds `setTimeout` overflows a signed 32-bit int and
   * Node coerces the delay to **1** — so an absurdly distant deadline fires at
   * once rather than never. Here that opens a session immediately, and the
   * reconnect arms another timer, so the failure is a loop.
   *
   * `readVoiceReport` bounds `expiresAt` to a safe integer, which still leaves
   * values thousands of years out. A bound on representability is not a bound
   * on plausibility.
   */
  it('does not turn a distant deadline into an immediate reconnect', () => {
    const h = harness()
    // A safe integer, and about 300 years away in seconds.
    h.next.announced(10_000_000_000)
    expect(h.armedMs()).toBeLessThanOrEqual(2_147_483_647)
    expect(h.armedMs()).toBeGreaterThan(0)
  })

  it('says when it clamped, rather than silently rescheduling', () => {
    const h = harness()
    h.next.announced(10_000_000_000)
    expect(h.logs.join(' ')).toContain('clamped')
  })

  it('still opens at once for a deadline that has genuinely passed', () => {
    // The clamp must not swallow the overdue case, which is the one place a
    // zero delay is correct.
    const h = harness()
    h.next.announced((1_700_000_000_000 - 60_000) / 1_000)
    expect(h.armedMs()).toBe(0)
  })
})
