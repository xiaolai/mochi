import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Nothing this application shows a person is written for one pronoun.
 *
 * ## Why this exists rather than another round of fixes
 *
 * `Persona.pronoun` has been validated, stored, migrated and tested since it was
 * added, and `SettingsView.pronoun`'s own comment records what that was worth:
 * *"`he` and `it` were both accepted and both still came out 'her'."* The
 * response each time has been to find the offending sentences and rewrite them,
 * and it has not held:
 *
 * - `sheet/mood.ts` still carries the note *"Two DID name her and were missed on
 *   the first pass: a he/him character's tiles read 'what she falls back to'."*
 * - The settings panes were done, and then six more arrived after them — a pane
 *   label, four notes and a refusal.
 * - `listKeys` held a table in main that said "Let her rest" whoever was worn.
 *
 * Three rounds of fixing instances is the point at which the instances stop
 * being the thing to fix. Every wording written from here is a fresh chance to
 * reintroduce this, and nothing failed when one was.
 *
 * ## The rule, in two halves
 *
 * **The renderer resolves.** A window has `view.pronoun` in hand, so gendered
 * wording lives in a `ByPronoun` table and is read through `forPronoun`.
 *
 * **Main words it neutrally where it cannot resolve.** Main reaches the worn
 * pronoun through `wornPronoun(userData)` and `says.ts` is where that copy
 * lives — but two places genuinely cannot: anything inside `catalogue()`, since
 * `wornPronoun` calls it, and anything in `store/`, where loading the persona
 * catalogue to word an error would couple a file reader to the thing that
 * depends on it. Those say it without a pronoun, which is `applyHearing`'s rule.
 *
 * ## Why it over-collects, and what it exempts
 *
 * It reads every string literal in the shell windows rather than the arguments
 * to text sinks. Sink-targeting was tried first and under-collects here, because
 * text reaches the DOM through local builders — `section`, `empty`, `chooser` —
 * and it missed five of the nine live cases. `stylesheets.test.ts` reached the
 * same conclusion about the same code for the same reason.
 *
 * Over-collecting is only safe with exemptions that are mechanical rather than
 * a list of forgiven files, so all four are properties of the literal itself:
 *
 * | Exempt | Why |
 * | --- | --- |
 * | a value under `she:`, `he:` or `it:` | it is the fix — a `ByPronoun` entry |
 * | a literal made only of pronouns | `'she / her'` is the control for CHOOSING one, and `'hers'` is a union tag |
 * | one starting `.` `@` `#` `--` `<` | an import path, a CSS variable, a selector, markup |
 * | one word with no spaces | an id, a class, a key |
 *
 * ## What it cannot see
 *
 * A pronoun assembled at runtime, and prose in `.html`. It does not try: the
 * mechanical half is the half that failed here three times, which is
 * `no-hardcoded-prompts.test.ts` reasoning about a different subject.
 */

const SRC = fileURLToPath(new URL('.', import.meta.url))

/** English's gendered pronouns. `it`/`its` are not among them. */
const GENDERED = /\b(she|her|hers|herself|he|him|his|himself)\b/i

/** Words that make a literal a pronoun LABEL or a stored value, not prose. */
const PRONOUN_WORDS = new Set([
  'she',
  'he',
  'it',
  'her',
  'him',
  'his',
  'hers',
  'its',
  'herself',
  'himself',
  'itself',
  'they',
  'them',
  'their',
])

/**
 * Where the tables are allowed to live.
 *
 * `*-says.ts` by convention, plus `shortcuts.ts` and `grants.ts`, which each
 * hold the wording beside the thing it describes rather than in a copy file —
 * `SHORTCUT_SAYS` sits with the two keys it names, and `GRANT_SPECS` with the
 * grants. A table anywhere else is fine too; it is the ENTRIES that are exempt,
 * by the `she:`/`he:`/`it:` rule below. These files are skipped whole only
 * because they are nothing but tables.
 */
const COPY_FILES = new Set(['shortcuts.ts', 'grants.ts', 'says.ts'])

function isCopyFile(name: string): boolean {
  return name.endsWith('-says.ts') || COPY_FILES.has(name)
}

