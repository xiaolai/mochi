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
