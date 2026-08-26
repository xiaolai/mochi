import { describe, expect, it } from 'vitest'
import { createPending } from './pending'

describe('both arrival orders produce the same turn', () => {
  // The whole reason this module exists. Cut at ~6s and the truncation arrives
  // first (13 of 13 runs); cut at 32s and the transcript beats it by half a
  // second because generation had finished. Two sequences, ONE expectation —
  // which is what this pair asserts and what it did not used to.
  it('truncation first, then the transcript', () => {
    const p = createPending()
    p.began('i1', 'r1', null)
    expect(p.truncated('i1', 1000, 42)).toBeNull()
    expect(p.said('i1', 'the whole story', 5000)).toEqual({
      transcript: 'the whole story',
      interruptedAt: 1000,
      heardAt: 42,
      phase: null,
      at: 1000,
    })
  })

  it('transcript first, then the truncation — §58 32-second case', () => {
    /*
      THE regression, and this test used to assert it as correct.

      It expected `said` to return an UNCUT turn carrying the whole generated
      text and `truncated` to return null — i.e. exactly the two wrong rows the
      module header now describes: 2,760 characters filed as though she had
      spoken them, against ~486 actually heard, and then an empty cut marker on
      top at session close. A test that restates the implementation tests the
      copy (§31); this one states what the ARCHIVE must end up holding.
    */
    const p = createPending()
    p.began('i1', 'r1', null)
    // Generation finished first, so the transcript lands before the barge-in.
    expect(p.said('i1', 'the whole story', 5000)).toBeNull()
    expect(p.truncated('i1', 6000, 9)).toEqual({
      transcript: 'the whole story',
      interruptedAt: 6000,
      heardAt: 9,
      phase: null,
      at: 6000,
    })
    // And nothing is left behind to be filed a second time.
    expect(p.flush()).toEqual([])
  })
})

describe('a turn she finished', () => {
  it('is settled by output_audio_buffer.stopped', () => {
    // §55 counted the verdict: 40 responses, 38 `cleared` and 2 `stopped`. The
    // two that finished naturally are the two this settles.
    const p = createPending()
    p.began('i1', 'r1', 'final_answer')
    expect(p.said('i1', 'she got to the end', 5000)).toBeNull()
    expect(p.finished('r1')).toEqual([
      {
        transcript: 'she got to the end',
        interruptedAt: null,
        heardAt: null,
        phase: 'final_answer',
        at: 5000,
      },
    ])
  })

  it('is stamped when the TRANSCRIPT arrived, not when the verdict did', () => {
    // §19 puts the audio draining 2.1–7.9s after generation finishes, so the
    // verdict is always later. Stamping at the verdict would drift every turn
    // she spoke against the user turns around it.
    const p = createPending()
    p.began('i1', 'r1', null)
    p.said('i1', 'a long answer', 5000)
    expect(p.finished('r1')[0]?.at).toBe(5000)
  })

  it('records the verdict when the stop arrives BEFORE the transcript', () => {
    /*
      This test used to assert the defect.

      It expected `said()` to return null after a `stopped` had already been
      seen — i.e. the transcript held for a verdict that had come and gone,
      settled only at session close, and evictable by `MAX_HELD` before then.
      Found by an independent verify pass over the previous fix, which is the
      argument for running one: the same shape of mistake this module was being
      corrected FOR was reintroduced two hours later, by me, in its test.

      A `stopped` still files nothing on its own — there is no text yet — but it
      is remembered, so the transcript settles the moment it lands.
    */
    const p = createPending()
    p.began('i1', 'r1', null)
    expect(p.finished('r1')).toEqual([])
    expect(p.said('i1', 'it arrived after', 5000)).toEqual({
      transcript: 'it arrived after',
      interruptedAt: null,
      heardAt: null,
      phase: null,
      at: 5000,
    })
    // And nothing is left holding, so it cannot be filed twice or evicted.
    expect(p.flush()).toEqual([])
  })

  it('leaves a cut item alone — the truncation wins', () => {
    // §28: one response can speak several items, so a response can emit
    // `cleared` for one and `stopped` for another.
    const p = createPending()
    p.began('i1', 'r1', null)
    p.truncated('i1', 1000, 9)
    p.said('i1', 'the cut one', 5000)
    expect(p.finished('r1')).toEqual([])
  })
})

describe('when no item frame ever arrived', () => {
  it('files the transcript at once rather than holding it for ever', () => {
    /*
      The fallback that makes the rest of this safe to depend on.

      `output_audio_buffer.stopped` names a RESPONSE, so without `began()` there
      is nothing to match it against and a held transcript would wait until
      session close. §67 measured `phase` over a WebSocket and this app is
      WebRTC — so the improvement is conditional on a frame that may not arrive,
      and this is what it degrades to: exactly the old behaviour.
    */
    const p = createPending()
    expect(p.said('i1', 'nothing knows this item', 5000)).toEqual({
      transcript: 'nothing knows this item',
      interruptedAt: null,
      heardAt: null,
      phase: null,
      at: 5000,
    })
  })
})

