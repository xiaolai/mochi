import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { MOCHI } from '@shared/avatar-spec'
import { AA_BODY, accentVariables, contrast, parseHex, type Rgb } from './accent'

/**
 * The token sheet, measured rather than reviewed.
 *
 * `accent.test.ts` already sweeps the whole colour cube for `readableInk`,
 * because HER colour is user-designable and the ink has to be chosen at
 * runtime. This file is the other half: the STATIC roles, which are chosen once
 * by hand and were therefore never checked by anything.
 *
 * That gap was not theoretical. The role now called `--ink-3` shipped at 3.02:1
 * on the page in light and 3.88:1 in dark, used for the one sentence the
 * settings window shows while it is loading. Nothing failed, because nothing
 * was looking.
 *
 * The same failure shape turned up twice in a design handoff being reviewed at
 * the same time: a correct contrast figure attributed to the wrong surface, and
 * then a correct figure asserted as a worst case without sweeping the set. Both
 * are only catchable by enumerating every pairing, which is a thing a test does
 * well and a person reliably does not.
 *
 * Parsed from the CSS rather than from a duplicated table in TypeScript. A
 * second copy of the palette is a copy that goes stale, and the point is to
 * measure what actually ships.
 */
const CSS = readFileSync(fileURLToPath(new URL('./tokens.css', import.meta.url)), 'utf8')

type Scheme = 'light' | 'dark'

function tokens(): Readonly<Record<string, string>> {
  const found: Record<string, string> = {}
  for (const match of CSS.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    // First definition wins: the `prefers-reduced-motion` block at the bottom
    // re-declares durations, and those are not colours anyway.
    found[match[1]!] ??= match[2]!.trim()
  }
  return found
}

/** One side of a `light-dark()` pair, or the plain value if it is not one. */
function inScheme(value: string, scheme: Scheme): string {
  const pair = /^light-dark\(\s*([^,]+),\s*(.+)\)$/.exec(value.trim())
  if (pair === null) return value.trim()
  return (scheme === 'light' ? pair[1]! : pair[2]!).trim()
}

function colour(name: string, scheme: Scheme): Rgb {
  const raw = tokens()[name]
  expect(raw, `${name} is not defined in tokens.css`).toBeDefined()
  const parsed = parseHex(inScheme(raw!, scheme))
  expect(parsed, `${name} (${scheme}) is not a hex colour: ${String(raw)}`).not.toBeNull()
  return parsed!
}

/**
 * Roles that carry WORDS, and the roles they can be drawn on.
 *
 * Listed rather than inferred, because "is this a text colour" is not something
 * a name can be trusted for. Anything added to the sheet has to be added here
 * too, which is the point: an unlisted role is a role nobody measured.
 */
const INKS = ['--ink', '--ink-2', '--ink-3', '--red', '--good', '--ink-brand'] as const
const SURFACES = ['--paper', '--paper-2', '--paper-3', '--field'] as const

/**
 * Backgrounds that only ever carry their OWN ink, so they are checked as pairs
 * rather than swept against everything. `--red-bg` never has body text on it;
 * it has `--red`.
 */
const TINTS = [
  ['--red', '--red-bg'],
  ['--warn-ink', '--warn-bg'],
  ['--ink-brand', '--gold-wash'],
] as const

describe('every text tone is legible on every surface it can land on', () => {
  it('clears AA for body text in both schemes', () => {
    const failures: string[] = []
    for (const scheme of ['light', 'dark'] as const) {
      for (const ink of INKS) {
        for (const surface of SURFACES) {
          const ratio = contrast(colour(ink, scheme), colour(surface, scheme))
          if (ratio < AA_BODY) {
            failures.push(`${ink} on ${surface} (${scheme}) = ${ratio.toFixed(2)}`)
          }
        }
      }
    }
    expect(failures, failures.join('\n')).toEqual([])
  })

  it('reports the worst pairing, so the margin is visible rather than assumed', () => {
    // Not a threshold assertion -- the test above owns that. This one exists so
    // the number is printed by name: "the worst pairing is X" is the claim that
    // went wrong twice in review, and a claim nobody can state from memory is a
    // claim that should be computed.
    let worst = { ratio: Number.POSITIVE_INFINITY, what: '' }
    for (const scheme of ['light', 'dark'] as const) {
      for (const ink of INKS) {
        for (const surface of SURFACES) {
          const ratio = contrast(colour(ink, scheme), colour(surface, scheme))
          if (ratio < worst.ratio) worst = { ratio, what: `${ink} on ${surface} (${scheme})` }
        }
      }
    }
    expect(worst.ratio, `worst pairing: ${worst.what}`).toBeGreaterThanOrEqual(AA_BODY)
  })

  it('gives each tinted background an ink that reads on it', () => {
    for (const scheme of ['light', 'dark'] as const) {
      for (const [ink, background] of TINTS) {
        const ratio = contrast(colour(ink, scheme), colour(background, scheme))
        expect(ratio, `${ink} on ${background} (${scheme})`).toBeGreaterThanOrEqual(AA_BODY)
      }
    }
  })

  it('keeps the ink ramp in order, so "faint" is still fainter than "muted"', () => {
    // A contrast floor alone would let the fix darken `--ink-faint` past
    // `--ink-muted` and quietly collapse the two roles into one.
    for (const scheme of ['light', 'dark'] as const) {
      const surface = colour('--paper', scheme)
      const ink = contrast(colour('--ink', scheme), surface)
      const muted = contrast(colour('--ink-2', scheme), surface)
      const faint = contrast(colour('--ink-3', scheme), surface)
      expect(ink, scheme).toBeGreaterThan(muted)
      expect(muted, scheme).toBeGreaterThan(faint)
    }
  })
})

