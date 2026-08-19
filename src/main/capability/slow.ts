/**
 * Capabilities that take longer than a sentence.
 *
 * A SEPARATE map from `builtinHandlers`, not a flag on it, because the two are
 * answered differently on the wire and the difference is the whole of §1:
 *
 * - a fast handler settles the call outright, and she has the answer before her
 *   next breath;
 * - a slow one **defers** — she says something like "let me look", carries on
 *   talking, and the real answer arrives later on the same `call_id`.
 *
 * §8 measured `codex exec` at a twenty-second floor. Answering that call
 * synchronously would leave her silent for twenty seconds mid-conversation,
 * which reads as a crash; and §1 tested five ways of delivering a late result,
 * of which this is the only one where she COMPLETES her earlier sentence rather
 * than correcting it.
 *
 * Keeping them in separate maps means the fast path never grows a branch for
 * the slow one, and a handler cannot be half-registered in both.
 */

import { readdir } from 'node:fs/promises'
import { guardWorkspace } from '../codex/workspace'
import { ask, type AskSettings } from '../codex/ask'
import { spawnCodex } from '../codex/spawn'

/** Answered later, on the same call. */
export type SlowHandler = (args: Readonly<Record<string, string>>) => Promise<unknown>

export interface AskDeps {
  /** Where the Codex CLI is, or null when it could not be found. */
  readonly codexPath: () => string | null
  /** The one directory she may read. */
  readonly workspace: () => string
  /** Inclusive top of the guard's walk. See `workspace.ts`. */
  readonly stopAt: () => string
  readonly settings: () => AskSettings
}

/**
 * A refusal she can say out loud, with the reason.
 *
 * Every one of these is a thing somebody can act on: install the CLI, move a
 * file, point her somewhere else. A bare "it failed" would be true and useless,
 * and she would repeat it as though it were an answer.
 */
function cannot(guidance: string): { status: 'unavailable'; guidance: string } {
  return { status: 'unavailable', guidance }
}

export function slowHandlers(deps: AskDeps): ReadonlyMap<string, SlowHandler> {
  return new Map<string, SlowHandler>([
    [
      'ask_workspace',
      async (args) => {
        const question = (args['question'] ?? '').trim()
        if (question === '') {
          return cannot('No question was asked. Ask her to say what she wants looked up.')
        }

        const codexPath = deps.codexPath()
        if (codexPath === null) {
          return cannot(
            'The Codex CLI is not installed on this machine, so there is nothing to look with. ' +
              'Say that plainly rather than answering from memory.',
          )
        }

        const workspace = deps.workspace()
        /**
         * Guarded BEFORE the process starts, every time.
         *
         * Not cached: the workspace is a directory somebody drops files into,
         * and the whole hazard is a file appearing in it. A verdict from
         * startup would be a verdict about a directory that no longer exists in
         * that shape.
         */
        const verdict = await guardWorkspace({
          workspace,
          stopAt: deps.stopAt(),
          list: (directory) => readdir(directory),
        })
        if (!verdict.ok) {
          if (verdict.why === 'unreadable') {
            return cannot(
              `The workspace at ${verdict.path} could not be read, so she did not look. ` +
                'Say so plainly.',
            )
          }
          const files = verdict.hazards.map((one) => one.path).join(', ')
          return cannot(
            `She did not look, because these files would give instructions to the tool ` +
              `rather than be read as content: ${files}. Say which files, and that they ` +
              'need to be moved out of the workspace first.',
          )
        }

        const result = await ask(question, {
          codexPath,
          workspace,
          settings: deps.settings(),
          run: spawnCodex,
        })
        if (!result.ok) {
          return cannot(
            `The lookup did not finish: ${result.why}. Say so plainly rather than ` +
              'inventing an answer.',
          )
        }
        return {
          status: 'ok',
          answer: result.answer.spoken,
          detail: result.answer.detail,
          sources: result.answer.sources,
          guidance:
            'Report this in your own words and name where it came from. Do not present it ' +
            'as something you already knew.',
        }
      },
    ],
  ])
}
