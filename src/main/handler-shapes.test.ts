import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * What main SENDS and what the renderer BELIEVES it gets, bound by the compiler.
 *
 * ## The gap this closes
 *
 * `ipcMain.handle` is typed to return `unknown`. The renderer's side is a cast:
 * `preload/index.ts` says `as readonly HistoryProblem[]` and nothing on main's
 * side is checked against that name. So a field added to the store shape and
 * forgotten on the wire shape — or the reverse — compiles cleanly on both sides
 * and arrives at the window missing. Nothing throws. The screen looks right
 * until somebody reads the value that was never sent.
 *
 * `wire: the store's shape and the window's were never checked against each
 * other` fixed exactly this for `history:list`, by annotating the map callback
 * `HistoryConversation`, and recorded that `settings:read` was already covered
 * because it is annotated `(): SettingsView`. Twenty-one of the twenty-eight
 * handlers carry that annotation. Three did not, and were found by an audit
 * rather than by a check:
 *
 * | channel | the renderer's cast |
 * | --- | --- |
 * | `history:problems` | `readonly HistoryProblem[]` |
 * | `history:turns` | `readonly HistoryTurn[]` |
 * | `history:search` | `readonly HistoryHit[]` |
 *
 * Measured rather than argued, both before and after: with a required
 * `driftProbe` added to all three wire interfaces and nothing else changed,
 * `tsc` reported no error at all. With the three handlers annotated, the same
 * probe fails in `src/main/index.ts`. The annotation is what does the work.
 *
 * ## Why a source check and not a type-level one
 *
 * There is nothing to assert against at runtime — the defect is the ABSENCE of
 * a type, and an absent type has no value to compare. What can be checked is
 * that every handler declares one, which is a property of the text.
 *
 * ## The exceptions are named, not inferred
 *
 * Four handlers are bound by something other than their own annotation. Each is
 * listed with the reason, in the shape `design-values.test.ts` uses for its
 * unspoken tokens: a list that has to be argued into, so a new unbound handler
 * cannot join it quietly.
 */
const MAIN = readFileSync(fileURLToPath(new URL('./index.ts', import.meta.url)), 'utf8')

/**
 * Bound by something the compiler can still see, and what that something is.
 *
 * An entry here is a claim that drift is caught elsewhere. It is not a licence
 * to skip the annotation because it was inconvenient.
 */
const BOUND_ELSEWHERE: Readonly<Record<string, string>> = {
  // The type flows out of the helper: `sessionConfig(deps): SessionConfig`, and
  // the handler returns its result. Verified with the same probe — a required
  // field added to `SessionConfig` fails in `voice/session-config.ts`.
  'voice:config': 'returns sessionConfig(), which is annotated SessionConfig',
  /*
    These two have NO independent wire type to be annotated against. The
    renderer casts to `Awaited<ReturnType<MochiApi['open']>>` — the API's own
    declared return, derived from the preload function rather than from a shape
    both sides agree on separately. Annotating main against that would be main
    importing the renderer's API type to check itself, which is a circle.

    Naming a real wire shape for the voice negotiation is the fix; it is a
    change to the contract rather than to a signature, so it is written down
    here rather than done in passing.
  */
  'voice:open': 'the renderer casts to the API type, so there is no second shape to check',
  'voice:sdp': 'the renderer casts to the API type, so there is no second shape to check',
  // Its `conversations` are bound by the map callback annotated
  // `HistoryConversation` — see `wire:`. The outer object has no name on the
  // renderer's side either: preload casts to an inline literal.
  'history:list':
    'conversations bound by the annotated map callback; the wrapper has no named type',
}

describe('every IPC handler declares the shape it sends', () => {
  /*
    The channel, and whether a return type stands between the argument list and
    the arrow. `[^)]*` for the arguments is safe because no handler here takes a
    parenthesised parameter, and the annotation cannot contain `=` — the widest
    one in the file is `Promise<ChosenWorkspace>`.

    `\s*` BEFORE THE ARROW, and leaving it out made this check impossible to
    fail. Without it the optional annotation group had to swallow the space in
    `: SettingsWrite =>` to reach the arrow, which it does — so an ANNOTATED
    handler matched, and an unannotated `async () => {` did not, because nothing
    was left to consume its space. The regex saw twenty-four of twenty-eight
    handlers and every one it could not see was one of the four this check was
    written to find. It passed on its first run, reporting nothing, and the only
    thing that gave it away was the count below disagreeing with `grep -c`.
  */
  const handlers = [
    ...MAIN.matchAll(
      /ipcMain\.handle\(\s*'([^']+)'\s*,\s*(?:async\s*)?\([^)]*\)(\s*:[^=]+)?\s*=>/g,
    ),
  ].map((one) => ({ channel: one[1] ?? '', annotated: one[2] !== undefined }))

  it('found every handler in the file', () => {
    /*
      Counted against a SEPARATE, dumber count of the same thing, not against a
      number somebody wrote down. A parser that has stopped matching cannot pass
      as a file with nothing wrong in it, and a hardcoded expectation would have
      to be edited every time a channel is added — which is the edit where
      somebody makes it agree with the parser instead of with the file.
    */
    const declared = [...MAIN.matchAll(/ipcMain\.handle\(/g)].length
    expect(declared).toBeGreaterThan(20)
    expect(handlers.length, `${declared} handlers in the file, ${handlers.length} parsed`).toBe(
      declared,
    )
    expect(handlers.map((one) => one.channel)).toContain('history:problems')
  })

  it.each(handlers.map((one) => [one.channel, one.annotated]))('%s', (channel, annotated) => {
    const excused = channel in BOUND_ELSEWHERE
    expect(
      annotated || excused,
      `${channel} sends a shape the renderer casts to a named type, and nothing checks the two ` +
        `against each other: ipcMain.handle returns unknown. Annotate the handler with the wire ` +
        `type the renderer expects, or add it to BOUND_ELSEWHERE with the reason it is safe.`,
    ).toBe(true)
  })

  it('excuses nothing that does not need excusing', () => {
    // The other direction, for the same reason `design-values.test.ts` checks
    // it: a list of exceptions that outlives the exception is a list nobody
    // trusts. A handler that has since been annotated must come off it.
    const annotated = new Set(handlers.filter((one) => one.annotated).map((one) => one.channel))
    const stale = Object.keys(BOUND_ELSEWHERE).filter((one) => annotated.has(one))
    expect(stale, `${stale.join(', ')} is annotated now — take it off BOUND_ELSEWHERE`).toEqual([])
  })
})
