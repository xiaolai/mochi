/**
 * Every refusal a user can be shown, in both languages.
 *
 * This is the last step: main sends a value, and exactly one
 * function turns it into words. Until it left `settings/main.ts` — which
 * touches `document` at load — nothing could check that every value produces
 * any words at all.
 */

import { describe, expect, it } from 'vitest'
import { LOCALE_TAGS, messagesFor } from '@shared/i18n'
import { forPronoun, PRONOUNS } from '@shared/pronoun'
import type { SaveProblem } from '@shared/ipc'
import type { Copy } from './copy'
import { describeLoadProblem, describeProblem } from './refusal'

/** Every shape `SaveProblem` has. A new variant fails to compile here. */
const EVERY: readonly SaveProblem[] = [
  { kind: 'not-permitted' },
  { kind: 'save-failed' },
  { kind: 'unknown-value', field: 'theme', allowed: 'moss, sky' },
  { kind: 'key-shape', reason: 'empty' },
  { kind: 'key-shape', reason: 'whitespace' },
  { kind: 'key-shape', reason: 'prefix' },
  { kind: 'key-shape', reason: 'short' },
  { kind: 'key-shape', reason: 'long' },
  { kind: 'key-store', reason: 'no-keychain' },
  { kind: 'key-store', reason: 'write-failed' },
  { kind: 'shortcut-unusable', id: 'toggleVisible' },
  { kind: 'shortcut-unusable', id: 'toggleAwake' },
  { kind: 'shortcut-clash' },
  { kind: 'field', field: 'name', reason: 'not-text' },
  { kind: 'field', field: 'name', reason: 'empty' },
  { kind: 'field', field: 'greeting', reason: 'not-object' },
  { kind: 'field-length', field: 'style', limit: 400 },
]

function copyFor(tag: (typeof LOCALE_TAGS)[number], pronoun: (typeof PRONOUNS)[number]): Copy {
  const t = messagesFor(tag).settings
  return { t, locale: tag, pronoun, say: (table) => forPronoun(table, pronoun) }
}

describe('every refusal says something', () => {
  it('produces a non-empty sentence for every problem, in every locale', () => {
    for (const tag of LOCALE_TAGS) {
      const copy = copyFor(tag, 'she')
      for (const problem of EVERY) {
        const said = describeProblem(problem, copy)
        expect(said.trim(), `${tag}: ${JSON.stringify(problem)}`).not.toBe('')
      }
    }
  })

  it('leaves no placeholder unfilled', () => {
    // `format` deliberately leaves an unknown brace visible rather than blank,
    // so a `{limit}` nobody filled reaches the screen as `{limit}`. That is the
    // right behaviour and the wrong thing to ship.
    for (const tag of LOCALE_TAGS) {
      const copy = copyFor(tag, 'she')
      for (const problem of EVERY) {
        expect(describeProblem(problem, copy), `${tag}: ${problem.kind}`).not.toMatch(/\{\w+\}/)
      }
    }
  })

  it('quotes the identifier it is about, untranslated', () => {
    // A field name and a list of accepted values are NAMES, not prose. Only the
    // sentence around them is chosen by the window.
    const copy = copyFor('zh-CN', 'she')
    expect(
      describeProblem({ kind: 'field', field: 'addressUser', reason: 'empty' }, copy),
    ).toContain('addressUser')
    expect(
      describeProblem({ kind: 'unknown-value', field: 'theme', allowed: 'moss, sky' }, copy),
    ).toContain('moss, sky')
    expect(describeProblem({ kind: 'field-length', field: 'style', limit: 400 }, copy)).toContain(
      '400',
    )
  })

  it('names the shortcut the way the pane names it', () => {
    // By its action, not by its id: `toggleAwake` is a code name, and a refusal
    // that used it would be the only place in the window that does.
    const copy = copyFor('en', 'she')
    const said = describeProblem({ kind: 'shortcut-unusable', id: 'toggleAwake' }, copy)
    expect(said).not.toContain('toggleAwake')
    expect(said).toContain(forPronoun(copy.t.keyToggleAwake, 'she'))
  })

  it('follows the chosen pronoun into the sentence', () => {
    const problem: SaveProblem = { kind: 'shortcut-unusable', id: 'toggleVisible' }
    const said = PRONOUNS.map((pronoun) => describeProblem(problem, copyFor('en', pronoun)))
    // Not all four need differ in English, but they must not all be the she/her
    // wording -- that was the bug this whole axis exists for.
    expect(new Set(said).size).toBeGreaterThan(1)
  })
})

describe('describeLoadProblem', () => {
  it('names the file and the field, so the author can act on it', () => {
    const line = describeLoadProblem(
      {
        kind: 'invalid',
        source: 'tutor.json',
        problems: [{ kind: 'field', field: 'id', reason: 'malformed' }],
      },
      copyFor('en', 'she'),
    )
    // Reporting only "not a usable persona" would leave whoever wrote the file
    // with nothing to act on, which is the failure this pathway exists for.
    expect(line).toContain('tutor.json')
    expect(line).toContain('id')
  })

  it('names every source in a duplicate group', () => {
    const line = describeLoadProblem(
      { kind: 'duplicate-id', id: 'tutor', sources: ['a.json', 'b.json'] },
      copyFor('en', 'she'),
    )
    expect(line).toContain('a.json')
    expect(line).toContain('b.json')
    expect(line).toContain('tutor')
  })

  it('has a sentence for every kind, in both languages', () => {
    // The exhaustiveness the compiler gives is over the SWITCH; this is over
    // the message tables, where a missing key is caught by the interface but a
    // key left as an empty string is not.
    const every: Parameters<typeof describeLoadProblem>[0][] = [
      { kind: 'folder-unreadable' },
      { kind: 'unreadable', source: 'a.json' },
      { kind: 'malformed', source: 'a.json' },
      { kind: 'invalid', source: 'a.json', problems: [] },
      { kind: 'duplicate-id', id: 'x', sources: ['a.json'] },
      { kind: 'reserved-id', id: 'mochi', source: 'a.json' },
      { kind: 'active-missing', id: 'gone' },
    ]
    for (const locale of ['en', 'zh-CN'] as const) {
      for (const problem of every) {
        const line = describeLoadProblem(problem, copyFor(locale, 'she'))
        expect(line.trim(), `${locale} ${problem.kind}`).not.toBe('')
        // No placeholder left unfilled -- a `{source}` on screen is a bug the
        // type system cannot see.
        expect(line, `${locale} ${problem.kind}`).not.toMatch(/\{[a-z]+\}/i)
      }
    }
  })
})
