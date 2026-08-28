import { readFileSync, writeFileSync } from 'node:fs'
import { promptsFor } from '@shared/prompts'
import { describe, expect, it } from 'vitest'

/**
 * The shipped framing, so these hold what she is ACTUALLY sent.
 *
 * It moved to the prompt catalogue so it can be rewritten, and a test asserting
 * on a stub would then be asserting on nothing — the property worth keeping is
 * that the DEFAULT still asks for sources and still permits the web.
 */
const FRAMING = promptsFor([]).find((s) => s.key === 'askWorkspace.framing')?.text ?? ''
import { argsFor, ask, framed, readAnswer, runSchema, type AskSettings } from './ask'
import type { RunHandle } from './spawn'

const SETTINGS: AskSettings = {
  webSearch: 'live',
  framing: FRAMING,
  model: null,
  profile: null,
  ignoreUserConfig: false,
}

function argAfter(args: readonly string[], flag: string): string | undefined {
  const at = args.indexOf(flag)
  return at === -1 ? undefined : args[at + 1]
}

describe('the invocation', () => {
  const args = argsFor({
    workspace: '/work',
    schemaPath: '/tmp/s.json',
    outPath: '/tmp/o.json',
    settings: SETTINGS,
  })

  it('looks and does not touch', () => {
    expect(argAfter(args, '-s')).toBe('read-only')
  })

  it('is pointed at the one directory she may read', () => {
    expect(argAfter(args, '-C')).toBe('/work')
  })

  it('carries no session history between questions', () => {
    // Each question stands alone, so nothing she asked yesterday steers what
    // Codex says today.
    expect(args).toContain('--ephemeral')
  })

  it('empties the fallback instruction filenames, which is what makes the guard real', () => {
    // The guard can only check names it KNOWS, and a user's own Codex config can
    // nominate further files to load as instructions. Without this the guard's
    // list could be complete and still be bypassed by a name only that config
    // knows about.
    expect(args).toContain('project_doc_fallback_filenames=[]')
  })

  it('decides web search per question rather than inheriting the machine', () => {
    expect(args).toContain('web_search="live"')
    const off = argsFor({
      workspace: '/work',
      schemaPath: '/s',
      outPath: '/o',
      settings: {
        webSearch: 'disabled',
        framing: FRAMING,
        model: null,
        profile: null,
        ignoreUserConfig: false,
      },
    })
    expect(off).toContain('web_search="disabled"')
  })

  it('says NOTHING about web search when told to follow the machine', () => {
    // Absent is a first-class choice: it leaves the user's own `config.toml` to
    // decide, which is different from overriding it to either value.
    const follow = argsFor({
      workspace: '/work',
      schemaPath: '/s',
      outPath: '/o',
      settings: {
        webSearch: 'follow',
        framing: FRAMING,
        model: null,
        profile: null,
        ignoreUserConfig: false,
      },
    })
    expect(follow.join(' ')).not.toContain('web_search')
  })

  it('leaves the model alone unless one was chosen', () => {
    expect(args).not.toContain('-m')
    const pinned = argsFor({
      workspace: '/work',
      schemaPath: '/s',
      outPath: '/o',
      settings: {
        webSearch: 'live',
        framing: FRAMING,
        model: 'gpt-5.6-sol',
        profile: null,
        ignoreUserConfig: false,
      },
    })
    expect(argAfter(pinned, '-m')).toBe('gpt-5.6-sol')
  })

  it('leaves the profile alone unless one was chosen', () => {
    expect(args).not.toContain('-p')
    const layered = argsFor({
      workspace: '/work',
      schemaPath: '/s',
      outPath: '/o',
      settings: {
        webSearch: 'live',
        framing: FRAMING,
        model: null,
        profile: 'mochi',
        ignoreUserConfig: false,
      },
    })
    expect(argAfter(layered, '-p')).toBe('mochi')
  })

  it('keeps the guard override even when a profile is layered', () => {
    // THE property, and the reason a profile is safe to hand somebody at all.
    // `-p` layers a file the user edits; `-c` here empties the list of files
    // Codex would read as instructions, which is what lets `guardWorkspace`
    // refuse a workspace containing one. Measured against codex-cli 0.148.0:
    // `-c` REPLACES a profile's value rather than merging with it, so a profile
    // cannot put the list back. `scripts/verify-codex-precedence.sh` is that
    // measurement; this is the half that stops the flag being dropped here.
    const layered = argsFor({
      workspace: '/work',
      schemaPath: '/s',
      outPath: '/o',
      settings: {
        webSearch: 'live',
        framing: FRAMING,
        model: null,
        profile: 'mochi',
        ignoreUserConfig: false,
      },
    })
    expect(layered).toContain('project_doc_fallback_filenames=[]')
    expect(layered).toContain('read-only')
    expect(layered).toContain('--ephemeral')
  })

  it('does not put the question in an argument at all', () => {
    /*
      `ps` shows a full command line to every user on the machine.

      The question used to be the last argv entry, so the words somebody said
      to her were readable by anything running as anybody — and the sleep
      summariser's prompt is a whole transcript. It also had to fit `ARG_MAX`,
      which a long conversation is the one input here with no ceiling under.

      `codex exec` reads its instructions from stdin when the PROMPT argument is
      absent, so this asserts the ABSENCE. The transport test asserts it arrives.
    */
    for (const one of args) {
      expect(one).not.toContain('What changed today?')
    }
  })
})

