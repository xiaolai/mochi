// @vitest-environment happy-dom
/**
 * Where the reader was, across a repaint that destroys everything.
 *
 * `paint` rebuilds the whole form, so focus, caret and scroll all die with it.
 * Two of the three were being kept; losing the third read as the window
 * reloading itself and jumping to the top whenever anything changed.
 */

import { describe, expect, it, beforeEach } from 'vitest'
import { preservingFocus } from './focus'

/** Build a shell the way `paint` does: fresh nodes, same keys and ids. */
function shell(): HTMLElement {
  const pane = document.createElement('div')
  pane.setAttribute('data-scroll-key', 'pane')
  const field = document.createElement('input')
  field.id = 'greeting'
  field.value = 'Hi, I am back'
  pane.append(field)
  return pane
}

/** happy-dom does not lay anything out, so `scrollTop` needs a real backing. */
function scrollable(node: HTMLElement): void {
  let value = 0
  Object.defineProperty(node, 'scrollTop', {
    get: () => value,
    set: (next: number) => {
      value = next
    },
    configurable: true,
  })
}

beforeEach(() => {
  document.body.replaceChildren(shell())
  scrollable(document.querySelector('[data-scroll-key="pane"]')!)
})

describe('a repaint puts the reader back', () => {
  function repaint(): void {
    const next = shell()
    document.body.replaceChildren(next)
    scrollable(next)
  }

  it('keeps the scroll position of a keyed container', () => {
    const pane = document.querySelector<HTMLElement>('[data-scroll-key="pane"]')!
    pane.scrollTop = 420

    preservingFocus(repaint)

    const after = document.querySelector<HTMLElement>('[data-scroll-key="pane"]')!
    expect(after.scrollTop).toBe(420)
  })

  it('keeps the caret as well as the position', () => {
    const pane = document.querySelector<HTMLElement>('[data-scroll-key="pane"]')!
    pane.scrollTop = 200
    const field = document.getElementById('greeting') as HTMLInputElement
    field.focus()
    field.setSelectionRange(3, 3)

    preservingFocus(repaint)

    const after = document.getElementById('greeting') as HTMLInputElement
    expect(document.activeElement).toBe(after)
    expect(after.selectionStart).toBe(3)
    expect(document.querySelector<HTMLElement>('[data-scroll-key="pane"]')!.scrollTop).toBe(200)
  })

  it('leaves a container that did not exist before at rest', () => {
    // Writing 0 for every keyed node would be a jump to the top wearing the
    // costume of a restore -- indistinguishable from the bug being fixed.
    preservingFocus(() => {
      const next = shell()
      const extra = document.createElement('div')
      extra.setAttribute('data-scroll-key', 'nav')
      scrollable(extra)
      extra.scrollTop = 99
      document.body.replaceChildren(next, extra)
      scrollable(next)
    })
    const nav = document.querySelector<HTMLElement>('[data-scroll-key="nav"]')!
    expect(nav.scrollTop).toBe(99)
  })
})
