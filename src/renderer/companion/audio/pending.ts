/**
 * Holding a turn until every fact about it is in.
 *
 * Four frames say what happened to one of her turns, and **they do not arrive
 * in a fixed order**:
 *
 * - `response.output_item.added` — that the item exists, which response it
 *   belongs to, and whether it is `commentary` or a `final_answer` (§67).
 * - `response.output_audio_transcript.done` — everything she generated.
 * - `conversation.item.truncated` — that she was cut off, and after how much
 *   audio.
 * - `output_audio_buffer.stopped` — that she reached the END of it, unasked.
 *
 * Measured, not assumed: cut at ~6 seconds and the truncation comes first in 13
 * of 13 runs, because generation is still going. Cut at 32 seconds and the
 * transcript beats it by half a second, because generation had already
 * finished. Acting on whichever lands first files the wrong thing half the time,
 * and the archive is append-only so it cannot be repaired afterwards.
 *
 * **The key is `item_id`.** `conversation.item.truncated` carries no
 * `response_id` at all — a design keyed on the response joins on a field that is
 * not there.
 *
 * ## There IS a frame that says "this one was not interrupted"
 *
 * This module used to say there was not, and filed a transcript the moment it
 * arrived. The consequence was measured rather than argued: in §58's
 * **32-second** case the transcript lands FIRST, so the turn was filed
 * **uncut, with everything she generated** — 2,760 characters against ~486
 * actually heard, which is the +446% to +513% over-filing that §60 and W4 exist
 * to remove — and the truncation that arrived half a second later found the
 * entry already deleted, recorded a verdict with no transcript, and produced a
 * SECOND row at session close: an empty cut marker. Two wrong rows for one
 * turn. The header even claimed *"`truncated()` returns the held transcript
 * when it has one"*, which was unreachable, and `pending.test.ts` asserted the
 * broken result as correct — a test restating the code, which is §31's lesson.
 *
 * The frame is `output_audio_buffer.stopped`. §55 counted it exactly: 40
 * response cycles produced 38 `cleared` and **2 `stopped`** — the two
 * utterances that finished naturally. So every response ends with one or the
 * other, and `stopped` is the missing "she reached the end" verdict.
 *
 * It names a RESPONSE and never an item, which is why this could not be done
 * before `began()` started recording the join from
 * `response.output_item.added`.
 *
 * ## And it degrades to the old behaviour rather than to silence
 *
 * If no item frame arrived, there is no response to settle against and holding
 * would mean holding for ever. So an item nothing was recorded for is filed the
 * moment its transcript lands, exactly as before. §67 measured `phase` over a
 * WebSocket and this app is WebRTC; the improvement is conditional on that
 * frame, and the fallback is what stops the conditional being a risk.
 *
 * ## The estimate is captured HERE, at the barge-in
 *
 * `heardAt` is where her cursor had reached when the truncation landed, and it
 * is taken at that moment rather than read later. It used to be read when the
 * turn was FILED, and in the ordinary ordering — truncation first — that is
 * seconds afterwards, by which time `Utterance` may have begun a new response
 * and reset the cursor to zero. A cut turn then filed as an EMPTY string over
 * however many seconds of speech she had actually been heard saying, which is
 * the regression §28 fact 2 names in its own words: *"filed an empty marker
 * over fourteen seconds of speech that was actually heard — worse than the bug
 * it replaced."*
 *
 * The cursor keeps no history, so the only way to have the value at filing time
 * is to have kept it. That is this record's job.
 */

export interface Spoken {
  /** Everything she generated for this item. */
  readonly transcript: string
  /**
   * Null when she finished it — nothing to cut. Otherwise when the barge-in
   * landed, which is the timestamp the turn must be filed under: the transcript
   * can arrive 16 seconds later and stamping at arrival reverses the archive.
   */
  readonly interruptedAt: number | null
  /**
   * Where her cursor had reached at the barge-in, as a character index.
   * Null when she was not interrupted, and therefore said all of it.
   */
  readonly heardAt: number | null
  /**
   * `commentary`, `final_answer`, or null when no item frame carried one.
   *
   * Passed through rather than acted on. What a phase MEANS for the archive is
   * a decision, and decisions are main's — see `main/index.ts`.
   */
  readonly phase: string | null
  /**
   * When this turn belongs in the archive, in epoch milliseconds.
   *
   * For a cut turn it is the barge-in; for a finished one it is when the
   * transcript arrived. Carried rather than defaulted to the filing moment,
   * because a turn now settles when its VERDICT lands — which for a natural end
   * is seconds later (§19: audio drains 2.1–7.9s after generation finishes) and
   * at session close could be an hour. Stamping at the write would reorder the
   * archive against the conversation that produced it.
   */
  readonly at: number
}

