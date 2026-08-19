import { describe, expect, it } from 'vitest'
import { createRegistry } from '@shared/capability/registry'
import type { CapabilityManifest } from '@shared/capability/manifest'
import type { Capability } from '../../capabilities/kind'
import { stubDeps } from '../../test/capability-deps'
import { createLedger, type AnswerFrame } from './ledger'
import { handleCall, type Dispatch } from './dispatch'

/**
 * ONE property, over every path: the call is answered.
 *
 * `ledger.ts` says why this needs its own file. An implementation that silently
 * drops a call satisfies every at-most-once test ever written, and what it
 * leaves behind is a conversation waiting for a frame that is not coming, for
 * the rest of the session, with nothing in it that says so. `unanswered()` and
 * `undelivered()` exist to make that visible; these assert it never happens.
 *
 * A real ledger and a real registry, with only the transport recorded. Mocking
 * the ledger here would test that this file calls functions, which is not the
 * property.
 */

function manifest(name: string): CapabilityManifest {
  return {
    name,
    description: `The ${name} capability.`,
    parameters: {
      type: 'object',
      properties: { input: { type: 'string', description: 'The input.' } },
      required: ['input'],
    },
  }
}

function immediate(name: string, handler: Capability['handler']): Capability {
  return { manifest: manifest(name), kind: 'immediate', handler } as Capability
}

function deferred(name: string, handler: Capability['handler']): Capability {
  return { manifest: manifest(name), kind: 'deferred', handler } as Capability
}

function harness(capabilities: readonly Capability[]) {
  const frames: AnswerFrame[] = []
  const noted: string[] = []
  const byName = new Map(capabilities.map((one) => [one.manifest.name, one]))
  const ledger = createLedger({
    registry: createRegistry(capabilities.map((one) => one.manifest)),
    send: (frame) => frames.push(frame),
  })
  const dispatch: Dispatch = {
    capabilities: byName,
    deps: stubDeps(),
    ledger,
    note: (name, detail) => noted.push(`${name}: ${detail}`),
    log: () => {},
    warn: () => {},
  }
  return { dispatch, ledger, frames, noted }
}

/** What actually went on the wire for a call, in order. */
function outputs(frames: readonly AnswerFrame[], callId: string): readonly unknown[] {
  return frames
    .filter((frame) => frame.item.call_id === callId)
    .map((frame) => JSON.parse(frame.item.output) as unknown)
}

const CALL = { name: 'fast', callId: 'call_1', args: JSON.stringify({ input: 'x' }) }

describe('an immediate capability', () => {
  it('settles the call with what the handler answered', () => {
    const { dispatch, ledger, frames } = harness([immediate('fast', () => ({ status: 'ok' }))])
    handleCall(dispatch, CALL)
    expect(outputs(frames, 'call_1')).toEqual([{ status: 'ok' }])
    expect(ledger.unanswered()).toEqual([])
    expect(ledger.undelivered()).toEqual([])
  })

  it('reads its arguments against the manifest that declared them', () => {
    let seen: unknown = null
    const { dispatch } = harness([
      immediate('fast', (args) => {
        seen = args
        return { status: 'ok' }
      }),
    ])
    handleCall(dispatch, CALL)
    expect(seen).toEqual({ input: 'x' })
  })

  it('still answers when the handler throws, and says where it went', () => {
    const { dispatch, ledger, frames, noted } = harness([
      immediate('fast', () => {
        throw new Error('the store fell over')
      }),
    ])
    handleCall(dispatch, CALL)
    expect(outputs(frames, 'call_1')).toEqual([
      { status: 'unavailable', guidance: expect.stringContaining('Say so plainly') },
    ])
    expect(ledger.unanswered()).toEqual([])
    expect(noted.join()).toContain('the store fell over')
  })

  it('still answers when the result cannot be serialised for the log', () => {
    // The log line runs AFTER the call is settled. A throw in it used to be a
    // throw out of the listener, and on the deferred path an unhandled
    // rejection — caused by a `console.log`.
    const cyclic: Record<string, unknown> = { status: 'ok' }
    cyclic['self'] = cyclic
    const { dispatch, ledger } = harness([immediate('fast', () => cyclic as never)])
    expect(() => handleCall(dispatch, CALL)).not.toThrow()
    expect(ledger.unanswered()).toEqual([])
  })
})

