import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * The credential is judged at startup, not at her first word.
 *
 * ## What was wrong
 *
 * `readBearer` was called in exactly one place: inside `voice:open`, which runs
 * when she tries to speak. `credential.ts` names that as "the least informative
 * place to discover it" — and from outside the app it is not a discovery at
 * all. She opens her eyes, somebody talks to her, and nothing happens.
 *
 * The token this borrows expires in **ten days** and nothing refreshes it
 * except running the Codex CLI (`codex/auth.ts`, measured). So the state this
 * covers is not exotic: it is a fortnight of not opening Codex.
 *
 * ## Why this is read from source
 *
 * `index.ts` cannot be imported outside Electron, so main-process wiring is
 * asserted on its text — the same instrument `sleep-ends-it.test.ts` uses, for
 * the same reason. Comments are stripped first, or the prose explaining the
 * check would satisfy every assertion below.
 *
 * ## What each assertion is entitled to
 *
 * That the check EXISTS, is called from startup, and reports through the two
 * surfaces a person can actually reach. Not that a user sees it — no source
 * test can say that, and the acceptance in `plan-0.1.md` W10 is a runtime
 * observation for exactly that reason.
 */
const MAIN = readFileSync(join(process.cwd(), 'src', 'main', 'index.ts'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[ \t]*\/\/.*$/gm, '')

/** The body of `checkCredentialNow`, with nothing after it. */
function theCheck(): string {
  const from = MAIN.indexOf('function checkCredentialNow(): void {')
  expect(from, 'checkCredentialNow is gone').toBeGreaterThan(-1)
  const body = MAIN.slice(from)
  return body.slice(0, body.indexOf('\n}\n') + 2)
}

describe('the borrowed credential is judged before she needs it', () => {
  it('is checked at startup, beside the readiness check', () => {
    // Beside `checkCodexNow` and not instead of it: they answer different
    // questions. One asks whether the CLI runs, this asks whether the token it
    // left behind is one the service will still take.
    const ready = MAIN.indexOf('void checkCodexNow()')
    const credential = MAIN.indexOf('checkCredentialNow()', ready)
    expect(ready).toBeGreaterThan(-1)
    expect(credential).toBeGreaterThan(ready)
  })

  it('asks the question with the reader that already knows the answer', () => {
    // No new diagnosis logic. `readBearer` distinguishes no-auth-file from
    // unreadable from no-token from stale-token, and re-deriving any of that
    // here would be a second opinion that can disagree with the first.
    expect(theCheck()).toContain('readBearer()')
  })

  it('says it in the words that carry the remedy', () => {
    // `describeProblem` is the difference between "she cannot start" and "run
    // `codex` once to sign in". A bare failure string would pass a weaker
    // version of this test and help nobody.
    expect(theCheck()).toContain('describeProblem(bearer.problem)')
  })

  it('files it where the indicator and the strip both read', () => {
    expect(theCheck()).toContain('problems.note(')
  })

  it('says it on HER, not only in the strip', () => {
    // The status line under her already carries why a session FAILED. What it
    // could not do was say so before anybody spoke — so a ten-day-old token
    // presented as somebody talking to a companion who was never going to
    // answer, and learning why afterwards.
    expect(theCheck()).toContain('tellHerWhyNot()')
  })

  it('does not depend on which of the two happened first', () => {
    /*
      `webContents.send` before the renderer's listener exists drops the frame
      with no error. Her window is created earlier in startup than this check
      runs, and the listener is registered when the module script executes —
      so neither order is guaranteed and both have to work.

      `did-finish-load` is the hook this codebase already uses for exactly
      that, and its own comment gives the reason: it fires after the module
      script has run, and again on a reload.
    */
    const load = MAIN.slice(MAIN.indexOf("companion.webContents.on('did-finish-load'"))
    expect(load.slice(0, 400)).toContain('tellHerWhyNot()')
  })

  it('stops saying it once a session actually opens', () => {
    // It described a moment rather than a state: `did-finish-load` fires again
    // on every reload, so somebody who ran `codex` to fix a stale token would
    // have had the old sentence put back under her afterwards.
    const open = MAIN.slice(MAIN.indexOf("ipcMain.handle('voice:open'"))
    expect(open.slice(0, open.indexOf('nextSession.opened()'))).toContain('cannotSpeak = null')
  })

  it('puts it on screen rather than behind a dot', () => {
    // The whole point of the item. A problems entry nobody has a window open
    // to see is the same silence one level along.
    expect(theCheck()).toContain('showHistoryWindow()')
  })

  it('returns without complaint when the credential is fine', () => {
    // The ordinary case is a usable token, and it must cost nothing: no note,
    // no window, no log line. A check that announced itself on success would be
    // trained out of within a week.
    expect(theCheck()).toContain('if (bearer.ok) return')
  })

  it('cannot stop the app starting', () => {
    // Opening a window can fail — no display, a renderer that will not load —
    // and a credential warning that takes the app down with it would be a
    // worse fault than the one it reports.
    const check = theCheck()
    expect(check.slice(check.indexOf('showHistoryWindow()'))).toContain('catch')
  })
})
