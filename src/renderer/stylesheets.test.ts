import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Two rules about the stylesheets, both of which shipped as visible bugs first.
 *
 * Neither is a question of taste, and neither can be caught by reading the
 * markup: both are cases where the CSS cascade quietly does something other
 * than what the file says, and the only evidence is a screenshot.
 *
 * ## 1. `[hidden]` has to win
 *
 * The UA sheet gives `[hidden]` a `display: none` of the lowest possible
 * weight, so any author rule setting `display` on the same element beats it.
 * The attribute stays in the DOM and the accessibility tree still reports the
 * element as hidden — it is simply on screen. This build shipped it twice from
 * one cause: `.panel` was `display: flex`, so the inactive tab's contents sat
 * under the active one, and `.warn` was `display: flex`, so a chip reading
 * "0 problems" stayed in the drawer with nothing to report. The first was
 * patched where it was found; the second was three lines below it and was
 * missed. So the rule is BOTH halves — the class fix must exist, and the
 * instance patches must not, because a per-element patch is the habit that
 * leaves the next one standing.
 *
 * ## 2. A class the renderer toggles cannot also be a bare selector
 *
 * Each window is one global stylesheet, so `.open` written on its own matches
 * every element that has the class — including one somewhere else that means
 * something completely different. That is not hypothetical: `.open` was the
 * microphone's lit state AND the open character's scrolling column, the column
 * rule came second, and so `display: flex; flex-direction: column;
 * overflow-y: auto` landed on the PILL. Its dot stacked above its label and it
 * became a 43px-tall scroll container in the title bar.
 *
 * A compound (`.pill.open`, `#said.bad`, `button.btn.arming`) or a descendant
 * cannot collide, which is why the check is narrow: a selector that is a single
 * bare class, where that class is one the renderer writes at runtime.
 */

function read(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
}

const TOKENS = read('./design/tokens.css')

// Two, since settings became a tab rather than a window.
const WINDOWS = ['companion', 'history'] as const

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

/** Everything between `<style>` and `</style>`. */
function inlineStyleOf(window: string): string {
  const html = read(`./${window}/index.html`)
  const style = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1]
  expect(style, `${window} has a <style> block`).toBeDefined()
  return style ?? ''
}

/**
 * Every class a stylesheet has a rule for.
 *
 * `url(...)` and `format(...)` are cut first. A font is loaded as
 * `url('./fonts/archivo-latin.woff2') format('woff2')`, and to a matcher
 * looking for a dot followed by a name, `.woff2` is a class — which is how the
 * first draft of the mirror check below reported the typeface as dead CSS.
 */
function classesIn(css: string): ReadonlySet<string> {
  const clean = css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\burl\([^)]*\)/g, '')
    .replace(/\bformat\([^)]*\)/g, '')
  return new Set([...clean.matchAll(/\.([\w-]+)/g)].map((one) => one[1] ?? ''))
}

/** What this window is styled by, its own sheet and the shared one together. */
function classesStyledIn(window: string): ReadonlySet<string> {
  return classesIn(stylesheetOf(window))
}

/** Whether the document actually pulls the shared sheet in. */
function linksTokens(window: string): boolean {
  return /<link[^>]+href="[^"]*design\/tokens\.css"/.test(read(`./${window}/index.html`))
}

/**
 * Everything that applies to this window: its own block, plus the shared sheet
 * IF it loads it. Appending `tokens.css` unconditionally is how the first draft
 * of this file reported a guarantee the companion did not have.
 */
function stylesheetOf(window: string): string {
  const own = inlineStyleOf(window)
  return linksTokens(window) ? `${own}\n${TOKENS}` : own
}

/** Every class this window's modules add, remove or toggle while running. */
function toggledClassesOf(window: string): readonly string[] {
  const dir = fileURLToPath(new URL(`./${window}/`, import.meta.url))
  const names = new Set<string>()
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith('.ts') || entry.endsWith('.test.ts')) continue
    const source = readFileSync(`${dir}${entry}`, 'utf8')
    for (const found of source.matchAll(/classList\.(?:add|remove|toggle)\('([\w-]+)'/g)) {
      const name = found[1]
      if (name !== undefined) names.add(name)
    }
  }
  return [...names]
}

