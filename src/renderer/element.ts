/**
 * Make an element, name it, and give it its words — in one call.
 *
 * ## Why this is its own module
 *
 * It was written twice, character for character, in `settings/panes.ts` and
 * `history/shelf.ts`. Two copies of the same helper is one defect wearing two
 * hats: the next person to fix a bug in one of them fixes it in one of them.
 *
 * The third surface is the argument, though. `history/main.ts` never had this
 * helper and paid for the absence — forty-one bare `createElement` calls, each
 * followed by its own `className` and `textContent` assignment, which is the
 * same five lines this function is one line of. A helper that exists in two
 * places out of three is worse than one that exists nowhere, because the
 * inconsistency reads as intent.
 *
 * It lives in `renderer/` and not `shared/` deliberately: it touches
 * `document`, so only the renderer process can ever call it.
 */
/**
 * A checkbox with an id, its state, and what to do when somebody changes it.
 *
 * Five places built this by hand — the two switches on her sheet, the grant
 * rows, the shoulder chip, and every expression tile — and all five wrote the
 * same four lines: make an `input`, set `type`, set `id`, set `checked`, then
 * listen. `element()` above could not help, because none of that is a class
 * name or a line of text.
 *
 * The reason it is worth a second function rather than a fifth copy is the
 * reason this module exists at all, stated a few lines up: a helper that exists
 * in two places out of three is worse than one that exists nowhere, because the
 * inconsistency reads as intent.
 *
 * The id is REQUIRED, not optional. Every one of the five needed one, because a
 * checkbox without an id has no `label.htmlFor` to bind to and a label that is
 * not bound is a hit target that does not work and a screen reader that reads
 * the box unlabelled. Making it a parameter means it cannot be the thing
 * somebody forgets.
 *
 * The callback is handed the NEW state rather than reading it back off the
 * element, so a caller cannot accidentally close over a stale value.
 */
export function checkbox(
  id: string,
  checked: boolean,
  onChange: (on: boolean) => void,
): HTMLInputElement {
  const made = document.createElement('input')
  made.type = 'checkbox'
  made.id = id
  made.checked = checked
  made.addEventListener('change', () => {
    onChange(made.checked)
  })
  return made
}

export function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const made = document.createElement(tag)
  if (className !== undefined) made.className = className
  if (text !== undefined) made.textContent = text
  return made
}
