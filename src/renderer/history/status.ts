/**
 * The line that tells somebody what just happened, and clears itself.
 *
 * Owns its own timer. Silence after a write reads as the write not landing, so
 * every path that changes something says so -- and every one of them would
 * otherwise need to remember to cancel the previous message's timer.
 */
import { saidEl, saidShutEl, saidWhatEl } from './elements'
import { said, type Write } from '../rules/said'
/**
 * Say what happened. Silence after a write reads as the write not landing.
 *
 * Its own strip on its own opaque surface, rather than a button's label — the
 * handoff's structural rule, and it stops a character rename reporting itself
 * inside a control marked "Export…".
 *
 * ## IT STAYS, and this reverses a decision
 *
 * It timed out after ten seconds, on the argument that "a message about a
 * character you have since switched away from is worse than no message". That
 * argument is real and it is outweighed.
 *
 * A live region announces when its content changes. A screen reader user is
 * still moving through the page when that happens, and by the time they reach
 * the bar the one sentence saying what their change did has been replaced by
 * nothing — so the timeout costs exactly the people who most need the line, and
 * saves everybody else a strip of chrome.
 *
 * The stale-message objection is answered rather than dismissed: a receipt is
 * replaced by the next change, and the dismiss button is still here. What is
 * left on screen is the last thing that happened, which is stale-looking and
 * TRUE — where an empty bar after a write is neither.
 *
 * ## `hidden`, not empty
 *
 * The strip used to hide by way of `#said:empty`, which stopped being true the
 * moment it held a dismiss button. `[hidden]` is a state the renderer sets, and
 * `tokens.css` makes it beat any `display` an author writes.
 *
 * Shown BEFORE the text is set, deliberately: a live region that is not rendered
 * when its content changes is not announced, so setting the words first and
 * revealing after is a message a screen reader never hears.
 */
export function hush(): void {
  saidEl.hidden = true
  saidShutEl.hidden = true
  saidWhatEl.textContent = ''
  saidWhatEl.title = ''
}

export function say(text: string, bad = false): void {
  saidEl.classList.toggle('bad', bad)
  /*
    THE WAY OUT, revealed with the line it dismisses.

    The button ships `hidden` and nothing ever unhid it. That was survivable
    while the line timed out after ten seconds — the timer was the way out, and
    the button was decoration nobody could reach. Making the receipt permanent
    turned it into the only way out, and it was still hidden.

    Which is the shape of the whole change: removing the timer moved the weight
    onto a control that had never had to work.
  */
  saidShutEl.hidden = false
  saidEl.hidden = false
  saidWhatEl.textContent = text
  // The drawer is one line tall, so a long message is ellipsed — and a message
  // that is only half available is a message somebody has to guess at. The
  // tooltip carries the rest; the live region still announces the whole thing,
  // because that reads `textContent` rather than what is painted.
  saidWhatEl.title = text
}

/**
 * The receipt for a completed write, if it earns one.
 *
 * `rules/said.ts` decides whether it does — most writes are their own receipt,
 * because the control moved and saying so underneath repeats what is already on
 * screen. What earns a line is a write whose EFFECT is somewhere else: a voice
 * that lands at a wake that has not happened, a note removed from a file.
 *
 * Silence here is a decision, not a gap. A bar that fills with restatements of
 * controls that already moved is a bar people stop reading, and then the one
 * line that mattered goes unread with the rest.
 */
export function receipt(write: Write): string | null {
  return said(write)
}

saidShutEl.addEventListener('click', hush)
