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

const WINDOWS = ['companion', 'history', 'settings'] as const

/** Everything between `<style>` and `</style>`. */
function inlineStyleOf(window: string): string {
  const html = read(`./${window}/index.html`)
  const style = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1]
  expect(style, `${window} has a <style> block`).toBeDefined()
  return style ?? ''
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
