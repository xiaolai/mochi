import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * The shape of the only irreversible action in the app.
 *
 * There is no undo, deliberately: an undo buffer is a second copy of the thing
 * somebody just asked to destroy, which contradicts the claim the deletion
 * exists to make good. The confirmation IS the undo, so its properties are the
 * safety, and they are asserted rather than assumed.
 */
const MAIN = readFileSync(join(process.cwd(), 'src', 'renderer', 'history', 'main.ts'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[ \t]*\/\/.*$/gm, '')

const HTML = readFileSync(join(process.cwd(), 'src', 'renderer', 'history', 'index.html'), 'utf8')

describe('confirming a deletion', () => {
  it('happens on a surface of its own, not by arming a button', () => {
    /*
      The arming pattern used elsewhere here -- click once to arm, again to act
      -- is defeated by a double-click, offers no Escape, and re-reads live
      state on the second click. A `<dialog>` needs a second click on a
      DIFFERENT element, and gets modality, focus trapping and Escape from the
      platform rather than from code that has to remember them.
    */
    expect(HTML).toContain('<dialog id="sure">')
    expect(MAIN).toContain('sureEl.showModal()')
  })

  /*
    D1 AND D3 MOVED to `rules/doomed.ts`, where they are exercised.

    They were asserted here by reading `main.ts` and checking the order of two
    assignments and the presence of two sentences. Right about the rules, and
    tied to a file. What is left below is what a pure test cannot see: that this
    window reaches for the rule, keeps no second copy of it, and answers the
    question exactly once.
  */
  it('reaches for the rule rather than keeping its own snapshot', () => {
    expect(MAIN).toContain("from '../rules/doomed'")
    expect(MAIN).not.toMatch(/let doomed/)
  })

  it('answers the question ONCE, through the rule', () => {
    // The property arming cannot have: a second press gets nothing back. The
    // rule enforces it; this is the assertion that the window asks it.
    const yes = MAIN.slice(MAIN.indexOf("sureYesEl.addEventListener('click'"))
    const body = yes.slice(0, yes.indexOf('\n})'))
    expect(body).toContain('sure.answer()')
    // And the live selection is not consulted here at all.
    expect(body).not.toContain('picking.chosen()')
  })

  it('drops the snapshot when the surface closes, however it closed', () => {
    // A `<dialog>` closes on Escape without running the cancel handler, so a
    // snapshot left behind would be available to a later confirmation.
    const closed = MAIN.slice(MAIN.indexOf("sureEl.addEventListener('close'"))
    expect(closed.slice(0, closed.indexOf('\n})'))).toContain('sure.drop()')
  })

  it('words the question when it is ASKED, not when it is answered', () => {
    // Worded later it is recomputed from whatever is live then, so a character
    // switch while the question waits makes it describe the wrong character.
    const ask = MAIN.slice(MAIN.indexOf('function askFirst'))
    expect(ask.slice(0, ask.indexOf('\n}'))).toContain('about.asks')
  })

  it('asks the rule what a click means, rather than deciding here', () => {
    // The one thing a pure test cannot see: that the answer is consulted at the
    // place a conversation is clicked.
    const guard = MAIN.slice(MAIN.indexOf('picking.click(token)'))
    expect(guard, 'nothing consults the rule at the click').not.toBe('')
    const before = MAIN.slice(0, MAIN.indexOf('picking.click(token)'))
    expect(before.slice(before.lastIndexOf('addEventListener'))).toContain("'click'")
  })

  it('tells the rule when the window changes place', () => {
    const place = MAIN.slice(MAIN.indexOf('function showPlace'))
    expect(place.slice(0, place.indexOf('\n}'))).toContain('picking.wentTo(place)')
  })

  it('is a mode, so the list stays readable', () => {
    // A delete affordance on every row is noise while reading and a misclick
    // surface at once. D4: no single gesture removes one conversation.
    expect(HTML).not.toContain('class="entry-delete"')
    // The mode exists and is entered deliberately — the rule owns the state,
    // and this window owns the control that turns it on.
    expect(HTML).toContain('id="pick"')
    expect(MAIN).toContain('picking.start()')
  })

  it('drops the selection when the character changes', () => {
    /*
      Found in the plan audit. The list resets its calendar day on a character
      switch and did not reset the selection, so choosing three and switching
      left the drawer offering to delete three against somebody else's list.
      Nothing of the first character's could have been deleted -- the store
      scopes by persona -- but confirming a deletion of three and being told
      "0 conversations deleted" is the worst way to find that out.
    */
    const read = MAIN.slice(MAIN.indexOf('async function readConversations'))
    const body = read.slice(0, read.indexOf('\n}'))
    expect(body).toContain('answer.persona !== listed')
    const onChange = body.slice(body.indexOf('answer.persona !== listed'))
    expect(onChange.slice(0, onChange.indexOf('    }'))).toContain('stopPicking()')
  })

  it('keeps the controls off every other place', () => {
    // "Delete all" under a heading that says something else is how a control's
    // scope gets misread, in the one direction that cannot be undone.
    const show = MAIN.slice(MAIN.indexOf('function showPicking'))
    expect(show.slice(0, show.indexOf('\n}'))).toContain("place === 'archive'")
  })
})

describe('what the page does with the answer', () => {
  it('stops showing a transcript that has just been deleted', () => {
    const del = MAIN.slice(MAIN.indexOf('async function deleteThem'))
    const body = del.slice(0, del.indexOf('\n}'))
    expect(body).toContain('talkEl.replaceChildren()')
  })

  it('reports a refusal rather than pretending it worked', () => {
    const del = MAIN.slice(MAIN.indexOf('async function deleteThem'))
    const body = del.slice(0, del.indexOf('\n}'))
    const refusal = body.slice(body.indexOf('if (!result.ok)'), body.indexOf('stopPicking()'))
    expect(refusal, 'a refusal falls through and reports success').toContain('return')
  })
})
