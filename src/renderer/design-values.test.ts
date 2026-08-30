import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The VALUES in the stylesheets, which nothing checked.
 *
 * `stylesheets.test.ts` checks the names on both sides — every class the
 * renderer writes is styled, every class styled is written. It says nothing
 * about what is on the right of the colon, and that is where both of the
 * defects this file exists for were sitting.
 *
 * ## 1. A `var()` naming a token that does not exist
 *
 * `#sure h2 { font-size: var(--t-md) }` shipped in this build. There is no
 * `--t-md`. An undefined custom property makes the whole declaration INVALID AT
 * COMPUTED-VALUE TIME, which for an inherited property means it computes to the
 * inherited value — so the confirmation dialog's heading rendered at 14px,
 * exactly its body text, and exactly what an `h2` with no rule at all would
 * have rendered at. Measured in the running window, with that third figure as
 * the control: the declaration did nothing whatsoever.
 *
 * Nothing threw, nothing logged, no test failed, and the pane looked
 * deliberate. It is the CSS spelling of "a producer with no consumer, and
 * nothing that fails" — the class `nothing-written-goes-unread.test.ts` was
 * built for, one layer over.
 *
 * ## 2. A literal that restates a token
 *
 * Sixty-one length literals in the shelf were exactly equal to a token that
 * already existed — forty of them `1px` where `--s-px` is `1px` and was
 * referenced by nothing at all. A design system with an unused rung and a
 * hardcoded copy of that rung is two facts about the same defect.
 *
 * ## What this deliberately does NOT flag
 *
 * A literal matching no token is COMPONENT GEOMETRY and is allowed: a 268px
 * column is not a spacing step, and forcing it into the global scale would put
 * a lie in the token file. The check is per ROLE — a `13px` font-size is
 * measured against the type scale only, so it can never suggest
 * `height: var(--t-sm)`, which is the kind of nonsense a value-blind version of
 * this rule produces on its first run.
 */

/** Every non-test `.ts` under a directory, at any depth. */
function sourcesUnder(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = `${dir}${entry.name}`
    if (entry.isDirectory()) found.push(...sourcesUnder(`${path}/`))
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) found.push(path)
  }
  return found
}

function read(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
}

const TOKENS = read('./design/tokens.css')
const WINDOWS = ['companion', 'history'] as const

/** Comments stripped, so prose naming a token is never mistaken for a use. */
function withoutComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

/**
 * `@font-face` blocks removed before any value is judged.
 *
 * Caught by running this against the token file on its first pass, which is the
 * only reason it is not still wrong. `@font-face { font-weight: 400 700 }`
 * DECLARES the range a variable font carries; it is not a use of the weight
 * scale, a `var()` is not valid in it, and the pair is one range rather than
 * two values. Left in, this rule would have demanded a change that does not
 * parse — a check that is confidently wrong is worse than no check.
 */
function withoutFontFaces(css: string): string {
  return css.replace(/@font-face\s*\{[^}]*\}/g, '')
}

function styleOf(window: string): string {
  const html = read(`./${window}/index.html`)
  return withoutComments(html.split('<style>')[1]?.split('</style>')[0] ?? '')
}

const SHEETS: readonly (readonly [string, string])[] = [
  ['tokens.css', withoutFontFaces(withoutComments(TOKENS))],
  ...WINDOWS.map((window) => [`${window}/index.html`, styleOf(window)] as const),
]

/** Every `--name:` declaration in the token file, with its value. */
const declared = new Map<string, string>()
for (const match of withoutComments(TOKENS).matchAll(/^\s*(--[\w-]+)\s*:\s*([^;]+);/gm)) {
  declared.set(match[1] ?? '', (match[2] ?? '').trim())
}

describe('the token file has something to check', () => {
  it('declares a vocabulary', () => {
    // Counted first: a parser that has stopped matching would make every
    // assertion below pass while checking nothing.
    expect(declared.size).toBeGreaterThan(50)
    expect(declared.get('--t-body')).toBe('14px')
  })
})

