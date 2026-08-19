/**
 * Asking Codex a question about the workspace, and getting a sourced answer.
 *
 * This is what `ask_workspace` actually does. The manifest for it has been
 * shipping since the rewrite and the handler behind it was `notBuilt` — she was
 * told she could look things up, tried, and was told she could not. That is the
 * exact failure the capability refusal in `registry.ts` is written to prevent,
 * being committed against the built-ins.
 *
 * ## The invocation, and why each piece is there
 *
 * Every flag below was arrived at in v1 against `codex-cli 0.147.0`, which is
 * still the installed version:
 *
 * - `-s read-only` — she is looking, not editing.
 * - `-C <workspace>` — the one directory she may look at. Guarded first; see
 *   `workspace.ts` for the measured reason.
 * - `--ephemeral` — no session history. Each question stands alone, so nothing
 *   she asked yesterday steers what Codex says today.
 * - `-c project_doc_fallback_filenames=[]` — the guard can only check names it
 *   KNOWS, and a user's own Codex configuration can nominate further files to
 *   load as instructions. Emptying it makes the set of instruction files fixed
 *   and therefore checkable, which is what makes the guard meaningful at all.
 * - `--output-schema` and `-o` — a structured answer written to a file, rather
 *   than parsing prose out of stdout.
 * - `-c web_search=...` — whether she may search the web, decided per question
 *   rather than by whatever the machine's Codex happens to be set to.
 *
 * ## It is slow, and that is designed for elsewhere
 *
 * §8 measured `codex exec` at a twenty-second floor. `ledger.ts` exists for
 * this: she answers immediately with `started`, keeps talking, and the real
 * answer is delivered later on the same `call_id` (§1). Nothing here needs to
 * be fast; it needs to arrive.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { WebSearchMode } from '@shared/delegation'
import type { RunHandle } from './spawn'

/**
 * The shape the answer must take.
 *
 * `spoken` separately from `detail` because she says one of them out loud. An
 * answer written for the page is the wrong length and the wrong shape for a
 * sentence, and asking her to summarise it again would be a second model call
 * to undo the first one's format.
 */
export const ANSWER_SCHEMA = {
  type: 'object',
  properties: {
    spoken: {
      type: 'string',
      description: 'The answer in one or two sentences, as it would be said aloud.',
    },
    detail: {
      type: 'string',
      description: 'Anything worth keeping that did not fit in the spoken answer.',
    },
    sources: {
      type: 'array',
      items: { type: 'string' },
      description: 'Files read or pages visited, as paths or URLs.',
    },
  },
  required: ['spoken', 'detail', 'sources'],
  additionalProperties: false,
} as const

/** What came back, once it has been read and checked. */
export interface Answer {
  readonly spoken: string
  readonly detail: string
  readonly sources: readonly string[]
}

export interface AskSettings {
  /** One of Codex's own values, or `follow` to send nothing. See `WEB_SEARCH_MODES`. */
  readonly webSearch: WebSearchMode
  /** Null leaves the model to the user's `config.toml`, which is a real choice. */
  readonly model: string | null
}

/**
 * The question, with the only instruction that keeps the answer honest.
 *
 * Codex is a general assistant. Handed a bare question it answers like one, and
 * the difference between that and a sourced answer is invisible once she has
 * said it aloud — which is the whole failure this framing exists to prevent.
 *
 * It does NOT forbid everything but the files. v1 tried that first, and it made
 * "what is the current version of X" unanswerable while looking like a refusal
 * to help rather than a rule about sourcing.
 */
export function framed(question: string): string {
  return [
    'Answer the question below for someone who will hear the answer spoken aloud.',
    'Read the files in this directory, and search the web when the question needs',
    'current information. Name every file or page you used in `sources`.',
    'If you could not find out, say so plainly in `spoken` and leave `sources` empty.',
    'Never present a guess as something you found.',
    '',
    'Question:',
    question,
  ].join('\n')
}

export function argsFor(options: {
  readonly workspace: string
  readonly schemaPath: string
  readonly outPath: string
  readonly question: string
  readonly settings: AskSettings
}): readonly string[] {
  const { settings } = options
  return [
    'exec',
    '-s',
    'read-only',
    '-C',
    options.workspace,
    '--skip-git-repo-check',
    '--ephemeral',
    // See the header: the guard can only check names it knows.
    '-c',
    'project_doc_fallback_filenames=[]',
    '--output-schema',
    options.schemaPath,
    '-o',
    options.outPath,
    ...(settings.model === null ? [] : ['-m', settings.model]),
    ...(settings.webSearch === 'follow' ? [] : ['-c', `web_search="${settings.webSearch}"`]),
    framed(options.question),
  ]
}

/**
 * Read what Codex wrote, and refuse anything that is not the agreed shape.
 *
 * A model asked for a schema usually honours it. "Usually" is the reason this
 * checks: the alternative is `undefined` reaching the wire as her answer, and
 * she would say the word.
 */
export function readAnswer(text: string): Answer | null {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null) return null
  const said = value as Record<string, unknown>
  const spoken = said['spoken']
  const detail = said['detail']
  const sources = said['sources']
  if (typeof spoken !== 'string' || spoken.trim() === '') return null
  return {
    spoken,
    detail: typeof detail === 'string' ? detail : '',
    sources: Array.isArray(sources)
      ? sources.filter((one): one is string => typeof one === 'string')
      : [],
  }
}

export interface AskDeps {
  readonly codexPath: string
  readonly workspace: string
  readonly settings: AskSettings
  /** Injected so a test can run the whole path without a Codex on the machine. */
  readonly run: (path: string, args: readonly string[]) => RunHandle
  /** How long to wait before giving up. §8 measured a twenty-second floor. */
  readonly timeoutMs?: number
}

export type AskResult =
  { readonly ok: true; readonly answer: Answer } | { readonly ok: false; readonly why: string }

/**
 * Run one question to completion.
 *
 * The schema and the answer go through a temporary directory that is removed
 * afterwards whatever happens — including when the process is killed on the
 * deadline, which is the path that leaked in every version of this that did the
 * cleanup on the success branch.
 */
export async function ask(question: string, deps: AskDeps): Promise<AskResult> {
  const scratch = mkdtempSync(join(tmpdir(), 'mochi-ask-'))
  const schemaPath = join(scratch, 'schema.json')
  const outPath = join(scratch, 'answer.json')
  try {
    writeFileSync(schemaPath, JSON.stringify(ANSWER_SCHEMA))
    const handle = deps.run(
      deps.codexPath,
      argsFor({
        workspace: deps.workspace,
        schemaPath,
        outPath,
        question,
        settings: deps.settings,
      }),
    )

    const deadline = setTimeout(() => {
      handle.kill('SIGTERM')
    }, deps.timeoutMs ?? 180_000)
    const finished = await handle.finished
    clearTimeout(deadline)

    if (finished.code !== 0) {
      // Its stderr, trimmed. A non-zero exit with nothing to say is still worth
      // reporting as itself rather than as "no answer".
      const said = finished.stderr.trim().split('\n').slice(-3).join(' ')
      return { ok: false, why: said === '' ? `codex exited ${String(finished.code)}` : said }
    }

    let written: string
    try {
      written = readFileSync(outPath, 'utf8')
    } catch {
      // Exit zero and no file is its own failure, and a different one from a
      // crash: it means the run succeeded and produced nothing.
      return { ok: false, why: 'codex wrote no answer' }
    }
    const answer = readAnswer(written)
    return answer === null
      ? { ok: false, why: 'the answer was not in the shape that was asked for' }
      : { ok: true, answer }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}