describe('the estimate is captured at the barge-in', () => {
  /*
    THE regression this argument exists for.

    `heardAt` used to be read when the turn was FILED rather than when the
    truncation landed — and in the ordinary ordering those are seconds apart,
    because §58 measured the truncation arriving before the transcript in 13 of
    13 runs at a six-second cut. In that window a short barge-in starts her next
    response, `Utterance` begins a new one, and the cursor is back at zero. The
    cut turn was then filed as an EMPTY string over however long she had
    actually been heard speaking — §28 fact 2's *"filed an empty marker over
    fourteen seconds of speech that was actually heard"*, again.
  */
  it('keeps the cursor from the truncation, not from whenever the transcript lands', () => {
    const p = createPending()
    p.truncated('i1', 1000, 214)
    // …time passes, she starts another response, the cursor resets. The
    // transcript for the CUT item only arrives now.
    const spoken = p.said('i1', 'a long story she was cut off in the middle of', 5000)
    expect(spoken?.heardAt).toBe(214)
  })

  it('carries no estimate for a turn she finished', () => {
    // Nothing was cut, so there is no cut point, and a zero here would read as
    // "she was heard saying none of it".
    const p = createPending()
    expect(p.said('i1', 'she got to the end', 5000)?.heardAt).toBeNull()
  })

  it('survives to the flush, for a turn whose transcript never came', () => {
    const p = createPending()
    p.truncated('i1', 900, 118)
    expect(p.flush()).toEqual([
      { transcript: '', interruptedAt: 900, heardAt: 118, phase: null, at: 900 },
    ])
  })
})

describe('the phase travels with the turn', () => {
  it('is carried from the item frame to the filed turn', () => {
    // §67: `response.output_item.added` is the earliest frame in a turn, so the
    // phase is always known before the transcript it belongs to.
    const p = createPending()
    p.began('i1', 'r1', 'commentary')
    // Held until a verdict, then carried out with it.
    expect(p.said('i1', 'let me look that up', 5000)).toBeNull()
    expect(p.finished('r1')[0]?.phase).toBe('commentary')
  })

  it('is null when no item frame arrived', () => {
    // The WebRTC-absence case. §67 measured `phase` over a WebSocket, and a
    // result on one transport does not speak for the other — so the turn is
    // still filed, and main treats an unknown phase as an answer.
    const p = createPending()
    expect(p.said('i1', 'something she said', 5000)?.phase).toBeNull()
  })

  it('survives a truncation arriving before the transcript', () => {
    const p = createPending()
    p.began('i1', 'r1', 'final_answer')
    p.truncated('i1', 1000, 30)
    expect(p.said('i1', 'the cut answer', 5000)?.phase).toBe('final_answer')
  })
})

describe('joining the two id spaces', () => {
  it('answers which response an item belongs to', () => {
    /*
      The only join that exists. `output_audio_buffer.*` names a RESPONSE and
      carries no item; `conversation.item.truncated` names an ITEM and carries
      no response. `response.output_item.added` is the one frame with both, and
      §28 measured it arriving 197ms before the audio starts.

      Without it `session.ts` passed an `item_…` where a `resp_…` was expected,
      so the cursor was never told she had been cut off.
    */
    const p = createPending()
    p.began('i1', 'r1', 'commentary')
    expect(p.responseFor('i1')).toBe('r1')
  })

  it('answers null rather than guessing when no item frame arrived', () => {
    const p = createPending()
    expect(p.responseFor('i1')).toBeNull()
  })
})

describe('turns she finished', () => {
  it('are filed whole, with nothing to cut', () => {
    const p = createPending()
    p.began('i1', 'r1', null)
    expect(p.said('i1', 'she got to the end', 5000)).toBeNull()
    expect(p.finished('r1')).toEqual([
      {
        transcript: 'she got to the end',
        interruptedAt: null,
        heardAt: null,
        phase: null,
        at: 5000,
      },
    ])
  })

  it('do not wait for a verdict that is not coming', () => {
    // There is no "she was not interrupted" frame. Holding for one would lose
    // every ordinary turn in the conversation.
    const p = createPending()
    p.said('i1', 'first', 5000)
    p.said('i2', 'second', 5000)
    expect(p.flush()).toEqual([])
  })
})

describe('items are kept apart', () => {
  it('does not let one item’s truncation settle another’s transcript', () => {
    // §28 measured one response speaking SEVERAL message items, so this is not
    // hypothetical bookkeeping.
    const p = createPending()
    p.truncated('i1', 500, 12)
    expect(p.said('i2', 'a different item', 5000)).toEqual({
      transcript: 'a different item',
      interruptedAt: null,
      heardAt: null,
      phase: null,
      at: 5000,
    })
    expect(p.said('i1', 'the cut one', 5000)).toEqual({
      transcript: 'the cut one',
      interruptedAt: 500,
      heardAt: 12,
      phase: null,
      at: 500,
    })
  })
})