/**
 * The selectors in a sheet, one per comma-separated part, with comments and
 * at-rule preludes dropped. Crude on purpose: it only has to be right about
 * whether a selector is a single bare class.
 */
function selectorsOf(css: string): readonly string[] {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const found: string[] = []
  for (const match of withoutComments.matchAll(/(^|[};])\s*([^{};@]+)\{/g)) {
    const prelude = match[2]
    if (prelude === undefined) continue
    for (const one of prelude.split(',')) found.push(one.trim())
  }
  return found.filter((one) => one !== '')
}

describe('`hidden` means hidden', () => {
  it('is declared once, in tokens.css', () => {
    // `!important` is the point rather than a shortcut: the whole failure is
    // that the ordinary cascade lets an author `display` win.
    expect(TOKENS).toMatch(/\[hidden\]\s*\{\s*display:\s*none\s*!important;?\s*\}/)
  })

  it.each(WINDOWS)('reaches %s, which has to LOAD the sheet to be covered', (window) => {
    // The half this file claimed and did not check. A rule in `tokens.css` is a
    // rule about the windows that link `tokens.css`, and saying "for every
    // window" while grepping one file is the same species of mistake as the bug
    // it guards: it reads as covered.
    expect(linksTokens(window)).toBe(true)
  })

  it.each(WINDOWS)('%s does not patch it per element', (window) => {
    // A patch here is not merely redundant — it is the habit that left the
    // "0 problems" chip on screen three lines from the fix for the same bug.
    const patches = selectorsOf(inlineStyleOf(window)).filter((one) => one.includes('[hidden]'))
    expect(patches).toEqual([])
  })
})

describe('a class the renderer toggles is never a bare selector', () => {
  it('has something to check, and knows the one that broke', () => {
    // Per window this would be a false guard: the companion draws to a canvas
    // and toggles nothing, so its check is vacuously true and honestly so. The
    // corpus is where emptiness would mean the extraction has silently stopped
    // matching — a green test that reads exactly like a passing one.
    const all = WINDOWS.flatMap((window) => toggledClassesOf(window))
    expect(all.length).toBeGreaterThan(0)
    /*
      A NAMED one, so the extraction cannot pass by finding nothing.

      It was `open`, from the microphone on the strip across the top of the
      shelf. That strip is gone — its facts are the title bar's, the tray's and
      her halo's — so the canary is `picking`, which is the archive's select
      mode and the toggled class with the most reason to stay: a list styled
      `.picking` bare would show its tick boxes on every conversation, always.
    */
    expect(all).toContain('picking')
  })

  it.each(WINDOWS)('%s', (window) => {
    const toggled = toggledClassesOf(window)
    const bare = new Set(selectorsOf(stylesheetOf(window)).filter((one) => /^\.[\w-]+$/.test(one)))
    for (const name of toggled) {
      expect(bare, `.${name} is toggled at runtime, so it must always be compounded`).not.toContain(
        `.${name}`,
      )
    }
  })
})

/**
 * Every class the renderer puts on an element is a class something styles.
 *
 * The third rule in this build that looked correct and governed nothing, after
 * the two above. `characterSheet` wraps its plates in `element('div', 'sheet')`
 * and `.sheet` had no rule anywhere — so the column layout lived on `#pane`,
 * whose children are that single wrapper, and the six boundaries between the
 * plates measured 0.0px. Adjacent 1px borders read as a table rather than as an
 * obvious fault, which is how it survived a rebuild and two rounds of
 * photographs.
 *
 * This does not catch every rule that governs nothing — `#pane`'s `gap` is real
 * CSS on a real element and only the STRUCTURE made it inert, which no textual
 * check can see. It catches the half that is mechanical: a class name that
 * exists in one file and nowhere else. That is the half that failed here.
 */
