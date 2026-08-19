import { readArgs } from '@shared/capability/args'
import type { CapabilityManifest } from '@shared/capability/manifest'
import type { Registry } from '@shared/capability/registry'

/**
 * Every tool call, from arrival to the frames that settle it.
 *
 * ## Why this is in main
 *
 * v1 dispatched tool calls in the **renderer** — the process holding
 * `RTCPeerConnection`, and the one that should have the least authority. Which
 * capability runs is a decision about what this machine does on somebody's
 * behalf, so it belongs on the same side of the boundary as the credential. The
 * renderer keeps the peer, because that is where the API lives, and forwards
 * calls here by name.
 *
 * ## "Answered exactly once" is wrong, and finding out why is the whole design
 *
 * The obvious invariant is one `function_call_output` per `call_id`. It is not
 * the invariant, and building it would have made a **measured, working**
 * mechanism impossible.
 *
 * `findings.md` §1 tested five ways of delivering a result that arrives a turn
 * late — `codex exec` has a floor near twenty seconds, so any capability that
 * does real work needs one. The mechanism that works is: answer immediately with
 * something like `{"status":"started"}`, then send a **second**
 * `function_call_output` reusing the same `call_id` when the work finishes. She
 * completes her earlier sentence rather than correcting it, which the other four
 * mechanisms could not manage.
 *
 * So a second frame on one `call_id` is not a duplicate — it is the feature. The
 * real rules are:
 *
 *   - a call is **acknowledged exactly once**: exactly one of `answer` or `defer`
 *   - a deferred call is **delivered at most once**
 *   - and neither may be skipped, which is the half that gets lost
 *
 * ## The half that gets lost
 *
 * An implementation that silently drops a call satisfies every at-most-once test
 * ever written. Being unable to *see* a missed answer is why this exposes two
 * separate queries rather than one, and why they are part of the contract:
 *
 *   - `unanswered()` — arrived, never acknowledged. **The conversation is
 *     hanging**: the model is waiting for a frame that is not coming, for the
 *     rest of the session.
 *   - `undelivered()` — acknowledged with a deferral, real result never sent.
 *     Nothing hangs; she simply told the user she was looking into something and
 *     then never mentioned it again.
 *
 * Both are failures. They are different failures, and a caller that collapses
 * them has lost the distinction that says which one happened.
 *
 * ## It cannot request a turn
 *
 * §1's mechanism works only **without** `response.create`. Asking for a turn
 * while she is speaking is refused (`conversation_already_has_active_response`),
 * and refused *intermittently* — the hardest kind to reproduce. There is no
 * method here that sends one: not "we do not call it", but not reachable, so a
 * later edit has to add it deliberately rather than reach for it.
 *
 * §1 also records the risk under all of this: reusing an already-answered
 * `call_id` **is not documented anywhere**. It works today and is the single
 * most likely thing to stop working. Its fallback is a `system` message, which
 * changes her wording from completing to correcting.
 */

/** What crosses to the renderer to be put on the data channel. */
export interface AnswerFrame {
  readonly type: 'conversation.item.create'
  readonly item: {
    readonly type: 'function_call_output'
    readonly call_id: string
    readonly output: string
  }
}

export type Arrival =
  | {
      readonly kind: 'accepted'
      readonly manifest: CapabilityManifest
      readonly args: Readonly<Record<string, string>>
    }
  /** No capability of that name. Already acknowledged with an error before returning. */
  | { readonly kind: 'no-such-capability'; readonly name: string }
  /** This `call_id` has been seen before. Nothing was sent. */
  | { readonly kind: 'duplicate'; readonly callId: string }

export type Refusal =
  /** No call by that id ever arrived. */
  | 'unknown-call'
  /** Already answered or deferred; acknowledgement happens once. */
  | 'already-acknowledged'
  /** `deliver` on a call that was settled outright, or already delivered. */
  | 'not-awaiting-delivery'

export type Outcome = { readonly ok: true } | { readonly ok: false; readonly reason: Refusal }

