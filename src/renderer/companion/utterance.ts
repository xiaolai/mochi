import { createPacer, type Pacer } from './pace'

/**
 * What she is saying right now, and how far into it she has got.
 *
 * This used to live inside `createBubble()`, which was wrong for a reason that
 * only showed up when something else needed it: **every path that fed it was
 * gated on the bubble being ON, and the bubble is off by default.** So for most
 * personas the estimate did not exist at all. The bubble is one CONSUMER of
 * this, not its owner — the archive is the other, and the archive does not care
 * what the persona looks like.
 *
 * ## Two clocks, and only one of them is hers
 *
 * `speaking` gates the CURSOR: it moves only while this response's own audio is
 * playing. `begun` outlives it, because the bubble's fade still has to run
 * after she stops and gating that on `speaking` froze it on screen.
 *
 * ## It is keyed on the RESPONSE, not on the item
 *
 * Not a preference — it is the only key the frames that drive it carry.
 * `response.output_audio_transcript.delta` and all three
 * `output_audio_buffer.*` name a RESPONSE and nothing else (§20 §1). Only
 * `conversation.item.truncated` names an item, and it names no response.
 *
 * Every parameter here used to be called `itemId`, and `session.ts` passed the
 * truncation's item id straight into `finished()` — so the interrupted call
 * compared `item_…` against `resp_…`, matched nothing, and returned. The cursor
 * was never told she had been cut off. `session.ts` joins the two spaces
 * through `Pending.responseFor` now; the names here say which space this is so
 * the two cannot be confused again.
 *
 * ## The rate belongs to the VOICE
 *
 * `Pacer` keeps its learned rate across utterances on purpose — one voice's
 * speed is stable. A persona change is a VOICE change, so `wear()` drops it.
 * §60's seed was measured on `alloy`, which this app never speaks with, so
 * carrying one voice's number into another is not a small error.
 */
export interface Utterance {
  /** One fragment of what she is generating, with the RESPONSE it belongs to. */
  add(delta: string, responseId: string): void
  /** Her audio for this response has begun — `output_audio_buffer.started`. */
  speaks(responseId: string): void
  /** It ended: naturally, or because she was cut off. */
  finished(responseId: string, interrupted: boolean): void
  /** Advance. `quietFor` is the analyser's, and `dt` the frame's. */
  step(quietFor: number, dtSeconds: number): void
  /** A different character is being worn, so the voice is different too. */
  wear(): void
  /** Everything generated for the response on screen. */
  text(): string
  /** How far into it she is estimated to have got. */
  at(): number
  /** Whether this response's audio has ever started. The fade needs it. */
  begun(): boolean
}

/** Bounded well above any real utterance, so a long session cannot grow forever. */
const MAX_HELD = 20_000

/**
 * How recently there must have been sound for the cursor to be moving.
 *
 * Much tighter than the bubble's fade threshold, and they are different
 * questions: "is she still in this utterance" tolerates a pause, "is she saying
 * a word right now" does not.
 */
export const SOUNDING_S = 0.25

export function createUtterance(): Utterance {
  let text = ''
  let responseId: string | null = null
  let begun = false
  let pacer: Pacer = createPacer()

  function begin(next: string): void {
    responseId = next
    text = ''
    begun = false
    pacer.restart()
  }

  return {
    add(delta: string, next: string) {
      if (next !== responseId) begin(next)
      if (text.length < MAX_HELD) text += delta
      pacer.wrote(text)
    },
    speaks(next: string) {
      if (next !== responseId) begin(next)
      begun = true
      pacer.began()
    },
    finished(next: string, interrupted: boolean) {
      // A frame for a response that is no longer on screen is not this one's
      // business, and acting on it would stop a live cursor.
      if (next !== responseId) return
      if (interrupted) pacer.cut()
      else pacer.ended()
    },
    step(quietFor: number, dtSeconds: number) {
      // No `speaking` check here on purpose. `Pacer.step` already refuses to
      // advance until `began()` has fired and stops on `ended()`/`cut()`, so a
      // second gate would be two mechanisms deciding one thing — and a control
      // that removed this one changed no observable at all, which is how a
      // redundant guard hides the fact that its test is aimed elsewhere.
      pacer.step(dtSeconds, quietFor < SOUNDING_S)
    },
    wear() {
      // A NEW pacer, not `restart()`. `restart()` keeps the learned rate by
      // design, which is right between two utterances of one voice and wrong
      // between two voices.
      pacer = createPacer()
      begin('')
      responseId = null
    },
    text: () => text,
    at: () => pacer.at(),
    begun: () => begun,
  }
}
