import { describe, expect, it } from 'vitest'
import { PRONOUNS, forPronoun, label, type Pronoun } from '../pronoun'
import {
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_TAGS,
  PANE_GROUPS,
  PANE_KEYS,
  SETUP_SECTIONS,
  format,
  isLocaleTag,
  messagesFor,
  resolveLocale,
} from './index'
import type { LocaleTag } from './index'
import { MOCHI } from '../avatar-spec'
import { layoutFor } from '../avatar-layout'

/** Every leaf in a message table, as dotted path to value. */
function flatten(value: unknown, prefix = ''): Record<string, string> {
  if (typeof value !== 'object' || value === null) return { [prefix]: String(value) }
  return Object.entries(value).reduce<Record<string, string>>(
    (all, [key, child]) => ({
      ...all,
      ...flatten(child, prefix === '' ? key : `${prefix}.${key}`),
    }),
    {},
  )
}

/**
 * Every leaf path.
 *
 * Derived from `flatten` rather than walked again. These were two recursive
 * functions differing by one line, which is one careful thing and one
 * liability: whichever got the next fix, the other kept the bug.
 */
function keysOf(value: unknown): string[] {
  return Object.keys(flatten(value))
}

describe('the locale registry', () => {
  it('gives every locale the same keys', () => {
    // The `Messages` interface makes this a compile error too. Asserted at
    // runtime as well because the interface cannot catch a locale object built
    // dynamically, and a missing key is a blank menu item rather than a crash.
    const expected = keysOf(messagesFor(DEFAULT_LOCALE)).sort()
    for (const tag of LOCALE_TAGS) {
      expect(keysOf(messagesFor(tag)).sort(), tag).toEqual(expected)
    }
  })

  it('leaves no string empty', () => {
    for (const tag of LOCALE_TAGS) {
      for (const [path, value] of Object.entries(flatten(messagesFor(tag)))) {
        expect(value.trim(), `${tag}.${path}`).not.toBe('')
      }
    }
  })

  it('names each language in its own language', () => {
    // Somebody who cannot read the current interface has to be able to find
    // their way out of it, so this is never translated.
    expect(LOCALES['zh-CN'].nativeName).toBe('简体中文')
    expect(LOCALES.en.nativeName).toBe('English')
  })

  it('carries a direction on every locale', () => {
    for (const tag of LOCALE_TAGS) {
      expect(['ltr', 'rtl']).toContain(LOCALES[tag].direction)
    }
  })

  it('keeps the placeholder in every translation that needs one', () => {
    // A translator dropping `{app}` produces a Quit item naming no application.
    for (const tag of LOCALE_TAGS) {
      expect(messagesFor(tag).tray.quit, tag).toContain('{app}')
    }
  })
})

describe('resolveLocale', () => {
  it('takes an exact tag', () => {
    expect(resolveLocale('zh-CN')).toBe('zh-CN')
    expect(resolveLocale('en')).toBe('en')
  })

  it('falls back through the base language', () => {
    // The real reason this exists: macOS reports things like `zh-Hans-CN`, and
    // an exact-match lookup would hand a Chinese user an English menu.
    expect(resolveLocale('zh-Hans-CN')).toBe('zh-CN')
    expect(resolveLocale('zh')).toBe('zh-CN')
    expect(resolveLocale('en-GB')).toBe('en')
  })

  it('falls back to the default for anything unknown or absent', () => {
    for (const value of [null, undefined, '', 'kl-GL', 'nonsense']) {
      expect(resolveLocale(value)).toBe(DEFAULT_LOCALE)
    }
  })
})

