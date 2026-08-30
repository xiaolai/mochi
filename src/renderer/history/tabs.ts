/**
 * Where this window can be, and moving between those places from the keyboard.
 *
 * ## Two pages, not three tabs
 *
 * This window used to be three sibling tabs — Cast, Archive, Machine — in one
 * strip. The delivered design is two pages and a rail that is always present:
 *
 *   Her page      three numbered views under her name, I / II / III
 *   This machine  a page of its own, reached from the rail
 *
 * The split is not cosmetic. It answers a question the tabs could not: which of
 * these settings belong to the CHARACTER and which belong to the machine. "What
 * she may do" is per-character — her grants, her capability descriptions — and
 * it sat in the Machine tab beside the keyboard shortcuts, which are true
 * whoever is worn. It is view III of her page now, and the machine page says
 * "true whoever is worn" at the foot of the rail.
 *
 * See `dev-docs/design-system/STRUCTURE.md`, and Rule 6 of the delivery: "The
 * machine is not her. It gets its own page, its own mark, and none of her
 * colour."
 *
 * ## Why the list lives here
 *
 * `alongViews` has to be importable from a test, and `main.ts` touches
 * `document` and `HTMLCanvasElement` at module scope — importing it from a test
 * fails before any assertion runs, because the suite is node with no DOM
 * emulator. The wrapping is the half people get wrong and it needs no DOM.
 */
export type Place = 'cast' | 'archive' | 'permits' | 'machine'

/**
 * A view on her page.
 *
 * It carried a Roman numeral, on the reading that these are parts of one
 * document rather than three destinations. That reading is right and the
 * numerals were still an invention: nothing in the delivery draws them, and
 * `HerHead.dc.html` — the component every screen's header is built from — draws
 * the three views as one segmented pill with the words alone.
 */
export interface View {
  readonly id: Place
}

/**
 * The three views of her page, in reading order.
 *
 * NO LABELS HERE. Their wording is "Who she is", "What she has said", "What she
 * may do" — three sentences about her, and every sentence in this window takes
 * the worn character's pronoun. They live in `shelf-says.ts` as `ByPronoun`
 * tables and are read with `forPronoun`, which is the rule `SettingsView.pronoun`
 * describes and the failure it records: the value was validated, stored and
 * migrated for the life of the product while everything on screen still said
 * "her". `pronoun-copy.test.ts` is what holds it.
 *
 * That the labels are sentences at all is the point — a tab called Cast names
 * what the developer built; a view called "Who she is" names what the reader
 * came for.
 */
export const VIEWS: readonly View[] = [{ id: 'cast' }, { id: 'archive' }, { id: 'permits' }]

/** Every place, including the one that is not about her. */
export const PLACES: readonly { readonly id: Place }[] = [
  ...VIEWS.map((one) => ({ id: one.id })),
  { id: 'machine' },
]

/** Whether a place is one of her views, rather than the machine's page. */
export function isHers(place: Place): boolean {
  return VIEWS.some((one) => one.id === place)
}

/**
 * Which view a key moves to, or null when it moves to none.
 *
 * Only ever moves WITHIN her page. The machine is not a fourth view and arrowing
 * off the end of the sub-navigation must not land there: it is a different
 * document with a different subject, and the rail is how you reach it. Wrapping
 * into it would make the two pages read as one strip of four, which is exactly
 * the arrangement this design replaced.
 *
 * Home and End are part of the pattern rather than extras: somebody arrowing
 * through wants a way back to the start without counting.
 */
export function alongViews(key: string, from: Place): Place | null {
  const order = VIEWS.map((one) => one.id)
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

/**
 * Which rail item a key moves to, given how many characters are listed.
 *
 * The rail is a COLUMN, so it takes up and down rather than left and right, and
 * it is one list: the characters, then the machine under a rule. Arrowing from
 * the last character to the machine is right — they are the same list of things
 * this window can be showing — while arrowing between her VIEWS must not reach
 * it. The two navigations differ because one is a table of contents and the
 * other is a set of sections within one document.
 *
 * Answers an index into that combined list, or null.
 */
export function alongRail(key: string, from: number, characters: number): number | null {
  const length = characters + 1
  if (length < 1 || from < 0 || from >= length) return null
  if (key === 'Home') return 0
  if (key === 'End') return length - 1
  const step = key === 'ArrowDown' ? 1 : key === 'ArrowUp' ? -1 : 0
  if (step === 0) return null
  return (from + step + length) % length
}
