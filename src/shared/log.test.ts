import { afterEach, describe, expect, it, vi } from 'vitest'
import { installLogStamp, isStamped, runName, splitStamp, stamp, writeForwarded } from './log'

const AT = new Date(2026, 7, 16, 19, 40, 33, 412)

/** The offset this machine is in, so the expectations do not assume one. */
const OFFSET = ((): string => {
  const behind = AT.getTimezoneOffset()
  const pad = (value: number): string => String(value).padStart(2, '0')
  const minutes = Math.abs(behind)
  return `${behind <= 0 ? '+' : '-'}${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`
})()
const CLOCK = `2026-08-16T19:40:33.412${OFFSET}`

/** Every test installs; this guarantees none of them leaves the console rewritten. */
let uninstall: (() => void) | null = null
afterEach(() => {
  uninstall?.()
  uninstall = null
  vi.restoreAllMocks()
})

describe('the wall clock', () => {
  it('is fixed width, so lines align in a scrollback', () => {
    // Not cosmetic. A column that moves cannot be read down, and reading down
    // is the whole reason for putting the time first.
    expect(stamp(AT)).toBe(CLOCK)
    expect(stamp(AT)).toHaveLength(29)
    expect(stamp(new Date(2026, 0, 1, 1, 2, 3, 4))).toHaveLength(29)
    expect(stamp(new Date(2026, 0, 1, 1, 2, 3, 4)).slice(0, 23)).toBe('2026-01-01T01:02:03.004')
  })

  it('carries the date, because a resident process runs past midnight', () => {
    // The defect this replaced: `00:00:01.000` sorts before `23:59:59.000` from
    // the evening before, so the log of an app left running overnight could not
    // be ordered at all.
    const evening = stamp(new Date(2026, 7, 16, 23, 59, 59, 0))
    const after = stamp(new Date(2026, 7, 17, 0, 0, 1, 0))
    expect(after > evening, 'the later line must sort later').toBe(true)
  })

  it('carries the UTC offset, so a daylight-saving repeat is not ambiguous', () => {
    // A fall-back prints the same local hour twice. Without the offset the two
    // passes are indistinguishable; with it they are not.
    expect(stamp(AT)).toMatch(/[+-]\d{2}:\d{2}$/)
  })

  it('recognises its own shape, and does not match a line that merely starts with digits', () => {
    expect(isStamped(`${CLOCK} [voice] hello`)).toBe(true)
    expect(isStamped(CLOCK)).toBe(true)
    expect(isStamped('[voice +50846ms] hello')).toBe(false)
    expect(isStamped('12345 items')).toBe(false)
    // The old time-only shape. Accepting it would strip a stamp from a line
    // that never carried one under the current grammar.
    expect(isStamped('19:40:33.412 [voice]')).toBe(false)
    // Close, but a millisecond short.
    expect(isStamped(`2026-08-16T19:40:33.41${OFFSET} [voice]`)).toBe(false)
  })

  it('splits a stamped line into its clock and the rest, once', () => {
    expect(splitStamp(`${CLOCK} [voice] hi`)).toEqual({ at: CLOCK, rest: '[voice] hi' })
    // A clock-only line, which the second copy of this grammar used to reject
    // -- and so tagged in FRONT of its own clock and stamped it again.
    expect(splitStamp(CLOCK)).toEqual({ at: CLOCK, rest: '' })
    expect(splitStamp('[voice] hi')).toBe(null)
  })
})

