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

  it('acts on a snapshot, not on whatever is selected when it is answered', () => {
    // Both can change while the question is on screen: the tray can switch
    // character, and the list is still live underneath.
    const ask = MAIN.slice(MAIN.indexOf('function askFirst'))
    expect(ask.slice(0, ask.indexOf('\n}'))).toContain('doomed = about')

    const yes = MAIN.slice(MAIN.indexOf("sureYesEl.addEventListener('click'"))
    const body = yes.slice(0, yes.indexOf('\n})'))
    expect(body).toContain('const about = doomed')
    // Read once and cleared before anything is deleted, so a second press
    // cannot act on the same snapshot twice.
    expect(body.indexOf('doomed = null')).toBeLessThan(body.indexOf('deleteThem(about)'))
    // And the live selection is not consulted here at all.
    expect(body).not.toContain('chosen')
  })

  it('drops the snapshot when the question is dismissed with Escape', () => {
    // `<dialog>` closes on Escape without running the cancel handler, so a
    // snapshot left behind would be available to a later confirmation.
    const closed = MAIN.slice(MAIN.indexOf("sureEl.addEventListener('close'"))
    expect(closed.slice(0, closed.indexOf('\n})'))).toContain('doomed = null')
  })

  it('names the scope and the count, never a bare "are you sure"', () => {
    expect(MAIN).toContain('Delete ${String(tokens.length)} conversations?')
    expect(MAIN).toContain('cannot be undone')
    // The global one says what it reaches beyond the worn character, and what
    // it leaves alone -- "everything" in a window that also holds characters
    // reads as more than it is.
    expect(MAIN).toContain('Delete every conversation, for every character?')
    expect(MAIN).toContain('Characters, voices and looks are untouched.')
  })
})

describe('choosing what to delete', () => {
  it('is a mode, so the list stays readable', () => {
    // A delete affordance on every row is noise while reading and a misclick
    // surface at once.
    expect(HTML).not.toContain('class="entry-delete"')
    expect(MAIN).toContain('let picking = false')
  })

  it('does not open a transcript while choosing', () => {
    // A click that also navigated would make "this one" and "show me this one"
    // impossible to tell apart.
    const click = MAIN.slice(MAIN.indexOf("button.addEventListener('click', () => {"))
    const body = click.slice(0, click.indexOf('\n  })'))
    const guard = body.slice(body.indexOf('if (picking) {'), body.indexOf('open = token'))
    expect(guard, 'the choosing branch falls through into opening the transcript').toContain(
      'return',
    )
  })

  it('clears the selection when the archive is left', () => {
    // A selection the user can no longer see is one they have stopped agreeing
    // to.
    const place = MAIN.slice(MAIN.indexOf('function showPlace'))
    expect(place.slice(0, place.indexOf('\n}'))).toContain(
      "if (place !== 'archive' && picking) stopPicking()",
    )
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

  it('says deleted and not-yet-scrubbed as the different things they are', () => {
    // The rows go inside a transaction; the words leave the write-ahead log at
    // a checkpoint a reader can hold off. Saying "deleted" while the second is
    // outstanding is a promise the disk has not kept.
    expect(MAIN).toContain('result.pending')
    expect(MAIN).toContain('still being cleared from the file')
  })

  it('reports a refusal rather than pretending it worked', () => {
    const del = MAIN.slice(MAIN.indexOf('async function deleteThem'))
    const body = del.slice(0, del.indexOf('\n}'))
    const refusal = body.slice(body.indexOf('if (!result.ok)'), body.indexOf('stopPicking()'))
    expect(refusal, 'a refusal falls through and reports success').toContain('return')
  })
})
