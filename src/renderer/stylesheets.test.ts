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
    expect(all).toContain('open')
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
    for (const entry of readdirSync(dir)) {
      if (!entry.endsWith('.ts') || entry.endsWith('.test.ts')) continue
      const source = readFileSync(`${dir}${entry}`, 'utf8')
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
