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
import type { Arrival, Ledger } from './ledger'

/** What settles a call that could not be run at all. */
// Both settle-strings are catalogued now, so they can be read and rewritten
// rather than only read here. Resolved through `deps.prompt` at the moment they
// are needed, like every other prompt in a capability's path.

export interface Dispatch {
  /** Every capability in this build, by the name it declared. */
  readonly capabilities: ReadonlyMap<string, Capability>
  readonly deps: CapabilityDeps
  readonly ledger: Ledger
  /**
   * Why this capability may not run right now, or null when it may.
   *
   * 5b's standing grants, asked at CALL time rather than at session open. The
   * tool list she was handed is a snapshot: a grant taken away mid-conversation
   * leaves her holding a description of something she may no longer do, and a
   * model that calls it then must get a sentence rather than an error.
   *
   * A string rather than a boolean, because what she is told is the whole
   * point — a refusal she cannot explain presents as her declining to help,
   * which is the failure `notBuilt` was deleted from this repository for.
   */
  readonly withheld: (name: string) => string | null
  /** Where a problem goes so somebody can be shown it. */
  readonly note: (name: string, detail: string) => void
  readonly log: (line: string) => void
  readonly warn: (line: string, error?: unknown) => void
  /**
   * A late answer has landed; ask her to volunteer it.
   *
   * §1 chose to send the second `function_call_output` with NO
   * `response.create`, because asking for a turn while she is speaking is
   * refused intermittently — and its note for what happens instead is *"it
   * comes out naturally the next time she speaks"*. Observed 2026-08-24, that
   * assumes a conversation that keeps going: the forecast arrived 25 seconds
   * after she said "just a tiny moment more", into a silent room, and was
   * never said at all.
   *
   * So the frame is unchanged and this is separate from it. Whether she may
   * speak yet is the renderer's to judge — see `audio/nudge.ts` — and a refusal
   * costs nothing, because the answer is already queued and degrades to exactly
   * the old behaviour.
   *
   * ONLY on the deferred path. An `immediate` capability answers inside the
   * turn she is already taking, and asking for another would interrupt her
   * mid-sentence to repeat herself.
   */
  readonly volunteer: () => void
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
  const { capabilities, deps, ledger, note, log, warn, withheld, volunteer } = dispatch
  const { name, callId } = call

  /**
   * GUARDED, because `arrived` can send.
   *
   * It emits one frame itself — the refusal for a name no capability answers to
   * — and that send is `webContents.send` on a window that can be destroyed, so
   * it throws. Unguarded it came straight back out of an `ipcMain` listener,
   * where nothing catches it. The path is not hypothetical: a capability
   * withdrawn while the model still holds the older tool list is exactly what a
   * revoked grant produces.
   */
  let arrival: Arrival
  try {
    arrival = ledger.arrived(call)
  } catch (error: unknown) {
    // Nothing left to answer to — the window holding the conversation is gone.
    quietly(() => warn(`[capability] ${name}: the refusal could not be sent:`, error))
    quietly(() => note(name, `the answer could not be sent: ${String(error)}`))
    return
  }
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

  /**
   * Taken away since she was handed the tool list. Answered, never dropped.
   *
   * Checked BEFORE the handler, and before the unreachable no-handler branch
   * below, because this one is entirely reachable: the switch is in a window
   * somebody can open mid-conversation.
   */
  let refusal: string | null
  try {
    refusal = withheld(name)
  } catch (error: unknown) {
    // FAIL CLOSED, and answer. This reads a file, so it genuinely can throw —
    // and unguarded it escaped `handleCall` with the call already accepted,
    // which hangs the conversation for the rest of the session. A permission
    // this process could not read is not one it may act on, so the call is
    // refused rather than run.
    quietly(() => warn(`[capability] ${name}: could not read what is allowed:`, error))
    quietly(() => note(name, `could not read what is allowed: ${String(error)}`))
    settle(name, note, () =>
      ledger.answer(callId, { status: 'unavailable', guidance: deps.prompt('dispatch.couldNot') }),
    )
    return
  }
  if (refusal !== null) {
    quietly(() => log(`[capability] ${name} is not allowed just now`))
    settle(name, note, () => ledger.answer(callId, { status: 'not-allowed', guidance: refusal }))
    return
  }

  const capability = capabilities.get(name)
  if (capability === undefined) {
    // Unreachable by construction: `arrived` accepts only names the registry
    // holds, and the registry is built from the manifests of this very map.
    // Answered anyway — the alternative to an unreachable branch that answers
    // is an unreachable branch that hangs the conversation.
    quietly(() => warn(`[capability] ${name} is on the wire with no handler`))
    quietly(() => note(name, 'declared with no handler — this is a bug in the build'))
    settle(name, note, () =>
      ledger.answer(callId, { status: 'unavailable', guidance: deps.prompt('dispatch.couldNot') }),
    )
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
          ledger.answer(callId, {
            status: 'unavailable',
            guidance: deps.prompt('dispatch.couldNot'),
          }),
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
          /*
            CHECKED AGAIN, because the first check is up to three minutes old.

            `ask_workspace` runs for up to 180 seconds and the permission
            switch is in a window somebody can open mid-conversation -- the
            same sentence that justifies checking per call justifies checking
            again here. Somebody who revokes a capability while it is running
            has said they do not want its result, and delivering it anyway
            makes the revoke advisory.

            A refusal is DELIVERED rather than dropped: the call is already
            deferred, and `undelivered()` exists because a promise she never
            returns from is worse than a no.

            The limit, stated: this stops the ANSWER, not the work. The child
            process runs to completion and the file it read has already been
            read. Killing it needs an abort signal threaded through every
            handler, which is a larger change than this one; what this
            guarantees is that a revoked capability's output never reaches her.
          */
          let revoked: string | null = null
          try {
            revoked = withheld(name)
          } catch (error: unknown) {
            // Fail closed, exactly as the first check does. A permission this
            // process cannot read is not one it may act on.
            quietly(() => warn(`[capability] ${name}: could not re-read what is allowed:`, error))
            revoked = deps.prompt('dispatch.couldNot')
          }
          if (revoked !== null) {
            quietly(() => log(`[capability] ${name} was withheld while it ran; not delivered`))
            quietly(() => note(name, 'the permission was withdrawn while this was running'))
            settle(name, note, () =>
              ledger.deliver(callId, { status: 'not-allowed', guidance: revoked }),
            )
            return
          }
          if (settle(name, note, () => ledger.deliver(callId, output))) {
            quietly(() => log(`[capability] ${name} delivered ${forLog(output)}`))
            // AFTER the answer is on the wire, so the turn she is asked for can
            // carry it. Quietly, for `quietly`'s reason: the answer is out, and
            // a failure to ask must not become a failure to deliver.
            quietly(() => {
              volunteer()
            })
          }
        } catch (error: unknown) {
          // Delivered anyway. A deferred call that never arrives is worse than
          // a refusal, and `undelivered()` is the only thing that would notice.
          quietly(() => warn(`[capability] ${name} threw:`, error))
          quietly(() => note(name, String(error)))
          if (
            settle(name, note, () =>
              ledger.deliver(callId, {
                status: 'unavailable',
                guidance: deps.prompt('dispatch.didNotFinish'),
              }),
            )
          ) {
            // A refusal is an answer too. She said she would look; "it did not
            // work" spoken is the whole point of not leaving her silent.
            quietly(() => {
              volunteer()
            })
          }
        }
      })()
      return
    }
  }
}
