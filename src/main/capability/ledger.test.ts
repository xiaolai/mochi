import { describe, expect, it } from 'vitest'
import { createRegistry } from '@shared/capability/registry'
import type { CapabilityManifest } from '@shared/capability/manifest'
import { createLedger, type AnswerFrame } from './ledger'

function manifest(name: string): CapabilityManifest {
  return {
    name,
    description: `The ${name} capability.`,
    parameters: {
      type: 'object',
      properties: { question: { type: 'string', description: 'What to find out.' } },
      required: ['question'],
    },
  }
}

/**
 * A real registry, a transport that records, and a clock that does not move
 * unless a test moves it. Nothing is mocked.
 */
function ledgerWithSpy() {
  const frames: AnswerFrame[] = []
  const uses: { name: string; at: number }[] = []
  const registry = createRegistry([manifest('ask_workspace')])
  const clock = { at: 1_000 }
  const ledger = createLedger({
    registry,
    send: (frame) => frames.push(frame),
    now: () => clock.at,
    used: (name, at) => uses.push({ name, at }),
  })
  return { ledger, frames, uses, clock }
}

const CALL = { name: 'ask_workspace', callId: 'call_1', args: JSON.stringify({ question: 'what' }) }

describe('a call arriving', () => {
  it('is accepted with its arguments read against the manifest', () => {
    const { ledger } = ledgerWithSpy()
    const arrival = ledger.arrived(CALL)

    expect(arrival.kind).toBe('accepted')
    if (arrival.kind !== 'accepted') return
    expect(arrival.args).toEqual({ question: 'what' })
    // Nothing has been sent. Arrival is not an answer.
    expect(ledger.emitted()).toBe(0)
  })

  it('is refused a second time under the same id, and sends nothing', () => {
    const { ledger } = ledgerWithSpy()
    ledger.arrived(CALL)
    expect(ledger.arrived(CALL)).toEqual({ kind: 'duplicate', callId: 'call_1' })
    expect(ledger.emitted()).toBe(0)
  })

  it('is answered rather than dropped when no capability has that name', () => {
    // Dropping it would hang the conversation over what is most likely our own
    // bug — a capability withdrawn while the model still holds the old list.
    const { ledger, frames } = ledgerWithSpy()
    const arrival = ledger.arrived({ ...CALL, name: 'rm_minus_rf' })

    expect(arrival).toEqual({ kind: 'no-such-capability', name: 'rm_minus_rf' })
    expect(ledger.emitted()).toBe(1)
    expect(frames[0]?.item.call_id).toBe('call_1')
    // And it is not left looking like something still owed an answer.
    expect(ledger.unanswered()).toEqual([])
  })
})

describe('acknowledging happens exactly once', () => {
  it('emits one frame, carrying the original call id', () => {
    const { ledger, frames } = ledgerWithSpy()
    ledger.arrived(CALL)

    expect(ledger.answer('call_1', { found: 'it' })).toEqual({ ok: true })
    expect(ledger.emitted()).toBe(1)
    expect(frames[0]).toEqual({
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id: 'call_1',
        output: JSON.stringify({ found: 'it' }),
      },
    })
  })

  it('refuses a second answer, and the count is how we know', () => {
    // Asserted on the counter rather than on anything observable downstream. A
    // doubly-answered call produces no visible symptom until it produces a very
    // confusing one.
    const { ledger } = ledgerWithSpy()
    ledger.arrived(CALL)
    ledger.answer('call_1', 'first')

    expect(ledger.answer('call_1', 'second')).toEqual({
      ok: false,
      reason: 'already-acknowledged',
    })
    expect(ledger.emitted()).toBe(1)
  })

  it('refuses a deferral after an answer, and an answer after a deferral', () => {
    const { ledger } = ledgerWithSpy()
    ledger.arrived(CALL)
    ledger.answer('call_1', 'done')
    expect(ledger.defer('call_1', 'on it').ok).toBe(false)

    const second = ledgerWithSpy()
    second.ledger.arrived(CALL)
    second.ledger.defer('call_1', 'on it')
    expect(second.ledger.answer('call_1', 'done').ok).toBe(false)
    expect(second.ledger.emitted()).toBe(1)
  })

  it('refuses to answer a call that never arrived', () => {
    const { ledger } = ledgerWithSpy()
    expect(ledger.answer('call_never', 'x')).toEqual({ ok: false, reason: 'unknown-call' })
    expect(ledger.emitted()).toBe(0)
  })
})

