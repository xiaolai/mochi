import { describe, expect, it } from 'vitest'
import {
  COMPANION_CHANNELS,
  PRIVATE_FRAME_PREFIX,
  SETTINGS_CHANNELS,
  SHELF_CHANNELS,
  isCompanionChannel,
  isPrivateFrame,
  isSettingsChannel,
  isShelfChannel,
} from './ipc'

describe('isCompanionChannel', () => {
  it('accepts every channel that is actually declared', () => {
    for (const channel of COMPANION_CHANNELS) {
      expect(isCompanionChannel(channel)).toBe(true)
    }
  })

  it('rejects a name that only looks like one', () => {
    expect(isCompanionChannel('companion:pong')).toBe(false)
    expect(isCompanionChannel('companion:')).toBe(false)
    expect(isCompanionChannel('companion:ping ')).toBe(false)
  })

  it('rejects values that are not strings instead of coercing them', () => {
    // The far side of this boundary is a web page, so the guard is reached with
    // whatever that page chose to send — not only with the type it promised.
    for (const value of [null, undefined, 42, {}, ['companion:ping']]) {
      expect(isCompanionChannel(value)).toBe(false)
    }
  })

  it('rejects inherited object keys', () => {
    // This is the assertion that survives a refactor. `includes` on an array
    // gets it right for free, but the obvious "faster" rewrite — a lookup object
    // tested with `map[name] !== undefined` — answers true for `constructor` and
    // `toString`, and would open channels nobody declared. The test is aimed at
    // the rewrite, not at today's implementation.
    for (const key of ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__']) {
      expect(isCompanionChannel(key)).toBe(false)
    }
  })
})

describe('frames main sends the renderer rather than the service', () => {
  /**
   * Every private type main puts on `voice:send`, listed here on purpose.
   *
   * The renderer forwards that channel to the peer, and until `isPrivateFrame`
   * existed it forwarded ALL of it — so every one of these was also written out
   * to OpenAI. `__mochi_grants__` carries her whole assembled prompt and her
   * tool list, which is what turned a stray unknown event into a leak.
   */
  const PRIVATE = [
    '__mochi_reconnect__',
    '__mochi_problems__',
    '__mochi_asleep__',
    '__mochi_stance__',
    '__mochi_bubble_side__',
    '__mochi_grants__',
  ]

  it.each(PRIVATE)('keeps %s off the wire', (type) => {
    expect(isPrivateFrame({ type })).toBe(true)
  })

  it('lets the ledger’s answers through, which are the whole point of the channel', () => {
    expect(
      isPrivateFrame({
        type: 'conversation.item.create',
        item: { type: 'function_call_output', call_id: 'c', output: '{}' },
      }),
    ).toBe(false)
  })

  it('is not fooled by a frame with no type, or one that is not an object', () => {
    for (const frame of [null, undefined, 'text', 42, {}, { type: 7 }]) {
      expect(isPrivateFrame(frame)).toBe(false)
    }
  })

  it('agrees with the prefix it publishes', () => {
    // Two spellings of this rule is how one end starts leaking what the other
    // end is filtering.
    for (const type of PRIVATE) expect(type.startsWith(PRIVATE_FRAME_PREFIX)).toBe(true)
  })
})

describe('three allowlists, and none of them reaches another', () => {
  const LISTS = [
    { name: 'companion', channels: COMPANION_CHANNELS, admits: isCompanionChannel },
    { name: 'shelf', channels: SHELF_CHANNELS, admits: isShelfChannel },
    { name: 'settings', channels: SETTINGS_CHANNELS, admits: isSettingsChannel },
  ] as const

  it.each(LISTS)('$name admits every channel it declares', ({ channels, admits }) => {
    for (const channel of channels) expect(admits(channel)).toBe(true)
  })

  it.each(LISTS)('$name admits nothing that is not a string', ({ admits }) => {
    for (const value of [null, undefined, 7, {}, ['history:list']]) {
      expect(admits(value)).toBe(false)
    }
  })

  it('keeps all three disjoint, which is what makes them three lists', () => {
    // A channel on two lists would be a channel two documents can reach, and
    // the second one would have got it without anybody deciding.
    for (const a of LISTS) {
      for (const b of LISTS) {
        if (a.name === b.name) continue
        for (const channel of a.channels) expect(b.admits(channel)).toBe(false)
      }
    }
  })

  it('refuses the four channels that MOVED from settings to the shelf', () => {
    // They were not copied. `plan-shell.md`'s split is the rule, and a name
    // left behind on the settings list would be a second way to change one
    // thing — which is what `menuHandlers` already exists to avoid.
    for (const gone of ['settings:wear', 'settings:save', 'settings:persona', 'settings:memory']) {
      expect(isSettingsChannel(gone)).toBe(false)
      // And the shelf does NOT answer to their old names either — it has its
      // own, so an old caller fails loudly rather than reaching the new handler.
      expect(isShelfChannel(gone)).toBe(false)
    }
  })

  it('gives the shelf what the character half actually needs', () => {
    for (const channel of [
      'shelf:read',
      'shelf:wear',
      'shelf:save',
      'shelf:persona',
      'shelf:memory',
      'shelf:copy',
    ]) {
      expect(isShelfChannel(channel)).toBe(true)
      expect(isSettingsChannel(channel)).toBe(false)
      expect(isCompanionChannel(channel)).toBe(false)
    }
  })

  it('gives NO window a way to READ the clipboard', () => {
    /*
      `shelf:copy` is write-only, and the absence is the point rather than an
      omission somebody may later "complete". Handing back words this window is
      already displaying is one thing; taking whatever a person copied out of
      their password manager a moment ago is another, and a channel named
      `clipboard:read` on any of the three lists would be that.
    */
    for (const channel of ['shelf:read-clipboard', 'clipboard:read', 'shelf:paste']) {
      expect(isShelfChannel(channel)).toBe(false)
      expect(isSettingsChannel(channel)).toBe(false)
      expect(isCompanionChannel(channel)).toBe(false)
    }
  })

  it('never lets a window that is not hers mint a credential', () => {
    // The property the split existed for before the shelf grew, and the one
    // thing that must survive every rearrangement of the other two.
    for (const channel of ['voice:open', 'voice:sdp', 'voice:config', 'voice:call']) {
      expect(isShelfChannel(channel)).toBe(false)
      expect(isSettingsChannel(channel)).toBe(false)
    }
  })
})
