import { MOCHI, type FaceSpec } from '@shared/avatar-spec'
import { accentVariables, contrastFailures } from './accent'

/**
 * Put her colour on the document.
 *
 * `tokens.css` ships fallbacks for all five of her roles so a window that
 * paints before a persona resolves is already the right colour rather than
 * briefly grey. This replaces them with the worn face's, which is the design's
 * second semantic rule: *the accent is her*, derived from `colBody`, with no
 * second place to set an app colour.
 *
 * ## An unreadable hue is REFUSED, not applied
 *
 * Her colour becomes the interface's colour, so shipping a persona is shipping
 * a UI theme — `accent.ts` says exactly that. The eight built-in themes are
 * swept by a test because their hues are known in advance; a hue somebody else
 * chose has never been seen by anything. So it is checked here, at the only
 * moment a stranger's hue exists, and a palette that would put text below AA on
 * its own surface falls back to the built-in rather than rendering a window
 * nobody can read.
 *
 * Returns what failed, so the caller can SAY so. Falling back silently would
 * leave somebody looking at a green window wondering why the character they
 * chose had no effect — the same class of failure as an avatar that quietly did
 * not load.
 */
export function applyAccent(root: HTMLElement, face: FaceSpec): readonly string[] {
  const failures = contrastFailures(face)
  // The built-in is the fallback, and it is the one palette this repository
  // guarantees: every pairing it produces is swept by `accent.test.ts`.
  const readable = failures.length === 0 ? face : MOCHI
  for (const [name, value] of Object.entries(accentVariables(readable))) {
    root.style.setProperty(name, value)
  }
  return failures
}