describe("the late result, which is §1's whole mechanism", () => {
  it('sends a SECOND frame on the same call id', () => {
    // The naive invariant — one frame per call_id — would forbid this, and it is
    // the measured, working way to deliver work that takes twenty seconds.
    const { ledger, frames } = ledgerWithSpy()
    ledger.arrived(CALL)

    expect(ledger.defer('call_1', { status: 'started' })).toEqual({ ok: true })
    expect(ledger.deliver('call_1', { answer: 'ALPHA7' })).toEqual({ ok: true })

    expect(ledger.emitted()).toBe(2)
    expect(frames.map((frame) => frame.item.call_id)).toEqual(['call_1', 'call_1'])
    expect(frames[1]?.item.output).toBe(JSON.stringify({ answer: 'ALPHA7' }))
  })

  it('delivers at most once', () => {
    const { ledger } = ledgerWithSpy()
    ledger.arrived(CALL)
    ledger.defer('call_1', 'on it')
    ledger.deliver('call_1', 'first')

    expect(ledger.deliver('call_1', 'second')).toEqual({
      ok: false,
      reason: 'not-awaiting-delivery',
    })
    expect(ledger.emitted()).toBe(2)
  })

  it('refuses a delivery on a call that was settled outright', () => {
    const { ledger } = ledgerWithSpy()
    ledger.arrived(CALL)
    ledger.answer('call_1', 'done')

    expect(ledger.deliver('call_1', 'late')).toEqual({
      ok: false,
      reason: 'not-awaiting-delivery',
    })
    expect(ledger.emitted()).toBe(1)
  })
})

describe('the half that gets lost', () => {
  it('names a call that arrived and was never acknowledged', () => {
    // THE assertion this module exists for. An implementation that silently
    // drops a call passes every at-most-once test above; only this one fails.
    const { ledger } = ledgerWithSpy()
    ledger.arrived(CALL)
    ledger.arrived({ ...CALL, callId: 'call_2' })
    ledger.answer('call_2', 'done')

    expect(ledger.unanswered()).toEqual(['call_1'])
  })

  it('names a deferral that was never delivered, and does NOT call it unanswered', () => {
    // Two different failures. The conversation is not hanging — she acknowledged
    // it — she simply said she would look into something and never came back.
    // A caller that collapses these two has lost which one happened.
    const { ledger } = ledgerWithSpy()
    ledger.arrived(CALL)
    ledger.defer('call_1', 'on it')

    expect(ledger.unanswered()).toEqual([])
    expect(ledger.undelivered()).toEqual(['call_1'])
  })

  it('reports nothing owed once everything is settled or delivered', () => {
    const { ledger } = ledgerWithSpy()
    ledger.arrived(CALL)
    ledger.arrived({ ...CALL, callId: 'call_2' })
    ledger.answer('call_1', 'done')
    ledger.defer('call_2', 'on it')
    ledger.deliver('call_2', 'result')

    expect(ledger.unanswered()).toEqual([])
    expect(ledger.undelivered()).toEqual([])
    expect(ledger.emitted()).toBe(3)
  })
})

