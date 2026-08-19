/**
 * She called something. This decides what runs, and that every call is answered.
 *
 * ## Why this is not four lines inside an `ipcMain.on`
 *
 * It was, and the thing it has to guarantee is exactly the thing an inline
 * listener cannot be tested for. `ledger.ts`'s header names it: an
 * implementation that silently drops a call satisfies every at-most-once test
 * ever written, and the failure is a conversation that hangs for the rest of
 * the session with nothing in it saying so. That property is worth a module of
 * its own with the ledger, the clock and the reporting injected, so
 * "every path answers" is an assertion rather than a claim about a listener
 * nobody can call.
 *
 * The one that was actually wrong: a deferred handler that threw SYNCHRONOUSLY
 * — before returning its promise — escaped `.then(ok, fail)` entirely, because
 * there was no promise yet to attach it to. The ledger had already recorded the
 * deferral, so she said she would look and then never came back, and
 * `undelivered()` was the only thing in the process that would ever have known.
 * Running the handler inside an `async` body catches that with the same `catch`
 * that takes a rejection.
 *
 * ## It switches on `kind`
 *
 * One map of whole capabilities, and a `switch` the compiler checks. The two
 * branches take differently-typed handlers, so a slow handler cannot be sent
 * down the fast path — which is what the discriminated union is for.
 */

import type { Capability, CapabilityDeps, CapabilityOutput } from '../../capabilities/kind'
import type { Ledger } from './ledger'

/** What settles a call that could not be run at all. */
const COULD_NOT = 'That did not work just now. Say so plainly rather than guessing at a result.'

/** What settles a deferred call whose lookup died after she said she would look. */
const DID_NOT_FINISH = 'The lookup did not finish. Say so plainly rather than guessing at a result.'

export interface Dispatch {
  /** Every capability in this build, by the name it declared. */
  readonly capabilities: ReadonlyMap<string, Capability>
  readonly deps: CapabilityDeps
  readonly ledger: Ledger
  /** Where a problem goes so somebody can be shown it. */
  readonly note: (name: string, detail: string) => void
  readonly log: (line: string) => void
  readonly warn: (line: string, error?: unknown) => void
}

/**
 * Settle a call, and survive a transport that has gone away.
 *
 * `ledger.answer` and `ledger.defer` record the state and then send, and the
 * send is `webContents.send` on a window that can be destroyed — so it throws,
 * after the ledger has already moved. Retrying is pointless (the ledger refuses
 * a second acknowledgement) and letting it escape is worse than pointless: it
 * would come out of an `ipcMain` listener, where nothing catches it.
 *
 * There is nothing to answer to in that case — the window holding the
 * conversation is gone — so the honest behaviour is to record it and stop, not
 * to keep trying to speak into a closed channel.
 */
function settle(name: string, note: Dispatch['note'], emit: () => void): boolean {
  try {
    emit()
    return true
  } catch (error: unknown) {
    quietly(() => note(name, `the answer could not be sent: ${String(error)}`))
    return false
  }
}

/**
 * Say something about a call, and never let saying it break the call.
 *
 * `log`, `warn` and `note` are observers, and one of them genuinely can throw:
 * `problems.note` notifies watchers, and main's watcher sends to the companion
 * window — which throws once that window has been destroyed. An observer that
 * takes the answer down with it would turn "we could not tell you about it"
 * into "the conversation hangs", which is the exact trade this module exists to
 * refuse. Anything they were going to report is lost; the frame is not.
 */
function quietly(say: () => void): void {
  try {
    say()
  } catch {
    // Deliberately nothing. There is nowhere left to report a failure of the
    // thing whose job is reporting, and the answer still has to go out.
  }
}

/**
 * A result, short enough for a log line, without ever throwing.
 *
 * `JSON.stringify` returns `undefined` rather than a string for some values and
 * throws outright on a cycle — and this is called AFTER the call has been
 * settled, on the deferred path inside a promise callback. A throw there was an
 * unhandled rejection caused by a log line.
 */