export interface Pending {
  /** An item was opened. Records the response it belongs to and its phase. */
  began(itemId: string, responseId: string, phase: string | null): void
  /**
   * Which response an item belongs to, or null if no item frame arrived.
   *
   * The one join between the two id spaces the service uses:
   * `output_audio_buffer.*` names a RESPONSE and `conversation.item.truncated`
   * names an ITEM, and nothing else carries both.
   */
  responseFor(itemId: string): string | null
  /**
   * The transcript arrived. Returns a turn to file, or null to keep waiting.
   *
   * Holds when the item is known (see `began`), because the verdict — cut or
   * finished — has not arrived yet and filing now is what produced two wrong
   * rows. Files at once when it is not, which is the fallback described above.
   */
  said(itemId: string, transcript: string, at: number): Spoken | null
  /** She was cut off. `heardAt` is the cursor NOW; see the header. */
  /**
   * `heardAt` is **null** when nothing is known about where she got to.
   *
   * Not zero. Zero is a position — "she was cut off before saying anything" —
   * and null is the absence of an estimate, which is what the caller has when
   * the cursor it can see belongs to a different response (§58). Main already
   * distinguishes them: a null `heardAt` files the whole turn rather than a cut
   * of it, which is the behaviour from before any estimate existed.
   */
  truncated(itemId: string, at: number, heardAt: number | null): Spoken | null
  /**
   * Her audio for a RESPONSE ended naturally — `output_audio_buffer.stopped`.
   *
   * Settles every held item of that response as a turn she finished. Returns
   * them to file; empty when none was waiting, which is the ordinary case for a
   * response whose transcript has not landed yet.
   */
  finished(responseId: string): readonly Spoken[]
  /**
   * The session is closing. Anything still held that was CUT is a turn she
   * began and was interrupted in, and is filed even with no transcript — an
   * empty text with a cut marker is a fact, and `store/transcripts.ts` keeps
   * those on purpose.
   */
  flush(): readonly Spoken[]
}

/**
 * A ceiling on how many items one session may hold open.
 *
 * §67 counts one or two items per response and §55 counted 40 responses in a
 * busy hour, so a real session uses a low hundreds at most. The cap is not for
 * that case: `began()` records every item including `function_call` ones, which
 * never receive a transcript and never get truncated, so nothing removes them
 * until the session ends. Bounded rather than trusted, and the oldest goes
 * first — an entry that has been waiting longest is the one least likely to
 * still be the turn on screen.
 */
const MAX_HELD = 1_000

interface Held {
  responseId?: string
  phase?: string | null
  transcript?: string
  /** When the transcript arrived — the instant a finished turn is filed under. */
  saidAt?: number
  interruptedAt?: number
  /**
   * Null and absent mean different things here, and both occur.
   *
   * Absent: no truncation has been seen for this item. Null: one has, and the
   * cursor it arrived with belonged to another response, so there is no usable
   * estimate. `settle` already collapses both to null on the way out.
   */
  heardAt?: number | null
  /** Her audio for this item ended naturally, before its transcript arrived. */
  finishedNaturally?: boolean
}

