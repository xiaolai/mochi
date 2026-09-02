import { ipcMain, type IpcMainInvokeEvent } from 'electron'

import type { Answers } from '@shared/answers'

/**
 * Register a request/response channel, with the RETURN TYPE that `ipcMain.
 * handle` throws away.
 *
 * ## What `handle` does not check
 *
 * `ipcMain.handle` accepts `(...args: unknown[]) => unknown`. Whatever a
 * handler returns is accepted, serialised and delivered — and the renderer's
 * side is a cast, because `invoke` also answers `unknown`. So the two ends of
 * every channel were held together by two independently written type names and
 * a hope that somebody kept them level.
 *
 * They did not, three times. `history:problems`, `history:turns` and
 * `history:search` sent shapes nothing checked against the ones the window
 * declared, and it was measured rather than argued: a required field added to
 * all three wire interfaces produced no compiler error anywhere in the project.
 *
 * ## Why a wrapper rather than a check
 *
 * The first fix was a test that read `index.ts` and asserted every handler
 * declared its type. It found the three. Then its own first version turned out
 * to parse twenty-four of twenty-eight handlers — a missing `\s*` before the
 * arrow meant it matched annotated handlers and skipped bare ones, so every
 * handler it could not see was one of the four it existed to find. It was
 * structurally incapable of failing, and passed.
 *
 * That is the argument for moving the rule into the type system. A source
 * check is a second thing that can be wrong about the source; this cannot be
 * wrong about it, because there is no longer a way to write the mistake. The
 * channel is a type parameter, `Answers[C]` is the required return, and a
 * handler that answers something else does not compile.
 *
 * ## The event is optional, and every arity is allowed
 *
 * Handlers here are written `() => …`, `(_event, token: unknown) => …` and
 * `async (event) => …`. A function of fewer parameters is assignable to one of
 * more, so all three shapes satisfy this signature and no call site has to
 * grow an argument it does not use.
 *
 * ## Arguments stay `unknown`, deliberately
 *
 * `Answers` types what main SENDS, not what it receives. Anything arriving from
 * a renderer is untrusted — the whole point of `history:turns` checking
 * `typeof token !== 'string'` before it reaches the query layer — and typing
 * the parameters here would replace that check with a promise the wire cannot
 * keep. One direction is a contract; the other is input.
 */
export function answer<C extends keyof Answers>(
  channel: C,
  handler: (
    event: IpcMainInvokeEvent,
    ...args: readonly unknown[]
  ) => Answers[C] | Promise<Answers[C]>,
): void {
  /*
    The cast is HERE and nowhere else, and it is the point of the file.

    Electron's own overload is `(...args: any[]) => any`, so handing it a
    narrower function is safe and unremarkable — the looseness is on Electron's
    side. What matters is that this is the single place the looseness exists:
    twenty-eight call sites used to each carry it, and now none does.
  */
  ipcMain.handle(channel, handler as (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown)
}
