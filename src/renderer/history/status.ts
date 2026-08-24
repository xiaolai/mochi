/**
 * The line that tells somebody what just happened, and clears itself.
 *
 * Owns its own timer. Silence after a write reads as the write not landing, so
 * every path that changes something says so -- and every one of them would
 * otherwise need to remember to cancel the previous message's timer.
 */
import { saidEl, saidShutEl, saidWhatEl } from './elements'
/**
 * Say what happened. Silence after a write reads as the write not landing.
 *
 * Its own strip on its own opaque surface, rather than a button's label — the
 * handoff's structural rule, and it stops a character rename reporting itself
 * inside a control marked "Export…".
 *
 * ## It goes away
 *
 * It used to stay until the next write replaced it, so the last thing you did
 * sat over the window for the rest of the session — and a message about a
 * character you have since switched away from is worse than no message.
 *
 * Ten seconds, and the same ten for a failure. A failure that vanished with
 * nothing behind it would be a different argument, but everything reported here
 * as bad is ALSO in the problems strip, which does not time out.
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
const SAID_FOR_MS = 10_000

let saidTimer: number | null = null

export function hush(): void {
  if (saidTimer !== null) clearTimeout(saidTimer)
  saidTimer = null
  saidEl.hidden = true
  saidWhatEl.textContent = ''
  saidWhatEl.title = ''
}

export function say(text: string, bad = false): void {
  if (saidTimer !== null) clearTimeout(saidTimer)
  saidEl.classList.toggle('bad', bad)
  saidEl.hidden = false
  saidWhatEl.textContent = text
  // The drawer is one line tall, so a long message is ellipsed — and a message
  // that is only half available is a message somebody has to guess at. The
  // tooltip carries the rest; the live region still announces the whole thing,
  // because that reads `textContent` rather than what is painted.
  saidWhatEl.title = text
  saidTimer = window.setTimeout(hush, SAID_FOR_MS)
}

saidShutEl.addEventListener('click', hush)
