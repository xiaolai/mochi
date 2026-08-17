import { recallPayloadFor } from '../memory/answer'
import type { Transcripts } from '../store/transcripts'

/**
 * What each shipped capability actually does.
 *
 * ## Why a map and not a branch
 *
 * Something has to implement a capability, and that part is inherently code —
 * the manifest says a tool exists and what its arguments are, not what happens
 * when it is called. The question is only whether adding one touches one place
 * or six.
 *
 * v1's answer was six: an array, a name constant, an argument reader, a
 * callback, a branch in an `if/else` chain, an IPC kind, a handler. Here it is
 * **two** and they are different kinds of thing — a manifest folder, which is
 * data a user could write, and one entry here, which is code that only a build
 * can carry. That split is the whole design: `resources/capabilities/` is the
 * open half and this file is the closed one.
 *
 * ## A name with no entry is answered, not dropped
 *
 * `handlerFor` returns a function in every case. A declared capability with no
 * implementation says so, rather than leaving the call unanswered — which would
 * hang the conversation for the rest of the session and give her no way to
 * mention it. `ledger.unanswered()` exists to make that failure visible; this
 * exists to make it not happen.
 */

/**
 * Arguments arrive already read against the manifest that declared them, so a
 * handler never parses. Missing and wrong-typed both arrive as `''`.
 */
// `unknown` alone, not `unknown | Promise<unknown>` — `unknown` already
// subsumes a promise, and the caller awaits regardless.
export type Handler = (args: Readonly<Record<string, string>>) => unknown

export interface HandlerDeps {
  readonly transcripts: () => Transcripts | null
  /** Whose archive to search. Null before a persona has been put on. */
  readonly wearing: () => string | null
  readonly now?: () => number
}

export function builtinHandlers(deps: HandlerDeps): ReadonlyMap<string, Handler> {
  const now = deps.now ?? Date.now

  return new Map<string, Handler>([
    [
      'recall_conversations',
      (args) => {
        const store = deps.transcripts()
        const personaId = deps.wearing()
        // `null` search means the store could not be asked, which
        // `recallPayloadFor` reports as `unavailable` — deliberately NOT the
        // same answer as searching and finding nothing. A model handed an empty
        // object picks one of those at random, and only one of them is true.
        const search =
          store === null || personaId === null
            ? null
            : () => store.search(personaId, args['query'] ?? '')
        return recallPayloadFor(search, now())
      },
    ],
  ])
}

/** The answer for a capability that is declared and not implemented. */
export function notBuilt(name: string): Handler {
  return () => ({
    status: 'unavailable',
    guidance:
      `The ${name} capability is declared but not built in this version. ` +
      'Say plainly that you cannot do it yet. Do not pretend to have done it.',
  })
}

export function handlerFor(handlers: ReadonlyMap<string, Handler>, name: string): Handler {
  return handlers.get(name) ?? notBuilt(name)
}