describe('isLocaleTag', () => {
  it('accepts only registered tags', () => {
    expect(isLocaleTag('en')).toBe(true)
    expect(isLocaleTag('zh-CN')).toBe(true)
    for (const value of ['fr', '', null, 42, {}]) {
      expect(isLocaleTag(value), JSON.stringify(value)).toBe(false)
    }
  })

  it('does not accept inherited property names', () => {
    // `in` walks the prototype chain, so this used to be true for every one of
    // these -- and `messagesFor('toString')` would dereference
    // `Function.prototype.toString.messages` and throw. A locale tag comes from
    // the OS today and from a settings file tomorrow, so it is a boundary.
    for (const value of ['toString', 'constructor', 'valueOf', 'hasOwnProperty', '__proto__']) {
      expect(isLocaleTag(value), value).toBe(false)
      expect(resolveLocale(value), value).toBe(DEFAULT_LOCALE)
    }
  })
})

describe('format', () => {
  it('substitutes named placeholders', () => {
    expect(format('Quit {app}', { app: 'mochi' })).toBe('Quit mochi')
    expect(format('{a} and {b}', { a: '1', b: '2' })).toBe('1 and 2')
  })

  it('leaves an unknown placeholder standing rather than blanking it', () => {
    // `Quit ` reads as a rendering bug with nothing to point at; `Quit {app}`
    // names the key that went missing.
    expect(format('Quit {app}', {})).toBe('Quit {app}')
  })

  it('passes through a template with no placeholders', () => {
    expect(format('Hide', { app: 'mochi' })).toBe('Hide')
  })
})

/**
 * Whether this language's third person actually distinguishes these forms.
 *
 * A `Record`, so adding a locale is a compile error until somebody decides.
 * English and Chinese both distinguish all four; a language like Finnish, whose
 * third person is one word, would legitimately be `false` and this file should
 * not be edited into silence when that day comes.
 */
const DISTINGUISHES: Readonly<Record<LocaleTag, boolean>> = {
  en: true,
  'zh-CN': true,
}

/** Every `Record<Pronoun, string>` in a table, as [path, table] pairs. */
function pronounTables(value: unknown, prefix = ''): Array<[string, Record<Pronoun, string>]> {
  if (typeof value !== 'object' || value === null) return []
  const keys = Object.keys(value)
  const isTable =
    keys.length === PRONOUNS.length &&
    PRONOUNS.every((p) => typeof (value as never)[p] === 'string')
  if (isTable) return [[prefix, value as Record<Pronoun, string>]]
  return Object.entries(value).flatMap(([key, child]) =>
    pronounTables(child, prefix === '' ? key : `${prefix}.${key}`),
  )
}

describe('pronoun forms', () => {
  it('every locale carries a real sentence for every pronoun', () => {
    for (const tag of LOCALE_TAGS) {
      const tables = pronounTables(messagesFor(tag))
      // Guarding the instrument. If the walker stops finding tables, every
      // assertion below passes vacuously and says nothing -- and so does the
      // feminine scan further down, which is the one with teeth.
      //
      // Named paths rather than a count. `> 3` was satisfied by a walker that
      // had lost all but four, and it says nothing about DEPTH: these two sit
      // at different nesting levels, so finding both proves the recursion
      // still descends rather than skimming the top.
      const found = new Set(tables.map(([path]) => path))
      for (const known of ['tray.wake', 'settings.paneAbout.personas']) {
        expect(found.has(known), `${tag}: the walker no longer finds ${known}`).toBe(true)
      }
      for (const [path, table] of tables) {
        for (const pronoun of PRONOUNS) {
          expect(table[pronoun].trim(), `${tag}.${path}.${pronoun}`).toBeTruthy()
        }
      }
    }
  })

  it('a language that distinguishes pronouns actually uses different words', () => {
    // The gap the type system leaves. `Record<Pronoun, string>` forces all four
    // keys to EXIST; nothing stops someone pasting the `she` string into the
    // other three, which compiles, ships, and reads as the feature being
    // broken for everyone who set it.
    for (const tag of LOCALE_TAGS) {
      if (!DISTINGUISHES[tag]) continue
      for (const [path, table] of pronounTables(messagesFor(tag))) {
        const distinct = new Set(PRONOUNS.map((p) => table[p]))
        expect(distinct.size, `${tag}.${path} reuses one wording for several pronouns`).toBe(
          PRONOUNS.length,
        )
      }
    }
  })
})

