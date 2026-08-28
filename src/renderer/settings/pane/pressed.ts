import { acceleratorFrom, acceleratorProblem } from '@shared/accelerator'

/**
 * What a keystroke during a shortcut capture MEANS.
 *
 * ## Why this is its own function
 *
 * It was five branches inside a 110-line DOM builder, tangled with
 * `combo.textContent`, `handlers.say` and a `listening` flag — so the decision
 * could only be exercised by building the whole row, and the suite runs in node
 * with no DOM.
 *
 * That is not a hypothetical cost. `Command+Escape` was unreachable through the
 * only control that can set a shortcut, because every event whose `key` is
 * `Escape` was treated as cancel — and `Escape` is in the accepted key set, so
 * the grammar allowed a combination the control could not express. Nothing
 * could have caught it: there was no seam to test.
 *
 * The DOM work stays where it was. What moved is the part with the rules in it.
 */
export type Pressed =
  /** A bare Escape. Leave the capture, changed nothing. */
  | { readonly kind: 'leave' }
  /**
   * A modifier on its own, or a key outside the accepted set.
   *
   * NOT an end to the capture: somebody on the way to `Control+Shift+K` holds
   * two modifiers first, and a control that gave up on the first would record
   * `Control`.
   */
  | { readonly kind: 'ignore' }
  /**
   * A real combination this grammar refuses — no modifier, usually.
   *
   * Still listening. Somebody most of the way to a good answer should not have
   * to start again, so the row shows what they pressed and says why.
   */
  | { readonly kind: 'refuse'; readonly pressed: string; readonly why: string }
  /** The combination it already has. Leave, and save nothing. */
  | { readonly kind: 'unchanged'; readonly pressed: string }
  | { readonly kind: 'save'; readonly pressed: string }

/** What a keyboard event carries that this decision reads. */
export interface Keystroke {
  readonly key: string
  readonly code: string
  readonly ctrlKey: boolean
  readonly altKey: boolean
  readonly shiftKey: boolean
  readonly metaKey: boolean
}

export function whatWasPressed(event: Keystroke, current: string): Pressed {
  /*
    A BARE Escape leaves; Escape with a modifier is a combination.

    `Escape` is in the accepted key set, so `Command+Escape` is a shortcut
    somebody is entitled to choose. Treating every `key === 'Escape'` as cancel
    made every combination containing it unreachable through the only control
    that can set one — a grammar that accepts a value and a control that cannot
    express it.
  */
  const bare =
    event.key === 'Escape' && !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey
  if (bare) return { kind: 'leave' }

  const pressed = acceleratorFrom(event)
  if (pressed === null) return { kind: 'ignore' }

  const why = acceleratorProblem(pressed)
  if (why !== null) return { kind: 'refuse', pressed, why }

  /*
    Unchanged is not a change to save.

    It would round-trip cleanly — main releases the combination and takes it
    straight back — and it would put a "Saved." over a key nobody moved.
  */
  if (pressed === current) return { kind: 'unchanged', pressed }
  return { kind: 'save', pressed }
}
