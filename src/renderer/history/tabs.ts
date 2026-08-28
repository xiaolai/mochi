/**
 * The three places this window can be, and moving between them.
 *
 * The list lives here rather than in `main.ts` because the strip is the only
 * thing that reads it, and `alongTabs` has to be importable from a test — see
 * its own note.
 */
export type Place = 'cast' | 'archive' | 'machine'

export const PLACES: readonly { readonly id: Place; readonly label: string }[] = [
  { id: 'cast', label: 'Cast' },
  { id: 'archive', label: 'Archive' },
  { id: 'machine', label: 'Machine' },
]

/**
 * Which tab a key moves to, or null when it moves to none.
 *
 * ITS OWN MODULE, not a function in `main.ts`. That file touches `document`
 * and `HTMLCanvasElement` at module scope, so importing it from a test fails
 * before any assertion runs — the suite is node with no DOM emulator, and the
 * config says why: "decisions worth testing are written as pure functions with
 * their dependencies injected." The wrapping is the half people get wrong and
 * it needs no DOM to check.
 *
 * Home and End are part of the pattern rather than extras: a strip somebody
 * arrows through wants a way back to the start without counting.
 */
export function alongTabs(key: string, from: Place): Place | null {
  const order = PLACES.map((one) => one.id)
  const at = order.indexOf(from)
  if (at === -1) return null
  if (key === 'Home') return order[0] ?? null
  if (key === 'End') return order[order.length - 1] ?? null
  const step = key === 'ArrowRight' ? 1 : key === 'ArrowLeft' ? -1 : 0
  if (step === 0) return null
  // Wraps, which is what the pattern specifies and what somebody arrowing off
  // the end expects rather than a dead key.
  return order[(at + step + order.length) % order.length] ?? null
}
