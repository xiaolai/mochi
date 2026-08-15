/**
 * Keeping where you WERE across a repaint: the caret, and the scroll.
 *
 * `paint` calls `replaceChildren` on the whole form, so everything focused or
 * scrolled is destroyed and rebuilt. Without this, a broadcast arriving while
 * somebody is typing takes the cursor out of the field mid-word -- and
 * changing anything low on a long pane threw the reader back to the top, which
 * reads as the window having reloaded itself.
 *
 * The caret came first and the scroll was left out, which is easy to do and
 * hard to notice: the two are the same fact -- where the reader was -- and only
 * one of them was being kept.
 *
 * Exposed as ONE function that wraps the repaint rather than as a capture and
 * a restore. They are always used as a pair, and a pair is a thing you can do
 * half of: restoring without having captured is a no-op nobody notices, and
 * capturing without restoring loses the caret exactly as if neither existed.
 */

interface Held {
  readonly id: string
  readonly start: number | null
}

/**
 * Which containers keep their scroll position.
 *
 * Declared by the LAYOUT, as `data-scroll-key`, rather than by a list of
 * selectors here. This module knows about focus and scroll; it has no business
 * knowing that the settings window happens to be a nav beside a pane, and a
 * selector list here would go stale the first time either is renamed -- which
 * would restore nothing, silently, exactly as before this existed.
 */
const SCROLLED = '[data-scroll-key]'

/** Do something that rebuilds the DOM, and put the reader back afterwards. */
export function preservingFocus(rebuild: () => void): void {
  const held = capture()
  const scrolls = captureScroll()
  rebuild()
  // Focus BEFORE scroll, and without letting it scroll: `focus()` pulls its
  // element into view, so restoring the caret last would drag the pane to
  // wherever the caret is and undo the position just put back.
  restore(held)
  restoreScroll(scrolls)
}

function captureScroll(): ReadonlyMap<string, number> {
  const held = new Map<string, number>()
  for (const node of document.querySelectorAll(SCROLLED)) {
    const key = node.getAttribute('data-scroll-key')
    if (key !== null) held.set(key, node.scrollTop)
  }
  return held
}

function restoreScroll(held: ReadonlyMap<string, number>): void {
  for (const node of document.querySelectorAll(SCROLLED)) {
    const key = node.getAttribute('data-scroll-key')
    const was = key === null ? undefined : held.get(key)
    // Assigned only when there is something to assign. Writing 0 for a
    // container that did not exist before would be a scroll to the top dressed
    // up as a restore.
    if (was !== undefined) node.scrollTop = was
  }
}

/** Which field had the caret, and where in it. Null when nothing eligible had it. */
function capture(): Held | null {
  const active = document.activeElement
  // An id is what makes a control findable after the rebuild. Everything the
  // form builds through `field()` has one.
  if (!(active instanceof HTMLElement) || active.id === '') return null
  const start =
    active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement
      ? active.selectionStart
      : null
  return { id: active.id, start }
}

function restore(held: Held | null): void {
  if (held === null) return
  const replacement = document.getElementById(held.id)
  if (!(replacement instanceof HTMLElement)) return
  // `preventScroll`, because the scroll position is restored right after this
  // and the default behaviour would fight it.
  replacement.focus({ preventScroll: true })
  // The caret too, not just the focus. Landing back in the field with the
  // cursor at the end is its own small betrayal of somebody editing mid-word.
  if (
    held.start !== null &&
    (replacement instanceof HTMLInputElement || replacement instanceof HTMLTextAreaElement)
  ) {
    replacement.setSelectionRange(held.start, held.start)
  }
}