describe('the framing', () => {
  it('asks for sources and forbids presenting a guess as one', () => {
    // Codex is a general assistant. Handed a bare question it answers like one,
    // and the difference between that and a sourced answer is invisible once
    // she has said it aloud.
    const text = framed('anything', FRAMING)
    expect(text).toContain('sources')
    expect(text.toLowerCase()).toContain('never present a guess')
  })

  it('does NOT forbid the web', () => {
    // v1 tried forbidding everything but the files first. It made "what is the
    // current version of X" unanswerable while looking like a refusal to help.
    expect(framed('anything', FRAMING).toLowerCase()).toContain('search the web')
  })
})

describe('reading what came back', () => {
  it('takes the agreed shape', () => {
    const answer = readAnswer(
      '{"spoken":"Two files changed.","detail":"a.ts, b.ts","sources":["a.ts"]}',
    )
    expect(answer?.spoken).toBe('Two files changed.')
    expect(answer?.sources).toEqual(['a.ts'])
  })

  it('refuses anything that is not it', () => {
    // The alternative is `undefined` reaching the wire as her answer, and she
    // would say the word out loud.
    expect(readAnswer('not json')).toBeNull()
    expect(readAnswer('[]')).toBeNull()
    expect(readAnswer('{"detail":"x"}')).toBeNull()
    expect(readAnswer('{"spoken":"   "}')).toBeNull()
  })

  it('fills in what is missing around a usable spoken answer', () => {
    // `spoken` is the only field she needs. Refusing the whole answer because
    // `sources` came back as a string would throw away a good answer over its
    // packaging.
    const answer = readAnswer('{"spoken":"Yes.","sources":"a.ts"}')
    expect(answer?.spoken).toBe('Yes.')
    expect(answer?.detail).toBe('')
    expect(answer?.sources).toEqual([])
  })
})

/** A Codex that writes what it is told to and exits how it is told to. */
function fakeCodex(behaviour: {
  code: number
  write?: string
  stderr?: string
}): (path: string, args: readonly string[]) => RunHandle {
  return (_path, args) => {
    const out = args[args.indexOf('-o') + 1]
    if (behaviour.write !== undefined && out !== undefined) writeFileSync(out, behaviour.write)
    return {
      finished: Promise.resolve({ code: behaviour.code, stderr: behaviour.stderr ?? '' }),
      kill: () => true,
    }
  }
}

