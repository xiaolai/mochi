import { describe, expect, it } from 'vitest'
import { heardPortion, whatToFile } from './heard'

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

describe('what a reported turn does to the archive', () => {
  const spoke = (over: Partial<Parameters<typeof whatToFile>[0]> = {}) =>
    whatToFile({ transcript: 'something she said', phase: null, heard: null, at: 5000, ...over })

  it('keeps a spoken preamble OUT of the archive', () => {
    /*
      §69's measurement is the whole of this. `set_expression` and
      `ask_workspace` are both preceded by a `commentary` message she says out
      loud — *"Okay, that sounds heavy—let me take a moment to respond
      thoughtfully."* — and §28 §3 caught the consequence in a live session: two
      acknowledgements 4.5 seconds apart, filed as two things she said.
    */
    const filing = spoke({ transcript: 'let me look that up for you', phase: 'commentary' })
    expect(filing.kind).toBe('preamble')
  })

  it('files an ordinary answer whole', () => {
    expect(spoke({ phase: 'final_answer' })).toEqual({
      kind: 'whole',
      text: 'something she said',
      at: 5000,
    })
  })

  it('files a turn with NO phase, rather than dropping it', () => {
    /*
      The WebRTC-absence case, and the direction matters more than the case.
      §67 measured `phase` over a WebSocket; if this transport never delivers
      the item frame, every turn arrives with a null phase. Withholding those
      would empty the archive completely — so the default is keep, and the log
      says once per session that it cannot tell the two apart.
    */
    expect(spoke({ phase: null }).kind).toBe('whole')
  })

  it('files a phase it has never heard of, rather than dropping it', () => {
    // An append-only archive has asymmetric mistakes: an extra line of filler
    // is noise, a real turn silently discarded is a memory she cannot get back.
    expect(spoke({ phase: 'some_phase_shipped_next_year' }).kind).toBe('whole')
  })

  it('cuts an interrupted turn and stamps it at the BARGE-IN', () => {
    const filing = spoke({
      transcript: 'the little owl taps the pixel feather and says hello',
      heard: { at: 30, interruptedAt: 1_700_000_000_000 },
    })
    expect(filing.kind).toBe('cut')
    if (filing.kind !== 'cut') return
    // Not this frame's instant: §28 measured the transcript arriving up to 16
    // seconds after the interruption, which would file her fragment after the
    // user turn that cut it off and reverse the archive.
    expect(filing.at).toBe(1_700_000_000_000)
    expect(filing.text.length).toBeLessThanOrEqual(30)
  })

  it('withholds a preamble even when she was cut off mid-preamble', () => {
    // §69 saw one spent for nothing — a `commentary` message followed by no
    // tool call at all. Cutting her off during one changes nothing about
    // whether it was said to anybody.
    const filing = spoke({
      phase: 'commentary',
      heard: { at: 5, interruptedAt: 1_700_000_000_000 },
    })
    expect(filing.kind).toBe('preamble')
  })
})
