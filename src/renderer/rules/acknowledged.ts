/**
 * What an optimistic control does when the value underneath it moves.
 *
 * ## Contract C1, and the half of it that was missing
 *
 * A control shows what it ASKED FOR, not what it was drawn with. The value it
 * was built from is captured when the pane is drawn and never moves, because
 * the redraw comes from an asynchronous write and a re-read — so until that
 * lands every control still believes the original answer. A second click on the
 * option somebody had just selected dispatched a duplicate write, and two quick
 * clicks on different options dispatched two writes from the same stale
 * snapshot.
 *
 * That is C1, and it is half the question. A control that tracks what it asked
 * for still has to decide what to do when an ANSWER arrives, and there are
 * three answers, not two:
 *
 *   the value we asked for came back    our write landed — settle, show it
 *   something else came back, no ask    somebody else changed it — adopt it
 *   something else came back, ask out   an OLDER value — ignore it
 *
 * The third is the one that gets missed. Click `he`, click `it`, and the
 * acknowledgement of `he` arrives first: reset on any change and the control
 * reverts to `he` while the write for `it` is still in flight.
 *
 * ## And the case that has no value to compare
 *
 * A REFUSED write comes back as the value that was already stored — so "did
 * what I asked for come back" is answered *no*, for ever, and a control waiting
 * for agreement waits for ever. `settled()` exists beside `arrived()` for that:
 * the ask is over when the WRITE is, whatever it settled as.
 *
 * `settled` takes the token `ask` gave, because an OLDER write finishing says
 * nothing about a newer one still out — without it, the first of two quick
 * clicks completing puts main's pre-write value back and wipes the second
 * choice.
 *
 * ## Why one module
 *
 * Three controls each grew their own version of this and each got a different
 * part of it wrong. It is one rule.
 */
export interface Acknowledged<Value> {
  /** What the control should be showing. */
  showing(): Value
  /** Whether a write of ours is still out. */
  waiting(): boolean
  /**
   * The person chose `value`.
   *
   * Answers a REQUEST token to hand back to `settled`, or null when this is not
   * a change worth writing — which is C1's rule: two clicks on different
   * options are two writes, two on the same one are one.
   */
  ask(value: Value): number | null
  /** A new stored value arrived. Answers what the control should show now. */
  arrived(stored: Value): Value
  /**
   * OUR write finished — accepted, refused or thrown, it does not matter which.
   *
   * This is what releases a control after a refusal, where `arrived` never can.
   * A settlement for anything but the newest request is IGNORED.
   */
  settled(request: number, stored: Value): Value
}

export function acknowledged<Value>(
  drawn: Value,
  /**
   * How two values are compared.
   *
   * A parameter because the value may be a list rather than a scalar, and
   * identity is the wrong question for one — a set that crosses a process
   * boundary is a new array every read.
   */
  same: (a: Value, b: Value) => boolean = Object.is,
): Acknowledged<Value> {
  let showing = drawn
  let waiting = false
  let asks = 0
  return {
    showing: () => showing,
    waiting: () => waiting,
    ask: (value) => {
      // Already what we are showing: a write here would redraw the pane under
      // the pointer for no change.
      if (same(value, showing)) return null
      showing = value
      waiting = true
      asks += 1
      return asks
    },
    arrived: (stored) => {
      if (same(stored, showing)) {
        // Our own write, landed. Nothing moves on screen.
        waiting = false
        return showing
      }
      // Somebody else's change — the tray, another window — but only if we are
      // not still waiting. While we are, this is the older value.
      if (!waiting) showing = stored
      return showing
    },
    settled: (request, stored) => {
      // An older request finishing says nothing about the newer one still out.
      if (request !== asks) return showing
      waiting = false
      // Whatever is stored now is the truth. On a refusal that is the value we
      // tried to replace, and showing it is how the control stops lying.
      showing = stored
      return showing
    },
  }
}
