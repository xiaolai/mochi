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
  sizes: { readonly sent: number; readonly tools: number; readonly draft: number },
): string {
  if (showing === 'write') return `${String(sizes.draft)} chars`
  if (showing === 'tools') return `${String(sizes.tools)} chars`
  return `${String(sizes.sent)} sent`
}