describe('a class the renderer creates is a class something styles', () => {
  /** `element(tag, 'a b')`, `className = 'a b'`, and the runtime toggles. */
  function classesCreatedBy(window: string): readonly string[] {
    const dir = fileURLToPath(new URL(`./${window}/`, import.meta.url))
    const made = new Set<string>()
    /*
      The settings panes too, and at any depth.

      The MIRROR check below already walks them, with a comment explaining that
      they are authored beside the settings window and rendered INTO this one.
      This half did not, and it is the half that catches the harmful direction —
      a class on a real element with no rule anywhere, which is how `.sheet`
      shipped six plates touching. Every class the panes create was invisible to
      it: the two directions disagreed about what this window draws, and only
      the forgiving one covered the newer files.

      Non-recursive `readdirSync` was the other half of that: `panes.ts` became
      a directory of one-pane-per-file, so even naming the folder would not have
      been enough.
    */
    const paths = sourcesUnder(dir)
    if (window === 'history') {
      paths.push(...sourcesUnder(fileURLToPath(new URL('./settings/', import.meta.url))))
    }
    for (const path of paths) {
      const source = readFileSync(path, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
      const found = [
        ...source.matchAll(/element\(\s*'[\w-]+'\s*,\s*'([^']+)'/g),
        ...source.matchAll(/\.className\s*=\s*'([^']+)'/g),
        ...source.matchAll(/classList\.(?:add|remove|toggle)\('([\w-]+)'/g),
      ]
      for (const one of found) for (const name of (one[1] ?? '').split(/\s+/)) made.add(name)
    }
    made.delete('')
    return [...made]
  }

  it('has something to check', () => {
    // The companion draws to a canvas and creates no classes at all, so a
    // per-window guard would be a false one. The corpus is where emptiness
    // means the extraction has silently stopped matching.
    const all = WINDOWS.flatMap((window) => classesCreatedBy(window))
    expect(all.length).toBeGreaterThan(0)
    expect(all).toContain('sheet')
  })

  it.each(WINDOWS)('%s', (window) => {
    const styled = classesStyledIn(window)
    const orphans = classesCreatedBy(window).filter((one) => !styled.has(one))
    expect(orphans).toEqual([])
  })
})

/**
 * And the MIRROR: a class the stylesheet styles that nothing anywhere creates.
 *
 * The check above catches the harmful direction — an element with no rule, which
 * is how `.sheet` shipped six plates touching. This one catches the residue of a
 * deletion: `.search input` was still styled after the search field moved into
 * the topbar and its wrapper stopped existing, and `.panel` outlived the card it
 * drew by one commit. Neither breaks anything on screen, and that is exactly why
 * they accumulate — nothing ever fails.
 *
 * ## Why the two cannot share an extractor
 *
 * They want opposite errors. The check above must UNDER-collect: a class it
 * wrongly believes is created would hide a missing rule, so it only accepts
 * unambiguous literals. This one must OVER-collect: a class it fails to see
 * created would be reported as dead and deleted while something still uses it.
 *
 * So this scans for any quoted or backticked word that could become a class —
 * ternaries inside `element()`, template literals, class names passed to a
 * builder like `iconButton('copy', …)` or `chooser('pills', …)` — plus every
 * `class="…"` in the document itself. Over-collecting here is safe in the
 * direction that matters: the worst case is a dead rule surviving, which is
 * where this file started.
 */
describe('a class the stylesheet styles is a class something creates', () => {
  /**
   * Every string that could name a class, from two kinds of evidence.
   *
   * ## Split only where a multi-class string is legal
   *
   * `element('div', 'mood off')` and `class="tab-pane cast"` really do carry two
   * classes, so those are split on whitespace. Everything else is taken WHOLE.
   *
   * That distinction is the whole check. The first version split every string
   * in the file, so the sentence "Could not search: …" donated the word
   * `search` and `.search input` survived as live CSS — the exact dead rule this
   * was written to catch. The second version still split bare literals, and
   * `'Web search'` in `panes.ts` donated it again. A guard that passes against
   * its own motivating example is worse than none, because it is believed.
   *
   * ## Why bare literals count at all
   *
   * A class name is not always at a class-setting site: `iconButton('copy', …)`
   * and `chooser('pills', …)` hand one to a builder that assigns it. Requiring
   * an EXACT match — the whole literal, no splitting — keeps those without
   * letting prose in.
   */
  function everyClassNameLiteral(window: string): ReadonlySet<string> {
    const dir = fileURLToPath(new URL(`./${window}/`, import.meta.url))
    const seen = new Set<string>()
    const add = (word: string): void => {
      if (/^[\w-]+$/.test(word)) seen.add(word)
    }
    /** A place a multi-class string is legal: split it. */
    const takeClassList = (text: string): void => {
      for (const one of text.matchAll(/'([^'\n]*)'/g)) {
        for (const word of (one[1] ?? '').trim().split(/\s+/)) add(word)
      }
      for (const one of text.matchAll(/`([^`]*)`/gs)) {
        for (const part of (one[1] ?? '').split(/\$\{[^}]*\}/)) {
          for (const word of part.trim().split(/\s+/)) add(word)
        }
      }
    }

    const body = read(`./${window}/index.html`).split('</style>')[1] ?? ''
    for (const one of body.matchAll(/class="([^"]+)"/g)) {
      for (const word of (one[1] ?? '').trim().split(/\s+/)) add(word)
    }

    const paths = sourcesUnder(dir)
    // The settings panes are authored beside the settings window and rendered
    // INTO this one, so their classes are created here even though the files
    // are not. Walked rather than named: `panes.ts` was one file and is now a
    // directory of one-pane-per-file, and a list of names would have silently
    // stopped covering the panes that moved -- which is exactly how ten live
    // classes came to look dead.
    if (window === 'history') {
      paths.push(...sourcesUnder(fileURLToPath(new URL('./settings/', import.meta.url))))
    }

    for (const path of paths) {
      const source = readFileSync(path, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')

      for (const site of [
        ...source.matchAll(/element\(\s*'[\w-]+'\s*,([^)]*)\)/g),
        ...source.matchAll(/\.className\s*=([^\n]*)/g),
        ...source.matchAll(/classList\.(?:add|remove|toggle)\(([^)]*)\)/g),
        ...source.matchAll(/setAttribute\(\s*'class'\s*,([^)]*)\)/g),
      ]) {
        takeClassList(site[1] ?? '')
      }

      // A bare literal with no whitespace, anywhere: the builder case.
      for (const one of source.matchAll(/'([^'\n\s]+)'/g)) add(one[1] ?? '')
    }
    return seen
  }

  it('has something to check', () => {
    // Emptiness here would mean the scan stopped matching and every rule looks
    // live — the failure mode this whole file exists to make impossible.
    expect(everyClassNameLiteral('history').size).toBeGreaterThan(50)
  })

  /** A leading digit is not a class — `letter-spacing: -0.005em` reads as one. */
  const couldBeAClass = (one: string): boolean => !/^\d/.test(one)

  it.each(WINDOWS)("%s's own <style> block", (window) => {
    // A window's INLINE sheet is its own. Nothing else can be using it, so a
    // rule nothing here creates is a rule for an element that stopped existing.
    const created = everyClassNameLiteral(window)
    const dead = [...classesIn(inlineStyleOf(window))]
      .filter(couldBeAClass)
      .filter((one) => !created.has(one))
    expect(dead).toEqual([])
  })

  it('the shared tokens.css, against every window at once', () => {
    /*
      The SHARED sheet is judged against the union, not per window.

      `button.btn` is styled in `tokens.css` and created only by the shell — the
      companion draws to a canvas and has no buttons at all. Checked per window
      that reads as three dead rules, and deleting them would take the shell's
      buttons with them. A shared rule needs one user, not one per document.
    */
    const created = new Set(WINDOWS.flatMap((one) => [...everyClassNameLiteral(one)]))
    const dead = [...classesIn(TOKENS)].filter(couldBeAClass).filter((one) => !created.has(one))
    expect(dead).toEqual([])
  })
})

/**
 * A control put into a MODE the shared rule was not written for.
 *
 * `select` is styled here as a dropdown: `appearance: none` strips the native
 * frame, a chevron is drawn in `background-image` at `top 50%`, and the border
 * and fill are transparent at rest because a collapsed select always shows its
 * value. Every one of those is right for a dropdown.
 *
 * `Hearing you` sets `multiple` and `size = 8`, and the same rules left an
 * eight-row list box with NO frame at all — the native one removed, nothing
 * drawn in its place — and a chevron floating in the middle of the rows
 * pointing at nothing that opens. It rendered as unstyled text on the pane.
 *
 * Nothing failed. This is the case the mirror checks above cannot see and say
 * so: real CSS, on a real element, with a real rule — made wrong by the
 * element's MODE rather than by its name or its nesting.
 *
 * So the check is narrow and mechanical: if a renderer puts a `select` into
 * `multiple`, the sheet has to say something about `select[multiple]`. It
 * cannot judge whether what it says is right. It can refuse to let the rule be
 * deleted while the control that needs it still exists, which is the half that
 * failed here.
 */
describe('a select in `multiple` has a rule written for a list box', () => {
  function makesAMultipleSelect(window: string): boolean {
    const dir = fileURLToPath(new URL(`./${window}/`, import.meta.url))
    const paths = sourcesUnder(dir)
    if (window === 'history') {
      paths.push(...sourcesUnder(fileURLToPath(new URL('./settings/', import.meta.url))))
    }
    return paths.some((path) => /\.multiple\s*=\s*true/.test(readFileSync(path, 'utf8')))
  }

  it('has something to check', () => {
    // The guard on the guard: if the detector stops matching, every assertion
    // below passes vacuously and reads exactly like a green test.
    expect(WINDOWS.some((one) => makesAMultipleSelect(one))).toBe(true)
  })

  it.each(WINDOWS)('%s', (window) => {
    if (!makesAMultipleSelect(window)) return
    const written = selectorsOf(stylesheetOf(window)).some((one) =>
      one.includes('select[multiple]'),
    )
    expect(
      written,
      'this window builds a `select` with `multiple`, which does not open and has no native frame once `appearance: none` lands on it — style it as a list box or it draws as unstyled text',
    ).toBe(true)
  })
})

/*
  `the tool column collapses when there is no tool list` stood here.

  It bound two halves that had to agree — the renderer being able to empty the
  aside, and the sheet answering for the empty case. Both halves are gone: no
  pane in `settings/pane/` returns a top-level heading, so the split that fed
  that aside produced an empty list on every render of every group, and the
  column it guarded has been deleted rather than repaired. B1 to B7 draw no
  apparatus column.

  The check was right about its own subject and the subject stopped existing,
  which `rebuild-contract.md` marks **moot** rather than failing — a check whose
  subject is deleted passes forever and is the thing that file exists to avoid.
*/

/**
 * Focus is this application's decision, not the operating system's.
 *
 * Three comments in this repository reasoned carefully about "the gold
 * `:focus-visible` outline" and no rule anywhere defined one. What they were
 * reasoning about was the BROWSER'S default ring: its colour followed the
 * system accent, its shape was a rounded rectangle whatever the control, and
 * none of it had been measured against this palette. It was found by looking at
 * the running window, which is the only way it could be found — every check
 * here reads rules, and the defect was the absence of one.
 */
/** A sheet with its comments taken out, so prose about a rule is not the rule. */
function bare(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

describe('the focus ring is declared', () => {
  it('exists at all, in the token file every window loads', () => {
    const tokens = bare(TOKENS)
    expect(tokens, 'no :focus-visible rule — focus is whatever the system says').toMatch(
      /:focus-visible\s*\{[^}]*outline:/,
    )
  })

  it('is a colour from this palette rather than a system one', () => {
    // `auto` and the UA keyword are what a browser gives when nothing is said,
    // and a literal is a value nothing measured.
    const ring = /:focus-visible\s*\{([^}]*)\}/.exec(bare(TOKENS))?.[1] ?? ''
    expect(ring).toMatch(/outline:[^;]*var\(--/)
    expect(ring).not.toMatch(/outline:\s*auto/)
  })

  it('is opted out of only where a rule replaces it', () => {
    /*
      A control may refuse the ring — the search field and her name both do,
      because an outline turns them into the rectangle they exist not to be —
      but only if something else shows focus. `outline: none` with nothing
      beside it is a control the keyboard cannot be seen on.

      The replacement may be in the same block or in another rule for the same
      selector, and the selector is escaped before it becomes a pattern: these
      are CSS selectors, and `input[type='text']` read as a regular expression
      is a character class that matches almost anything.
    */
    const sheet = bare(inlineStyleOf('history'))
    /*
      A WIDTH AND A COLOUR ARE NOT A BORDER, and this check used to think they
      were.

      `.finding` sets `border: 0`, which sets `border-style: none`. The rule that
      claimed to replace the ring set `border-bottom-width` and
      `border-bottom-color` — and a width and a colour on a side with no style
      paint nothing at all. So the search field opted out of the focus ring, its
      replacement drew nothing, and this test passed the whole time: it matched
      the word "border" and asked no more.

      A border only shows if it carries a STYLE — the shorthand with a keyword in
      it, or an explicit `border-*-style`. Everything else here paints on its own.
    */
    const paints = (block: string): boolean => {
      /*
        A NO-OP VALUE IS NOT A PAINT, and the first version of this check missed
        that in the funniest possible way: it matched `outline` against the very
        `outline: none` it was inspecting, so every opt-out counted as its own
        replacement.
      */
      const NOTHING = new Set(['none', 'transparent', '0', ''])
      /*
        The VALUE is read out and compared, rather than asserted past with a
        lookahead.

        `:\s*(?!none)` looks right and is not: `\s*` backtracks to match zero
        characters, which puts the lookahead on the space before the value, and
        "none" does not begin at a space — so `outline: none` satisfied a pattern
        written to reject it, and every opt-out counted as its own replacement.

        That is the third lookup-that-always-misses in this pass, and the second
        one inside a check meant to catch the first.
      */
      const has = (property: string): boolean => {
        const found = new RegExp(`(?:^|;|\\s)${property}\\s*:([^;]*)`).exec(block)
        return found !== null && !NOTHING.has((found[1] ?? '').trim())
      }
      return (
        has('background') ||
        has('box-shadow') ||
        has('outline') ||
        has('text-decoration') ||
        /border[a-z-]*:\s*[^;]*\b(solid|dashed|dotted|double|groove|ridge|inset|outset)\b/.test(
          block,
        ) ||
        /border[a-z-]*-style\s*:\s*(?!none\b)/.test(block)
      )
    }

    const rules = [...sheet.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((one) => ({
      selector: (one[1] ?? '').trim(),
      block: one[2] ?? '',
    }))
    let checked = 0
    for (const [at, rule] of rules.entries()) {
      if (!/outline:\s*none/.test(rule.block)) continue
      checked += 1
      /*
        The replacement is in the same block, or it is the NEXT rule.

        Adjacency rather than "somewhere in the sheet", because that is the
        convention worth holding: a control that refuses the ring says what
        shows focus instead, immediately, where the next reader will see both.
        `#q` refuses it and `.finding:focus-within` — its container, the line
        under the field — carries it on the following line.
      */
      const beside = rules[at + 1]?.block ?? ''
      const shown =
        paints(rule.block) || (paints(beside) && /focus/.test(rules[at + 1]?.selector ?? ''))
      expect(
        shown,
        `${rule.selector} refuses the focus ring; the rule beside it has to show focus instead`,
      ).toBe(true)
    }
    // Counted, so a parser that stopped matching cannot pass as a sheet with
    // nothing to check.
    expect(checked).toBeGreaterThan(0)
  })
})