describe('every var() names a token that exists', () => {
  /*
    The whole sheet, INCLUDING the token file itself — a token defined in terms
    of another one is the same trap with an extra step, and the failure would be
    even quieter because it happens once and affects everywhere the role is
    used.

    Locally declared properties count. `--wake-floor` is scoped to one rule in
    the shelf and is a perfectly good custom property; what must not happen is a
    name that is declared NOWHERE.
  */
  for (const [where, css] of SHEETS) {
    const local = new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map((one) => one[1] ?? ''))
    const used = [...css.matchAll(/var\(\s*(--[\w-]+)/g)].map((one) => one[1] ?? '')

    it(`${where} — has var() calls to check`, () => {
      expect(used.length).toBeGreaterThan(0)
    })

    const unknown = [...new Set(used)].filter((name) => !declared.has(name) && !local.has(name))
    it.each(unknown.length === 0 ? [['(none)']] : unknown.map((one) => [one]))(
      `${where} — %s`,
      (name) => {
        expect(
          name === '(none)',
          `${name} is used here and declared nowhere. An undefined custom property makes the ` +
            `whole declaration invalid at computed-value time — it does not fall back, it ` +
            `silently does nothing. Declare it, or use the rung that already exists.`,
        ).toBe(true)
      },
    )
  }
})

/**
 * Which tokens a property may be measured against.
 *
 * Per ROLE, never "any token with this value". Without that, a `13px` height
 * matches `--t-sm` and this test starts demanding `height: var(--t-sm)` — a
 * suggestion that is worse than the literal it replaces.
 */
const ROLES: readonly { readonly property: RegExp; readonly family: RegExp }[] = [
  { property: /^font-size$/, family: /^--t-/ },
  { property: /^font-weight$/, family: /^--w-/ },
  { property: /^letter-spacing$/, family: /^--track/ },
  { property: /^line-height$/, family: /^--leading/ },
  /*
    `--r-` , not `--r\d`.

    The ladder was `--r1` through `--r5` and is `--r-part`, `--r-card`,
    `--r-panel`, `--r-pill` — named for the job rather than numbered, because
    five names for two values is five names nobody can choose between. The
    pattern was not renamed with them, so for the whole of the v2 port a
    hardcoded `14px` radius matched no token in its role and this check quietly
    covered nothing.
  */
  { property: /border-radius$/, family: /^--r-/ },
  {
    property:
      /^(margin|padding|gap|row-gap|column-gap|inset|top|right|bottom|left|width|height|min-width|min-height|border(-\w+)?-width)/,
    family: /^--s/,
  },
]

describe('no literal restates a token that already exists', () => {
  for (const [where, css] of SHEETS) {
    /** Every `property: value` pair, flattened. */
    const declarations = [...css.matchAll(/([a-z-]+)\s*:\s*([^;{}]+);/g)].map((one) => ({
      property: one[1] ?? '',
      value: (one[2] ?? '').trim(),
    }))

    it(`${where} — has declarations to check`, () => {
      expect(declarations.length).toBeGreaterThan(10)
    })

    const restated: string[] = []
    for (const { property, value } of declarations) {
      const role = ROLES.find((one) => one.property.test(property))
      if (role === undefined) continue
      // Only the parts outside a var(), so `var(--s3)` is never re-flagged and
      // a fallback inside one is left alone.
      const outside = value.replace(/var\([^)]*\)/g, ' ')
      for (const literal of outside.match(/-?\d*\.?\d+(px|em|rem)?\b/g) ?? []) {
        for (const [name, token] of declared) {
          if (!role.family.test(name)) continue
          if (token !== literal) continue
          restated.push(`${property}: ${literal} — ${name} is exactly this`)
        }
      }
    }

    const unique = [...new Set(restated)]
    it.each(unique.length === 0 ? [['(none)']] : unique.map((one) => [one]))(
      `${where} — %s`,
      (what) => {
        expect(
          what === '(none)',
          `this value is already a token in the same role; use it. A hardcoded copy of a rung ` +
            `is how a scale drifts — and it is how --s-px came to be declared, unused, and ` +
            `written out by hand forty times.`,
        ).toBe(true)
      },
    )
  }
})

