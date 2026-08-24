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
import { argsFor, ask, framed, readAnswer, type AskSettings } from './ask'
import type { RunHandle } from './spawn'

const SETTINGS: AskSettings = { webSearch: 'live', framing: FRAMING, model: null, profile: null }

function argAfter(args: readonly string[], flag: string): string | undefined {
  const at = args.indexOf(flag)
  return at === -1 ? undefined : args[at + 1]
}

describe('the invocation', () => {
  const args = argsFor({
    workspace: '/work',
    schemaPath: '/tmp/s.json',
    outPath: '/tmp/o.json',
    question: 'What changed today?',
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
      question: 'q',
      settings: { webSearch: 'disabled', framing: FRAMING, model: null, profile: null },
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
      question: 'q',
      settings: { webSearch: 'follow', framing: FRAMING, model: null, profile: null },
    })
    expect(follow.join(' ')).not.toContain('web_search')
  })

  it('leaves the model alone unless one was chosen', () => {
    expect(args).not.toContain('-m')
    const pinned = argsFor({
      workspace: '/work',
      schemaPath: '/s',
      outPath: '/o',
      question: 'q',
      settings: { webSearch: 'live', framing: FRAMING, model: 'gpt-5.6-sol', profile: null },
    })
    expect(argAfter(pinned, '-m')).toBe('gpt-5.6-sol')
  })

  it('leaves the profile alone unless one was chosen', () => {
    expect(args).not.toContain('-p')
    const layered = argsFor({
      workspace: '/work',
      schemaPath: '/s',
      outPath: '/o',
      question: 'q',
      settings: { webSearch: 'live', framing: FRAMING, model: null, profile: 'mochi' },
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
      question: 'q',
      settings: { webSearch: 'live', framing: FRAMING, model: null, profile: 'mochi' },
    })
    expect(layered).toContain('project_doc_fallback_filenames=[]')
    expect(layered).toContain('read-only')
    expect(layered).toContain('--ephemeral')
  })

  it('puts the question last, framed', () => {
    expect(args[args.length - 1]).toBe(framed('What changed today?', FRAMING))
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
