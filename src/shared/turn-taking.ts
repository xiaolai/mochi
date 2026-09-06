/**
 * When she decides somebody has taken a turn, and whether that cuts her off.
 *
 * ## Why this is a setting and not the good default it used to be
 *
 * She has always been interruptible, and the README sells it: you cut her off
 * mid-sentence the way you would cut anybody off. That is the right answer for
 * ONE person at ONE desk, and it stops being right the moment there are two.
 *
 * The case that broke it is a room with two or three children, each with their
 * own Mochi. Every microphone hears every child AND every other Mochi, so a
 * companion is silenced by a voice that was never talking to it — and the child
 * it belongs to gets a half-sentence and no explanation. `far_field` noise
 * reduction and `semantic_vad` between them decide what a turn is, and neither
 * of them can decide whose turn it was: the model reads the words, and the
 * words in the room are perfectly good words. Nothing in the audio says which
 * mouth they were aimed at.
 *
 * So the fix cannot be a better threshold. It has to be somebody saying "in
 * this room, she finishes her sentence" — which is a fact about the room, like
 * the transcription languages next to it, and not a fact about the character.
 *
 * ## Why dropping the interjection is the RIGHT behaviour here, not a cost
 *
 * With `interrupt_response: false` the service documents that speech arriving
 * while she is already responding may fail to produce a response at all. Read
 * as a general voice-agent decision that is a real loss: a person who
 * interrupts deliberately expects to be answered when the sentence ends.
 *
 * Read against the room this exists for, it is the point. The voice that
 * arrives mid-sentence is USUALLY the other child, or the other Mochi. Queueing
 * it would mean she stops, listens, and then answers a question nobody asked
 * her — which is worse than not hearing it, because it also spends her turn.
 *
 * The honest statement of the trade is therefore: switching this off buys a
 * companion that cannot be talked over, and costs the deliberate interjection
 * from her own person. That is a good trade in a shared room and a bad one at a
 * desk alone, which is exactly why it is a switch and not a new default.
 *
 * Keeping `create_response` at its default is what confines the change to that
 * one trade. The alternative the service documents — both fields off and a
 * manual `response.create` — would put turn creation in the renderer, and a bug
 * there is not a dropped interjection but a companion that never answers at
 * all.
 *
 * ## `eagerness` is the softer half, and most rooms want it first
 *
 * Interruptibility is binary and it is a big hammer. `eagerness` moves the line
 * without crossing it: how long the semantic classifier waits before it decides
 * a turn has ended. The service documents maximum timeouts of 8s, 4s and 2s for
 * `low`, `medium` and `high`.
 *
 * `low` is the setting for a noisy room that still wants her interruptible —
 * she waits longer before believing a stray sound was somebody taking a turn.
 * `high` is for a quiet desk where waiting reads as slowness. §64 measured the
 * shipped configuration at 1989ms P90 from the end of speech, so this is the
 * knob that number moves, and anybody changing it should expect to feel it.
 */

/**
 * Every answer offered for how quickly she decides a turn ended.
 *
 * `auto` is first because it is the default and the one most people should
 * leave alone. It is not a fourth speed: the service documents it as equivalent
 * to `medium`, and `turnDetectionConfig` sends nothing at all for it — see
 * there for why the two are not the same message.
 */
export const EAGERNESS = ['auto', 'low', 'medium', 'high'] as const

export type Eagerness = (typeof EAGERNESS)[number]

/**
 * A well-formed eagerness, as `isHaloWhen` is a well-formed halo.
 *
 * Membership rather than a grammar, unlike `isLanguageCode`: this list is short
 * enough to enumerate and every member of it means something specific to the
 * service, so a value from outside it is not a preference this build has not
 * heard of — it is a field the service would reject.
 */
export function isEagerness(value: unknown): value is Eagerness {
  return typeof value === 'string' && (EAGERNESS as readonly string[]).includes(value)
}

/**
 * A stored or messaged value, read into the answer the session will send.
 *
 * Tolerant like every other reader of a preference: anything unrecognised
 * becomes `auto`, which is the state the app shipped in for every session
 * before this file existed. An unreadable file therefore does not change how
 * she takes turns, which is the direction `readHaloWhen` and
 * `readTranscriptionLanguages` both fail in.
 */
export function readEagerness(value: unknown): Eagerness {
  return isEagerness(value) ? value : 'auto'
}

/**
 * Whether a voice arriving mid-sentence cuts her off.
 *
 * `true` unless somebody has said otherwise, and an unreadable file fails
 * toward it — the same direction as `readShoulderChip`, and for a stronger
 * reason than a missing button. A companion that has silently stopped being
 * interruptible looks like a companion that has stopped listening, and there is
 * nothing on screen that would say which.
 */
export function readInterruptible(value: unknown): boolean {
  return value !== false
}

/** How she takes turns, as one answer. Both halves are read from one file. */
export interface TurnTaking {
  readonly eagerness: Eagerness
  readonly interruptible: boolean
}

/**
 * The `audio.input.turn_detection` object exactly as it goes on the wire.
 *
 * ## Why this is a function and not four lines in `session.ts`
 *
 * `transcriptionConfig`'s reason, and it is the same file that cannot be
 * tested: `session.ts` holds `RTCPeerConnection` and `getUserMedia`, so nothing
 * can construct it. The decisions live here, where a test can hold them.
 *
 * ## The two decisions, said out loud
 *
 * **`auto` sends no `eagerness` at all.** The service documents `auto` as its
 * default and as equivalent to `medium` TODAY. Those are two different claims,
 * and only the first one keeps being true if the service re-tunes what it
 * thinks a good default is. Somebody choosing `auto` is saying "you decide",
 * and pinning `medium` on their behalf would quietly convert that into "decide
 * the way you decided in 2026". Sending nothing is the only way to say the
 * thing they actually asked for.
 *
 * **`interrupt_response` is always sent, including when it is `true`.** The
 * opposite call from `eagerness` above, deliberately: `true` is not "you
 * decide", it is "yes, cut her off". Somebody who has switched interruption
 * back ON has made a positive choice about the loudest behaviour this app has,
 * and it should not be riding on a default that could move underneath it.
 */
export function turnDetectionConfig(input: TurnTaking): {
  readonly type: 'semantic_vad'
  readonly eagerness?: Eagerness
  readonly interrupt_response: boolean
} {
  return input.eagerness === 'auto'
    ? { type: 'semantic_vad', interrupt_response: input.interruptible }
    : {
        type: 'semantic_vad',
        eagerness: input.eagerness,
        interrupt_response: input.interruptible,
      }
}
