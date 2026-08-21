import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { FEET_FROM_TOP, WINDOW_H, WINDOW_W, fullPad } from '@shared/avatar-layout'

/**
 * Her window is never SHOWN at the size it is born.
 *
 * ## What was measured, against this exact configuration
 *
 * macOS clamps a window onto the display the first time it is shown. Probed
 * with a frameless, transparent, alwaysOnTop, skipTaskbar window created
 * `show: false` at 980x560:
 *
 * ```
 * afterSetPosition: 1957,1058    setPosition on a hidden window works
 * afterLoad:        1957,1058    and survives the load
 * afterShow:        1580, 880    show() moved it
 * ```
 *
 * 1957 + 980 = 2937, which is 377 past a 2560-wide display. 1058 + 560 = 1618,
 * which is 178 past 1440. It came back 377 left and 178 up — exactly the
 * overhang, on both axes, which is what makes this a clamp and not a
 * coincidence.
 *
 * ## Why it is structural rather than a bad number somewhere
 *
 * She stands 443px in from the left of that window and 267px down from its top.
 * Putting her body near the bottom-right corner of a display therefore REQUIRES
 * the window to hang off two edges. The clamp refuses, so the corner is not a
 * position this window can be shown in — at that size, at any origin, for any
 * value anybody computes.
 *
 * Three fixes missed this by looking at which process reported her position.
 * The position was fine. It was being changed after it was set, by the act of
 * showing her, and nothing re-applied it.
 *
 * ## What makes waiting safe, also measured
 *
 * - `ready-to-show` fires for a HIDDEN window in an accessory app here, because
 *   she is alwaysOnTop at screen-saver level and on every workspace.
 * - Showing at the fitted size does not clamp: 2374,1299 survived.
 * - Growing back over the display edge once VISIBLE does not clamp either, so a
 *   bubble still gets its room.
 *
 * The replayed sequence, with the real numbers, lands her body at 2400,1325 —
 * where she was left.
 */

/**
 * Everything outside a comment, so an ARGUMENT about `ready-to-show` is not a
 * use of it.
 *
 * The same helper `lifecycle.test.ts` keeps, and for the same reason — which
 * this file found the direct way: the assertion below failed on the paragraph
 * explaining why the thing it forbids was removed.
 */
function source(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('the size she is born at cannot hold her in a corner', () => {
  it('is arithmetic, not an opinion', () => {
    /*
      The clamp is not testable without a display, but the REASON it bites is,
      and it is the part somebody could undo by changing a constant. If her
      offset inside the window ever became small enough for the window to sit
      wholly on screen with her in a corner, the rule below would stop being
      necessary — and this is what would say so.
    */
    const pad = fullPad({ width: 94, height: 73 })
    expect(pad.left).toBe(Math.round(WINDOW_W / 2 - 47))
    expect(pad.top).toBe(FEET_FROM_TOP - 73)

    // A 2560x1440 display, her body 4px from its bottom-right corner.
    const display = { width: 2560, height: 1440 }
    const her = { x: display.width - 4 - 94, y: display.height - 4 - 73 }
    const origin = { x: her.x - pad.left, y: her.y - pad.top }
    expect(origin.x + WINDOW_W).toBeGreaterThan(display.width)
    expect(origin.y + WINDOW_H).toBeGreaterThan(display.height)
  })
})

describe('who shows her, and when', () => {
  const window = source('./window.ts')
  const index = source('./index.ts')

  it('is not the window module, and not on ready-to-show', () => {
    // `window.once('ready-to-show', () => window.show())` is what put her on
    // screen at 980x560 and let the clamp move her. The companion is created
    // and left hidden; `bringForward` still shows the OTHER window, which is
    // ordinary and fits on a display.
    const companion = /export function createCompanionWindow[\s\S]*?\n\}/.exec(window)?.[0] ?? ''
    expect(companion, 'the companion factory is still findable').not.toBe('')
    expect(companion).toContain('show: false')
    expect(companion).not.toMatch(/window\.show\(\)/)
    expect(companion).not.toMatch(/ready-to-show/)
  })

  it('is the first fit, once the window is the size it will be', () => {
    // After `setBounds`, never before it: the whole point is that the size and
    // the position are already right when the clamp gets its one chance.
    const fit = /ipcMain\.on\('companion:fit'[\s\S]*?\n\}\)/.exec(index)?.[0] ?? ''
    expect(fit, 'main still answers companion:fit').not.toBe('')
    const bounds = fit.indexOf('setBounds')
    const show = fit.indexOf('showHerOnce')
    expect(bounds).toBeGreaterThan(-1)
    expect(show).toBeGreaterThan(bounds)
  })

  it('has a backstop, because the fit is now the only thing that shows her', () => {
    // A renderer that never boots would otherwise be an app running with
    // nothing on screen, indistinguishable from one that launched fine.
    expect(index).toContain('SHOW_ANYWAY_MS')
    expect(index).toMatch(/setTimeout\([\s\S]{0,400}?showHerOnce[\s\S]{0,200}?SHOW_ANYWAY_MS\)/)
  })

  it('does not undo "hidden" by relaunching', () => {
    // `resting.hidden` is a state somebody chose and it survives a quit. The
    // old unconditional show put her back on screen, which is a preference
    // undone by the one act that should preserve it.
    const fn = /function showHerOnce[\s\S]*?\n\}/.exec(index)?.[0] ?? ''
    expect(fn, 'showHerOnce is still findable').not.toBe('')
    expect(fn).toContain('resting.hidden')
    // Once, whatever calls it. Two shows would mean two chances at the clamp.
    expect(fn).toContain('if (shown) return')
  })
})