describe('a deferred capability', () => {
  it('acknowledges at once and delivers on the same call id', async () => {
    const { dispatch, ledger, frames } = harness([
      deferred('slow', async () => ({ status: 'ok', answer: 'Tuesday' })),
    ])
    handleCall(dispatch, { name: 'slow', callId: 'call_2', args: '{}' })
    // Acknowledged BEFORE the work finishes — that is the whole mechanism.
    expect(outputs(frames, 'call_2')).toEqual([{ status: 'started' }])
    expect(ledger.undelivered()).toEqual(['call_2'])

    await new Promise((resolve) => setImmediate(resolve))
    expect(outputs(frames, 'call_2')).toEqual([
      { status: 'started' },
      { status: 'ok', answer: 'Tuesday' },
    ])
    expect(ledger.undelivered()).toEqual([])
  })

  it('delivers a refusal when the lookup rejects', async () => {
    const { dispatch, ledger, frames, noted } = harness([
      deferred('slow', async () => {
        throw new Error('the CLI died')
      }),
    ])
    handleCall(dispatch, { name: 'slow', callId: 'call_3', args: '{}' })
    await new Promise((resolve) => setImmediate(resolve))
    expect(outputs(frames, 'call_3')[1]).toEqual({
      status: 'unavailable',
      guidance: expect.stringContaining('did not finish'),
    })
    expect(ledger.undelivered()).toEqual([])
    expect(noted.join()).toContain('the CLI died')
  })

  it('delivers when the handler throws SYNCHRONOUSLY, before it has a promise', async () => {
    // The one that was actually broken. `handler(...).then(ok, fail)` attaches
    // its rejection handler to a promise that a synchronous throw never
    // produces, so the throw escaped the listener — with the deferral already
    // recorded. She said she would look and never came back, and
    // `undelivered()` was the only thing that would ever have known.
    const { dispatch, ledger, frames } = harness([
      deferred('slow', () => {
        throw new Error('threw before awaiting anything')
      }),
    ])
    expect(() => handleCall(dispatch, { name: 'slow', callId: 'call_4', args: '{}' })).not.toThrow()
    await new Promise((resolve) => setImmediate(resolve))
    expect(ledger.undelivered()).toEqual([])
    expect(outputs(frames, 'call_4')).toHaveLength(2)
  })
})

describe('a call that cannot be run', () => {
  it('is answered by the ledger when nothing declares that name', () => {
    const { dispatch, ledger, frames } = harness([immediate('fast', () => ({ status: 'ok' }))])
    handleCall(dispatch, { name: 'rm_minus_rf', callId: 'call_5', args: '{}' })
    expect(outputs(frames, 'call_5')).toEqual([{ error: 'no capability named rm_minus_rf' }])
    expect(ledger.unanswered()).toEqual([])
  })

  it('is answered, and noted, when a name is on the wire with no handler', () => {
    // Unreachable while the registry is built from these manifests — and
    // answered rather than dropped, because the alternative to an unreachable
    // branch that answers is an unreachable branch that hangs.
    const one = immediate('fast', () => ({ status: 'ok' }))
    const frames: AnswerFrame[] = []
    const noted: string[] = []
    const ledger = createLedger({
      registry: createRegistry([one.manifest]),
      send: (frame) => frames.push(frame),
    })
    handleCall(
      {
        capabilities: new Map(),
        deps: stubDeps(),
        ledger,
        note: (name, detail) => noted.push(`${name}: ${detail}`),
        log: () => {},
        warn: () => {},
      },
      CALL,
    )
    expect(outputs(frames, 'call_1')).toEqual([
      { status: 'unavailable', guidance: expect.stringContaining('Say so plainly') },
    ])
    expect(ledger.unanswered()).toEqual([])
    expect(noted.join()).toContain('no handler')
  })

  it('sends nothing at all for a call id it has already seen', () => {
    // Not a refusal frame: the first call is still in flight or already
    // settled, and a second frame on it would be a duplicate rather than the
    // deliberate second frame a deferral earns.
    const { dispatch, frames } = harness([immediate('fast', () => ({ status: 'ok' }))])
    handleCall(dispatch, CALL)
    handleCall(dispatch, CALL)
    expect(outputs(frames, 'call_1')).toHaveLength(1)
  })
})