function forLog(output: unknown): string {
  try {
    return String(JSON.stringify(output)).slice(0, 120)
  } catch {
    return '(a result that could not be serialised for the log)'
  }
}

/**
 * Run one tool call to a frame, whatever happens.
 *
 * Returns immediately in every case. A deferred capability is acknowledged
 * here and delivered later on the same `call_id` (§1) — the promise is
 * deliberately not awaited, because `codex exec` has a twenty-second floor
 * (§8) and waiting for it would leave her silent mid-conversation.
 */
export function handleCall(
  dispatch: Dispatch,
  call: { readonly name: string; readonly callId: string; readonly args: unknown },
): void {
  const { capabilities, deps, ledger, note, log, warn } = dispatch
  const { name, callId } = call

  const arrival = ledger.arrived(call)
  if (arrival.kind !== 'accepted') {
    // Already settled or already seen. `arrived` emits the refusal for an
    // unknown name itself, so there is nothing left to answer here.
    quietly(() => log(`[capability] ${name}: ${arrival.kind}`))
    return
  }
  // BOUNDED, like the result. The arguments are model output arriving through a
  // renderer, and an unbounded log line is a way to make the main process do
  // work by asking it to write something down.
  quietly(() => log(`[capability] ${name}(${forLog(arrival.args)})`))

  const capability = capabilities.get(name)
  if (capability === undefined) {
    // Unreachable by construction: `arrived` accepts only names the registry
    // holds, and the registry is built from the manifests of this very map.
    // Answered anyway — the alternative to an unreachable branch that answers
    // is an unreachable branch that hangs the conversation.
    quietly(() => warn(`[capability] ${name} is on the wire with no handler`))
    quietly(() => note(name, 'declared with no handler — this is a bug in the build'))
    settle(name, note, () => ledger.answer(callId, { status: 'unavailable', guidance: COULD_NOT }))
    return
  }

  switch (capability.kind) {
    case 'immediate': {
      // SYNCHRONOUS, and that is the type's doing. An immediate handler answers
      // with an object of JSON values and cannot return a promise, so there is
      // nothing to await; a handler that wanted to wait would have to declare
      // itself deferred.
      let output: CapabilityOutput
      try {
        output = capability.handler(arrival.args, deps)
      } catch (error: unknown) {
        // The HANDLER failed, which is a thing to say out loud. Kept separate
        // from a transport failure below, because one produces a sentence and
        // the other means there is nobody left to say it to.
        quietly(() => warn(`[capability] ${name} threw:`, error))
        quietly(() => note(name, String(error)))
        settle(name, note, () =>
          ledger.answer(callId, { status: 'unavailable', guidance: COULD_NOT }),
        )
        return
      }
      if (settle(name, note, () => ledger.answer(callId, output))) {
        quietly(() => log(`[capability] ${name} -> ${forLog(output)}`))
      }
      return
    }
    case 'deferred': {
      // OUTSIDE the async body and therefore guarded here: this send is the
      // acknowledgement, and a throw from it used to escape the listener with
      // the call already recorded as deferred — permanently, since `deliver`
      // is the only thing that could move it and nothing was going to run.
      if (!settle(name, note, () => ledger.defer(callId, { status: 'started' }))) return
      // An `async` body, NOT `handler(...).then(...)`. A handler that throws
      // before returning its promise has no promise to attach a rejection
      // handler to, so it escaped — after the deferral was recorded, which is
      // the state where she has said she will look and never comes back.
      void (async () => {
        try {
          const output = await capability.handler(arrival.args, deps)
          if (settle(name, note, () => ledger.deliver(callId, output))) {
            quietly(() => log(`[capability] ${name} delivered ${forLog(output)}`))
          }
        } catch (error: unknown) {
          // Delivered anyway. A deferred call that never arrives is worse than
          // a refusal, and `undelivered()` is the only thing that would notice.
          quietly(() => warn(`[capability] ${name} threw:`, error))
          quietly(() => note(name, String(error)))
          settle(name, note, () =>
            ledger.deliver(callId, { status: 'unavailable', guidance: DID_NOT_FINISH }),
          )
        }
      })()
      return
    }
  }
}