describe('the sheet that chooses the pronoun uses it', () => {
  // The window where the pronoun is CHOSEN was the last one written in she/her
  // throughout -- "Who she is", "Ask her for". Selecting `he` updated the tray
  // menu while the form the user was standing in ignored it.
  //
  // There used to be a hand-written list of the eleven settings that vary by
  // pronoun, asserting each was non-empty in each form. It was a SUBSET of what
  // `pronoun forms` above already checks over every table the walker finds --
  // and being hand-kept, it had gone stale: `personaHowEditing` was added to
  // the sheet and never to the list, so the newest pronoun-dependent string in
  // the window was the one string this block did not cover. Deleted rather than
  // extended; the exhaustive check is the one worth having.

  it('never says "she" to somebody who chose he, they or it', () => {
    // English only: a word-boundary scan for the feminine forms is meaningless
    // against Chinese and would need a different test.
    //
    // EVERY table, not four named ones. The four were chosen when this was
    // written and nothing added since has been checked -- which is the same
    // way the list above went stale. The walker finds them all, so a new
    // string that hardcodes "her" in the `they` form fails here on the day it
    // is written.
    const feminine = /\b(she|her|hers|herself)\b/i
    for (const [path, table] of pronounTables(messagesFor('en'))) {
      for (const pronoun of ['he', 'it'] as const) {
        expect(table[pronoun], `${path}.${pronoun}`).not.toMatch(feminine)
      }
    }
  })

  it('takes her dimensions from the layout rather than from the copy', () => {
    // `94 × 73` was typed into both locales. Retuning the base size made every
    // translation quietly wrong, in a string nothing compares against the
    // geometry.
    const body = layoutFor(MOCHI, 100)
    for (const tag of LOCALE_TAGS) {
      const hint = forPronoun(messagesFor(tag).settings.sizeHint, 'she')
      expect(hint, tag).toContain('{width}')
      expect(hint, tag).toContain('{height}')
      const filled = format(hint, {
        width: String(Math.round(body.bodyWidth)),
        height: String(Math.round(body.bodyHeight)),
      })
      expect(filled, tag).not.toContain('{')
      expect(filled, tag).toContain(String(Math.round(body.bodyWidth)))
    }
  })
})

describe('the groups', () => {
  // DERIVED, never listed again. This block wrote the panes out by hand and
  // called itself "the six groups" while naming seven -- so it went on testing
  // a `voice` group after that group was folded into the persona sheet, and
  // said nothing about `personas` at all. A hand-kept copy of a list is a copy
  // that is wrong the first time the list moves.
  it('names every group in every locale', () => {
    for (const tag of LOCALE_TAGS) {
      const t = messagesFor(tag).settings
      for (const pane of PANE_KEYS) {
        // Through `label`, because a few titles are sentences about her and
        // vary by pronoun while most are the same noun whoever she is. Every
        // FORM has to be a real string, not just the one this loop picks.
        for (const pronoun of PRONOUNS) {
          expect(label(t.panes[pane], pronoun).trim(), `${tag}.panes.${pane}.${pronoun}`).not.toBe(
            '',
          )
        }
      }
    }
  })

  it('puts every group in exactly one half of the navigation', () => {
    // A pane in `PANE_KEYS` but in no group is not drawn at all -- the nav
    // iterates the groups, so the setting simply becomes unreachable with
    // nothing failing anywhere. A pane in two would be drawn twice.
    const placed = PANE_GROUPS.flatMap((group) => group.panes)
    expect([...placed].sort()).toEqual([...PANE_KEYS].sort())
  })

  it('names every half in every locale', () => {
    for (const tag of LOCALE_TAGS) {
      const t = messagesFor(tag).settings
      for (const group of PANE_GROUPS) {
        for (const pronoun of PRONOUNS) {
          expect(
            label(t.paneGroups[group.key], pronoun).trim(),
            `${tag}.paneGroups.${group.key}.${pronoun}`,
          ).not.toBe('')
        }
      }
    }
  })

  it('describes every group, in every pronoun where the description mentions her', () => {
    // `about` is the one description with no pronoun in it — it is about the
    // build, not about her — so it is a plain string and the others are not.
    for (const tag of LOCALE_TAGS) {
      const t = messagesFor(tag).settings
      expect(t.paneAbout.about.trim(), `${tag}.paneAbout.about`).not.toBe('')
      for (const pane of PANE_KEYS) {
        if (pane === 'about') continue
        for (const pronoun of PRONOUNS) {
          expect(
            forPronoun(t.paneAbout[pane], pronoun).trim(),
            `${tag}.${pane}.${pronoun}`,
          ).not.toBe('')
        }
      }
    }
  })
})

