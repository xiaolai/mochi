/**
 * What the counter beside the wake tabs says.
 *
 * Pure, and its own function because it was three branches inside a 138-line
 * `draw` written out at three call sites — and it is the one part of that panel
 * with a rule in it rather than a wiring.
 *
 * The count names the PANE'S OWN quantity rather than one number for all three.
 * "sent" beside a tool list would be counting the wrong thing, and a character
 * count beside the assembled prompt would be counting a thing nobody is
 * editing.
 */
export function wakeCount(
  showing: 'sent' | 'tools' | 'write',
  sizes: {
    readonly sent: number
    readonly tools: number
    readonly draft: number
    /** What main will refuse past. See `ShelfView['prompt'].limit`. */
    readonly limit: number
  },
): string {
  /*
    THE CEILING, on the one pane that can hit it.

    "318 chars" is a number with nothing to compare it against, so the limit was
    discovered by writing past it and having the save refused — after the
    writing. A8 draws "318 / 400 characters" and A2b draws her notes the same
    way; a box that is capped says so while there is still room.

    Only on `write`. Sent and Tools are assembled, not typed, and nothing a
    person does here can shorten them — a limit beside a number nobody controls
    is a threat rather than a guide.
  */
  if (showing === 'write') {
    return `${String(sizes.draft)} / ${String(sizes.limit)} characters`
  }
  if (showing === 'tools') return `${String(sizes.tools)} chars`
  return `${String(sizes.sent)} sent`
}
