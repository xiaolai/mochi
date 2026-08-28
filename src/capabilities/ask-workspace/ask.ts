/**
 * Asking Codex a question about the workspace, and getting a sourced answer.
 *
 * This is what `ask_workspace` actually does. Its manifest shipped from the
 * rewrite until 2026-08-19 with `notBuilt` behind it — she was told she could
 * look things up, tried, and was told she could not. That is the exact failure
 * `registry.ts` used to refuse third-party capabilities to prevent, committed
 * against the built-ins. It is unrepresentable now: `capability.ts` in this
 * folder holds the manifest and the handler as one value, so a manifest with
 * nothing behind it does not typecheck.
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

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { logBoundedRead, readBounded } from '../../main/store/read-bounded'
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
  /** The framing, as `askWorkspace.framing` currently says. See `@shared/prompts`. */
  readonly framing: string
  /** Null leaves the model to the user's `config.toml`, which is a real choice. */
  readonly model: string | null
  /**
   * Run with `$CODEX_HOME/config.toml` not loaded at all.
   *
   * ## Why this is a setting and not a constant either way
   *
   * §65 measured that a Codex profile carries `mcp_servers` and that
   * `-s read-only` does not confine them: an MCP server is a separate process
   * running as the user, launched BEFORE authentication, outside the sandbox.
   * That is a feature for a lookup — §65's own conclusion is that
   * `mochi → codex → mcp` needs no code here because the profile is what it is
   * for — and it is not one for the sleep summariser.
   *
   * The difference is who asked. A lookup happens because somebody pressed a
   * key or the model chose a tool; the summariser fires on its own, every time
   * she goes to sleep, unattended. Starting somebody's configured tool
   * processes on that schedule is not something they asked for, and the job
   * needs no tools at all — it is handed a transcript and returns JSON.
   *
   * Measured 2026-08-27, §71: `--ignore-user-config` stops the launch, with a
   * control on either side, and a real run still authenticates and still
   * honours `--output-schema`. `-c mcp_servers={}` does NOT stop it, which is
   * why this is a flag rather than an override.
   */
  readonly ignoreUserConfig: boolean
  /**
   * A Codex profile to layer, or null for none.
   *
   * `-p <name>` layers `$CODEX_HOME/<name>.config.toml` over the user's base
   * config. This is how somebody configures a lookup — their model, their
   * reasoning effort, their MCP servers — WITHOUT this project re-exposing
   * Codex's flags one at a time, and without a config file inside the workspace
   * where dropping a file could change how the tool behaves.
   *
   * The name has already passed `isProfileName`; it becomes a filename inside
   * `$CODEX_HOME`.
   */
  readonly profile: string | null
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
export function framed(question: string, framing: string): string {
  return [framing, '', 'Question:', question].join('\n')
}