/**
 * The halo's geometry, which `tokens.css` claims is shared and was not.
 *
 * The token file says, in as many words, that the ring is expressed as tokens
 * "because several surfaces draw it and the ellipse has to match across all of
 * them". `halo.ts` then declares `WIDTH = 66`, `HEIGHT = 16` and a -12° tilt of
 * its own, and `--ring-w`, `--ring-h` and `--ring-tilt` were referenced by
 * nothing at all. The numbers agree today by coincidence of history, and
 * nothing would have said so when one of them moved.
 *
 * ## Why a check rather than reading the cascade
 *
 * `resolve.ts` already reads tokens into the canvas and argues the case — "a
 * second table of hexes in TypeScript, however carefully checked in, is a
 * second table". That is the right instinct and the wrong mechanism HERE:
 * `haloReach` and `haloRect` are pure, they feed `her-geometry.ts`, and that
 * decides the size of the window she lives in. Making the window's dimensions
 * depend on a stylesheet having loaded trades a silent drift for a startup
 * order-of-operations bug, which is a worse trade.
 *
 * So the constants stay where they are and this binds them. The claim in the
 * comment becomes a thing that fails.
 */
describe('the ring is one shape, not two copies of one', () => {
  const halo = readFileSync(fileURLToPath(new URL('./companion/halo.ts', import.meta.url)), 'utf8')

  function constant(name: string): string {
    const found = new RegExp(`const ${name} = ([^\\n]+)`).exec(halo)
    return (found?.[1] ?? '').replace(/\s*\/\/.*$/, '').trim()
  }

  it('has both sides to compare', () => {
    expect(constant('WIDTH')).not.toBe('')
    expect(declared.get('--ring-w')).toBeDefined()
  })

  it('draws the width the token declares', () => {
    expect(`${constant('WIDTH')}px`).toBe(declared.get('--ring-w'))
  })

  it('draws the height the token declares', () => {
    expect(`${constant('HEIGHT')}px`).toBe(declared.get('--ring-h'))
  })

  it('leans by the angle the token declares', () => {
    // The token is degrees because CSS has no other way to say it; `halo.ts`
    // needs radians for `ctx.rotate`. The conversion is what the check has to
    // see through, so it compares the degrees rather than the expression.
    const degrees = /\(?(-?\d+(?:\.\d+)?) \* Math\.PI\) \/ 180/.exec(constant('TILT'))?.[1]
    expect(`${degrees ?? '?'}deg`).toBe(declared.get('--ring-tilt'))
  })
})

/**
 * Tokens nothing reads, pinned so the set cannot grow quietly.
 *
 * Not deleted, and that is a decision rather than an omission. `tray-assets.
 * test.ts` set the precedent in this repository with its "assets that ship and
 * are asked for by nothing": a designed vocabulary with a rung missing is what
 * somebody wiring the next state will reach for, and throwing it away costs
 * more than carrying it. What is NOT acceptable is the list growing without
 * anybody noticing, which is how it reached twenty-two.
 *
 * Every entry here has a reason. A new one has to be argued for in this file,
 * next to the others, which is the whole point of the check.
 */