describe('stamping the console', () => {
  it('puts the clock in front of every line', () => {
    const seen: unknown[][] = []
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => void seen.push(args))
    uninstall = installLogStamp(() => AT)
    console.log('[memory] codex exited with 1')
    expect(seen[0]).toEqual([`${CLOCK} [memory] codex exited with 1`])
  })

  it('leaves console placeholders working', () => {
    // The regression this asserts: passing the clock as a NEW first argument
    // makes it the format string, so `%s` never substitutes and every
    // placeholder in the app breaks silently the day stamping arrives.
    const seen: unknown[][] = []
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => void seen.push(args))
    uninstall = installLogStamp(() => AT)
    console.log('value=%s', 42)
    expect(seen[0]).toEqual([`${CLOCK} value=%s`, 42])
  })

  it('still stamps when the first argument is not a string', () => {
    const seen: unknown[][] = []
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => void seen.push(args))
    uninstall = installLogStamp(() => AT)
    const boom = new Error('boom')
    console.log(boom)
    expect(seen[0]).toEqual([CLOCK, boom])
  })

  it('stamps warnings and errors too, not just logs', () => {
    // `[memory]` and `[recall]` warn rather than log, and those are exactly the
    // lines that needed ordering against the renderer's narration.
    const seen: unknown[][] = []
    vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => void seen.push(a))
    vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => void seen.push(a))
    uninstall = installLogStamp(() => AT)
    console.warn('a warning')
    console.error('an error')
    expect(seen).toEqual([[`${CLOCK} a warning`], [`${CLOCK} an error`]])
  })

  it('stamps a line that merely looks forwarded, because provenance is not a shape', () => {
    // The defect this replaced: the wrapper sniffed every message for something
    // clock-shaped and skipped stamping it. Ordinary text of that shape -- a
    // transcript of somebody reading a time out loud -- escaped stamping and
    // was then read as though it had come from the other process.
    const seen: unknown[][] = []
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void seen.push(a))
    uninstall = installLogStamp(() => AT)
    console.log(`${CLOCK} SHE SAID: "the meeting is at nine"`)
    expect(seen[0]).toEqual([`${CLOCK} ${CLOCK} SHE SAID: "the meeting is at nine"`])
  })

  it('does not stamp a line the forwarder declares already stamped', () => {
    // The renderer stamps its own lines and they are forwarded through main's
    // console. Stamping again would print two clocks, and dropping the
    // renderer's would replace emission time with arrival time -- so two events
    // milliseconds apart could print in the wrong order.
    const seen: unknown[][] = []
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void seen.push(a))
    uninstall = installLogStamp(() => AT)
    writeForwarded('log', `2026-08-16T19:40:33.001${OFFSET} [companion] mic open`)
    expect(seen[0]).toEqual([`2026-08-16T19:40:33.001${OFFSET} [companion] mic open`])
  })

  it('forwards through an ordinary console when nothing is installed', () => {
    const seen: unknown[][] = []
    vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => void seen.push(a))
    writeForwarded('warn', 'no installation here')
    expect(seen[0]).toEqual(['no installation here'])
  })

  it('is idempotent, because a hot reload imports the entry point twice', () => {
    // ASSERTED ON THE UNINSTALL, not on the output, and the first version of
    // this test got that wrong: it checked that a doubly-installed console
    // printed one stamp, which passes with the idempotence flag DELETED --
    // because the already-stamped check catches the second pass anyway. It
    // agreed with the code and proved nothing.
    //
    // What the flag actually buys is that a second install adds no second
    // wrapper. Without it, `uninstall` unwinds one layer and leaves the other,
    // so the console is never restored and every later line in the process
    // carries a stamp from a module that believes it has cleaned up.
    const before = console.log
    const off = installLogStamp(() => AT)
    const again = installLogStamp(() => AT)
    expect(again, 'a second install built a second uninstall').toBe(off)
    off()
    expect(console.log, 'a wrapper survived the uninstall').toBe(before)
  })

  it('puts the console back exactly as it found it', () => {
    // A suite whose first importer permanently rewrites `console` is a suite
    // whose later failures print wrong.
    const before = console.log
    const off = installLogStamp(() => AT)
    expect(console.log).not.toBe(before)
    off()
    expect(console.log).toBe(before)
  })

  it('will not let a stale uninstall unwind a newer installation', () => {
    // The defect: uninstall restored whatever it had captured over whatever
    // happened to be there. Called after a reinstall it put the FIRST
    // installation's originals back over the SECOND's wrappers and deleted the
    // second's marker -- so the process logged unstamped while the live
    // installation believed it owned the console.
    const before = console.log
    const first = installLogStamp(() => AT)
    first()
    const second = installLogStamp(() => AT)
    const live = console.log
    first()
    expect(console.log, 'the stale uninstall unwound the live installation').toBe(live)
    second()
    expect(console.log).toBe(before)
  })

  it('refuses to unwrap a console somebody else has since wrapped', () => {
    const before = console.log
    const off = installLogStamp(() => AT)
    const mine = (...args: unknown[]): void => void args
    console.log = mine
    off()
    expect(console.log, 'a later wrapper was clobbered').toBe(mine)
    console.log = before
    // The record is still ours, so the console is still reported as installed;
    // cleaning up for the next test now works because our wrapper is gone.
    installLogStamp(() => AT)()
    console.log = before
  })

  it('fails loudly when the marker is not an installation record', () => {
    // The quiet version of this shipped: a marker with no usable uninstall made
    // `installLogStamp` return a no-op that claimed success, and the process
    // logged unstamped for the rest of its life.
    const slot = Symbol.for('mochi.log.installation')
    const host = console as unknown as Record<symbol, unknown>
    host[slot] = { token: 'not a symbol' }
    try {
      expect(() => installLogStamp(() => AT)).toThrow(/not an installation record/)
    } finally {
      delete host[slot]
    }
  })
})

describe('naming one launch', () => {
  it('is short enough to compare by eye and carries the date', () => {
    expect(runName(AT, () => 0)).toBe('0816-000')
    expect(runName(AT, () => 0.5)).toMatch(/^0816-[0-9a-z]{3}$/)
  })

  it('separates two launches on the same day', () => {
    expect(runName(AT, () => 0.1)).not.toBe(runName(AT, () => 0.9))
  })
})