export interface Ledger {
  /** A tool call arrived from the renderer. */
  arrived(call: { readonly name: string; readonly callId: string; readonly args: unknown }): Arrival
  /** Settle a call outright. Nothing further may be sent on it. */
  answer(callId: string, output: unknown): Outcome
  /** Acknowledge now, promise the real result later (§1). */
  defer(callId: string, acknowledgement: unknown): Outcome
  /** The late result for a deferred call, on the original `call_id`. */
  deliver(callId: string, output: unknown): Outcome

  /** Arrived, never acknowledged — the conversation is hanging on these. */
  unanswered(): readonly string[]
  /** Deferred, never delivered — she said she would look and never came back. */
  undelivered(): readonly string[]
  /** Frames actually emitted. For assertions that count rather than observe. */
  emitted(): number
  /** Every call this process has seen, in arrival order. See `LedgerCall`. */
  calls(): readonly LedgerCall[]
}

/** Where a call has got to. Exported because `LedgerCall` names it. */
export type CallState = 'pending' | 'settled' | 'deferred' | 'delivered'

/**
 * One call, and the two times a caller outside this module can use.
 *
 * ## `settledAt` is when nothing further is owed, not when a frame went out
 *
 * §1's mechanism means a deferred call gets TWO frames on one `call_id`, and
 * the first of them is a promise rather than an answer. So the deferral is not
 * a settlement: `undelivered()` still names that call as something she said she
 * would come back to. `settledAt` is filled in by `answer` and by `deliver`,
 * which is exactly the set of moments after which this ledger owes nothing —
 * the same line `unanswered()` and `undelivered()` are drawn along.
 *
 * ## And why there are times here at all
 *
 * 5b's autonomy panel carries "when it was last used" per grant, and that is
 * what makes a revoke a decision somebody can make rather than a guess. The
 * durable half of it is `store/usage.ts`; this is the per-process record it is
 * written from, and it is also what a latency view would read.
 */
export interface LedgerCall {
  readonly callId: string
  /** The name it was called by — including one no capability answers to. */
  readonly name: string
  readonly state: CallState
  readonly arrivedAt: number
  /** Null while anything is still owed on it. See above. */
  readonly settledAt: number | null
}

/** What goes in `output`, which must be a string on every path. */
const UNSERIALISABLE = JSON.stringify({ error: 'the result could not be serialised' })

function payload(output: unknown): string {
  if (typeof output === 'string') return output
  let written: string | undefined
  try {
    written = JSON.stringify(output)
  } catch {
    // Never throw out of an answer path. A result that cannot be serialised must
    // still produce a frame, or the conversation hangs over a formatting fault.
    return UNSERIALISABLE
  }
  // `JSON.stringify` RETURNS `undefined` — it does not throw — for `undefined`,
  // a function and a symbol. That is not a serialisation failure the `catch`
  // above ever sees, so a non-string reached `AnswerFrame.output` and the call
  // was then recorded as settled: a frame the service cannot read, booked as an
  // answer. The type says this cannot happen; the type does not survive the
  // boundary, because `answer` takes `unknown` by contract.
  return written ?? UNSERIALISABLE
}

