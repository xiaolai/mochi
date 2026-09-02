import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The two things the COMPILER cannot say about `answer()`, and nothing else.
 *
 * ## What this file used to be, and why almost all of it is gone
 *
 * It read `index.ts` and asserted that every `ipcMain.handle` declared a return
 * type, with a ratchet of four named exceptions. It found three real unbound
 * channels. It was also, in its first version, structurally incapable of
 * failing: a missing `\s*` before the arrow meant the pattern matched annotated
 * handlers and skipped bare ones, so twenty-four of twenty-eight were seen and
 * every one it could not see was one of the four it existed to find. Twenty-six
 * green tests, reporting nothing.
 *
 * That was fixed, and then fixed properly: `Answers` in `@shared/answers` names
 * what every channel replies with, `answer()` requires the handler to return
 * `Answers[C]`, and the preload casts to `Answers[C]` for the same channel. A
 * handler that answers the wrong shape does not compile — verified, not
 * assumed:
 *
 *     answer('history:problems', () => 'not a problem list')
 *     -> Type 'string' is not assignable to type
 *        'Promise<readonly HistoryProblem[]> | readonly HistoryProblem[]'
 *
 * and the drift that started all of this — a required field added to
 * `HistoryProblem`, `HistoryTurn` and `HistoryHit` — now fails in
 * `src/main/index.ts`, where before it produced no error anywhere.
 *
 * So the shape checking is the type system's, and a test that re-implements it
 * by parsing source is a second thing that can be wrong about the source. What
 * is left here is only what types cannot reach.
 */
const MAIN = readFileSync(fileURLToPath(new URL('../index.ts', import.meta.url)), 'utf8')
const ANSWERS = readFileSync(
  fileURLToPath(new URL('../../shared/answers.ts', import.meta.url)),
  'utf8',
)

/**
 * Comments removed, because this file argues its decisions next to them.
 *
 * Both checks below look for a string that gets written in PROSE here as
 * readily as in code — `ipcMain.handle` is named in the comment explaining why
 * `listen()` exists, and in `answer()`'s own doc. Against raw text that is a
 * red suite over a sentence, which is the false-red this project has already
 * paid three releases for in `jump-lands`.
 */
const code = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1 ')

describe('every answer goes through the wrapper', () => {
  it('main calls ipcMain.handle nowhere', () => {
    /*
      THE ONE THING `answer()` CANNOT ENFORCE ABOUT ITSELF.

      Its signature makes a wrong reply impossible to write — but only for code
      that calls it. `ipcMain.handle` is still there, still accepts
      `(...args: unknown[]) => unknown`, and a handler registered through it
      answers whatever it likes with nothing checked, exactly as the three that
      started this did.

      A type cannot say "and do not use the other door". This can.
    */
    const raw = [...code(MAIN).matchAll(/ipcMain\.handle\(/g)].length
    expect(
      raw,
      `${raw} handler(s) registered with ipcMain.handle directly. Use answer() from ` +
        `./ipc/answer — it requires the reply to match Answers[channel], which is the ` +
        `binding ipcMain.handle throws away.`,
    ).toBe(0)
  })

  it('registers a handler for every channel that promises an answer', () => {
    /*
      The other direction, and it is the `nothing-written-goes-unread` shape one
      layer over: an entry in `Answers` for a channel nobody handles is a
      promise to the renderer that main never keeps. `invoke` on it hangs until
      the window is closed, which is a symptom nobody traces back to a table.

      The compiler cannot see this — an unused key of an interface is not an
      error, and never should be.
    */
    const promised = [...code(ANSWERS).matchAll(/^\s*'([a-z-]+:[a-z-]+)':/gm)].map(
      (one) => one[1] ?? '',
    )
    // Counted, so a pattern that has stopped matching cannot pass as a table
    // with nothing in it. Every parser-backed check here has had that bug once.
    expect(promised.length).toBeGreaterThan(20)

    const handled = new Set(
      [...code(MAIN).matchAll(/\banswer\(\s*'([a-z-]+:[a-z-]+)'/g)].map((one) => one[1] ?? ''),
    )
    const unanswered = promised.filter((one) => !handled.has(one))
    expect(
      unanswered,
      `${unanswered.join(', ')} is declared in Answers and handled by nothing in main`,
    ).toEqual([])
  })
})