describe('the accent fallbacks', () => {
  /**
   * These five are NOT `light-dark()` and that is deliberate: `accent.ts`
   * overwrites them at runtime from her `colBody`, and her colour is one colour
   * regardless of the user's scheme. What is in the sheet is the pre-injection
   * fallback, so what matters is that it agrees with what the function would
   * compute -- not that it has a dark variant.
   */
  it('are exactly what accent.ts derives from her built-in face', () => {
    // Every one of the five, compared against the function that overwrites
    // them. Checking only `--accent-ink` by hand left the other four free to
    // drift, and a fallback that differs from the injected value is a flash of
    // the wrong colour on every launch -- brief, and precisely the kind of
    // thing nobody can reproduce on request.
    const derived = accentVariables(MOCHI)
    const sheet = tokens()
    for (const [name, value] of Object.entries(derived)) {
      expect(sheet[name], `${name} fallback differs from what accent.ts emits`).toBe(value)
    }
  })

  it('put a readable label on a filled button', () => {
    const ratio = contrast(colour('--gold', 'light'), colour('--gold-ink', 'light'))
    expect(ratio).toBeGreaterThanOrEqual(AA_BODY)
  })
})

describe('the sheet and the stylesheets that consume it agree', () => {
  /**
   * Every `var()` in the app resolves to something this file defines.
   *
   * Written after unifying two token vocabularies into one, which renamed
   * twenty roles. CSS has no undefined-variable error: `var(--gone)` simply
   * yields nothing, so a missed rename is an element with no colour, no
   * padding, or no font — rendered, shipped, and noticed by a person or not at
   * all. One reference was in fact missed (`--font`, the macOS `menu` face),
   * and this is what would have caught it.
   */
  const CONSUMERS = ['./controls.css', '../settings/settings.css', '../companion/companion.css']

  /**
   * Custom properties set per-ELEMENT at runtime, which is why they are absent
   * from a sheet of global tokens.
   *
   * `--fill` is how far along a slider's track the fill reaches; it belongs to
   * one input, changes as you drag, and would be meaningless declared at
   * `:root`. Listed explicitly rather than pattern-matched, so adding one is a
   * decision somebody writes down instead of a hole that widens quietly. The
   * accent properties are NOT here: they are global, and the sheet declares
   * them as fallbacks precisely so the window is never unstyled.
   */
  const SET_AT_RUNTIME = new Set(['--fill'])

  it('defines every token the stylesheets reference', () => {
    const declared = new Set(Object.keys(tokens()))
    const missing: string[] = []
    for (const file of CONSUMERS) {
      const text = readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8')
      for (const [, name] of text.matchAll(/var\((--[\w-]+)/g)) {
        if (!declared.has(name!) && !SET_AT_RUNTIME.has(name!)) {
          missing.push(`${name} (used in ${file})`)
        }
      }
    }
    expect(missing, missing.join('\n')).toEqual([])
  })

  /**
   * A verdict is never painted with a token that belongs to somebody.
   *
   * `.auth-dot.is-ok` -- the one mark on the whole app that says the
   * credential works -- was `var(--accent)`, her colour. It looked right,
   * because her colour happened to be green. Then the chrome was re-pointed at
   * gold, every `--accent` went with it, and "working" started reporting in
   * the same tone as a warning. Nothing failed: the rename was complete, the
   * contrast sweep above passes on gold, and the dot rendered.
   *
   * Contrast cannot catch this class -- the wrong colour is perfectly legible.
   * What distinguishes it is PROVENANCE: a state the user reads to decide
   * whether anything works cannot vary with the persona worn, so the state
   * classes may only draw from the status block.
   *
   * Matched by PATTERN rather than by a list of the four dot states, which is
   * the opposite of how `SET_AT_RUNTIME` above is kept and deliberately so: an
   * unlisted runtime property is a loud failure the first test catches, but an
   * unlisted state class is a silent hole in this one. `is-` is the naming
   * convention for state in these sheets, so enforcing it costs nothing and
   * covers states nobody has written yet.
   */
  it('paints no state with a persona colour', () => {
    const PERSONA = /--her(-|\b)|--accent/
    const STATE = /(\.is-[\w-]+)[^{}]*\{([^}]*)\}/g
    const wrong: string[] = []
    for (const file of CONSUMERS) {
      const text = readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8')
      for (const [, , body] of text.matchAll(STATE)) {
        for (const [, name] of body!.matchAll(/var\((--[\w-]+)/g)) {
          if (PERSONA.test(name!)) wrong.push(`${name} in a state rule in ${file}`)
        }
      }
    }
    expect(wrong, wrong.join('\n')).toEqual([])
  })

  /**
   * The label column is declared once, not once per stylesheet that needs it.
   *
   * It was a bare `14ch` in two places: the grid that creates the column, and
   * the credential status line, which is not in a `.field` at all and is
   * indented by hand to line up with the controls around it. Widening the
   * column for a longer translation would have left that one row out of line
   * -- silently, and with `controls.test.ts` re-measuring the grid and
   * reporting everything fine, because it only ever looked at the grid.
   *
   * Only THIS value is forbidden, not `ch` in general: `5ch`, `9ch` and `46ch`
   * are real measurements of other things, and a rule that swept them up would
   * be turned off within a week.
   */
  it('declares the label column in one place', () => {
    const declared = /--label-col:\s*([\d.]+ch)/.exec(CSS)?.[1]
    expect(declared, 'the sheet no longer declares --label-col in ch').toBeDefined()
    const repeats: string[] = []
    for (const file of CONSUMERS) {
      const text = readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8')
      // Comments stripped first: the measurement is EXPLAINED in prose in two
      // of these, and prose is not a second declaration.
      const code = text.replace(/\/\*[\s\S]*?\*\//g, '')
      if (code.includes(declared!)) repeats.push(file)
    }
    expect(repeats, `${declared!} is written again in: ${repeats.join(', ')}`).toEqual([])
  })

  /**
   * The destructive affordance is drawn in the status red, not in a brand tone.
   *
   * `.button-danger` was `--ink-brand`, which is a green: the one button that
   * ends something irreversible looked like every button that does not. The
   * state guard above did not catch it because that one matches `.is-*`, and
   * this is a variant class -- so the rule got a second spelling and only one
   * of them was watched.
   */
  it('draws anything destructive in red', () => {
    const DESTRUCTIVE = /\.[\w-]*-danger\b[^{]*\{([^}]*)\}/g
    const wrong: string[] = []
    for (const file of CONSUMERS) {
      const text = readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8')
      for (const [, body] of text.matchAll(DESTRUCTIVE)) {
        const tokens = [...body!.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]!)
        if (!tokens.some((name) => name.startsWith('--red'))) {
          wrong.push(`${file} draws a danger control with ${tokens.join(', ') || 'no token'}`)
        }
      }
    }
    expect(wrong, wrong.join('\n')).toEqual([])
  })

  /**
   * Every vendored face is allowed by the content policy.
   *
   * `default-src 'none'` catches fonts unless `font-src` says otherwise, and
   * the failure is the quiet kind: the text renders, the layout holds, and the
   * window simply shows a system face instead of the one in the sheet. Six
   * files shipped blocked for two days and only the dev console knew.
   */
  it('lets the fonts it declares actually load', () => {
    const declaresFaces = /@font-face/.test(CSS)
    expect(declaresFaces, 'the sheet no longer vendors any face').toBe(true)
    const csp = readFileSync(
      fileURLToPath(new URL('../../main/windows/csp.ts', import.meta.url)),
      'utf8',
    )
    // Matched against the DIRECTIVE line, not the file: a mention in a comment
    // would satisfy a looser test while the policy still blocked every face.
    expect(csp, 'the policy has no font-src, so every @font-face is blocked').toMatch(
      /^\s*"font-src [^"]*",$/m,
    )
  })

  it('has no raw colour outside this file', () => {
    // The sheet's opening claim, enforced. A hex in a consuming stylesheet is a
    // value that no contrast sweep above can see.
    for (const file of CONSUMERS) {
      const text = readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8')
      const hexes = [...text.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0])
      expect(hexes, `${file} contains raw colours`).toEqual([])
    }
  })
})
