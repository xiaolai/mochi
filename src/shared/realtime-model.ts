/**
 * Which model her voice runs on.
 *
 * ## A machine preference, not a persona field
 *
 * `store/worn.ts` already draws this line and states the test: which model
 * runs describes this installation rather than the character being worn. The
 * same person wants `mini` on a metered hotel connection and `2.1` at their
 * desk, and switching persona must not change either. That is the definition
 * of a property of the machine.
 *
 * It is therefore NOT beside `persona.voice`, which is genuinely hers. Voice is
 * part of the character; the engine underneath it is part of the computer.
 *
 * ## Listed, never inferred
 *
 * The same discipline as `VOICE_NAMES`: adding one is a deliberate edit here
 * and a wrong one is a compile error. The service will accept any string it
 * happens to know about, so inferring the list from anywhere would mean
 * offering the user a model nobody has ever opened a session with.
 *
 * ## Every entry was opened, not read off a page
 *
 * Measured 2026-08-16 (`findings.md` §24 and §25). Each model here:
 *
 * - connects, and echoes its own name back on `session.created`;
 * - accepts **all ten** of `VOICE_NAMES`, so no persona can be broken by a
 *   switch -- which was the one failure this feature could plausibly have had;
 * - accepts the exact `sessionConfig()` body this app sends today, keeping
 *   `semantic_vad`, `far_field` and the transcription model;
 * - answers `POST /v1/realtime/calls` with `201` and an SDP body, which is the
 *   endpoint the app really uses. A WebSocket result does not speak for it.
 *
 * **`gpt-realtime` is deliberately absent**, and it is what this repository was
 * pinned to until now. It is the oldest of the line and the only one that
 * rejects `reasoning.effort`; on it, the turn that emits a tool call can be
 * completely silent (`findings.md` §12), which the `-2` line fixes by emitting
 * a `phase: 'commentary'` message alongside the call. Keeping it as a choice
 * would be offering somebody a worse conversation with nothing on screen able
 * to say why it was worse.
 *
 * ## What is NOT claimed
 *
 * Acceptance is not quality and it is not latency. Nothing here has measured
 * time-to-first-audio, interruption behaviour, or how any of these sound, and
 * the end-to-end goal is P90 < 1000ms. If `2.1` turns out to be slower on this
 * network, the remedy is a measurement in `findings.md` and a different
 * `DEFAULT_REALTIME_MODEL` -- not a fallback chain, which would make "which
 * model am I actually talking to" unanswerable.
 */

/**
 * Ordered as the picker shows them: best first, cheapest last.
 *
 * The order is data rather than a decision the pane makes, for the reason
 * `readModelCatalog` sorts by priority -- two places rendering the same list
 * differently is how a default comes to be second in one of them.
 */
export const REALTIME_MODELS = ['gpt-realtime-2.1', 'gpt-realtime-2', 'gpt-realtime-mini'] as const

export type RealtimeModel = (typeof REALTIME_MODELS)[number]

/**
 * The newest of the line.
 *
 * A default rather than a law, in the sense `plan-m10` uses: it is what she
 * runs on until somebody says otherwise, and the picker is how they say so.
 */
export const DEFAULT_REALTIME_MODEL: RealtimeModel = 'gpt-realtime-2.1'

export function isRealtimeModel(value: unknown): value is RealtimeModel {
  return typeof value === 'string' && (REALTIME_MODELS as readonly string[]).includes(value)
}

/**
 * A stored or messaged value, or the default.
 *
 * Tolerant on purpose, and this is the upgrade path: a `preferences.json`
 * written before this field existed has no `realtimeModel`, and one written by
 * a later version may name a model this build has never heard of. Both are
 * ordinary rather than corrupt, and both should leave her able to talk.
 */
export function readRealtimeModel(value: unknown): RealtimeModel {
  return isRealtimeModel(value) ? value : DEFAULT_REALTIME_MODEL
}