export function createPending(): Pending {
  const held = new Map<string, Held>()
  /**
   * Items already filed, so a late verdict cannot raise one from the dead.
   *
   * `held.get(itemId) ?? {}` cannot tell "never seen" from "already settled" —
   * both are absent. So a `conversation.item.truncated` arriving after its
   * turn had been filed created a NEW held record with no transcript, which
   * then waited for one that was never coming and was filed at session close
   * as an empty cut marker: a phantom turn in the archive, attached to a
   * conversation that had already recorded the real one.
   *
   * A late truncation is not exotic. §58 puts the transcript before the
   * truncation in 13 of 13 runs at a six-second cut, which is exactly the
   * order that settles the item first.
   *
   * Bounded like `held`, and by the same argument: a long session must not
   * grow this forever.
   */
  const filed = new Set<string>()

  function remember(itemId: string): void {
    filed.add(itemId)
    while (filed.size > MAX_HELD) {
      const oldest = filed.values().next().value
      if (oldest === undefined) break
      filed.delete(oldest)
    }
  }

  function record(itemId: string, next: Held): void {
    held.set(itemId, next)
    // Map preserves insertion order, so the first key is the oldest.
    while (held.size > MAX_HELD) {
      const oldest = held.keys().next().value
      if (oldest === undefined) break
      held.delete(oldest)
    }
  }

  /** Turn a held record into the turn to file, and stop holding it. */
  function settle(itemId: string, it: Held, transcript: string): Spoken {
    held.delete(itemId)
    remember(itemId)
    const cut = it.interruptedAt !== undefined
    return {
      transcript,
      interruptedAt: cut ? (it.interruptedAt ?? null) : null,
      heardAt: cut ? (it.heardAt ?? null) : null,
      phase: it.phase ?? null,
      // The barge-in for a cut turn, the transcript's arrival for a whole one.
      // Never "now": this can run seconds or an hour after either.
      at: cut ? (it.interruptedAt ?? 0) : (it.saidAt ?? 0),
    }
  }

  return {
    began(itemId: string, responseId: string, phase: string | null) {
      record(itemId, { ...held.get(itemId), responseId, phase })
    },
    responseFor(itemId: string) {
      return held.get(itemId)?.responseId ?? null
    },
    said(itemId: string, transcript: string, at: number) {
      const it = held.get(itemId) ?? {}
      // A verdict is already in — either of them — so settle rather than hold.
      // The natural-end half of this was missing and the transcript waited for
      // a verdict that had already come and gone: see `finished`.
      if (it.interruptedAt !== undefined) return settle(itemId, it, transcript)
      if (it.finishedNaturally === true) return settle(itemId, { ...it, saidAt: at }, transcript)
      /*
        NOTHING KNOWS THIS ITEM, so nothing will ever settle it.

        `output_audio_buffer.stopped` names a response, and without `began()`
        there is no response to match it against — so holding would hold until
        session close. Filed at once instead, which is exactly what this module
        did for every turn before `stopped` was read.
      */
      if (it.responseId === undefined) {
        held.delete(itemId)
        return { transcript, interruptedAt: null, heardAt: null, phase: it.phase ?? null, at }
      }
      // Known item, no verdict yet. Hold: it is about to be one or the other,
      // and filing now is what produced two rows for one turn.
      record(itemId, { ...it, transcript, saidAt: at })
      return null
    },
    truncated(itemId: string, at: number, heardAt: number | null) {
      // Already filed. Recording a verdict now would create a fresh held
      // record with no transcript -- see `filed` -- and file it as an empty cut
      // marker beside the turn it is a verdict FOR.
      if (filed.has(itemId)) return null
      const it = held.get(itemId) ?? {}
      if (it.transcript === undefined) {
        record(itemId, { ...it, interruptedAt: at, heardAt })
        return null
      }
      return settle(itemId, { ...it, interruptedAt: at, heardAt }, it.transcript)
    },
    finished(responseId: string) {
      const out: Spoken[] = []
      // Iterated directly even though `settle` deletes: a Map iterator tolerates
      // the removal of the entry it is currently on, and nothing here removes
      // one it has not reached. A defensive copy would allocate per response.
      for (const [itemId, it] of held) {
        if (it.responseId !== responseId) continue
        /*
          No transcript yet, so there is nothing to file — but the VERDICT is
          recorded rather than dropped.

          §19 puts generation 2.1–7.9s ahead of the audio draining, so the
          transcript almost always lands first and this branch is the unusual
          one. Skipping it outright is what made it dangerous: `said()` would
          then hold the transcript waiting for a verdict that had already
          arrived, and nothing would settle it until session close — or until
          `MAX_HELD` evicted it, losing the turn outright. Caught by an
          independent verify pass, which also pointed at the test below that had
          codified the broken sequence as correct.
        */
        if (it.transcript === undefined) {
          record(itemId, { ...it, finishedNaturally: true })
          continue
        }
        // Already cut: the truncation wins. A response can emit `cleared` for
        // one item and `stopped` for another (§28: several items per response).
        if (it.interruptedAt !== undefined) continue
        out.push(settle(itemId, it, it.transcript))
      }
      return out
    },
    flush() {
      const out: Spoken[] = []
      // Same as `finished`: only the current entry is ever deleted.
      for (const [itemId, it] of held) {
        // A turn she was cut off in is a fact even with no transcript.
        if (it.interruptedAt !== undefined) {
          out.push(settle(itemId, it, it.transcript ?? ''))
          continue
        }
        // And a transcript whose verdict never came is still something she
        // said. Filed whole, under the instant it arrived rather than this one
        // — the session may have been open for an hour since.
        if (it.transcript !== undefined) {
          out.push(settle(itemId, it, it.transcript))
        }
      }
      // EVERYTHING, not only what was emitted. The entries left behind are
      // items that were opened and never spoken — `function_call` items, and
      // messages the session outlived — and the session they belong to is over.
      held.clear()
      return out
    },
  }
}
