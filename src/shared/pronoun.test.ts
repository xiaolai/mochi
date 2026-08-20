import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PRONOUN,
  PRONOUNS,
  RETIRED_PRONOUNS,
  forPronoun,
  isPronoun,
  isRetiredPronoun,
  label,
  type ByPronoun,
} from './pronoun'

/**
 * The sibling this module never had.
 *
 * Every other file in `src/shared/` carries one, and the gap was not cosmetic:
 * `forPronoun`, `label` and `ByPronoun` had zero callers anywhere in `src` for
 * the whole of this build. The validation half was live and covered — `he` and
 * `it` were accepted, stored, migrated and asserted — and then every window said
 * "her" regardless, because nothing ever turned the stored value into a word. A
 * test file here would not have caught that on its own, but its ABSENCE was the
 * visible edge of it: the half nobody tested was the half nobody called.
 */

describe('which pronouns there are', () => {
  it('offers three, and `she` is what a file that does not say gets', () => {
    expect([...PRONOUNS]).toEqual(['she', 'he', 'it'])
    expect(PRONOUNS).toContain(DEFAULT_PRONOUN)
  })

  it('keeps `they` as retired rather than as an option', () => {
    // The owner's call, made twice. It stays readable so a stored persona
    // survives; it is not offered, so nothing new can be written with it.
    expect([...RETIRED_PRONOUNS]).toEqual(['they'])
    expect(PRONOUNS).not.toContain('they' as unknown as (typeof PRONOUNS)[number])
    expect(isRetiredPronoun('they')).toBe(true)
    expect(isPronoun('they')).toBe(false)
  })

  it('refuses anything that is not one of the three', () => {
    for (const bad of ['unicorn', '', 'She', 'SHE', 0, null, undefined, {}, ['she']]) {
      expect(isPronoun(bad)).toBe(false)
    }
    // Case matters: the stored value is a key into a `Record`, and a lookup on
    // `'She'` would be `undefined` at runtime with nothing to say so.
    expect(isRetiredPronoun('They')).toBe(false)
  })

  it('accepts each of the three', () => {
    for (const one of PRONOUNS) expect(isPronoun(one)).toBe(true)
  })
})

describe('reading a phrasing', () => {
  const REST: ByPronoun = { she: 'Let her rest', he: 'Let him rest', it: 'Let it rest' }

  it('returns the form for the pronoun asked for', () => {
    expect(forPronoun(REST, 'she')).toBe('Let her rest')
    expect(forPronoun(REST, 'he')).toBe('Let him rest')
    expect(forPronoun(REST, 'it')).toBe('Let it rest')
  })

  it('reads a plain string as itself, whoever is worn', () => {
    // The case the module exists for: most navigation labels do NOT vary, and
    // three identical strings is a choice that is not one.
    for (const one of PRONOUNS) expect(label('Keys', one)).toBe('Keys')
  })

  it('reads a table as its entry', () => {
    for (const one of PRONOUNS) expect(label(REST, one)).toBe(REST[one])
  })

  it('does not interpolate, which is the point of a table', () => {
    // A template producing "Let $them rest" happens to work in English and
    // stops working the moment a locale inflects differently — `叫醒她` differs
    // from `Wake her` in more than the pronoun. Every form is a WHOLE string,
    // so a translator can write what their language actually says.
    const chinese: ByPronoun = { she: '叫醒她', he: '叫醒他', it: '叫醒它' }
    expect(forPronoun(chinese, 'he')).toBe('叫醒他')
    expect(new Set(Object.values(chinese)).size).toBe(PRONOUNS.length)
  })
})

describe('the helpers are actually wired to something', () => {
  /**
   * The defect this file was written after, stated as a check.
   *
   * `forPronoun`, `label` and `ByPronoun` were exported, documented at length,
   * and imported by nothing for the whole of this build — while `isPronoun` and
   * `DEFAULT_PRONOUN` beside them were live. So the app validated a field,
   * stored it, migrated a retired value forward and tested all of that, and then
   * rendered "her" whatever the persona said. Set a character to `he` and every
   * window still called them "her".
   *
   * Imports rather than call sites, deliberately: `history/main.ts` imports
   * `label as paneLabel` to dodge a local of the same name, and a grep for
   * `label(` would miss it and report a guarantee it does not have. The example
   * used to be `settings/main.ts`, which is gone — the aliasing is the point and
   * it outlived the file that first did it.
   */
  const SOURCES = import.meta.glob('../**/*.ts', { eager: true, query: '?raw', import: 'default' })

  it.each(['forPronoun', 'label', 'ByPronoun'])('%s has a caller outside this module', (name) => {
    const importers = Object.entries(SOURCES)
      .filter(([path]) => !path.includes('pronoun'))
      .filter(([, source]) => {
        const text = String(source)
        // EVERY import from the module, not the first. A file may import the
        // types in one statement and a function in another — `history/main.ts`
        // does — and `.exec` stopping at the first one reported `label` as
        // having no callers while it was being used two lines below.
        const named = [
          ...text.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+'[^']*pronoun'/gs),
        ]
          .map((one) => one[1] ?? '')
          .join(', ')
        return new RegExp(`\\b${name}\\b`).test(named)
      })
      .map(([path]) => path)
    expect(importers.length).toBeGreaterThan(0)
  })
})
