import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { PromptSpec } from '@shared/prompts'
import {
  PROMPTS_FILE,
  promptRows,
  readPromptOverrides,
  resolvePrompts,
  writePromptOverride,
} from './prompts'

const SPECS: readonly PromptSpec[] = [
  { key: 'a', title: 'A', purpose: 'p', text: 'the shipped A', requires: [] },
  { key: 'b', title: 'B', purpose: 'p', text: 'the shipped B with <notes>', requires: ['<notes>'] },
]

describe('resolving what a prompt currently says', () => {
  it('is the default when nothing was overridden', () => {
    expect(resolvePrompts(SPECS, {})('a')).toBe('the shipped A')
  })

  it('is the override when there is one', () => {
    expect(resolvePrompts(SPECS, { a: 'mine' })('a')).toBe('mine')
  })

  it('answers empty for a key this build does not have', () => {
    // A caller asking for a prompt that no longer exists is a bug worth seeing
    // in the text she is sent, not a crash in the middle of a session.
    expect(resolvePrompts(SPECS, {})('gone')).toBe('')
  })
})

describe('the file', () => {
  let userData: string
  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'mochi-prompts-'))
  })
  afterEach(() => {
    rmSync(userData, { recursive: true, force: true })
  })

  it('treats an absent file as nothing overridden', () => {
    // The ordinary state on a fresh install, and it is not a failure.
    expect(readPromptOverrides(userData)).toEqual({ ok: true, overrides: {} })
  })

  it('round-trips an override', () => {
    writePromptOverride(userData, SPECS, 'a', 'mine')
    const read = readPromptOverrides(userData)
    expect(read.ok && read.overrides['a']).toBe('mine')
  })

  it('DELETES on reset rather than writing the default back', () => {
    /*
      The property this file's shape exists for.

      Storing the current default would pin this release's wording for ever
      while reporting itself unedited — so the prompt would silently stop
      tracking the app, which is the failure `store/prompt.ts` describes for the
      system prompt. Absent means "whatever ships today".
    */
    writePromptOverride(userData, SPECS, 'a', 'mine')
    writePromptOverride(userData, SPECS, 'a', null)
    const read = readPromptOverrides(userData)
    expect(read.ok && Object.hasOwn(read.overrides, 'a')).toBe(false)
  })

  it('clears when the text is edited back to the default', () => {
    // Same argument: identical text stored as an override is still a pin.
    writePromptOverride(userData, SPECS, 'a', 'mine')
    writePromptOverride(userData, SPECS, 'a', 'the shipped A')
    const read = readPromptOverrides(userData)
    expect(read.ok && Object.hasOwn(read.overrides, 'a')).toBe(false)
  })

  it('reports an unreadable file rather than calling it empty', () => {
    /*
      Both states produce a working companion, which is exactly why they must be
      told apart: running the shipped wording over somebody's edited prompts
      silently is the app disagreeing with the screen that shows them.
    */
    writeFileSync(join(userData, PROMPTS_FILE), 'not json at all')
    expect(readPromptOverrides(userData).ok).toBe(false)
  })

  it('refuses to write over a file it could not read', () => {
    // `worn.ts` was corrected to this rule on 2026-08-19: absent means "nothing
    // yet", anything else means "cannot tell", and cannot-tell must not become
    // an overwrite of edits nobody could read.
    writeFileSync(join(userData, PROMPTS_FILE), '{ broken')
    expect(() => {
      writePromptOverride(userData, SPECS, 'a', 'mine')
    }).toThrow()
  })

  it('ignores a value that is not text', () => {
    // The file is hand-editable, so a number under a key would otherwise reach
    // her instructions as itself.
    writeFileSync(join(userData, PROMPTS_FILE), JSON.stringify({ a: 42, b: 'kept' }))
    const read = readPromptOverrides(userData)
    expect(read.ok && read.overrides).toEqual({ b: 'kept' })
  })
})

describe('what the pane draws', () => {
  it('marks an edited prompt and keeps the default beside it', () => {
    const [a] = promptRows(SPECS, { a: 'mine' })
    expect(a).toMatchObject({ text: 'mine', fallback: 'the shipped A', edited: true })
  })

  it('reports a required phrase an override dropped', () => {
    /*
      Reported, never refused. `askWorkspace.framing` carries the `sources`
      contract `parseFields` enforces and the summariser names the fenced blocks
      it is told to distrust — dropping one is very likely a mistake and is
      occasionally exactly what somebody meant.
    */
    const rows = promptRows(SPECS, { b: 'no fence here' })
    expect(rows.find((one) => one.key === 'b')?.missing).toEqual(['<notes>'])
  })

  it('reports nothing missing when the phrase survived', () => {
    const rows = promptRows(SPECS, { b: 'still has <notes> in it' })
    expect(rows.find((one) => one.key === 'b')?.missing).toEqual([])
  })

  it('lists every prompt, not only the edited ones', () => {
    // The pane answers "what is she told", not "what have I changed".
    expect(promptRows(SPECS, {})).toHaveLength(SPECS.length)
  })
})
