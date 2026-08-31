import { describe, expect, it } from 'vitest'
import { pickUpdater } from './update'

/**
 * The one thing in `update.ts` that can be tested without an Electron app, and
 * it is the thing that was wrong.
 *
 * `electron-updater` is CommonJS; the source says `await import(...)`; Node's
 * interop decides what the namespace holds. It finds named exports by static
 * analysis, and `autoUpdater` is installed with `Object.defineProperty` — so it
 * is not on the namespace, only on `.default`. Destructuring it gave
 * `undefined`, and the next line assigned a property to it:
 *
 *     TypeError: Cannot set properties of undefined (setting 'autoDownload')
 *
 * Which shipped, because nothing here presses that button: the pane offers it
 * only in a packaged build, and the rendered gate refuses to press anything that
 * opens a network connection.
 */
describe('finding autoUpdater on whatever the import returns', () => {
  const real = { autoDownload: true }

  it('takes the named export when there is one', () => {
    expect(pickUpdater({ autoUpdater: real })).toBe(real)
  })

  it('falls back to `default`, which is the shape that actually ships', () => {
    expect(pickUpdater({ default: { autoUpdater: real } })).toBe(real)
  })

  it('prefers the named export, so a later release that adds one is not a break', () => {
    const other = { autoDownload: false }
    expect(pickUpdater({ autoUpdater: real, default: { autoUpdater: other } })).toBe(real)
  })

  it('throws rather than returning undefined for a shape with neither', () => {
    // The failure this replaces was a TypeError three lines later, naming a
    // property rather than the module that did not export what was expected.
    expect(() => pickUpdater({ AppUpdater: class {} })).toThrow(/no autoUpdater/)
    expect(() => pickUpdater({})).toThrow(/no autoUpdater/)
    expect(() => pickUpdater(null)).toThrow()
  })
})

describe('the module this actually imports', () => {
  it('really does hide autoUpdater behind `default`', async () => {
    /*
      Against the installed package, not a fixture — the whole bug was an
      assumption about a real module's shape, and a test that only exercised
      hand-written objects would have passed just as happily before the fix.

      The descriptor is read rather than the property, because reading it
      CONSTRUCTS the updater and that needs an Electron `app`.
    */
    const module = (await import('electron-updater')) as unknown as Record<string, unknown>
    const named = Object.getOwnPropertyDescriptor(module, 'autoUpdater')
    const fallback = Object.getOwnPropertyDescriptor(module['default'], 'autoUpdater')
    expect(named === undefined || fallback !== undefined).toBe(true)
    expect(fallback).toBeDefined()
  })
})