describe('the vocabulary that is declared and not yet spoken', () => {
  const KNOWN: Readonly<Record<string, string>> = {
    // Motion, for motion that is not in CSS. Both windows have zero transitions
    // and zero keyframes; she is the only thing that moves, she is a canvas,
    // and `mochi.ts` honours `prefers-reduced-motion` itself. These stay as the
    // vocabulary a future CSS transition would use.
    '--duration': 'no CSS motion exists yet; the rig gates its own',
    '--duration-fast': 'no CSS motion exists yet; the rig gates its own',
    /*
      The ring's geometry, which IS bound — by the check above, not at runtime.

      Deliberately not counted as spoken by the detector: it only reads
      production TypeScript, because a token named in a test file is a token a
      fixture mentions, and counting those is how a check like this starts
      passing for the wrong reason. These three have a stronger guarantee than
      most tokens in this file, and they belong here for an honest reason rather
      than a flattering one.
    */
    '--ring-w': "bound to halo.ts's WIDTH by the check above",
    '--ring-h': "bound to halo.ts's HEIGHT by the check above",
    '--ring-tilt': "bound to halo.ts's TILT by the check above",
    // The halo's dimmer ring, for a state the code collapsed: `haloFor` answers
    // off / closed / open, and asleep draws the closed ring rather than one of
    // its own.
    '--ring-asleep': 'the asleep ring is drawn as the closed one',
    // The desktop behind her. Nothing in either window paints the desktop; the
    // companion is transparent and sits on whatever is there.
    '--desk': 'nothing paints the desktop',
    '--ink-desk': 'nothing paints the desktop',
    '--hair-desk': 'nothing paints the desktop',
    // Families with a rung spare.
    '--gold-ink': 'gold is on its way out; only --gold and --gold-wash are still drawn',
    '--hair': 'hairlines are drawn as a border in --rule rather than as a shadow',
    '--lift-2': 'no surface lifts this far',
    '--lift-window': 'the windows are chromeless and cast no shadow of their own',
    // Scale rungs between sizes nothing has needed.
    '--r5': 'a radius between --r4 and the pill',
    '--t-lead': 'a size between --t-h3 and --t-body',
  }

  /*
    THREE ways a token is spoken, not one.

    The first version of this counted `var()` in the sheets only, and called
    `--alarm`, `--ring-thinking` and the three ring geometry tokens dead. They
    are not: the companion is a CANVAS, `ctx.fillStyle` takes a colour rather
    than a custom property, and `resolve.ts` exists precisely to read those
    tokens out of the cascade by name. A detector blind to that would have had
    me delete the colours she is drawn in.

    So: a `var()` in a stylesheet, a name in the renderer's TypeScript, or a
    token bound by the halo check above.
  */
  const everything = [TOKENS, ...WINDOWS.map(styleOf)].join('\n')
  const scripts = sourcesUnder(fileURLToPath(new URL('.', import.meta.url)))
    .map((path) => readFileSync(path, 'utf8'))
    .join('\n')

  function isSpoken(token: string): boolean {
    if (new RegExp(`var\\(\\s*${token}\\s*[,)]`).test(everything)) return true
    return scripts.includes(`'${token}'`)
  }

  it('has a vocabulary and a detector that can say no', () => {
    expect(isSpoken('--paper')).toBe(true)
    expect(isSpoken('--not-a-token-anyone-declared')).toBe(false)
  })

  it.each([...declared.keys()].map((one) => [one]))('%s', (token) => {
    // Her seven runtime colours are written by `accent.ts` onto the document and
    // read by the canvas through `resolve.ts`, never as `var()` in a sheet.
    if (/^--her|^--ink-brand$/.test(token)) return
    const spoken = isSpoken(token)
    const known = token in KNOWN
    expect(
      spoken !== known,
      spoken
        ? `${token} is listed as unspoken and something reads it — take it off the list`
        : `${token} is declared and nothing reads it. Use it, remove it, or add it to KNOWN ` +
            `with the reason. A scale that grows rungs nobody plays is how --s-px came to be ` +
            `dead while forty hardcoded 1px copies of it sat in the sheet.`,
    ).toBe(true)
  })
})

/**
 * The frame's colour before the document paints, bound to the page's.
 *
 * The shelf is created already shown, so `BrowserWindow`'s `backgroundColor` is
 * what somebody sees for the moment between the window appearing and the first
 * paint. It held v1's warm paper for the whole of the v2 port — `#f7f6f1` — so
 * opening the window flashed warm grey in the build whose palette claims neutral
 * grey with no warmth at all. Nothing could have caught it: it is a colour in
 * main, and every check in this file reads stylesheets.
 *
 * Hardcoded there rather than read, for the reason `accent.ts` gives about its
 * own copy — main has parsed no stylesheet and can parse none. So this is the
 * binding, the same shape as the ring's geometry above: the constant stays where
 * it has to be and the claim that it matches becomes a thing that fails.
 */
describe('the window opens in the page’s own colour', () => {
  const main = readFileSync(fileURLToPath(new URL('../main/window.ts', import.meta.url)), 'utf8')

  it('has both sides to compare', () => {
    expect(main).toMatch(/backgroundColor:/)
    expect(declared.get('--paper')).toBeDefined()
  })

  it('uses the two halves of `--paper`, and no other colour', () => {
    const paper = declared.get('--paper') ?? ''
    const halves = /light-dark\(\s*(#[0-9a-f]{6})\s*,\s*(#[0-9a-f]{6})\s*\)/.exec(paper)
    expect(halves, '--paper is not a light-dark pair').not.toBeNull()
    const line = /backgroundColor:[^,\n]*/.exec(main)?.[0] ?? ''
    expect(line).toContain(halves?.[1] ?? 'no-light-half')
    expect(line).toContain(halves?.[2] ?? 'no-dark-half')
  })
})
