/**
 * Looking something up, and coming back with it later.
 *
 * `kind: 'deferred'`, and that is the whole difference from the fast one.
 * findings §8 measured `codex exec` at a twenty-second floor; settling this
 * call synchronously would leave her silent for twenty seconds in the middle of
 * a conversation, which reads as a crash. §1 tested five ways of delivering a
 * late result, and this is the only one where she COMPLETES her earlier
 * sentence rather than correcting it: acknowledge now, deliver on the same
 * `call_id` when the answer lands.
 *
 * ## Why the codex modules live in this folder
 *
 * `ask.ts`, `spawn.ts`, `locate.ts` and `workspace.ts` exist for this
 * capability and nothing else. A capability that owns its own machinery is the
 * seam this layout is about: deleting the folder deletes the feature, and there
 * is no leftover module in main that nothing calls.
 *
 * `@shared/delegation` stays shared. `WEB_SEARCH_MODES` is drawn by the
 * settings window, and the reserved-name list is a fact about Codex rather than
 * about this capability.
 */

import { readdir } from 'node:fs/promises'
import { fill } from '@shared/prompts'
import type { Capability } from '../kind'
import { ask } from './ask'
import { spawnCodex } from './spawn'
import { MOST_AT_ONCE, createRunning, type Running } from './running'

/**
 * Shared by every call, because the thing it bounds is shared: one machine,
 * one disk, one workspace.
 */
export const running: Running = createRunning()
import { guardWorkspace } from './workspace'

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

export const capability: Capability = {
  manifest: {
    name: 'ask_workspace',
    description:
      'Look something up: read the files in the workspace, and search the web when the question needs current information. Returns immediately and the answer arrives later, usually within a minute — say you are going to look, then carry on talking. The answer names where it came from; pass that on rather than presenting it as your own knowledge. Report what comes back in your own words, including when it found nothing, and never invent an answer you did not receive or quietly replace one with something you remember.',
    parameters: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'What to find out.' },
      },
      required: ['question'],
    },
  },
  kind: 'deferred',
  handler: async (args, deps) => {
    const question = (args['question'] ?? '').trim()
    if (question === '') {
      return cannot(deps.prompt('askWorkspace.noQuestion'))
    }

    const codexPath = deps.codexPath()
    if (codexPath === null) {
      return cannot(deps.prompt('askWorkspace.noCodex'))
    }

    const workspace = deps.workspace()
    /**
     * Guarded BEFORE the process starts, every time.
     *
     * Not cached: the workspace is a directory somebody drops files into, and
     * the whole hazard is a file appearing in it. A verdict from startup would
     * be a verdict about a directory that no longer exists in that shape.
     */
    const verdict = await guardWorkspace({
      workspace,
      stopAt: deps.guardStopAt(),
      list: (directory) => readdir(directory),
    })
    if (!verdict.ok) {
      if (verdict.why === 'unreadable') {
        return cannot(fill(deps.prompt('askWorkspace.unreadable'), { path: verdict.path }))
      }
      const files = verdict.hazards.map((one) => one.path).join(', ')
      return cannot(fill(deps.prompt('askWorkspace.hazards'), { files }))
    }

    /*
      BOUNDED, and held so it can be stopped.

      Each of these spawns a Codex process that may run three minutes, and the
      model can call a tool in a loop -- nothing said no, so a loop spawned one
      process per call until the machine decided which to stop. And nothing
      held them, so quitting left them reading somebody's workspace with the
      app gone from the Dock. See `running.ts`; both came from the same
      absence.

      Refused rather than queued: a queue is a three-minute silence the model
      cannot see, and `dispatch` guarantees every call an answer, so a refusal
      is a shape the rest of the system already understands.
    */
    const slot = running.begin()
    if (!slot.ok) {
      return cannot(fill(deps.prompt('askWorkspace.busy'), { most: String(MOST_AT_ONCE) }))
    }
    let result
    try {
      result = await ask(question, {
        codexPath,
        workspace,
        settings: {
          webSearch: deps.webSearch(),
          model: null,
          profile: deps.codexProfile(),
          framing: deps.prompt('askWorkspace.framing'),
        },
        run: (path, args) => {
          const handle = spawnCodex(path, args)
          const release = running.hold(handle)
          void handle.finished.finally(release)
          return handle
        },
      })
    } finally {
      // In a `finally`, not on the success path: a handler that throws with the
      // slot still taken refuses every later lookup for the life of the process.
      slot.done()
    }
    if (!result.ok) {
      return cannot(fill(deps.prompt('askWorkspace.didNotFinish'), { why: result.why }))
    }
    return {
      status: 'ok',
      answer: result.answer.spoken,
      detail: result.answer.detail,
      sources: result.answer.sources,
      guidance: deps.prompt('askWorkspace.report'),
    }
  },
}
