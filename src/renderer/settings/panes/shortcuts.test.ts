// @vitest-environment happy-dom
/**
 * The two bindings, as a reader meets them.
 *
 * This pane was built on the ABOUT pane's markup -- a description list of
 * name/value pairs -- and its values are not values. They are buttons you
 * press to record a new chord. Wearing the wrong layout cost it two things:
 * its controls did not share the left edge every other pane's controls sit on,
 * and a `<dt>` names nothing, so each button's accessible name was the chord
 * printed on it. "Control Shift M, button" says which keys, never what for.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SHORTCUT_IDS } from '@shared/shortcuts'
import { messagesFor } from '@shared/i18n'
import { forPronoun } from '@shared/pronoun'
import type { SettingsSnapshot } from '@shared/ipc'
import { shortcutsPane } from './shortcuts'
import type { Copy } from '../copy'

const copy: Copy = {
  t: messagesFor('en').settings,
  locale: 'en',
  pronoun: 'she',
  say: (table) => forPronoun(table, 'she'),
}

const snapshot = {
  keys: {
    toggleVisible: { shown: '⌃⇧M', accelerator: 'Control+Shift+M', unavailable: false },
    toggleAwake: { shown: '⌃⇧A', accelerator: 'Control+Shift+A', unavailable: true },
    askWorkspace: { shown: '⌃⇧K', accelerator: 'Control+Shift+K', unavailable: false },
  },
} as SettingsSnapshot

const deps = { act: () => undefined, showProblems: () => undefined }

function render(): void {
  document.body.replaceChildren(shortcutsPane(copy, snapshot, deps))
}

describe('each binding says what it binds', () => {
  it('names every chord button after the action, not after the chord', () => {
    render()
    for (const id of SHORTCUT_IDS) {
      const button = document.getElementById(`key-${id}`)
      expect(button, `key-${id} is missing`).not.toBeNull()
      // The name is assembled from the term AND the button: what it does, then
      // what it is bound to. A `<dt>` beside a `<dd>` carries no relationship
      // at all, so this used to be the chord alone -- "Control Shift M,
      // button", which says which keys and never what for.
      const named = (button?.getAttribute('aria-labelledby') ?? '').split(/\s+/)
      expect(named[0]).toBe(`key-${id}-label`)
      const term = document.getElementById(`key-${id}-label`)
      expect(term?.textContent, `key-${id} has an empty name`).toBeTruthy()
      expect(named).toContain(`key-${id}`)
    }
  })

  it('keeps its own column, because these labels do not fit the shared one', () => {
    // Not an oversight, a measurement: "Wake them, or let them sleep" is
    // 19.6ch and `.field`'s column is 14ch, so every English variant of that
    // label wraps if this pane joins it. `controls.test.ts` owns the number.
    render()
    expect(document.querySelectorAll('.field').length).toBe(0)
    expect(document.querySelector('.key-list')).not.toBeNull()
  })

  it('aligns its labels the way every other pane does', () => {
    // The column is wider here, because these labels are sentences. Its
    // APPEARANCE is not this pane's to invent: a wider column is a
    // measurement, a differently-styled label is a different application.
    render()
    for (const id of SHORTCUT_IDS) {
      const term = document.getElementById(`key-${id}-label`)
      expect(term?.classList.contains('field-label'), `key-${id} styles itself`).toBe(true)
    }
  })

  it("sits flush against the pane's right edge", () => {
    // The one block in this window that is not left-anchored on the shared
    // label column, and the exception is measured: these labels are sentences
    // and do not fit that column. Since it has to be wider, it is squared off
    // on the right instead -- wider on both sides reads as a mistake.
    //
    // `justify-content: end` is only half of it. A `1fr` second track would
    // stretch to the pane and leave the buttons exactly where the old layout
    // put them, so the track sizing is pinned too.
    const css = readFileSync(join(process.cwd(), 'src/renderer/settings/settings.css'), 'utf8')
    const rule = /\.key-list \{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(rule, '.key-list is no longer declared').not.toBe('')
    expect(rule).toContain('justify-content: end')
    expect(rule).toContain('grid-template-columns: max-content max-content')
  })

  it('shows the chord in the mono face', () => {
    // The binding is DATA -- a string of keys read character by character --
    // and it sits directly under the ones above it. `.chord` carries this
    // itself; it used to also inherit it from a description-list rule that has
    // since gone, so losing it would have been silent.
    // From the project root rather than `import.meta.url`: this file runs in
    // the happy-dom environment, where that is not a file URL.
    const css = readFileSync(join(process.cwd(), 'src/renderer/settings/settings.css'), 'utf8')
    const rule = /\.chord \{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(rule, '.chord is no longer declared').not.toBe('')
    expect(rule).toContain('font-family: var(--mono)')
    // And the note beside it is PROSE, so it must not be dragged into mono.
    const note = /\.chord-note \{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(note).not.toContain('--mono')
  })

  it('still says when the system already owns a chord', () => {
    render()
    const taken = document.querySelector('.chord-note')
    expect(taken?.textContent).toBe(messagesFor('en').settings.keyTaken)
    // On the row that is actually taken, not merely somewhere on the pane.
    expect(taken?.closest('dd')?.querySelector('button')?.id).toBe('key-toggleAwake')
  })
})
