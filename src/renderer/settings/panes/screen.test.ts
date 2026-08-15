// @vitest-environment happy-dom
/**
 * The colour swatches, as a reader's pointer actually meets them.
 *
 * This file exists because a 748-test gate could not see a dead label. Every
 * check in this project reads source, JSON or CSS as TEXT; nothing rendered a
 * pane, so `for` pointing at an element that does not exist was invisible to
 * all of it -- and the swatch it killed was the FIRST one, which is the
 * built-in's own colour.
 */

import { describe, expect, it } from 'vitest'
import { MOCHI } from '@shared/avatar-spec'
import { THEME_IDS } from '@shared/theme'
import { DEFAULT_PERSONA } from '@shared/persona'
import { messagesFor } from '@shared/i18n'
import { forPronoun } from '@shared/pronoun'
import type { SettingsSnapshot } from '@shared/ipc'
import { colourPicker } from './screen'
import type { Copy } from '../copy'

const copy: Copy = {
  t: messagesFor('en').settings,
  locale: 'en',
  pronoun: 'she',
  say: (table) => forPronoun(table, 'she'),
}

const snapshot = { face: MOCHI } as SettingsSnapshot

const deps = {
  act: () => undefined,
  showProblems: () => undefined,
  adoptTheme: () => undefined,
  refreshFromMain: () => Promise.resolve(),
}

function render(theme: (typeof THEME_IDS)[number]) {
  const host = document.createElement('div')
  host.append(colourPicker(copy, { ...DEFAULT_PERSONA, theme }, snapshot, deps))
  // Attached, because `for` resolves against a DOCUMENT: a detached tree
  // reports no control for any label and the test would pass on every swatch.
  document.body.replaceChildren(host)
  return host
}

describe('every swatch can be clicked', () => {
  it('points each label at its own radio', () => {
    render('sky')
    const dead = THEME_IDS.filter((id) => {
      const label = document.querySelector<HTMLLabelElement>(`label[for="theme-${id}"]`)
      return label === null || label.control === null
    })
    // `moss` failed here alone: it is `THEME_IDS[0]`, and the field helper
    // reached into the group for "the labelable control", found the first
    // radio, and renamed it out from under its own label.
    expect(dead, `these swatches label nothing: ${dead.join(', ')}`).toEqual([])
  })

  it('keeps the id each radio was built with', () => {
    render('sky')
    for (const id of THEME_IDS) {
      const input = document.querySelector<HTMLInputElement>(`#theme-${id}`)
      expect(input, `#theme-${id} is missing`).not.toBeNull()
      expect(input?.value).toBe(id)
    }
  })

  it('checks the worn colour and only that one', () => {
    render('sky')
    const checked = [...document.querySelectorAll<HTMLInputElement>('.swatch-input')]
      .filter((input) => input.checked)
      .map((input) => input.value)
    expect(checked).toEqual(['sky'])
  })

  it('still labels the group itself, for a reader who cannot see it', () => {
    // The id theft was in service of something real -- a group with no
    // accessible name -- so the fix has to keep that name, not drop it.
    const host = render('sky')
    const group = host.querySelector('[role="radiogroup"]')
    const named = group?.getAttribute('aria-labelledby')
    expect(named, 'the swatch group has no accessible name').toBeTruthy()
    expect(document.getElementById(named ?? '')?.textContent).toBeTruthy()
  })
})
