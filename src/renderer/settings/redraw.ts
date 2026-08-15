/**
 * Should this snapshot redraw the window?
 *
 * Its own module because `settings/main.ts` cannot be imported by a test — it
 * touches `document` and the bridge at load — and this decision has already
 * been wrong twice in opposite directions, which is exactly the kind of thing
 * that wants a test rather than care.
 *
 * **Redrawing on everything** destroys the control under the pointer: the size
 * slider is live, so main broadcasts once per animation frame while somebody
 * drags, and a rebuild mid-drag drops the thumb they are holding.
 *
 * **Redrawing only when the persona changed** — the fix for that — was wrong
 * in the other direction, and worse, because it failed silently. Auth,
 * shortcuts and her theme all live OUTSIDE the persona. Storing an API key
 * wrote the key, broadcast the new state, and changed nothing on screen;
 * removing one deleted the key and left the window still showing it stored,
 * with the Remove button still enabled. The feature looked broken while
 * working correctly, which is the most expensive kind of bug to be told about.
 *
 * So: everything except the one field that changes at frame rate.
 */

import type { SettingsSnapshot } from '@shared/ipc'

/**
 * The comparable part of a snapshot.
 *
 * `sizePercent` is excluded because it is the live-dragged value and the only
 * reason this function exists. Every other field is included by construction —
 * a rest spread rather than a list of fields to keep in step, so a field added
 * to the snapshot next year is compared without anybody remembering to add it.
 */
export function signatureOf(snapshot: SettingsSnapshot): string {
  const { sizePercent: _live, ...rest } = snapshot
  // Keys SORTED, at every depth. `JSON.stringify` follows insertion order, so
  // two snapshots carrying identical values would serialise differently if main
  // ever built one along a second code path -- and the window would rebuild
  // itself, mid-interaction, over a difference that does not exist.
  return JSON.stringify(rest, (_key, value: unknown) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return value
    const record = value as Record<string, unknown>
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, record[key]]),
    )
  })
}

/**
 * The new signature, or null when nothing worth redrawing changed.
 *
 * One serialisation, not two. This was a boolean `shouldRedraw`, which computed
 * the signature to compare it and threw it away -- and the only caller then
 * recomputed the identical string to store it. That is twice through
 * `JSON.stringify` over the whole snapshot, on the path that runs once per
 * animation frame while the size slider is dragged.
 */
export function nextSignature(previous: string | null, next: SettingsSnapshot): string | null {
  const signature = signatureOf(next)
  return signature === previous ? null : signature
}