/**
 * A class the FRAME writes in markup is not also a class the renderer writes.
 *
 * The eleventh, twelfth and thirteenth bugs of one shape in this window, and
 * the first one this file can see. Each was a single global stylesheet where
 * one name meant two things:
 *
 *   `.head`     the header of a PAGE, at `padding: 30px 40px 0` — and the
 *               heading row of a section on her sheet. Nine caps labels sat
 *               forty pixels right of the control they name.
 *   `.subject`  the row across the top of a page, `display: flex` with 30px
 *               under it — and the subject LINE of a conversation and of a
 *               problem. Both were flex containers with padding they never
 *               asked for, and `.entry .subject` asks for an ellipsis a flex
 *               container does not give its anonymous item.
 *   `.machine`  the page's grid — and, later in the sheet at equal
 *               specificity, the thing that turned that page back into three
 *               columns.
 *
 * The shape is mechanical and therefore checkable: `index.html` holds the FRAME
 * — the shell each page is drawn into, written once by hand — and the modules
 * build what goes inside it. A name in both is a name whose owner is unclear,
 * and the cascade resolves that ambiguity silently and in one direction.
 *
 * ## Why an allow-list rather than zero
 *
 * Some names are legitimately shared, and they are all shared for the same
 * reason: the frame draws ONE instance of a thing the renderer draws the rest
 * of. The machine's rail row is in the markup because it is always there and
 * the character rows are built; the spacer, the button and the warning colour
 * are vocabulary. Each is named here, so an eleventh has to be argued for
 * rather than merely typed.
 */
