import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * That the window actually reaches for the rules, and keeps no second copy.
 *
 * A rule extracted into a tested module and then not used is worse than one
 * left inline: it passes, it reads as covered, and the view goes on doing
 * whatever it did. This is the half a pure test cannot see, so it is asserted
 * from the source — the one thing source-reading tests are genuinely for.
 */
const source = (...parts: string[]): string =>
  readFileSync(join(process.cwd(), 'src', 'renderer', ...parts), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')

const PROMPTS = source('settings', 'pane', 'prompts.ts')
const SHELF = source('history', 'shelf.ts')
const MAIN = source('history', 'main.ts')
const MEMORY = source('history', 'sheet', 'memory.ts')
const COMPANION = source('companion', 'face.ts')

describe('C3 · the panes that edit a document use the rule', () => {
  it('is reached for by the catalogued prompts', () => {
    expect(PROMPTS).toContain("from '../../rules/editing'")
    expect(PROMPTS).toContain('editing(one.text')
  })

  it('is reached for by the wake panel', () => {
    expect(SHELF).toContain("from '../rules/editing'")
    expect(SHELF).toContain('editing(view.prompt.text)')
  })

  it('leaves neither pane setting a control from its own comparison', () => {
    // The inline form was `save.disabled = !canSave(box.value, one.text, ...)`
    // and `const changed = editor.value !== view.prompt.text`. Either one
    // reintroduces a second opinion about what is available, which is how the
    // two drifted apart in the first place.
    for (const pane of [PROMPTS, SHELF]) {
      expect(pane).not.toMatch(/\bsave\.disabled = !(?!doc\.)/)
      expect(pane).not.toMatch(/const changed =/)
    }
  })

  it('asks the rule before every write, so a late click writes nothing', () => {
    expect(PROMPTS).toContain('doc.commit()')
    expect(PROMPTS).toContain('doc.revertByWriting()')
    expect(SHELF).toContain('doc.commit()')
  })

  it('takes the BOX away with the buttons in both', () => {
    expect(PROMPTS).toContain('box.disabled = doc.sending()')
    expect(SHELF).toContain('editor.disabled = doc.sending()')
  })

  it('keeps the wake panel Cancel local — it must not take the lock', () => {
    // Cancel writes nothing, so locking there would strand the panel waiting
    // for a re-read that is never coming.
    expect(SHELF).toContain('doc.revert()')
    expect(SHELF).not.toContain('doc.revertByWriting()')
  })
})

describe('M4 · answers from outside are read afresh on return', () => {
  it('is reached for by the window', () => {
    expect(MAIN).toContain("from '../rules/afresh'")
    expect(MAIN).toContain('afresh(window, readProblemCount)')
  })

  it('registers no focus listener of its own', () => {
    // The launch read and the read on return are one registration. Two
    // statements is what let them drift apart, and dropping the listener while
    // keeping the launch read is the original session-long blind spot.
    expect(MAIN).not.toContain("addEventListener('focus'")
  })
})

describe('A2b · the one step back comes from the rule', () => {
  it('is reached for by the notes section', () => {
    expect(MEMORY).toContain("from '../../rules/undoing'")
    expect(MEMORY).toContain('undoing(view.note)')
  })

  it('keeps no second opinion about whether to offer it', () => {
    // `undo.disabled = view.note.previous === null` was the inline form. It is
    // the same comparison the rule makes, and two copies of it drift the first
    // time somebody decides `''` should count.
    expect(MEMORY).not.toMatch(/previous === null/)
  })

  it('asks on a surface of its own rather than arming a button', () => {
    // Contract D2. This was the last armed control in the window.
    expect(MEMORY).toContain('handlers.askToErase')
    expect(MEMORY).not.toContain("classList.add('arming')")
  })
})

describe('C2 / C5 · the expression set decides what she wears', () => {
  it('is reached for by the rig, not only by the sheet', () => {
    // The whole point of A2c. For the life of the field nothing consulted it to
    // decide what she wears, so the switch changed one sentence and then not
    // even that — which is why C2 and C5 were marked moot.
    expect(COMPANION).toContain("from '../rules/expressions'")
    expect(COMPANION).toContain('wearing(allowed')
  })

  it('does not name the perk expression twice', () => {
    // `setEmotion({ emotion: 'surprised' })` beside a call that asks whether
    // 'surprised' is allowed is two answers to one question, and the literal is
    // the one that would keep working after the permission said no.
    expect(COMPANION).not.toMatch(/emotion: 'surprised'/)
  })
})
