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
  const volunteered: number[] = []
  const noted: string[] = []
  const byName = new Map(capabilities.map((one) => [one.manifest.name, one]))
  const uses: string[] = []
  const ledger = createLedger({
    registry: createRegistry(capabilities.map((one) => one.manifest)),
    send: (frame) => frames.push(frame),
    now: () => 1_000,
    used: (name) => uses.push(name),
  })
  const dispatch: Dispatch = {
    capabilities: byName,
    deps: stubDeps(),
    ledger,
    volunteer: () => volunteered.push(1),
    note: (name, detail) => noted.push(`${name}: ${detail}`),
    log: () => {},
    warn: () => {},
    withheld: () => null,
  }
  return { dispatch, ledger, frames, noted, uses, volunteered }
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
      now: () => 1_000,
      used: () => {},
    })
    handleCall(
      {
        capabilities: new Map(),
        deps: stubDeps(),
        ledger,
        note: (name, detail) => noted.push(`${name}: ${detail}`),
        log: () => {},
        warn: () => {},
        withheld: () => null,
        volunteer: () => undefined,
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
      now: () => 1_000,
      used: () => {},
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
          withheld: () => null,
          volunteer: () => undefined,
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
      now: () => 1_000,
      used: () => {},
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
        withheld: () => null,
        volunteer: () => undefined,
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

describe('a capability whose grant has been taken away', () => {
  it('is answered with a sentence rather than run', () => {
    // The switch is in a window somebody can open mid-conversation, so the tool
    // list she is holding is a snapshot. A model that calls a withdrawn
    // capability must get something it can say out loud — a refusal she cannot
    // explain presents as her declining to help, which is the failure
    // `notBuilt` was deleted from this repository for.
    let ran = false
    const one = immediate('fast', () => {
      ran = true
      return { status: 'ok' }
    })
    const { dispatch, frames } = harness([one])
    handleCall({ ...dispatch, withheld: () => 'They turned it off. Say so plainly.' }, CALL)

    expect(ran).toBe(false)
    expect(outputs(frames, 'call_1')).toEqual([
      { status: 'not-allowed', guidance: 'They turned it off. Say so plainly.' },
    ])
  })

  it('is answered rather than dropped, so nothing is left hanging', () => {
    const { dispatch, ledger } = harness([immediate('fast', () => ({ status: 'ok' }))])
    handleCall({ ...dispatch, withheld: () => 'no' }, CALL)
    expect(ledger.unanswered()).toEqual([])
    expect(ledger.undelivered()).toEqual([])
  })

  it('does not start a deferred capability either', async () => {
    // The expensive one. A lookup that ran and then had its answer thrown away
    // would be a revoked capability still reading the workspace.
    let ran = false
    const slow = deferred('slow', async () => {
      ran = true
      return { status: 'ok' }
    })
    const { dispatch, frames } = harness([slow])
    handleCall({ ...dispatch, withheld: () => 'no' }, { name: 'slow', callId: 'c', args: '{}' })
    await new Promise((resolve) => setImmediate(resolve))

    expect(ran).toBe(false)
    expect(outputs(frames, 'c')).toEqual([{ status: 'not-allowed', guidance: 'no' }])
  })

  it('is refused, not run, when what is allowed cannot be read', () => {
    // `withheld` reads a file, so it genuinely can throw — and unguarded it
    // escaped `handleCall` with the call already accepted, which hangs the
    // conversation for the rest of the session. Fails CLOSED: a permission
    // this process could not read is not one it may act on.
    let ran = false
    const one = immediate('fast', () => {
      ran = true
      return { status: 'ok' }
    })
    const { dispatch, ledger, frames } = harness([one])
    expect(() =>
      handleCall(
        {
          ...dispatch,
          withheld: () => {
            throw new Error('preferences.json could not be read')
          },
        },
        CALL,
      ),
    ).not.toThrow()

    expect(ran).toBe(false)
    expect(ledger.unanswered()).toEqual([])
    expect(outputs(frames, 'call_1')).toEqual([
      { status: 'unavailable', guidance: expect.stringContaining('Say so plainly') },
    ])
  })

  it('runs normally when nothing is withheld', () => {
    const { dispatch, frames } = harness([immediate('fast', () => ({ status: 'ok' }))])
    handleCall(dispatch, CALL)
    expect(outputs(frames, 'call_1')).toEqual([{ status: 'ok' }])
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
      now: () => 1_000,
      used: () => {},
    })
    const dispatch: Dispatch = {
      capabilities: new Map([[one.manifest.name, one]]),
      deps: stubDeps(),
      ledger,
      note: (name, detail) => noted.push(`${name}: ${detail}`),
      log: () => {},
      warn: () => {},
      withheld: () => null,
      volunteer: () => undefined,
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

  it('does not throw when a name NOBODY answers to cannot be refused either', () => {
    // `ledger.arrived` sends one frame itself — the refusal for an unknown name
    // — and that send throws on a destroyed window. Unguarded it came straight
    // back out of the `ipcMain` listener. The path is not hypothetical: a
    // capability withdrawn while the model still holds the older tool list is
    // exactly what revoking a grant produces.
    const { dispatch, noted } = angryTransport(immediate('fast', () => ({ status: 'ok' })))
    expect(() =>
      handleCall(dispatch, { name: 'rm_minus_rf', callId: 'call_9', args: '{}' }),
    ).not.toThrow()
    expect(noted.join()).toContain('could not be sent')
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

describe('asking her to volunteer a late answer', () => {
  it('asks once the deferred result is on the wire', async () => {
    /*
      §1 sends the second `function_call_output` with no `response.create`, and
      its note for what happens next is *"it comes out naturally the next time
      she speaks"*. Observed 2026-08-24, that assumed a conversation that keeps
      going: the forecast landed 25 seconds after she said "just a tiny moment
      more", into a silent room, and was never spoken at all.

      The frame itself is unchanged — `ledger.test.ts` still asserts it never
      asks for a turn. This is a separate signal, and the RENDERER decides
      whether she may take one; see `audio/nudge.ts`.
    */
    const { dispatch, frames, volunteered } = harness([
      deferred('slow', async () => ({ status: 'ok', answer: 'Tuesday' })),
    ])
    handleCall(dispatch, { name: 'slow', callId: 'call_v', args: '{}' })
    // Acknowledged, not yet delivered: nothing to volunteer.
    expect(volunteered).toHaveLength(0)

    await new Promise((resolve) => setImmediate(resolve))
    expect(volunteered).toHaveLength(1)
    // AFTER the answer, so the turn she is asked for can carry it.
    expect(outputs(frames, 'call_v')).toEqual([
      { status: 'started' },
      { status: 'ok', answer: 'Tuesday' },
    ])
  })

  it('asks even when the lookup failed, because a refusal is an answer', async () => {
    // She said she would look. "It did not work", spoken, is the whole point of
    // not leaving her silent — a failed lookup that says nothing is the same
    // dead end as a successful one that says nothing.
    const { dispatch, volunteered } = harness([
      deferred('slow', async () => {
        throw new Error('the CLI died')
      }),
    ])
    handleCall(dispatch, { name: 'slow', callId: 'call_w', args: '{}' })
    await new Promise((resolve) => setImmediate(resolve))
    expect(volunteered).toHaveLength(1)
  })

  it('does NOT ask for an immediate capability', () => {
    /*
      An immediate answer settles inside the turn she is already taking, so
      asking for another would interrupt her mid-sentence to repeat herself —
      and mid-sentence is exactly where §1 measured `response.create` being
      refused.
    */
    const { dispatch, volunteered } = harness([immediate('fast', () => ({ status: 'ok' }))])
    handleCall(dispatch, CALL)
    expect(volunteered).toHaveLength(0)
  })
})

describe('a permission withdrawn while a deferred call was running', () => {
  /**
   * `ask_workspace` runs for up to 180 seconds and the switch is in a window
   * somebody can open mid-conversation. The check that justifies itself as
   * "per call, not held" ran once and then not again for three minutes, so a
   * revoke during the run was advisory: the answer was delivered anyway.
   */
  async function ranThenRevoked() {
    let allowed = true
    const kit = harness([
      deferred('slow', async () => {
        // Revoked while the handler is in flight.
        allowed = false
        return await Promise.resolve({ status: 'ok', answer: 'THE-WORKSPACE-CONTENTS' })
      }),
    ])
    // Rebuilt rather than assigned: `withheld` is readonly on `Dispatch`, and
    // that is the point of the field -- a dispatch whose permission source can
    // be swapped after construction is one whose checks mean less.
    const dispatch = { ...kit.dispatch, withheld: () => (allowed ? null : 'not just now') }
    handleCall(dispatch, { name: 'slow', callId: 'call_slow', args: JSON.stringify({}) })
    // Let the deferred body run to completion.
    await new Promise((resolve) => setTimeout(resolve, 0))
    return kit
  }

  it('does not put the answer on the wire', async () => {
    const kit = await ranThenRevoked()
    const wire = JSON.stringify(outputs(kit.frames, 'call_slow'))
    expect(wire).not.toContain('THE-WORKSPACE-CONTENTS')
  })

  it('delivers a refusal rather than leaving the promise open', async () => {
    // The call is already deferred. `undelivered()` exists because a promise
    // she never returns from is worse than a no.
    const kit = await ranThenRevoked()
    const wire = JSON.stringify(outputs(kit.frames, 'call_slow'))
    expect(wire).toContain('not-allowed')
    expect(kit.ledger.undelivered()).not.toContain('call_slow')
  })

  it('says so where somebody can see it', async () => {
    const kit = await ranThenRevoked()
    expect(kit.noted.join(' ')).toContain('withdrawn while this was running')
  })
})
