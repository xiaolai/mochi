import { describe, expect, it } from 'vitest'
import { checkedLabel, versionMark } from './freshness'

const NOW = 1_700_000_000_000
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

describe('the version as it is printed', () => {
  it('takes the number out of what the CLI actually prints', () => {
    // The real string off this machine, not a bare number supplied here.
    expect(versionMark('codex-cli 0.151.0')).toBe('v0.151.0')
  })

  it('says nothing rather than "vunknown version"', () => {
    expect(versionMark('unknown version')).toBeNull()
  })

  it('has nothing to print when nothing came back', () => {
    expect(versionMark(null)).toBeNull()
  })
})

describe('how old the claim is', () => {
  it('draws B1’s line', () => {
    expect(
      checkedLabel({ checkedAt: NOW - 2 * MINUTE, now: NOW, version: 'codex-cli 0.148.0' }),
    ).toBe('checked 2 minutes ago · v0.148.0')
  })

  it('does not say "0 minutes ago"', () => {
    expect(checkedLabel({ checkedAt: NOW - 3_000, now: NOW, version: null })).toBe(
      'checked just now',
    )
  })

  it('counts one of a thing without an s', () => {
    expect(checkedLabel({ checkedAt: NOW - MINUTE, now: NOW, version: null })).toBe(
      'checked 1 minute ago',
    )
    expect(checkedLabel({ checkedAt: NOW - HOUR, now: NOW, version: null })).toBe(
      'checked 1 hour ago',
    )
    expect(checkedLabel({ checkedAt: NOW - DAY, now: NOW, version: null })).toBe(
      'checked 1 day ago',
    )
  })

  it('coarsens rather than counting 240 minutes', () => {
    expect(checkedLabel({ checkedAt: NOW - 4 * HOUR, now: NOW, version: null })).toBe(
      'checked 4 hours ago',
    )
    expect(checkedLabel({ checkedAt: NOW - 9 * DAY, now: NOW, version: null })).toBe(
      'checked 9 days ago',
    )
  })

  it('keeps the version when the clock moved under it', () => {
    // A stamp in the future is a clock change, not a check that has not run.
    // The elapsed time is not a measurement; the version still is.
    expect(checkedLabel({ checkedAt: NOW + HOUR, now: NOW, version: 'codex-cli 0.151.0' })).toBe(
      'v0.151.0',
    )
  })

  it('has nothing to say before the first check comes back', () => {
    expect(checkedLabel({ checkedAt: null, now: NOW, version: null })).toBeNull()
  })
})