export function createLedger(input: {
  readonly registry: Registry
  readonly send: (frame: AnswerFrame) => void
  /**
   * The clock, injected, like everything else in this repository that reads
   * one. A test asserting on an elapsed time must not depend on how fast it
   * runs.
   */
  readonly now: () => number
  /**
   * A capability was called — the durable half of "last used".
   *
   * REQUIRED rather than optional, because the failure of forgetting it is
   * silent: the panel would show "never" beside a capability she used this
   * morning, which reads as a fact rather than as a gap. See `store/usage.ts`.
   *
   * Called on ARRIVAL rather than on the answer. A call that arrived is a use
   * whether or not it worked, and a lookup that fails after twenty seconds
   * would otherwise be invisible to the one column that would have shown it.
   *
   * It may throw — it writes a file — and a failure to record a use must never
   * cost the answer, so it is called through the same guard the observers in
   * `dispatch.ts` use.
   */
  readonly used: (name: string, at: number) => void
}): Ledger {
  const { registry, send, now, used } = input
  /** A `call_id` is never removed. The map IS the record. */
  const calls = new Map<string, LedgerCall>()
  let sent = 0

  /**
   * Note a use, and never let noting it break the call.
   *
   * The same argument `dispatch.ts` makes about `log`, `warn` and `note`: this
   * one genuinely can throw, because it writes to disk. Losing the record of a
   * use is a column that says "never"; letting it escape would hang the
   * conversation over a bookkeeping write.
   */
  function remember(name: string, at: number): void {
    try {
      used(name, at)
    } catch (error: unknown) {
      console.warn(`[capability] could not record that ${name} was used:`, error)
    }
  }

  function emit(callId: string, state: CallState, output: unknown): void {
    // SENT FIRST, then recorded. The transport is `webContents.send` on a
    // window that can be destroyed, so it throws — and recording the state
    // first meant a frame that never went out was booked as one that had. The
    // call would sit as `deferred` for the life of the process with `deliver`
    // refusing to move it, or as `settled` with nothing ever emitted.
    //
    // Ordered this way, a failed send leaves the call exactly where it was:
    // `unanswered()` still reports it, and the caller may try again. It does
    // not weaken "acknowledged exactly once" — a send that threw did not
    // acknowledge anything.
    send({
      type: 'conversation.item.create',
      item: { type: 'function_call_output', call_id: callId, output: payload(output) },
    })
    const held = calls.get(callId)
    // Unreachable: every path into `emit` has already recorded the arrival.
    // Guarded rather than asserted because the frame has already gone out, and
    // throwing here would report a delivered answer as a failure.
    if (held !== undefined) {
      calls.set(callId, {
        ...held,
        state,
        // `answer` and `deliver` are the two that leave nothing owed. A
        // deferral is a promise, and `undelivered()` is the thing that says so.
        settledAt: state === 'settled' || state === 'delivered' ? now() : held.settledAt,
      })
    }
    sent += 1
  }

  function idsIn(state: CallState): readonly string[] {
    return [...calls].filter(([, held]) => held.state === state).map(([callId]) => callId)
  }

  return {
    arrived(call) {
      if (calls.has(call.callId)) return { kind: 'duplicate', callId: call.callId }
      const arrivedAt = now()
      // RECORDED FIRST, for every name including one nothing answers to. `emit`
      // amends the entry rather than creating it, so a send that throws leaves
      // the call visible as `unanswered()` — which is what it is, since the
      // model is waiting for a frame that did not go out.
      calls.set(call.callId, {
        callId: call.callId,
        name: call.name,
        state: 'pending',
        arrivedAt,
        settledAt: null,
      })

      const manifest = registry.get(call.name)
      if (manifest === null) {
        // Acknowledged, not dropped. An unknown name is most likely our own bug
        // — a capability withdrawn while the model still holds the older tool
        // list — and dropping it would hang the conversation over our mistake.
        //
        // NOT recorded as a use. Nothing ran, so there is nothing whose "last
        // used" this would be, and writing one would put a row in the panel for
        // a capability this build does not have.
        emit(call.callId, 'settled', { error: `no capability named ${call.name}` })
        return { kind: 'no-such-capability', name: call.name }
      }

      remember(call.name, arrivedAt)
      return { kind: 'accepted', manifest, args: readArgs(manifest, call.args) }
    },

    answer(callId, output) {
      const state = calls.get(callId)?.state
      if (state === undefined) return { ok: false, reason: 'unknown-call' }
      if (state !== 'pending') return { ok: false, reason: 'already-acknowledged' }
      emit(callId, 'settled', output)
      return { ok: true }
    },

    defer(callId, acknowledgement) {
      const state = calls.get(callId)?.state
      if (state === undefined) return { ok: false, reason: 'unknown-call' }
      if (state !== 'pending') return { ok: false, reason: 'already-acknowledged' }
      emit(callId, 'deferred', acknowledgement)
      return { ok: true }
    },

    deliver(callId, output) {
      const state = calls.get(callId)?.state
      if (state === undefined) return { ok: false, reason: 'unknown-call' }
      if (state !== 'deferred') return { ok: false, reason: 'not-awaiting-delivery' }
      emit(callId, 'delivered', output)
      return { ok: true }
    },

    unanswered: () => idsIn('pending'),
    undelivered: () => idsIn('deferred'),
    emitted: () => sent,
    // Insertion order, which for a `Map` is arrival order. The panel and any
    // later latency view both want them oldest first.
    calls: () => [...calls.values()],
  }
}
