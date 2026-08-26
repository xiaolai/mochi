import { describe, expect, it } from 'vitest'

import { createIdleSleep } from './idle-sleep'

/**
 * The timer that decides she has been talking to nobody.
 *
 * The arithmetic here had no test because it lived in a closure in `index.ts`,
 * which cannot be imported — and the two interesting cases are both ones where
 * a wrong answer is silent: an opt-out that becomes an immediate sleep, and a
 * setting change that only takes effect after a restart.
 */

function harness(minutes = 15) {
  let armed: { run: () => void; ms: number } | null = null
  let id = 1
  let asleep = false
  const slept: number[] = []
  const logs: string[] = []
  let setting = minutes

  const idle = createIdleSleep({
    minutes: () => setting,
    asleep: () => asleep,
    sleep: () => {
      asleep = true
      slept.push(1)
    },
    log: (line) => logs.push(line),
    setTimer: (run, ms) => {
      armed = { run, ms }
      return id++
    },
    clearTimer: () => {
      armed = null
    },
  })

  return {
    idle,
    slept,
    logs,
    armedMs: () => armed?.ms ?? null,
    fire: () => {
      const due = armed
      armed = null
      due?.run()
    },
    setTo: (next: number) => {
      setting = next
    },
    rest: () => {
      asleep = true
    },
  }
}

describe('arming the idle timeout', () => {
  it('sets it for the configured minutes', () => {
    const h = harness(15)
    h.idle.arm()
    expect(h.armedMs()).toBe(15 * 60_000)
  })

  it('puts her to rest when it comes due', () => {
    const h = harness(15)
    h.idle.arm()
    h.fire()
    expect(h.slept).toHaveLength(1)
    expect(h.logs.join(' ')).toContain('15 minutes')
  })

  it('replaces a pending one rather than stacking', () => {
    // Armed on every stir, so a session with any conversation in it arms this
    // hundreds of times. Two live timers would put her to sleep mid-sentence.
    const h = harness(15)
    h.idle.arm()
    h.idle.arm()
    h.idle.arm()
    h.fire()
    expect(h.slept).toHaveLength(1)
  })

  it('does nothing while she is already resting', () => {
    const h = harness(15)
    h.rest()
    h.idle.arm()
    expect(h.idle.pending()).toBe(false)
  })
})

describe('the opt-out', () => {
  it('arms nothing at all for zero', () => {
    /*
      "Never" and "in a thousand hours" are different promises, and only one of
      them survives a machine that stays awake for a week. Turning zero into a
      long timer would break exactly the case somebody choosing zero is
      choosing for.
    */
    const h = harness(0)
    h.idle.arm()
    expect(h.idle.pending()).toBe(false)
  })

  it('treats a nonsense setting as the opt-out, not as "now"', () => {
    // A negative or NaN setting reaching `setTimeout` fires immediately, which
    // would put her to sleep the moment she woke — and look like the app
    // refusing to stay awake rather than like a bad value.
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const h = harness(bad)
      h.idle.arm()
      expect(h.idle.pending(), `armed for ${String(bad)}`).toBe(false)
    }
  })
})

describe('a setting changed mid-conversation', () => {
  it('takes effect on the next arming, not the next restart', () => {
    /*
      The setting is in a window somebody can open while she is listening, and
      this is re-armed on every stir. Reading it once at construction would
      make a change wait for a restart — which is indistinguishable from a
      preference that does not work.
    */
    const h = harness(15)
    h.idle.arm()
    expect(h.armedMs()).toBe(15 * 60_000)
    h.setTo(2)
    h.idle.arm()
    expect(h.armedMs()).toBe(2 * 60_000)
  })

  it('honours a switch to the opt-out immediately', () => {
    const h = harness(15)
    h.idle.arm()
    h.setTo(0)
    h.idle.arm()
    expect(h.idle.pending()).toBe(false)
  })
})

describe('a timeout too long for the timer', () => {
  it('does not overflow into an immediate sleep', () => {
    /*
      Past 2^31-1 ms the delay overflows a signed 32-bit int and Node coerces it
      to 1 — so the longest possible timeout fires at once. `SLEEP_AFTER_MAX`
      keeps the setting under this today, but the two numbers live in different
      files and nothing connects them.
    */
    const h = harness(60_000)
    h.idle.arm()
    expect(h.armedMs()).toBeLessThanOrEqual(2_147_483_647)
    expect(h.armedMs()).toBeGreaterThan(60_000)
  })
})

describe('stopping', () => {
  it('cancels a pending sleep', () => {
    const h = harness(15)
    h.idle.arm()
    h.idle.stop()
    expect(h.idle.pending()).toBe(false)
  })

  it('is safe when nothing is armed', () => {
    const h = harness(15)
    expect(() => {
      h.idle.stop()
      h.idle.stop()
    }).not.toThrow()
  })
})