describe('closing the session', () => {
  it('files a cut item whose transcript never arrived', () => {
    // A turn she began and was cut off in before a word of it survived. Empty
    // text with a cut marker is a fact; losing it silently is how the archive
    // comes to disagree with what happened.
    const p = createPending()
    p.truncated('i1', 900, 0)
    expect(p.flush()).toEqual([
      { transcript: '', interruptedAt: 900, heardAt: 0, phase: null, at: 900 },
    ])
  })

  it('flushes once, not on every close', () => {
    const p = createPending()
    p.truncated('i1', 900, 0)
    expect(p.flush()).toHaveLength(1)
    expect(p.flush()).toEqual([])
  })

  it('drops the items that were opened and never spoken', () => {
    /*
      A `function_call` item gets a `began()` and then nothing: no transcript,
      no truncation. Those are not turns and must not be filed — but they must
      not be held for ever either, and only the flush knows the session is over.
    */
    const p = createPending()
    p.began('call-item', 'r1', null)
    expect(p.flush()).toEqual([])
    // And it is genuinely gone rather than merely unemitted.
    expect(p.responseFor('call-item')).toBeNull()
  })

  it('bounds what one session can hold', () => {
    // `began()` records every item and nothing removes a `function_call` one
    // until the session ends, so the map is bounded rather than trusted.
    const p = createPending()
    for (let i = 0; i < 1_200; i += 1) p.began(`i${String(i)}`, `r${String(i)}`, null)
    // The oldest went first; the newest is still there.
    expect(p.responseFor('i0')).toBeNull()
    expect(p.responseFor('i1199')).toBe('r1199')
  })
})

describe('a cut whose cursor belongs to another response', () => {
  /**
   * §58 measured a short barge-in starting her NEXT response and resetting the
   * cursor to zero before the previous response's truncation is handled. The
   * caller used to read the cursor unconditionally, so a turn she was most of
   * the way through was filed as though she had said almost none of it.
   *
   * `session.ts` compares the response ids and passes null when they disagree.
   * This asserts the store treats null as "nothing is known" rather than as
   * the position zero.
   */
  it('files the whole turn rather than a cut of it', () => {
    const p = createPending()
    p.began('item-1', 'response-1', null)
    p.said('item-1', 'the whole of what she generated', 1_000)
    const spoken = p.truncated('item-1', 2_000, null)
    expect(spoken).not.toBeNull()
    // Null, not 0. Zero is a position -- "cut off before saying anything" --
    // and main files a cut turn differently from a whole one.
    expect(spoken?.heardAt).toBeNull()
  })

  it('keeps the estimate when the cursor does belong to this response', () => {
    const p = createPending()
    p.began('item-2', 'response-2', null)
    p.said('item-2', 'the whole of what she generated', 1_000)
    const spoken = p.truncated('item-2', 2_000, 12)
    expect(spoken?.heardAt).toBe(12)
  })

  it('carries a null cursor through a truncation that arrives first', () => {
    // The other order: the verdict lands before the transcript. The null must
    // survive being recorded and replayed, or the distinction is lost exactly
    // where §19 says the unusual case lives.
    const p = createPending()
    p.began('item-3', 'response-3', null)
    expect(p.truncated('item-3', 2_000, null)).toBeNull()
    const spoken = p.said('item-3', 'what she generated', 3_000)
    expect(spoken?.heardAt).toBeNull()
  })
})

describe('a verdict that arrives after its turn was filed', () => {
  /**
   * `held.get(itemId) ?? {}` cannot tell "never seen" from "already settled" —
   * both are absent. So a late `conversation.item.truncated` created a NEW
   * held record with no transcript, which waited for one that was never coming
   * and was filed at session close as an empty cut marker: a phantom turn
   * beside the real one it was a verdict for.
   */
  it('does not raise the item from the dead', () => {
    const p = createPending()
    p.began('i1', 'r1', null)
    p.said('i1', 'the whole story', 5_000)
    // The verdict settles it and the turn is filed.
    expect(p.truncated('i1', 6_000, 9)).not.toBeNull()
    // A second, later verdict for the same item must produce nothing at all.
    expect(p.truncated('i1', 7_000, 9)).toBeNull()
    expect(p.flush()).toEqual([])
  })

  it('does not do it for a turn that ended naturally either', () => {
    const p = createPending()
    p.began('i2', 'r2', null)
    p.said('i2', 'a finished answer', 5_000)
    expect(p.finished('r2')).toHaveLength(1)
    expect(p.truncated('i2', 6_000, 3)).toBeNull()
    expect(p.flush()).toEqual([])
  })

  it('still holds a verdict for an item that has not been filed', () => {
    // The ordinary order, which must keep working: verdict first, transcript
    // after. Blocking too eagerly here would lose every interrupted turn.
    const p = createPending()
    p.began('i3', 'r3', null)
    expect(p.truncated('i3', 6_000, 4)).toBeNull()
    expect(p.said('i3', 'cut off here', 7_000)).not.toBeNull()
  })
})
