import { describe, expect, it } from 'vitest'
import { heardPortion } from './heard'

/**
 * What gets remembered when she is cut off.
 *
 * The measured stakes (§58, on prose): filing everything she GENERATED stores
 * ~80–82% of an interrupted turn as though she had spoken it, and §55 counted
 * 38 truncations in an hour of ordinary use. §60 scored the estimate this uses
 * at −3% to −22% against transcripts of her own truncated audio.
 */
describe('cutting to what she was heard saying', () => {
  const line = 'the little owl taps the pixel feather and says hello'

  it('keeps roughly the estimate, never more', () => {
    // Rounds DOWN twice — by the bias, then to a boundary — because the two
    // error directions are not symmetric.
    const kept = heardPortion(line, 30)
    expect(kept.length).toBeLessThanOrEqual(30)
    expect(kept.length).toBeGreaterThan(10)
    expect(line.startsWith(kept)).toBe(true)
  })

  it('never splits a Latin word', () => {
    for (let at = 0; at <= line.length; at += 1) {
      const kept = heardPortion(line, at)
      const next = line[kept.length] ?? ' '
      // Either the cut lands on a boundary, or it is the whole line.
      if (kept.length < line.length) {
        expect(/\s/.test(next) || /\s/.test(line[kept.length - 1] ?? ' ')).toBe(true)
      }
    }
  })

  it('cuts Chinese between glyphs rather than walking back to a space', () => {
    // THE case a `lastIndexOf(' ')` boundary gets catastrophically wrong: it
    // keeps two characters out of sixteen because the nearest space is a whole
    // clause behind.
    const mixed = '好的 今天天气很好我们出去走走吧然后再说'
    const kept = heardPortion(mixed, 18)
    expect(kept.length).toBeGreaterThan(12)
    expect(mixed.startsWith(kept)).toBe(true)
  })

  it('is empty when she was cut off before a word survived', () => {
    // Not an error state: `store/transcripts.ts` keeps an empty turn with `cut`
    // on purpose, because a turn she began and was cut off in is a fact.
    expect(heardPortion(line, 0)).toBe('')
  })

  it('still rounds down when the cursor has run to the end', () => {
    // A cursor at the end is SATURATED: `pace.ts` clamps it to the text in
    // hand, so "at === length" can mean she said all of it OR that the estimate
    // hit the clamp and stopped. Those are not distinguishable, and on a turn
    // she was interrupted in the safe reading is the short one.
    const kept = heardPortion(line, 9999)
    expect(kept.length).toBeLessThan(line.length)
    expect(line.startsWith(kept)).toBe(true)
  })

  it('never returns more than it was given', () => {
    expect(heardPortion(line, 9999).length).toBeLessThanOrEqual(line.length)
    expect(heardPortion('', 40)).toBe('')
  })

  it('is always a prefix of what she generated', () => {
    // The property that matters: this decides what is remembered, so it must
    // never invent, reorder or reach past the text.
    for (const text of [line, '今天天气很好我们出去走走吧', 'mixed 今天 text here', '']) {
      for (const at of [0, 3, 7, 20, 999]) {
        expect(text.startsWith(heardPortion(text, at))).toBe(true)
      }
    }
  })
})