describe('what may never be sent', () => {
  it('emits only function_call_output — never anything that asks for a turn', () => {
    // Structural, over every frame this module can produce. §1 measured that
    // `response.create` while she is speaking is refused, and refused
    // INTERMITTENTLY. There is no method here that sends one; this asserts the
    // absence rather than trusting it.
    const { ledger, frames } = ledgerWithSpy()
    ledger.arrived(CALL)
    ledger.defer('call_1', 'on it')
    ledger.deliver('call_1', 'result')
    ledger.arrived({ ...CALL, callId: 'call_2', name: 'nope' })

    expect(frames).toHaveLength(3)
    for (const frame of frames) {
      expect(frame.type).toBe('conversation.item.create')
      expect(frame.item.type).toBe('function_call_output')
    }
  })

  it('emits a STRING even for a value JSON.stringify answers `undefined` for', () => {
    // Not the same as the cyclic case below, and that is why it was missed:
    // `JSON.stringify(undefined)` does not throw, it RETURNS undefined. So a
    // non-string reached `AnswerFrame.output` and the call was booked as
    // settled — a frame the service cannot read, recorded as an answer.
    for (const value of [undefined, () => 'hello', Symbol('x')]) {
      const { ledger, frames } = ledgerWithSpy()
      ledger.arrived(CALL)
      ledger.answer('call_1', value)
      expect(typeof frames[0]?.item.output).toBe('string')
      expect(frames[0]?.item.output).toContain('could not be serialised')
    }
  })

  it('still emits a frame when the result cannot be serialised', () => {
    // A call that cannot be answered because of a formatting fault would hang
    // the conversation for the rest of the session. Loud in the payload, not
    // silent in a throw.
    const { ledger, frames } = ledgerWithSpy()
    ledger.arrived(CALL)
    const cyclic: Record<string, unknown> = {}
    cyclic['self'] = cyclic

    expect(() => ledger.answer('call_1', cyclic)).not.toThrow()
    expect(ledger.emitted()).toBe(1)
    expect(frames[0]?.item.output).toContain('could not be serialised')
    expect(ledger.unanswered()).toEqual([])
  })
})

describe('a transport that throws', () => {
  it('leaves the call exactly where it was, so it still shows as unanswered', () => {
    // `webContents.send` on a destroyed window throws. Recording the state
    // first booked a frame that never went out: the call sat as `settled` with
    // nothing emitted, or as `deferred` with `deliver` refusing to move it for
    // the life of the process — and `unanswered()`, the thing whose whole job
    // is to make a missed answer visible, reported nothing wrong.
    let angry = true
    const registry = createRegistry([manifest('ask_workspace')])
    const ledger = createLedger({
      registry,
      send: () => {
        if (angry) throw new Error('Object has been destroyed')
      },
      now: () => 1_000,
      used: () => {},
    })
    expect(ledger.arrived(CALL).kind).toBe('accepted')
    expect(() => ledger.answer(CALL.callId, { status: 'ok' })).toThrow()
    expect(ledger.unanswered()).toEqual([CALL.callId])
    expect(ledger.emitted()).toBe(0)

    // And it can still be answered once there is somewhere to answer to.
    angry = false
    expect(ledger.answer(CALL.callId, { status: 'ok' })).toEqual({ ok: true })
    expect(ledger.unanswered()).toEqual([])
    expect(ledger.emitted()).toBe(1)
  })

  it('leaves a deferral unacknowledged rather than stuck awaiting delivery', () => {
    const registry = createRegistry([manifest('ask_workspace')])
    const ledger = createLedger({
      registry,
      send: () => {
        throw new Error('Object has been destroyed')
      },
      now: () => 1_000,
      used: () => {},
    })
    ledger.arrived(CALL)
    expect(() => ledger.defer(CALL.callId, { status: 'started' })).toThrow()
    // NOT `undelivered`. Nothing was acknowledged, so nothing is owed.
    expect(ledger.undelivered()).toEqual([])
    expect(ledger.unanswered()).toEqual([CALL.callId])
  })
})

