import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * What main insists on before it deletes anything.
 *
 * Read from source: the handler is `ipcMain.handle` in a module that cannot be
 * imported outside Electron, and every property here is about the ORDER of
 * checks against ambient state — which is what a unit test of any one piece
 * cannot see. Comments are stripped, so prose cannot satisfy an assertion.
 */
const HANDLER = ((): string => {
  const main = readFileSync(join(process.cwd(), 'src', 'main', 'index.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
  const from = main.indexOf("ipcMain.handle('history:forget'")
  expect(from, 'the delete handler is gone').toBeGreaterThan(-1)
  return main.slice(from, main.indexOf('\n})', from))
})()

describe('before it deletes anything', () => {
  it('decides whose in main, never from the message', () => {
    // The page names the character it was SHOWING. It does not choose.
    expect(HANDLER).toContain('const worn = wornId()')
    const uses = [...HANDLER.matchAll(/forgetSessions\(([A-Za-z]+),/g)].map((one) => one[1])
    expect(uses.length).toBeGreaterThan(0)
    for (const who of uses) expect(who).toBe('worn')
    expect(HANDLER).toContain('archive.forget(worn)')
  })

  it('refuses when the page was showing somebody else', () => {
    /*
      The race, which is the reason the id travels at all: a character switch is
      a write and a re-read, and the old sheet stays on screen and clickable
      while that is in flight. Long enough to confirm "delete all of hers" about
      one character and have it land on another.
    */
    expect(HANDLER).toContain('shown !== worn')
    const refusal = HANDLER.slice(HANDLER.indexOf('shown !== worn'))
    /*
      The SAYS key, not the prose it resolves to.

      This read the sentence verbatim and broke when the wording moved into
      `says.ts` to be given a phrasing per pronoun. That was the assertion
      pinning the wrong thing: what has to hold is that the refusal names the
      character mismatch, and the key names it more durably than the sentence
      did — a reword now changes one table entry instead of failing a test in
      another file.
    */
    expect(refusal.slice(0, 300)).toContain('SAYS.characterChanged')
    // And the refusal comes before anything is touched.
    expect(HANDLER.indexOf('shown !== worn')).toBeLessThan(HANDLER.indexOf('transcripts()'))
  })

  it('exempts only the scope that is global by definition', () => {
    // "Every conversation, every character" has no character to agree about.
    expect(HANDLER).toContain("if (kind !== 'everything') {")
  })

  it('refuses a scope it does not know, rather than defaulting to one', () => {
    expect(HANDLER).toContain("if (kind !== 'some' && kind !== 'hers' && kind !== 'everything') {")
  })

  it('refuses a token list that is not one', () => {
    // It arrives from the least trusted process here.
    expect(HANDLER).toContain('!Array.isArray(tokens)')
    expect(HANDLER).toContain("typeof one !== 'string'")
  })

  it('lets the live conversation go when it has just been deleted', () => {
    /*
      Otherwise the open token points at a row that is gone, and every turn
      after that is dropped with only a log line: she talks, nothing is
      written, and nothing says so.
    */
    expect(HANDLER).toContain('conversation().liveToken()')
    const releases = [...HANDLER.matchAll(/conversation\(\)\.forget\(live\)/g)]
    // All three scopes, not just the one somebody thought of.
    expect(releases).toHaveLength(3)
    expect(HANDLER).toContain('wanted.includes(live)')
  })

  it('never reports a count it did not count', () => {
    /*
      It first answered `gone: 1` for "all of hers" and for "everything" --
      a number that would have been believed, saying 1 after deleting four
      hundred. Nothing read it at those scopes, which is what makes it the kind
      of lie that survives until something does.

      Null now, and the type says `number | null`, so the shape cannot express
      it. Those two scopes delete by predicate in one statement; a count would
      be a second query run only to fill a field.
    */
    expect(HANDLER).toContain('let gone: number | null = null')
    const coarse = HANDLER.slice(HANDLER.indexOf('archive.forget(worn)'))
    expect(coarse.slice(0, coarse.indexOf('} catch'))).not.toContain('gone = 1')
  })

  it('reports a failure instead of reporting success', () => {
    // A deletion that failed and said it worked is the one outcome here that
    // nobody can check for themselves.
    expect(HANDLER).toContain('catch (error: unknown)')
    expect(HANDLER).toContain('Nothing was removed.')
  })
})
