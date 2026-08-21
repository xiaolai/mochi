import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  checkPrompt,
  MAX_PROMPT_CHARS,
  promptFile,
  readPrompt,
  seedPrompt,
  writePrompt,
} from './prompt'

let userData = ''
beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'mochi-prompt-'))
})
afterEach(() => {
  rmSync(userData, { recursive: true, force: true })
})

describe('the system prompt document', () => {
  it('is empty before anything has been written', () => {
    // The default, and the decision: nothing is compiled in. She still gets her
    // style, her notes and her tools — see `instructionsFor`.
    expect(readPrompt(userData)).toBe('')
  })

  it('seeds an EMPTY file, so the path exists and can be opened', () => {
    seedPrompt(userData)
    expect(readFileSync(promptFile(userData), 'utf8')).toBe('')
  })

  it('seeds nothing into it, because markdown has no comment she cannot read', () => {
    // Anything put here to explain the file would be text she is handed. The
    // explanation belongs in the window that edits it.
    seedPrompt(userData)
    expect(readPrompt(userData)).toBe('')
  })

  it('never overwrites what is already there', () => {
    writePrompt(userData, 'You are a lighthouse keeper.')
    seedPrompt(userData)
    expect(readPrompt(userData)).toBe('You are a lighthouse keeper.')
  })

  it('round-trips a document', () => {
    writePrompt(userData, '# Rules\nBe brief.')
    expect(readPrompt(userData)).toBe('# Rules\nBe brief.')
  })

  it('stores empty as a real answer', () => {
    // The default IS empty, so refusing it would make the state a fresh install
    // ships in unreachable the moment anybody typed anything.
    writePrompt(userData, 'something')
    writePrompt(userData, '')
    expect(readPrompt(userData)).toBe('')
  })

  it('trims on the way out, so a file of one newline is empty', () => {
    writeFileSync(promptFile(userData), '\n\n   \n')
    expect(readPrompt(userData)).toBe('')
  })

  it('adds no trailing newline of its own', () => {
    // What is stored is what somebody typed. `readPrompt` trims, so an appended
    // byte would be one nobody wrote and nothing can see.
    writePrompt(userData, 'Be brief.')
    expect(readFileSync(promptFile(userData), 'utf8')).toBe('Be brief.')
  })

  it('refuses one that is too long rather than storing a truncation', () => {
    const long = 'x'.repeat(MAX_PROMPT_CHARS + 1)
    expect(checkPrompt(long).ok).toBe(false)
    expect(() => {
      writePrompt(userData, long)
    }).toThrow()
    // And nothing was written — a refused save must not half-land.
    expect(readPrompt(userData)).toBe('')
  })

  it('refuses something that is not text at all', () => {
    // It crosses a bridge from a renderer, so the type says nothing here.
    expect(checkPrompt(42).ok).toBe(false)
    expect(checkPrompt(null).ok).toBe(false)
    expect(checkPrompt('').ok).toBe(true)
  })

  it('answers empty for a file it cannot read, rather than throwing', () => {
    /*
      An unreadable prompt must still leave her able to wake: `style` is where
      her character lives, so this costs prose rather than a session. A
      directory where the file should be is the reproducible version of that —
      `readBounded` reports it as unreadable rather than absent.
    */
    mkdirSync(promptFile(userData))
    expect(readPrompt(userData)).toBe('')
  })

  it('leaves an unreadable file alone rather than seeding over it', () => {
    // Replacing it with an empty one would be deleting somebody's work that
    // this process merely cannot see — the failure `writeMerged` refuses for
    // `preferences.json`.
    const path = promptFile(userData)
    writeFileSync(path, 'You are a lighthouse keeper.')
    chmodSync(path, 0o000)
    try {
      seedPrompt(userData)
    } finally {
      chmodSync(path, 0o600)
    }
    expect(readPrompt(userData)).toBe('You are a lighthouse keeper.')
  })
})
