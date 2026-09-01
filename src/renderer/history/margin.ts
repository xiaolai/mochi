/**
 * The margin: everything to the right of the rule.
 *
 * "Everything to the right of this rule is apparatus — where a thing is stored,
 * when it was last used, whose recommendation it is. Never the thing itself."
 *
 * That sentence is the whole contract, and it is the one worth checking a new
 * block against: if somebody would come to this window to READ it, it belongs in
 * the reading column. A margin that starts holding content is a second column of
 * the same document, and this window has been that before — the Cast tab drew a
 * character list, her sheet and a prompt panel side by side, and none of the
 * three was obviously the subject.
 *
 * ## Rules, not boxes
 *
 * Blocks are separated by a hairline rather than wrapped in one. "Rules do the
 * grouping. Boxes are reserved for the two things that need one: a control and
 * a warning."
 */
import { element } from '../element'

/** A hairline between two blocks. */
function marginRule(): HTMLElement {
  return element('div', 'margin-rule')
}

/**
 * One block: a label, and what it has to say.
 *
 * The label is Sora in small caps and the body is prose, which is the delivery's
 * split between what you operate and what you read applied one level down — the
 * label names the apparatus, the sentence is still a sentence.
 */
export function marginBlock(head: string, ...body: readonly (string | Node)[]): HTMLElement {
  const block = element('div', 'margin-block')
  block.append(element('p', 'margin-head', head))
  for (const one of body) {
    block.append(typeof one === 'string' ? element('p', 'note', one) : one)
  }
  return block
}

/**
 * Machine-shaped lines: times, counts, paths.
 *
 * Mono, because "if it is machine-shaped, it is set in mono" — and one line per
 * fact rather than a sentence joining them, because these are read by scanning
 * for one of them rather than by reading the set.
 */
export function marginFacts(...lines: readonly string[]): HTMLElement {
  const facts = element('div', 'margin-facts')
  for (const line of lines) facts.append(element('div', undefined, line))
  return facts
}

/**
 * Every block, with a hairline between each pair and none at the ends.
 *
 * Here rather than at each caller because a trailing rule under the last block
 * is the commonest way this pattern goes wrong, and it looks like a section that
 * failed to render rather than like a mistake in the separator.
 */
export function marginColumn(...blocks: readonly HTMLElement[]): readonly HTMLElement[] {
  const out: HTMLElement[] = []
  for (const block of blocks) {
    if (out.length > 0) out.push(marginRule())
    out.push(block)
  }
  return out
}