describe("the setup pane's sections", () => {
  it('names every section in every locale', () => {
    for (const tag of LOCALE_TAGS) {
      const t = messagesFor(tag).settings
      for (const key of SETUP_SECTIONS) {
        expect(t.sections[key].trim(), `${tag}.sections.${key}`).not.toBe('')
      }
    }
  })

  it('puts the credential first, because nothing under it works without it', () => {
    // The ORDER is the decision, so it is pinned rather than left to whichever
    // literal the renderer happens to hold. Sorted by what blocks what: the
    // credential, then looking things up -- which is the same credential being
    // spent -- then what she hears with and how long she stays, then the keys
    // that reach her, then how much room she takes: setup you do once above
    // tuning you return to.
    //
    // Delegation sits SECOND for one reason: without a usable Codex the whole
    // section has nothing to offer, so it belongs directly beneath the thing it
    // depends on rather than among the tuning controls.
    //
    // Presence sits beside Sound because both describe the LIVE session, while
    // the two after them describe the desktop around it. It is deliberately not
    // inside Sound: that section ends by saying its controls wait for the next
    // wake, and this one applies immediately.
    expect([...SETUP_SECTIONS]).toEqual([
      'auth',
      'delegation',
      'sound',
      'presence',
      'shortcuts',
      'screen',
    ])
  })

  it('is the whole machine half, beside About and nothing else', () => {
    // Four panes became one. If a fifth machine pane ever appears, this is
    // where somebody decides whether it is a pane or a section, rather than
    // discovering the nav has quietly grown a sixth row.
    const machine = PANE_GROUPS.find((group) => group.key === 'machine')
    expect(machine?.panes).toEqual(['setup', 'about'])
  })
})

describe('a string that names a pronoun has to offer all four', () => {
  it('finds no hardcoded feminine wording in any plain English string', () => {
    // The defect class the checks above CANNOT see. They walk the tables that
    // already vary by pronoun; a string that SHOULD vary and is typed `string`
    // is invisible to them -- which is exactly how the navigation went on
    // saying "Who she is" beside a pane whose every field said "it", in the
    // one window where the pronoun is chosen.
    //
    // So: any plain string that names her is a string in the wrong type. The
    // tables are excluded by construction, because a leaf inside one is a form
    // that is allowed to say "she".
    const feminine = /\b(she|her|hers|herself)\b/i
    const inTables = new Set(
      pronounTables(messagesFor('en')).flatMap(([path]) =>
        PRONOUNS.map((pronoun) => `${path}.${pronoun}`),
      ),
    )
    const offenders = Object.entries(flatten(messagesFor('en')))
      .filter(([path]) => !inTables.has(path))
      .filter(([, value]) => feminine.test(value))
      .map(([path, value]) => `${path}: ${value}`)

    expect(offenders, offenders.join('\n')).toEqual([])
  })
})
