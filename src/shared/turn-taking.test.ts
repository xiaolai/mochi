import { describe, expect, it } from 'vitest'
import {
  EAGERNESS,
  isEagerness,
  readEagerness,
  readInterruptible,
  turnDetectionConfig,
} from './turn-taking'

describe('what an eagerness may be', () => {
  it('takes the four the service documents and nothing else', () => {
    for (const one of EAGERNESS) expect(isEagerness(one)).toBe(true)
    for (const one of ['', 'AUTO', 'fast', 'slow', 'medium ', 0, null, undefined, {}]) {
      expect(isEagerness(one)).toBe(false)
    }
  })

  it('reads anything unrecognised as auto, which is what shipped', () => {
    // The direction every preference reader here fails in: an unreadable or
    // hand-edited file must not change how she takes turns.
    for (const one of [undefined, null, 'quick', 42, [], {}]) {
      expect(readEagerness(one)).toBe('auto')
    }
  })

  it('keeps a value it recognises', () => {
    expect(readEagerness('low')).toBe('low')
    expect(readEagerness('high')).toBe('high')
    expect(readEagerness('medium')).toBe('medium')
  })
})

describe('whether she may be cut off', () => {
  it('is true unless somebody stored exactly false', () => {
    // `readShoulderChip`'s rule, for a stronger reason: a companion that has
    // silently stopped being interruptible looks like one that stopped
    // listening, and nothing on screen would say which.
    for (const one of [undefined, null, true, 'false', 0, '']) {
      expect(readInterruptible(one)).toBe(true)
    }
    expect(readInterruptible(false)).toBe(false)
  })
})

describe('the turn_detection object that goes on the wire', () => {
  it('sends NO eagerness for auto, rather than sending medium', () => {
    /*
      The decision this function exists to hold. `auto` is documented as the
      service's default AND as equivalent to `medium` today; only the first of
      those keeps being true if the default is re-tuned. Somebody choosing
      `auto` said "you decide", and pinning `medium` would convert that into
      "decide the way you decided in 2026".
    */
    const sent = turnDetectionConfig({ eagerness: 'auto', interruptible: true })
    expect(sent).toEqual({ type: 'semantic_vad', interrupt_response: true })
    expect('eagerness' in sent).toBe(false)
  })

  it('sends a chosen eagerness through', () => {
    expect(turnDetectionConfig({ eagerness: 'low', interruptible: true })).toEqual({
      type: 'semantic_vad',
      eagerness: 'low',
      interrupt_response: true,
    })
  })

  it('always states interrupt_response, including when it is true', () => {
    /*
      The OPPOSITE call from eagerness, deliberately. `true` is not "you
      decide", it is "yes, cut her off" — a positive choice about the loudest
      behaviour this app has, which should not ride on a default that could
      move underneath it.
    */
    for (const eagerness of EAGERNESS) {
      const on = turnDetectionConfig({ eagerness, interruptible: true })
      const off = turnDetectionConfig({ eagerness, interruptible: false })
      expect(on.interrupt_response).toBe(true)
      expect(off.interrupt_response).toBe(false)
    }
  })

  it('keeps semantic_vad whatever else is chosen', () => {
    // §17: her own voice through a speaker reads as somebody taking a turn
    // without this, and the type is not what either of these settings moves.
    for (const eagerness of EAGERNESS) {
      for (const interruptible of [true, false]) {
        expect(turnDetectionConfig({ eagerness, interruptible }).type).toBe('semantic_vad')
      }
    }
  })
})
