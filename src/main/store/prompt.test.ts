import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
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

/**
 * The seed never overwrites, which it did not used to guarantee.
 *
 * `seedPrompt`'s header promises the file is "NEVER overwritten — once it is on
 * disk it is the user's, including when what they wrote is nothing." It kept
 * that promise with a read followed by a write, and finished with
 * `writeTextAtomically`, whose rename CLOBBERS. `seedProfile` writes its own
 * seed with `wx` and says exactly why: "A read followed by a write would race,
 * and an unconditional write would throw away whatever somebody had put in it."
 */
describe('seeding an empty prompt', () => {
  it('creates one when there is none', () => {
    const home = mkdtempSync(join(tmpdir(), 'mochi-seed-'))
    seedPrompt(home)
    expect(readFileSync(promptFile(home), 'utf8')).toBe('')
    rmSync(home, { recursive: true, force: true })
  })

  it('leaves what is already there, whatever it says', () => {
    const home = mkdtempSync(join(tmpdir(), 'mochi-seed-'))
    writeFileSync(promptFile(home), 'my own prompt')
    seedPrompt(home)
    expect(readFileSync(promptFile(home), 'utf8')).toBe('my own prompt')
    rmSync(home, { recursive: true, force: true })
  })

  it('is idempotent, and the second call is decided by the early return', () => {
    /*
      HONEST ABOUT WHAT THIS PROVES, because the first draft of it proved
      nothing. It asserted that "a file appearing mid-seed is not replaced" and
      passed just as well against the clobbering version — because `seedPrompt`
      returns early when the read finds a file, so the exclusive create never
      ran. A test that passes against the defect is worse than no test.

      The race the `wx` flag closes is the window between `readBounded`
      reporting absent and the write landing, and it has no seam here: forcing
      it would need either a concurrent writer or an injected filesystem, and
      the injected version would assert that a double was called rather than
      that the create is exclusive. `seedProfile` has the same shape and the
      same gap.

      So this asserts the property that IS reachable — seeding a second time
      does not disturb what is there — and says plainly which line decides it.
    */
    const home = mkdtempSync(join(tmpdir(), 'mochi-seed-'))
    seedPrompt(home)
    writeFileSync(promptFile(home), 'written afterwards')
    seedPrompt(home)
    expect(readFileSync(promptFile(home), 'utf8')).toBe('written afterwards')
    rmSync(home, { recursive: true, force: true })
  })

  it('leaves a path that is not a regular file entirely alone', () => {
    /*
      A symlink, which `readBounded` reports as not-a-regular-file rather than
      absent because it uses `lstat`. This is the nearest reachable neighbour of
      the race: the path exists, the reader refuses to say what is in it, and
      the seed must not decide that means empty.
    */
    const home = mkdtempSync(join(tmpdir(), 'mochi-seed-'))
    const target = join(home, 'elsewhere.md')
    writeFileSync(target, 'somebody else content')
    symlinkSync(target, promptFile(home))
    seedPrompt(home)
    expect(readFileSync(target, 'utf8')).toBe('somebody else content')
    expect(lstatSync(promptFile(home)).isSymbolicLink()).toBe(true)
    rmSync(home, { recursive: true, force: true })
  })
})