describe('the times each call carries', () => {
  it('stamps arrival from the injected clock, not from the wall', () => {
    // Injected, like everything else here that reads one, so an assertion about
    // an elapsed time does not depend on how fast the suite runs.
    const { ledger, clock } = ledgerWithSpy()
    clock.at = 5_000
    ledger.arrived(CALL)

    const [call] = ledger.calls()
    expect(call?.callId).toBe('call_1')
    expect(call?.name).toBe('ask_workspace')
    expect(call?.arrivedAt).toBe(5_000)
    expect(call?.settledAt).toBe(null)
  })

  it('stamps the settle when the call is answered outright', () => {
    const { ledger, clock } = ledgerWithSpy()
    clock.at = 5_000
    ledger.arrived(CALL)
    clock.at = 5_120
    ledger.answer('call_1', 'done')

    expect(ledger.calls()[0]).toMatchObject({ arrivedAt: 5_000, settledAt: 5_120 })
  })

  it('leaves a deferral UNSETTLED, because something is still owed on it', () => {
    // The same line `undelivered()` is drawn along. A deferral is a promise,
    // and calling it settled would make the panel report a lookup as finished
    // at the moment she said she would go and look.
    const { ledger, clock } = ledgerWithSpy()
    clock.at = 5_000
    ledger.arrived(CALL)
    clock.at = 5_010
    ledger.defer('call_1', { status: 'started' })
    expect(ledger.calls()[0]?.settledAt).toBe(null)

    clock.at = 26_000
    ledger.deliver('call_1', { answer: 'ALPHA7' })
    expect(ledger.calls()[0]).toMatchObject({ state: 'delivered', settledAt: 26_000 })
  })

  it('records a call nothing answers to, so it is not invisible', () => {
    const { ledger, clock } = ledgerWithSpy()
    clock.at = 7_000
    ledger.arrived({ ...CALL, name: 'rm_minus_rf' })

    expect(ledger.calls()[0]).toMatchObject({
      name: 'rm_minus_rf',
      state: 'settled',
      arrivedAt: 7_000,
      settledAt: 7_000,
    })
  })

  it('keeps them in arrival order', () => {
    const { ledger, clock } = ledgerWithSpy()
    ledger.arrived(CALL)
    clock.at = 2_000
    ledger.arrived({ ...CALL, callId: 'call_2' })
    expect(ledger.calls().map((one) => one.callId)).toEqual(['call_1', 'call_2'])
  })
})

describe('recording that a capability was used', () => {
  it('records it on ARRIVAL, before anything has run', () => {
    // A call that arrived is a use whether or not it worked. Recording it on
    // the answer would leave a lookup that failed after twenty seconds
    // invisible to the one column that would have shown it.
    const { ledger, uses, clock } = ledgerWithSpy()
    clock.at = 9_000
    ledger.arrived(CALL)
    expect(uses).toEqual([{ name: 'ask_workspace', at: 9_000 }])
  })

  it('does not record a name no capability answers to', () => {
    // Nothing ran, so there is nothing whose "last used" this would be — and a
    // row for a capability this build does not have is a row nobody can act on.
    const { ledger, uses } = ledgerWithSpy()
    ledger.arrived({ ...CALL, name: 'rm_minus_rf' })
    expect(uses).toEqual([])
  })

  it('does not record a duplicate call id twice', () => {
    const { ledger, uses } = ledgerWithSpy()
    ledger.arrived(CALL)
    ledger.arrived(CALL)
    expect(uses).toHaveLength(1)
  })

  it('leaves an unknown name visible as unanswered when the refusal cannot be sent', () => {
    // `arrived` records the entry BEFORE it emits, so a send that throws leaves
    // the call exactly where it is. The model is waiting for a frame that did
    // not go out, and that is what `unanswered()` means.
    const registry = createRegistry([manifest('ask_workspace')])
    const ledger = createLedger({
      registry,
      send: () => {
        throw new Error('Object has been destroyed')
      },
      now: () => 1_000,
      used: () => {},
    })
    expect(() => ledger.arrived({ ...CALL, name: 'rm_minus_rf' })).toThrow()
    expect(ledger.unanswered()).toEqual([CALL.callId])
    expect(ledger.calls()[0]).toMatchObject({ name: 'rm_minus_rf', state: 'pending' })
  })

  it('answers the call even when recording the use throws', () => {
    // It writes a file, so it genuinely can fail. Losing the record of a use
    // costs a column that says "never"; letting it escape would hang the
    // conversation over a bookkeeping write.
    const frames: AnswerFrame[] = []
    const ledger = createLedger({
      registry: createRegistry([manifest('ask_workspace')]),
      send: (frame) => frames.push(frame),
      now: () => 1_000,
      used: () => {
        throw new Error('ENOSPC')
      },
    })
    expect(() => ledger.arrived(CALL)).not.toThrow()
    expect(ledger.answer('call_1', 'done')).toEqual({ ok: true })
    expect(frames).toHaveLength(1)
  })
})
