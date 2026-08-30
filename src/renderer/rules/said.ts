/**
 * The receipt: what just happened, said once and left there.
 *
 * ## Permanent, not fading — and this was a decision
 *
 * The delivery draws the line on three screens and does not settle whether it
 * stays. It stays. A fading receipt is gone before a screen-reader user reaches
 * it: the region announces, the reader is still moving through the page, and by
 * the time they arrive the one sentence saying what their change did has been
 * replaced by nothing. A line that persists until the next change costs a strip
 * of chrome; a line that fades costs the people who most need it.
 *
 * The consequence is honest and worth stating: the bar holds the last thing you
 * did, including from twenty minutes ago. That is a stale-looking sentence, and
 * it is better than an absent one, because it is TRUE — it is the last thing
 * that happened.
 *
 * ## What it is not
 *
 * Not an error channel. Nothing that went wrong comes through here — that is
 * the problems drawer, which is a different surface with a different lifetime
 * and a count. A receipt says a write LANDED, so a failed write produces no
 * receipt at all rather than a sentence with a "not" in it.
 *
 * ## Why so many writes produce nothing
 *
 * Most of them are their own receipt. Turning a switch off moves the switch;
 * saying "Withheld — turned off" underneath repeats what the control already
 * shows, and a bar that fills with sentences nobody needs is a bar people stop
 * reading. What earns a line is a write whose EFFECT is somewhere else: a voice
 * that lands on her next wake, a prompt sent at a wake that has not happened, a
 * note removed from a file. That test — "is the consequence visible where the
 * control is?" — is what `WORTH_SAYING` encodes.
 */

/** A write that finished, named by what it changed. */
export interface Write {
  readonly kind: string
  /** The value it settled on, when the sentence needs to name it. */
  readonly value?: string
  /** Whether it landed. A refusal says nothing here. */
  readonly ok?: boolean
}

/**
 * The writes whose consequence is somewhere the control is not.
 *
 * A table rather than a switch with a default, so a new write kind says nothing
 * until somebody decides it should — the safe direction. A default of "say
 * something" fills the bar with restatements of controls that already moved.
 */
const WORTH_SAYING: Readonly<Record<string, (value: string) => string>> = {
  // Lands at a wake that has not happened yet, so nothing on screen shows it.
  voice: (value) => `Saved — ${value} lands on her next wake.`,
  prompt: () => 'Saved. It is sent at her next wake.',
  instruction: () => 'Saved. It is sent at her next wake.',
  // The file changed and the pane did not: her note is a document, and removing
  // a line from it leaves the rest looking exactly as it did.
  'note-undone': (value) => `Undone — ${value} is gone.`,
  'note-cleared': () => 'Erased. Everything she had kept about you is gone.',
  // A rename moves a name in three places at once, and the rail is the only one
  // on screen — so the receipt is what says the other two followed.
  name: (value) => `Renamed to ${value}.`,
  // Takes effect at once and she is TOLD, which is the half nothing shows.
  grant: (value) => `${value} — she is told at once, and will say she can no longer do it.`,
  expression: (value) => `${value} — she will not be told she has it.`,
}

/**
 * The sentence for a completed write, or nothing.
 *
 * `null` rather than an empty string, so a caller cannot put a blank line in the
 * bar by forgetting to check. An empty receipt and no receipt are different
 * states and only one of them is a state.
 */
export function said(write: Write): string | null {
  // A refusal is not a receipt. It goes to the problems drawer, which counts.
  if (write.ok === false) return null
  const sentence = WORTH_SAYING[write.kind]
  if (sentence === undefined) return null
  return sentence(write.value ?? '')
}
