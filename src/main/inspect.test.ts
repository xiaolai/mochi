import { describe, expect, it, vi } from 'vitest'
import { inDevelopment, inspectMenuTemplate } from './inspect'

describe('whether this is a development run', () => {
  it('is the dev server URL, and nothing else', () => {
    expect(inDevelopment({ ELECTRON_RENDERER_URL: 'http://localhost:5173' })).toBe(true)
    expect(inDevelopment({})).toBe(false)
  })

  it('treats an EMPTY value as development, not as a build', () => {
    /*
      The same check `window.ts` makes, for the same reason. An empty
      `ELECTRON_RENDERER_URL` is a broken dev run; reading it as a packaged one
      would silently take the menu away exactly when somebody is debugging why
      the dev server did not come up.
    */
    expect(inDevelopment({ ELECTRON_RENDERER_URL: '' })).toBe(true)
  })

  it('is not fooled by a similarly named variable', () => {
    expect(inDevelopment({ ELECTRON_RENDERER_URL_OLD: 'http://localhost:5173' })).toBe(false)
  })
})

describe('the menu, as data', () => {
  it('is one item, and it inspects where the click was', () => {
    const inspect = vi.fn()
    const template = inspectMenuTemplate({ x: 412, y: 98 }, inspect)
    expect(template.map((one) => one.label)).toEqual(['Inspect Element'])
    // The point comes off the `context-menu` params, which are already in the
    // coordinate space `inspectElement` wants — no conversion, and none hidden.
    // `click` takes the menu item, the window and the event; none of them is
    // read here, and the signature admits `undefined` for all three.
    template[0]?.click?.(undefined!, undefined, undefined!)
    expect(inspect).toHaveBeenCalledWith(412, 98)
  })

  it('carries the point it was built with, not the one at click time', () => {
    // Two menus for two different clicks must not share a point. They would if
    // the template read a mutable "last event" instead of closing over one.
    const first = vi.fn()
    const second = vi.fn()
    const a = inspectMenuTemplate({ x: 1, y: 2 }, first)
    const b = inspectMenuTemplate({ x: 300, y: 400 }, second)
    b[0]?.click?.(undefined!, undefined, undefined!)
    a[0]?.click?.(undefined!, undefined, undefined!)
    expect(second).toHaveBeenCalledWith(300, 400)
    expect(first).toHaveBeenCalledWith(1, 2)
  })
})