describe('a class the frame writes is not also one the renderer writes', () => {
  /**
   * Every class in the document's BODY, not its stylesheet.
   *
   * Cut at `</style>`, so the rules above are not read as markup — otherwise
   * every selector in the sheet counts as a class the frame writes and the
   * check compares the sheet against itself.
   */
  function classesInFrame(window: string): ReadonlySet<string> {
    const html = read(`./${window}/index.html`)
    const body = html.slice(html.indexOf('</style>'))
    const names = new Set<string>()
    for (const one of body.matchAll(/class="([^"]+)"/g)) {
      for (const name of (one[1] ?? '').split(/\s+/)) if (name !== '') names.add(name)
    }
    return names
  }

  /**
   * Every class a module puts on an element it MAKES.
   *
   * Only unambiguous literals, like the created-classes check above: this
   * reports a collision, so a name it wrongly believes is created is a false
   * alarm about a file somebody then has to read.
   */
  function classesFromModules(): ReadonlySet<string> {
    const names = new Set<string>()
    for (const path of sourcesUnder(fileURLToPath(new URL('./', import.meta.url)))) {
      const source = readFileSync(path, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
      const found = [
        ...source.matchAll(/element\(\s*'[\w-]+'\s*,\s*'([^']+)'/g),
        ...source.matchAll(/\.className\s*=\s*'([^']+)'/g),
      ]
      for (const one of found) for (const name of (one[1] ?? '').split(/\s+/)) names.add(name)
    }
    names.delete('')
    return names
  }

  /**
   * The frame draws one of these and the renderer draws the rest, or they are
   * shared vocabulary. Both readings mean the same element type, which is the
   * thing that makes them safe.
   */
  const SHARED = new Set([
    // The machine's rail row is in the markup because it is always present;
    // every character's row is built. Same row, same rule, on purpose.
    'rail-row',
    'rail-name',
    // Vocabulary: a button, a warning, a bullet, a spacer.
    'btn',
    'bad',
    'dot',
    'grow',
  ])

  it('has something to check, and knows the ones that broke', () => {
    const frame = classesInFrame('history')
    expect(frame.size).toBeGreaterThan(10)
    // Named, so an extractor that has silently stopped matching cannot pass as
    // a window with no collisions.
    expect(frame.has('head')).toBe(true)
    expect(classesFromModules().has('section-head')).toBe(true)
  })

  it.each(WINDOWS)('%s', (window) => {
    const made = classesFromModules()
    const both = [...classesInFrame(window)].filter((one) => made.has(one) && !SHARED.has(one))
    expect(both).toEqual([])
  })
})

