import { describe, expect, it } from 'vitest'
import { MARGIN_MS, SETUP_MS, whenToReconnect } from './reconnect'

/** A session that has just opened, in the shape `session.created` sends. */
const NOW = 1_755_432_000_000
const EXPIRES_AT = NOW / 1_000 + 3_597

describe('scheduling the next session', () => {
  it('lands before the deadline by setup plus margin', () => {
    const schedule = whenToReconnect({ expiresAt: EXPIRES_AT, now: NOW })
    expect(schedule.kind).toBe('in')
    if (schedule.kind !== 'in') return
    expect(schedule.ms).toBe(3_597_000 - SETUP_MS - MARGIN_MS)
    // Sanity in human terms: a little under an hour from now.
    expect(schedule.ms).toBeGreaterThan(58 * 60_000)
    expect(schedule.ms).toBeLessThan(60 * 60_000)
  })

  it('says "now" the moment the window has passed, and how late it is', () => {
    // A machine that slept through the timer, or a session picked up late.
    const late = NOW + 3_597_000 - SETUP_MS - MARGIN_MS + 4_000
    expect(whenToReconnect({ expiresAt: EXPIRES_AT, now: late })).toEqual({
      kind: 'now',
      overdueMs: 4_000,
    })
  })

  it('says "now" rather than a negative timer when the session has already expired', () => {
    const after = NOW + 4_000_000
    const schedule = whenToReconnect({ expiresAt: EXPIRES_AT, now: after })
    expect(schedule.kind).toBe('now')
    if (schedule.kind !== 'now') return
    expect(schedule.overdueMs).toBeGreaterThan(0)
  })

  it('treats the exact boundary as now, not as a zero-length timer', () => {
    const exactly = NOW + 3_597_000 - SETUP_MS - MARGIN_MS
    expect(whenToReconnect({ expiresAt: EXPIRES_AT, now: exactly })).toEqual({
      kind: 'now',
      overdueMs: 0,
    })
  })
})

describe('an unusable deadline is said out loud', () => {
  it('refuses values that would schedule nonsense', () => {
    // The failure being prevented: a caller quietly schedules nothing, and finds
    // out an hour later when she stops talking. A session with no usable expiry
    // still dies on time.
    const cases: readonly [string, number][] = [
      ['NaN', Number.NaN],
      ['Infinity', Number.POSITIVE_INFINITY],
      ['zero', 0],
      ['negative', -1],
    ]
    for (const [label, expiresAt] of cases) {
      const schedule = whenToReconnect({ expiresAt, now: NOW })
      expect(schedule.kind, label).toBe('unusable')
    }
  })

  it('refuses a broken clock and a broken budget too', () => {
    expect(whenToReconnect({ expiresAt: EXPIRES_AT, now: Number.NaN }).kind).toBe('unusable')
    expect(whenToReconnect({ expiresAt: EXPIRES_AT, now: NOW, setupMs: -1 }).kind).toBe('unusable')
    expect(whenToReconnect({ expiresAt: EXPIRES_AT, now: NOW, marginMs: Number.NaN }).kind).toBe(
      'unusable',
    )
  })

  it('never returns a negative or non-finite delay', () => {
    // Whatever it is handed, the caller can pass the result to a timer.
    const inputs = [EXPIRES_AT, 1, 1e12, NOW / 1_000]
    for (const expiresAt of inputs) {
      for (const now of [NOW, 0, NOW * 2]) {
        const schedule = whenToReconnect({ expiresAt, now })
        if (schedule.kind === 'in') {
          expect(Number.isFinite(schedule.ms) && schedule.ms > 0, `${expiresAt}/${now}`).toBe(true)
        }
        if (schedule.kind === 'now') {
          expect(Number.isFinite(schedule.overdueMs) && schedule.overdueMs >= 0).toBe(true)
        }
      }
    }
  })
})

describe('the budget is held to the measurements', () => {
  it('still covers the worst full open ever observed', () => {
    // §48 (7 runs, Shenzhen) and §50 (5 runs, Beijing) timed mint + POST + ICE +
    // channel end to end. The worst was 5.8s. If somebody trims `SETUP_MS`
    // below that, this fails and points at the measurement rather than at a
    // preference.
    const WORST_OBSERVED_OPEN_MS = 5_800
    expect(SETUP_MS).toBeGreaterThanOrEqual(WORST_OBSERVED_OPEN_MS)
  })

  it('reconnects early enough that the whole open fits before the deadline', () => {
    // The property that matters, stated as arithmetic rather than as a constant:
    // start at the scheduled moment, spend the worst observed open, and still be
    // done before `expires_at`.
    const schedule = whenToReconnect({ expiresAt: EXPIRES_AT, now: NOW })
    expect(schedule.kind).toBe('in')
    if (schedule.kind !== 'in') return
    const finishedAt = NOW + schedule.ms + 5_800
    expect(finishedAt).toBeLessThan(EXPIRES_AT * 1_000)
  })

  it('reads expires_at as seconds, not milliseconds', () => {
    // Getting this wrong by a factor of a thousand schedules the reconnect
    // either an hour ago or six weeks out, and both read as a plausible number
    // in a log. Anchored on a value whose two readings are far apart.
    const schedule = whenToReconnect({ expiresAt: EXPIRES_AT, now: NOW })
    if (schedule.kind !== 'in') throw new Error('expected a timer')
    // If seconds were read as milliseconds the deadline would be in 1970.
    expect(schedule.ms).toBeGreaterThan(0)
    expect(schedule.ms).toBeLessThan(3_600_000)
  })
})