describe('an observer that fails', () => {
  it('cannot stop the call being answered', () => {
    // `problems.note` notifies watchers, and main's watcher sends to the
    // companion window — which throws once that window has been destroyed. An
    // observer taking the answer down with it would turn "we could not tell you
    // about it" into "the conversation hangs", which is the one outcome this
    // module exists to refuse.
    const frames: AnswerFrame[] = []
    const one = immediate('fast', () => {
      throw new Error('the store fell over')
    })
    const ledger = createLedger({
      registry: createRegistry([one.manifest]),
      send: (frame) => frames.push(frame),
    })
    const angry = (): never => {
      throw new Error('the window has been destroyed')
    }
    expect(() =>
      handleCall(
        {
          capabilities: new Map([[one.manifest.name, one]]),
          deps: stubDeps(),
          ledger,
          note: angry,
          log: angry,
          warn: angry,
        },
        CALL,
      ),
    ).not.toThrow()
    expect(ledger.unanswered()).toEqual([])
    expect(outputs(frames, 'call_1')).toEqual([
      { status: 'unavailable', guidance: expect.stringContaining('Say so plainly') },
    ])
  })

  it('cannot stop a deferred call being delivered', async () => {
    const frames: AnswerFrame[] = []
    const one = deferred('slow', async () => ({ status: 'ok' }))
    const ledger = createLedger({
      registry: createRegistry([one.manifest]),
      send: (frame) => frames.push(frame),
    })
    const angry = (): never => {
      throw new Error('the window has been destroyed')
    }
    handleCall(
      {
        capabilities: new Map([[one.manifest.name, one]]),
        deps: stubDeps(),
        ledger,
        note: angry,
        log: angry,
        warn: angry,
      },
      { name: 'slow', callId: 'call_6', args: '{}' },
    )
    await new Promise((resolve) => setImmediate(resolve))
    expect(ledger.undelivered()).toEqual([])
    expect(outputs(frames, 'call_6')).toHaveLength(2)
  })

  it('bounds what it writes down about a call', () => {
    // The arguments are model output arriving through a renderer. An unbounded
    // log line is a way to make the main process do work by asking it to write
    // something down.
    const lines: string[] = []
    const { dispatch } = harness([immediate('fast', () => ({ status: 'ok' }))])
    handleCall(
      { ...dispatch, log: (line) => lines.push(line) },
      { name: 'fast', callId: 'call_7', args: JSON.stringify({ input: 'x'.repeat(50_000) }) },
    )
    for (const line of lines) expect(line.length).toBeLessThan(300)
  })
})

describe('a transport that has gone away', () => {
  function angryTransport(one: Capability) {
    const noted: string[] = []
    const ledger = createLedger({
      registry: createRegistry([one.manifest]),
      send: () => {
        throw new Error('Object has been destroyed')
      },
    })
    const dispatch: Dispatch = {
      capabilities: new Map([[one.manifest.name, one]]),
      deps: stubDeps(),
      ledger,
      note: (name, detail) => noted.push(`${name}: ${detail}`),
      log: () => {},
      warn: () => {},
    }
    return { dispatch, noted }
  }

  it('does not throw out of the listener when an answer cannot be sent', () => {
    // `webContents.send` on a destroyed window throws, and this runs inside an
    // `ipcMain` listener where nothing catches it. There is nothing left to
    // answer to — the window holding the conversation is gone — so it is
    // recorded and dropped rather than retried into a refusal.
    const { dispatch, noted } = angryTransport(immediate('fast', () => ({ status: 'ok' })))
    expect(() => handleCall(dispatch, CALL)).not.toThrow()
    expect(noted.join()).toContain('could not be sent')
  })

  it('does not throw when the ACKNOWLEDGEMENT of a deferred call cannot be sent', async () => {
    // The one that escaped: `ledger.defer` sits outside the async body, so a
    // throw from it left the listener with the call already recorded as
    // deferred — permanently, because `deliver` is the only thing that could
    // move it and nothing was going to run.
    let ran = false
    const { dispatch, noted } = angryTransport(
      deferred('slow', async () => {
        ran = true
        return { status: 'ok' }
      }),
    )
    expect(() => handleCall(dispatch, { name: 'slow', callId: 'call_8', args: '{}' })).not.toThrow()
    await new Promise((resolve) => setImmediate(resolve))
    expect(noted.join()).toContain('could not be sent')
    // And the work was never started, because nothing would have received it.
    expect(ran).toBe(false)
  })

  it('does not throw when a handler fails AND the refusal cannot be sent', async () => {
    const { dispatch } = angryTransport(
      immediate('fast', () => {
        throw new Error('the store fell over')
      }),
    )
    expect(() => handleCall(dispatch, CALL)).not.toThrow()
  })
})