/**
 * A class built in more than one file is styled without an ancestor.
 *
 * The fourth rule in this file, and the one with the most instances. A class
 * whose only rule is `.wake .row` or `.grant .switch` is styled in the one
 * place its author was looking at and unstyled everywhere else — and unstyled is
 * not blank, it is the browser's defaults, which is a `<div>` that is a block
 * when the file that made it assumed a flex row.
 *
 *   `.note`    forty-four uses, one rule: `.section .note`. Everywhere outside
 *              a settings row it was unmeasured body text in the operating
 *              face.
 *   `.row`     four files, one rule: `.wake .row`, which set
 *              `align-items: center` on something still `display: block`. So
 *              the rule did nothing, the `.grow` spacer inside it did nothing,
 *              and Save and Reset touched edge to edge under all twenty-seven
 *              prompt editors.
 *   `.switch`  two panes, one rule: `.grant .switch`. On the machine's page the
 *              box sat above its label instead of beside it.
 *   `.meta`    three files, two rules, neither reaching the third — "edited"
 *              beside a prompt drew as body text next to a caps heading.
 *
 * Two files is the threshold because that is the point at which the ancestor
 * assumption is already known to be false: whoever wrote the second one was in
 * a different part of the document from whoever wrote the rule.
 *
 * ## What counts as styled
 *
 * A selector with no combinator — `.row`, `button.btn.primary`, `.note.bad`,
 * `.day:hover`. Those apply wherever the element is. Anything with a descendant,
 * child or sibling combinator is scoped to a place, which is the thing being
 * checked for.
 */
