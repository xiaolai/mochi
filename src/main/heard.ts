import { boundaryAt } from '@shared/script'
import { COMMENTARY } from '@shared/realtime/frames'

/**
 * What a turn she spoke does to the archive — the whole decision, in one place.
 *
 * The renderer reports three observations about one of her turns: the text she
 * generated, what KIND of turn it was, and where its cursor had reached if she
 * was cut off. It judges none of them. The decisions are here, because that is
 * what main is for, and because a decision inside `main/index.ts` cannot be
 * tested at all — that file imports Electron.
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

/**
 * How much of the estimate to keep.
 *
 * **Not measured, and stacked on two things that are** — stated plainly here
 * because an audit called it redundant and it is not: it is a third margin on
 * top of a measured one, and only one of the three has a number behind it.
 *
 * §60 scored the SHIPPED estimator — the traces were replayed through the real
 * `pace.ts` — at −3% to −22%, short in all five runs. `boundaryAt` then rounds
 * back again. So this multiplies a quantity that already errs in the safe
 * direction.
 *
 * It is kept anyway, and the reason is the one thing §60 could not cover: every
 * one of its traces is a COLD START, where the pacer still holds the 15.1 seed.
 * In real use the rate is learned from each completed utterance, and a rate
 * learned from an unusually fast one runs the cursor long — the direction with
 * no other guard in front of it. Removing this would be trading a measured
 * safety property for an unmeasured one on the strength of a tidiness argument.
 *
 * §60 names it as "the number to watch if the bias factor is ever tuned". What
 * would settle it is a trace whose rate was LEARNED rather than seeded, scored
 * the same way; that run has never been taken.
 */
const BIAS = 0.9

export function heardPortion(transcript: string, at: number): string {
  const bounded = Math.max(0, Math.min(at, transcript.length))
  return transcript.slice(0, boundaryAt(transcript, Math.floor(bounded * BIAS)))
}

/** One of her turns, exactly as the renderer reports it. */
export interface Spoke {
  readonly transcript: string
  /** `commentary`, `final_answer`, or null when no item frame carried one. */
  readonly phase: string | null
  /** Null when she finished. Otherwise the cursor and the barge-in's instant. */
  readonly heard: { readonly at: number; readonly interruptedAt: number } | null
  /** When this turn belongs in the archive. See `VoiceReport`'s `said`. */
  readonly at: number
}

export type Filing =
  /**
   * Spoken aloud, and said to nobody. Logged, never archived.
   *
   * §26 §5 and §67 measured the shape: a turn that calls a tool arrives as a
   * `message` tagged `commentary` and then the `function_call`, and the message
   * is SPOKEN — 79 characters of *"Let me check th…"*. §69 measured what it
   * costs and put the remedy in one sentence: *"Let me celebrate with you for a
   * moment" is not something she said to the person; it is something she said
   * to the tool-calling machinery, and filing it makes her transcripts read as
   * though every answer came twice.* §28 §3 caught exactly that in the wild.
   */
  | { readonly kind: 'preamble'; readonly text: string }
  /**
   * She finished it, so everything generated was spoken.
   *
   * `at` is when the transcript arrived, not when this was decided: the verdict
   * that settles a finished turn is `output_audio_buffer.stopped`, which §19
   * puts 2.1–7.9s later, and at session close it can be an hour.
   */
  | { readonly kind: 'whole'; readonly text: string; readonly at: number }
  /**
   * She was cut off. `text` is what she is estimated to have been HEARD saying,
   * and `at` is the barge-in's instant rather than this frame's — the
   * transcript can arrive 16 seconds late (§28), and stamping at arrival files
   * her fragment after the user turn that interrupted it.
   */
  | { readonly kind: 'cut'; readonly text: string; readonly at: number }

/**
 * Which of the three a reported turn is.
 *
 * **An unknown phase is filed, not dropped.** Only `commentary` is withheld;
 * anything else — `final_answer`, null because no item frame arrived, or a
 * value this build has never heard of — is kept. The two mistakes are not
 * symmetric in an append-only archive: an extra line of filler is noise, and a
 * real turn silently discarded is a memory she cannot get back. The safe
 * default therefore has to be "keep", which is the opposite of the default a
 * denylist usually wants.
 */
export function whatToFile(spoke: Spoke): Filing {
  if (spoke.phase === COMMENTARY) return { kind: 'preamble', text: spoke.transcript }
  if (spoke.heard === null) return { kind: 'whole', text: spoke.transcript, at: spoke.at }
  return {
    kind: 'cut',
    text: heardPortion(spoke.transcript, spoke.heard.at),
    at: spoke.heard.interruptedAt,
  }
}