export function argsFor(options: {
  readonly workspace: string
  readonly schemaPath: string
  readonly outPath: string
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
    /**
     * See the header: the guard can only check names it KNOWS.
     *
     * This is the one key a user's profile must not be able to take back, and
     * `-p` below cannot. MEASURED against `codex-cli 0.148.0` on 2026-08-19,
     * three ways, because a scalar result would not have settled an array key:
     *
     * - a profile carrying a wrong-typed value for it fails config load, so the
     *   profile's value really is read and validated;
     * - the same profile WITH this override loads cleanly, so the override
     *   REPLACES rather than merges, and the profile's value never materialises;
     * - a valid profile value with a wrong-typed override fails, which is what
     *   rules out "the override was quietly ignored" as the reason for the
     *   second result.
     *
     * `scripts/verify-codex-precedence.sh` is that measurement, runnable. It is
     * a behaviour of the CLI rather than a documented contract, and this project
     * has already been bitten once by exactly that — `agents.override.md` was
     * blocklist rot that arrived immediately rather than in some future release.
     */
    '-c',
    'project_doc_fallback_filenames=[]',
    // See `AskSettings.ignoreUserConfig`. Auth still reads `CODEX_HOME`, which
    // is what makes this usable at all — measured, §71.
    ...(settings.ignoreUserConfig ? ['--ignore-user-config'] : []),
    '--output-schema',
    options.schemaPath,
    '-o',
    options.outPath,
    ...(settings.profile === null ? [] : ['-p', settings.profile]),
    ...(settings.model === null ? [] : ['-m', settings.model]),
    ...(settings.webSearch === 'follow' ? [] : ['-c', `web_search="${settings.webSearch}"`]),
    /*
      AND NO PROMPT. `codex exec` reads its instructions from stdin when the
      PROMPT argument is absent, and `spawnCodex` writes them there.

      This used to end with `framed(question, framing)` as the last argv entry.
      `ps` shows a full command line to every user on the machine, so the words
      somebody said to her were readable by anything running as anybody — and
      the sleep summariser's prompt is a whole transcript, which is also the one
      input here with no ceiling under `ARG_MAX`.
    */
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
  /*
    THE SHAPE, all three fields — which is what the docblock above already
    promises and what `ANSWER_SCHEMA` already requires.

    Only `spoken` was checked. A missing `detail` became `''` and a missing or
    malformed `sources` became `[]`, so an answer that ignored the schema was
    presented as one that honoured it: she said the spoken half aloud and
    reported no sources, which is indistinguishable from a lookup that found
    none.

    That distinction is the feature. `askWorkspace.framing` carries the sourcing
    contract and `prompts.test.ts` asserts it survives an override; an answer
    the model never sourced arriving as an unsourced answer is the one failure
    the framing exists to prevent.

    EMPTY IS STILL FINE. The framing's own note says it "does NOT forbid
    everything but the files" — "what is the current version of X" legitimately
    has none — so `sources: []` is a real answer. What is refused is the field
    being absent or the wrong type, which is a different fact: the model did not
    answer the question it was asked.

    An invalid ENTRY is refused rather than filtered out, for the same reason:
    dropping it would report fewer sources than the model gave, silently.

    `detail` stays lenient. It is "anything worth keeping that did not fit in
    the spoken answer" — an absent one is faithfully nothing, and there is no
    claim in it to get wrong.
  */
  if (!Array.isArray(sources) || sources.some((one) => typeof one !== 'string')) return null
  // `detail` is the lenient one, and the asymmetry is the point. It is
  // "anything worth keeping that did not fit in the spoken answer", so an
  // absent one is faithfully rendered as nothing — there is no claim to get
  // wrong. `sources` is a claim.
  return {
    spoken,
    detail: typeof detail === 'string' ? detail : '',
    sources: sources as readonly string[],
  }
}

export interface AskDeps {
  readonly codexPath: string
  readonly workspace: string
  readonly settings: AskSettings
  /**
   * Injected so a test can run the whole path without a Codex on the machine.
   *
   * `input` is the prompt, and it goes down stdin rather than into `args` —
   * see `spawnCodex`. A test that wants to assert what was ASKED reads this
   * argument; one that wants to assert how it was CONFIGURED reads `args`.
   */
  readonly run: (path: string, args: readonly string[], input: string) => RunHandle
  /** How long to wait before giving up. §8 measured a twenty-second floor. */
  readonly timeoutMs?: number
  /**
   * How long SIGTERM gets before SIGKILL.
   *
   * SIGTERM is a request a process may ignore, and the ones that ignore it are
   * the ones this timeout is for. Five seconds is enough for a child that is
   * merely finishing a write and short enough that a wedged one does not hold
   * the call open.
   */
  readonly graceMs?: number
}

export type AskResult =
  { readonly ok: true; readonly answer: Answer } | { readonly ok: false; readonly why: string }

/** What one schema-constrained run produced, or why it produced nothing. */
export type SchemaRun =
  { readonly ok: true; readonly text: string } | { readonly ok: false; readonly why: string }

/**
 * Run one schema-constrained prompt to completion, and hand back what it wrote.
 *
 * The transport, with no opinion about what is being asked. `ask` below is one
 * caller and the sleep summariser is the other, and they share this for the
 * reason the summariser's own header gives: it runs on the Codex subscription
 * rather than a metered key, so the credential, the deadline, the kill
 * escalation and the process group should exist once rather than twice.
 *
 * The two callers differ in one setting and it is deliberate — see
 * `AskSettings.ignoreUserConfig`.
 *
 * The schema and the answer go through a temporary directory that is removed
 * afterwards whatever happens — including when the process is killed on the
 * deadline, which is the path that leaked in every version of this that did the
 * cleanup on the success branch.
 */
export async function runSchema(prompt: string, schema: object, deps: AskDeps): Promise<SchemaRun> {
  const scratch = mkdtempSync(join(tmpdir(), 'mochi-ask-'))
  const schemaPath = join(scratch, 'schema.json')
  const outPath = join(scratch, 'answer.json')
  try {
    writeFileSync(schemaPath, JSON.stringify(schema))
    const handle = deps.run(
      deps.codexPath,
      argsFor({
        workspace: deps.workspace,
        schemaPath,
        outPath,
        settings: deps.settings,
      }),
      framed(prompt, deps.settings.framing),
    )

    /*
      SIGTERM, then SIGKILL, because SIGTERM is a REQUEST.

      A process is free to ignore it -- and the ones that do are exactly the
      ones this timeout exists for: a child wedged in an uninterruptible read,
      or one that installed a handler and is stuck before reaching it. The
      timeout used to send SIGTERM and then go on awaiting `finished` for ever,
      so a child that declined to die held the await, the tool call, and the
      ledger entry open with nothing left to time it out.
    */
    const grace = deps.graceMs ?? 5_000
    let escalation: ReturnType<typeof setTimeout> | null = null
    const deadline = setTimeout(() => {
      handle.kill('SIGTERM')
      escalation = setTimeout(() => {
        // Nothing to ask any more. The child had its grace period.
        handle.kill('SIGKILL')
      }, grace)
    }, deps.timeoutMs ?? 180_000)

    /*
      A LAST BOUND, because SIGKILL is a request to the KERNEL, not a guarantee
      about when.

      The escalation above is the fix for a child that ignores SIGTERM, and it
      left the failure it was reaching for one step further out: after the kill
      this still awaited `finished` with nothing left to time it out. A process
      wedged in an uninterruptible wait — a stalled network mount, a device read
      — does not reap until that syscall returns, whatever signal is pending. So
      the await could outlive every deadline in this function, holding the tool
      call, the ledger entry and the slot open exactly as the un-escalated
      version did.

      One more grace period after the kill, and then this stops waiting. The
      child is NOT abandoned quietly: it is still held by `running`, so quitting
      kills it, and the answer says plainly that it would not go — which is a
      different fact from "it failed" and points at the machine rather than at
      the lookup.
    */
    const abandoned = Symbol('did not exit')
    const finished = await Promise.race([
      handle.finished,
      new Promise<typeof abandoned>((resolve) =>
        setTimeout(() => resolve(abandoned), (deps.timeoutMs ?? 180_000) + grace * 2).unref?.(),
      ),
    ])
    clearTimeout(deadline)
    if (escalation !== null) clearTimeout(escalation)
    if (finished === abandoned) {
      return {
        ok: false,
        why: 'the lookup did not stop when it was asked to, and was left running',
      }
    }

    if (finished.code !== 0) {
      // Its stderr, trimmed. A non-zero exit with nothing to say is still worth
      // reporting as itself rather than as "no answer".
      const said = finished.stderr.trim().split('\n').slice(-3).join(' ')
      return { ok: false, why: said === '' ? `codex exited ${String(finished.code)}` : said }
    }

    /*
      BOUNDED, because a subprocess wrote it.

      This was a bare `readFileSync`. The file is produced by Codex -- another
      program, running against a workspace whose contents are not ours -- and
      reading it whole put an unbounded amount of somebody else's output into
      the main process's heap in one call. Every other file this app reads goes
      through `readBounded`; this was the one that did not, and it is the only
      one written by something outside the app.

      `readBounded` also refuses a non-regular file, which matters more here
      than elsewhere: `outPath` is in a temp directory, and a symlink dropped
      there between the spawn and this read would otherwise be followed.
    */
    const read = readBounded(outPath)
    if (!read.ok) {
      // Exit zero and no answer is its own failure, and a different one from a
      // crash: it means the run succeeded and produced nothing usable.
      return {
        ok: false,
        why:
          read.reason.kind === 'absent'
            ? 'codex wrote no answer'
            : `codex's answer could not be read: ${logBoundedRead(read.reason)}`,
      }
    }
    return { ok: true, text: read.text }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

/**
 * Run one question to completion and read the answer she will speak.
 *
 * A thin caller of `runSchema`: this one owns `ANSWER_SCHEMA` and the shape
 * check, and nothing else.
 */
export async function ask(question: string, deps: AskDeps): Promise<AskResult> {
  const run = await runSchema(question, ANSWER_SCHEMA, deps)
  if (!run.ok) return { ok: false, why: run.why }
  const answer = readAnswer(run.text)
  return answer === null
    ? { ok: false, why: 'the answer was not in the shape that was asked for' }
    : { ok: true, answer }
}
