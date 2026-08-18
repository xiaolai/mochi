/**
 * Holding a turn until both facts about it are in.
 *
 * Two frames say what happened to one of her turns, and **they arrive in either
 * order**:
 *
 * - `response.output_audio_transcript.done` — everything she generated.
 * - `conversation.item.truncated` — that she was cut off, and after how much
 *   audio.
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
 * ## Why a transcript alone is filed immediately
 *
 * Most turns are never interrupted, and there is no frame that says "this one
 * will not be". So a transcript with no truncation **already waiting** is filed
 * at once; waiting for a verdict that is not coming would lose every ordinary
 * turn. The cost is that a truncation arriving after its transcript cannot
 * retroactively shorten it — which is exactly why the 32-second case above
 * matters, and why `truncated()` returns the held transcript when it has one.
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
}

export interface Pending {
  /** The transcript arrived. Returns a turn to file, or null to keep waiting. */
  said(itemId: string, transcript: string): Spoken | null
  /** She was cut off. Returns a turn to file if the transcript is already in. */
  truncated(itemId: string, at: number): Spoken | null
  /**
   * The session is closing. Anything still held that was CUT is a turn she
   * began and was interrupted in, and is filed even with no transcript — an
   * empty text with a cut marker is a fact, and `store/transcripts.ts` keeps
   * those on purpose.
   */
  flush(): readonly Spoken[]
}

export function createPending(): Pending {
  const held = new Map<string, { transcript?: string; interruptedAt?: number }>()

  return {
    said(itemId: string, transcript: string) {
      const it = held.get(itemId)
      if (it?.interruptedAt === undefined) {
        // No truncation waiting: an ordinary finished turn.
        held.delete(itemId)
        return { transcript, interruptedAt: null }
      }
      held.delete(itemId)
      return { transcript, interruptedAt: it.interruptedAt }
    },
    truncated(itemId: string, at: number) {
      const it = held.get(itemId)
      if (it?.transcript === undefined) {
        held.set(itemId, { ...it, interruptedAt: at })
        return null
      }
      held.delete(itemId)
      return { transcript: it.transcript, interruptedAt: at }
    },
    flush() {
      const out: Spoken[] = []
      for (const [itemId, it] of held) {
        if (it.interruptedAt === undefined) continue
        out.push({ transcript: it.transcript ?? '', interruptedAt: it.interruptedAt })
        held.delete(itemId)
      }
      return out
    },
  }
}