describe('one question, end to end', () => {
  const deps = { codexPath: '/bin/codex', workspace: '/work', settings: SETTINGS }

  it('answers when Codex does', async () => {
    const result = await ask('What changed?', {
      ...deps,
      run: fakeCodex({ code: 0, write: '{"spoken":"Nothing.","detail":"","sources":[]}' }),
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.answer.spoken).toBe('Nothing.')
  })

  it('reports a non-zero exit AS ITSELF, with what Codex said', async () => {
    const result = await ask('q', {
      ...deps,
      run: fakeCodex({ code: 1, stderr: 'not logged in' }),
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.why).toContain('not logged in')
  })

  it('tells apart "it crashed" from "it succeeded and wrote nothing"', async () => {
    // Two different failures with two different fixes. Collapsing them into
    // "no answer" loses which one happened.
    const crashed = await ask('q', { ...deps, run: fakeCodex({ code: 2 }) })
    const empty = await ask('q', { ...deps, run: fakeCodex({ code: 0 }) })
    expect(crashed.ok).toBe(false)
    expect(empty.ok).toBe(false)
    if (!empty.ok) expect(empty.why).toContain('wrote no answer')
  })

  it('refuses an answer that is not the shape that was asked for', async () => {
    const result = await ask('q', { ...deps, run: fakeCodex({ code: 0, write: '{"nope":1}' }) })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.why).toContain('shape')
  })

  it('writes the schema where it told Codex to look for it', async () => {
    let seen: string | null = null
    await ask('q', {
      ...deps,
      run: (_p, args) => {
        const schema = args[args.indexOf('--output-schema') + 1]
        seen = schema === undefined ? null : readFileSync(schema, 'utf8')
        return { finished: Promise.resolve({ code: 0, stderr: '' }), kill: () => true }
      },
    })
    expect(seen).not.toBeNull()
    expect(String(seen)).toContain('spoken')
  })

  it('kills it on the deadline rather than waiting for ever', async () => {
    let killed: string | undefined
    const result = await ask('q', {
      ...deps,
      timeoutMs: 5,
      run: () => ({
        finished: new Promise((resolve) => {
          setTimeout(() => {
            resolve({ code: null, stderr: '' })
          }, 40)
        }),
        kill: (signal) => {
          killed = signal
          return true
        },
      }),
    })
    expect(killed).toBe('SIGTERM')
    expect(result.ok).toBe(false)
  })
})

describe('a child that will not die', () => {
  /**
   * SIGTERM is a REQUEST, and the processes that ignore it are exactly the ones
   * a timeout exists for — one wedged in an uninterruptible read, or stuck
   * before it reaches the handler it installed.
   *
   * Before the escalation, the timeout sent SIGTERM and went on awaiting
   * `finished` for ever. A child that declined to die held the await, the tool
   * call and its ledger entry open, with nothing left to time it out.
   */
  function stubborn(): {
    run: (path: string, args: readonly string[]) => RunHandle
    signals: NodeJS.Signals[]
    die: () => void
  } {
    const signals: NodeJS.Signals[] = []
    let settle: (value: { code: number; stderr: string }) => void = () => undefined
    const finished = new Promise<{ code: number; stderr: string }>((resolve) => {
      settle = resolve
    })
    return {
      signals,
      die: () => {
        settle({ code: 143, stderr: 'killed' })
      },
      run: () => ({
        finished,
        kill: (signal?: NodeJS.Signals) => {
          signals.push(signal ?? 'SIGTERM')
          // Ignores SIGTERM, as the wedged case does. Only SIGKILL settles it.
          if (signal === 'SIGKILL') settle({ code: 137, stderr: '' })
          return true
        },
      }),
    }
  }

  it('stops waiting on a child that does not reap even after SIGKILL', async () => {
    /*
      SIGKILL is a request to the KERNEL, not a guarantee about when. A process
      wedged in an uninterruptible wait — a stalled network mount, a device read
      — does not reap until that syscall returns, whatever signal is pending.

      The escalation fixed the ignore-SIGTERM case and left this one step
      further out: the await had nothing behind it, so it could outlive every
      deadline in the function and hold the tool call, the ledger entry and the
      slot open exactly as the un-escalated version did.
    */
    const signals: NodeJS.Signals[] = []
    const result = await ask('q', {
      codexPath: '/bin/codex',
      workspace: '/work',
      settings: SETTINGS,
      // Never settles, whatever it is sent. This is the wedged case.
      run: () => ({
        finished: new Promise<{ code: number; stderr: string }>(() => undefined),
        kill: (signal?: NodeJS.Signals) => {
          signals.push(signal ?? 'SIGTERM')
          return true
        },
      }),
      timeoutMs: 5,
      graceMs: 5,
    })
    expect(signals).toEqual(['SIGTERM', 'SIGKILL'])
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    // A different fact from "it failed": it points at the machine rather than
    // at the lookup, and says the child is still out there.
    expect(result.why).toContain('did not stop')
  })

  it('escalates to SIGKILL when SIGTERM is ignored', async () => {
    const child = stubborn()
    const result = await ask('q', {
      codexPath: '/bin/codex',
      workspace: '/work',
      settings: SETTINGS,
      run: child.run,
      timeoutMs: 5,
      graceMs: 5,
    })
    expect(child.signals).toEqual(['SIGTERM', 'SIGKILL'])
    expect(result.ok).toBe(false)
  })

  it('does not send SIGKILL to a child that went quietly', async () => {
    // The escalation must be cancelled when `finished` settles, or every
    // ordinary run signals a process that is already gone — and that pid may
    // by then belong to somebody else.
    const child = stubborn()
    const running = ask('q', {
      codexPath: '/bin/codex',
      workspace: '/work',
      settings: SETTINGS,
      run: child.run,
      timeoutMs: 10_000,
      graceMs: 10,
    })
    child.die()
    await running
    expect(child.signals).toEqual([])
  })
})

/**
 * The transport, asked for a schema that is not the answer schema.
 *
 * `runSchema` came out of `ask` so the sleep summariser could share one
 * credential, one deadline and one kill escalation rather than growing a second
 * copy of each. That is only true if the schema it writes is the one it was
 * HANDED — and nothing checked it, because for the whole of this function's
 * previous life there was exactly one schema and it was a constant.
 *
 * A `runSchema` that quietly kept using `ANSWER_SCHEMA` would pass every test
 * in this file: `ask` would still work, and the summariser would get JSON in a
 * shape `parseFields` refuses, reported as "the notes were refused" — a message
 * about the model's output, pointing away from the bug.
 */
describe('the transport takes the schema it is given', () => {
  const deps = { codexPath: '/bin/codex', workspace: '/work', settings: SETTINGS }

  it('writes THAT schema to disk, not the answer schema', async () => {
    const SUMMARY = { type: 'object', properties: { about: { type: 'array' } } }
    let written: unknown = null
    await runSchema('rewrite this note', SUMMARY, {
      ...deps,
      run: (_path, args) => {
        const schemaPath = args[args.indexOf('--output-schema') + 1]
        if (schemaPath !== undefined) written = JSON.parse(readFileSync(schemaPath, 'utf8'))
        const out = args[args.indexOf('-o') + 1]
        if (out !== undefined) writeFileSync(out, '{"about":[]}')
        return { finished: Promise.resolve({ code: 0, stderr: '' }), kill: () => true }
      },
    })
    expect(written).toEqual(SUMMARY)
  })

  it('hands back the raw text, and does not judge its shape', async () => {
    // `ask` owns the answer shape; this owns the transport. A `runSchema` that
    // validated would have to know every caller's schema, which is the coupling
    // the extraction removed.
    const result = await runSchema(
      'q',
      { type: 'object' },
      {
        ...deps,
        run: fakeCodex({ code: 0, write: '{"anything":true}' }),
      },
    )
    expect(result.ok).toBe(true)
    if (result.ok) expect(JSON.parse(result.text)).toEqual({ anything: true })
  })

  it('carries the prompt through on stdin, and nowhere else', async () => {
    let sent = ''
    let inArgs = false
    await runSchema(
      'rewrite this note',
      { type: 'object' },
      {
        ...deps,
        run: (_path, args, input) => {
          sent = input
          inArgs = args.some((one) => one.includes('rewrite this note'))
          const out = args[args.indexOf('-o') + 1]
          if (out !== undefined) writeFileSync(out, '{}')
          return { finished: Promise.resolve({ code: 0, stderr: '' }), kill: () => true }
        },
      },
    )
    expect(sent).toContain('rewrite this note')
    // Asserting only that it arrived would pass a version that sent it both ways.
    expect(inArgs).toBe(false)
  })
})

describe('whose configuration a run inherits', () => {
  /*
    §65 measured that a Codex profile carries `mcp_servers`, that they are
    launched BEFORE authentication, and that `-s read-only` does not confine
    them — an MCP server is a separate process running as the user.

    That is a FEATURE for a lookup. §65's own conclusion is that
    `mochi → codex → mcp` needs no code in this project because the profile is
    what it is for. It is not a feature for the sleep summariser, which fires by
    itself every time she goes to sleep and is handed a transcript to turn into
    JSON — it needs no tools at all, and starting somebody's configured tool
    processes on that schedule is not something they asked for.

    §71 measured the mechanism: `--ignore-user-config` stops the launch, with a
    control either side, while auth still reads `CODEX_HOME`. `-c
    mcp_servers={}` does NOT stop it, which is why this is a flag and not an
    override.
  */
  function argsWith(ignoreUserConfig: boolean): readonly string[] {
    return argsFor({
      workspace: '/work',
      schemaPath: '/s',
      outPath: '/o',
      settings: { ...SETTINGS, ignoreUserConfig },
    })
  }

  it('keeps it by default, because a lookup is asked for', () => {
    expect(argsWith(false)).not.toContain('--ignore-user-config')
  })

  it('drops it when the caller says so, which is the unattended path', () => {
    expect(argsWith(true)).toContain('--ignore-user-config')
  })
})