function filesUnder(directory: string): readonly string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}${entry.name}`
    if (entry.isDirectory()) return filesUnder(`${path}/`)
    if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) return []
    return isCopyFile(entry.name) ? [] : [path]
  })
}

/** Comments stripped, so prose about the bug cannot satisfy or trip the check. */
function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
}

/** A literal, with whatever `key:` precedes it, so a table entry is visible. */
const LITERAL = /(\w+\s*:\s*)?('(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)/g

function exempt(prefix: string | undefined, text: string): boolean {
  const body = text.slice(1, -1).trim()
  // A value in a she/he/it triple. This is what a fix looks like.
  const key = prefix?.trim().replace(/:$/, '').trim()
  if (key === 'she' || key === 'he' || key === 'it') return true
  // Only pronouns: a label for choosing one, or a stored `who` value.
  const words = body.match(/[A-Za-z']+/g) ?? []
  if (words.length > 0 && words.every((one) => PRONOUN_WORDS.has(one.toLowerCase()))) return true
  // An identifier rather than prose.
  if (/^[.@#<]|^--|^src\//.test(body)) return true
  if (!body.includes(' ') && /^[\w./#-]+$/.test(body)) return true
  return false
}

function offendersIn(path: string): readonly string[] {
  const found: string[] = []
  for (const match of code(path).matchAll(LITERAL)) {
    const text = match[2] ?? ''
    if (!GENDERED.test(text)) continue
    if (exempt(match[1], text)) continue
    found.push(text.slice(0, 90))
  }
  return [...new Set(found)]
}

describe('the renderer resolves every gendered wording', () => {
  /*
    The shell windows only. The companion draws to a canvas and its literals are
    log lines and SVG ids; `design/` holds CSS custom property names, several of
    which are literally `--her`. Including either would mean an allowlist of
    forgiven files, which is the thing that rots.
  */
  const files = [
    ...filesUnder(`${SRC}renderer/history/`),
    ...filesUnder(`${SRC}renderer/settings/`),
  ]

  it('finds the files it is checking', () => {
    // Counted first: a walk that matched nothing would pass while reading not
    // one line — the failure this repository names as "green is not evidence
    // that anything happened".
    expect(files.length).toBeGreaterThan(15)
  })

  it('has a working detector, checked against the shape that keeps recurring', () => {
    // The guard on the guard. Every assertion below is an absence, and an
    // absence proves nothing about a matcher that has stopped matching.
    expect(GENDERED.test('what she falls back to')).toBe(true)
    expect(exempt('she: ', "'what she falls back to'")).toBe(true)
    expect(exempt(undefined, "'what she falls back to'")).toBe(false)
    expect(exempt(undefined, "'she / her'")).toBe(true)
    expect(exempt(undefined, "'hers'")).toBe(true)
    expect(exempt(undefined, "'--her-deep'")).toBe(true)
    expect(exempt(undefined, "'drop-hers'")).toBe(true)
  })

  it.each(
    [...filesUnder(`${SRC}renderer/history/`), ...filesUnder(`${SRC}renderer/settings/`)].map(
      (path) => [path.slice(SRC.length), path],
    ),
  )('%s', (_name, path) => {
    expect(
      offendersIn(path),
      'wording for one pronoun — put a ByPronoun table in the nearest *-says.ts and read it with forPronoun',
    ).toEqual([])
  })
})

describe('main says nothing to a person that is worded for one pronoun', () => {
  /*
    Main is scanned by SINK rather than whole, and here that is right rather
    than a compromise: main is mostly log lines, and `[keys] she was left at…`
    is not something anybody reads in the window. What reaches a person is a
    refusal's `why` and a problem note's detail, and both are drawn verbatim in
    the conversations window.

    `says.ts` is skipped as a copy file, so what is left to find is a sentence
    written at the site instead of taken from a table.
  */
  const SINKS = [
    /\brefuse\(\s*('(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)/g,
    /\bno\(\s*('(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)/g,
    /\bwhy:\s*('(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)/g,
    /problems\.note\(\s*[^,]+,\s*[^,]+,\s*('(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)/g,
  ]

  const files = [...filesUnder(`${SRC}main/`), ...filesUnder(`${SRC}capabilities/`)]

  it('finds the files it is checking', () => {
    expect(files.length).toBeGreaterThan(20)
  })

  it('has a working detector', () => {
    const sample = "return refuse('She is not on screen just now.')"
    const hit = [...sample.matchAll(SINKS[0] ?? /$^/g)].map((one) => one[1] ?? '')
    expect(hit).toHaveLength(1)
    expect(GENDERED.test(hit[0] ?? '')).toBe(true)
  })

  it.each(
    [...filesUnder(`${SRC}main/`), ...filesUnder(`${SRC}capabilities/`)].map((path) => [
      path.slice(SRC.length),
      path,
    ]),
  )('%s', (_name, path) => {
    const source = code(path)
    const found: string[] = []
    for (const sink of SINKS) {
      for (const match of source.matchAll(sink)) {
        const text = match[1] ?? ''
        if (GENDERED.test(text) && !exempt(undefined, text)) found.push(text.slice(0, 90))
      }
    }
    expect(
      [...new Set(found)],
      'a refusal or problem note worded for one pronoun — resolve it through says.ts with wornPronoun, or word it without a pronoun where the character is not in hand',
    ).toEqual([])
  })
})