describe('a class built in more than one file is styled without an ancestor', () => {
  /** Every class each module builds, by the files that build it. */
  function builtBy(): ReadonlyMap<string, readonly string[]> {
    const where = new Map<string, string[]>()
    for (const path of sourcesUnder(fileURLToPath(new URL('./', import.meta.url)))) {
      const source = readFileSync(path, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
      const found = [
        ...source.matchAll(/element\(\s*'[\w-]+'\s*,\s*'([^']+)'/g),
        ...source.matchAll(/\.className\s*=\s*'([^']+)'/g),
      ]
      for (const one of found) {
        for (const name of (one[1] ?? '').split(/\s+/)) {
          if (name === '') continue
          const files = where.get(name) ?? []
          if (!files.includes(path)) files.push(path)
          where.set(name, files)
        }
      }
    }
    return where
  }

  /** Whether any rule names this class in a selector that is not scoped. */
  function styledAnywhere(css: string, name: string): boolean {
    const wanted = new RegExp(`\\.${name}(?![\\w-])`)
    return selectorsOf(css).some((one) => !/[\s>+~]/.test(one) && wanted.test(one))
  }

  /**
   * Classes that legitimately have only scoped rules, because they legitimately
   * mean something different in each place.
   *
   * `.dot` is the whole list: it is a 4px mark on a day cell, a 6px one beside a
   * voice, a state light in the drawer and a bullet in a note, and every one of
   * those has its own rule. A base rule for it would be a size that is wrong
   * four times. That is the test a candidate has to pass — not "it works today"
   * but "every context styles it, on purpose".
   */
  const PER_CONTEXT = new Set(['dot'])

  it('has something to check, and knows the ones that broke', () => {
    const built = builtBy()
    expect((built.get('row') ?? []).length).toBeGreaterThan(1)
    expect((built.get('note') ?? []).length).toBeGreaterThan(1)
    // The canary for the extractor itself: `.dot` is on the list, so it must
    // still be found in more than one file or the list is silently vacuous.
    expect((built.get('dot') ?? []).length).toBeGreaterThan(1)
  })

  it('history', () => {
    const css = stylesheetOf('history')
    const unstyled = [...builtBy()]
      .filter(([name, files]) => files.length > 1 && !PER_CONTEXT.has(name))
      .filter(([name]) => !styledAnywhere(css, name))
      .map(([name]) => name)
    expect(unstyled).toEqual([])
  })
})
