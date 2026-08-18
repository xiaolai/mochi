import { boundaryAt } from '@shared/script'

/**
 * How much of what she generated she was actually HEARD saying.
 *
 * The renderer reports where its cursor had reached when the barge-in landed.
 * The decision about what is remembered is made here, because that is a
 * decision, and decisions are main's.
 *
 * ## Why this is an estimate at all
 *
 * The server truncates its own copy on a barge-in (§27) — but the truncated
 * TEXT is not stored anywhere. §58 measured `conversation.item.retrieve`
 * returning an empty transcript on the data channel; §59 measured the same over
 * a WebSocket sideband where a megabyte arrives fine, so it is not a size or
 * transport problem. The one signal about what was heard is `audio_end_ms`, a
 * time rather than a character offset.
 *
 * ## What it is worth
 *
 * §60 scored the cursor against transcripts of her own truncated audio, at five
 * barge-in points across two languages: **−3% to −22%, short in every run**,
 * against **+446% to +513%** for filing everything she generated.
 *
 * ## Why it rounds down twice
 *
 * The two error directions are not symmetric. Too long puts words she never
 * said into her memory and they are replayed to her as context — the bug this
 * exists to fix. Too short loses a word from a turn already marked `cut`. So
 * the estimate is scaled by `BIAS` and then rounded back to a boundary a reader
 * would accept, and `boundaryAt` never rounds forward.
 */
const BIAS = 0.9

export function heardPortion(transcript: string, at: number): string {
  const bounded = Math.max(0, Math.min(at, transcript.length))
  return transcript.slice(0, boundaryAt(transcript, Math.floor(bounded * BIAS)))
}
