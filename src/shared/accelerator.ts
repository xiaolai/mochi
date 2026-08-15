/**
 * Key combinations, as a CLOSED grammar.
 *
 * `globalShortcut.register()` THROWS on an accelerator it cannot parse. Not
 * returns false — that is what it does when another application already owns
 * the combination, which is an ordinary outcome. A malformed string takes the
 * process down, and the strings will eventually come from a settings field,
 * which means from a person, which means from anything.
 *
 * So nothing here returns a string that Electron might reject. The parser
 * yields a `Chord` built only from members of two fixed sets, and the only way
 * back to text is `toAccelerator`, which composes those members. Any string
 * that gets out is one Electron accepts, by construction rather than by
 * validation — there is no path that produces an unchecked string, so there is
 * no path to check.
 *
 * Shared rather than in `main/` because the settings window has to display and
 * eventually edit these, and a renderer that formats a chord with its own rules
 * is a second grammar waiting to disagree with this one.
 */

/**
 * Modifiers, spelled as Electron spells them, in CANONICAL ORDER.
 *
 * One list, not two. There used to be a separate `ORDER` holding the same nine
 * members for sorting, which is two places to add a modifier and one place to
 * forget: a member missing from `ORDER` is silently dropped by the sort, so the
 * chord registers without it. The order is the declaration.
 *
 * `CommandOrControl` is the portable one and the default for anything a user
 * chooses. The platform-specific spellings exist because the ported v1 config
 * used them and a stored accelerator has to keep parsing after an upgrade.
 *
 * ALIASES ARE NOT MEMBERS. `Option` is macOS's name for `Alt` and `Meta` is the
 * other name for `Super` — the same physical key, two spellings. Keeping both
 * as members made `Alt+M` and `Option+M` two different strings for one chord,
 * so `collides` compared them as distinct and let the user bind two actions to
 * one key. They live in the alias table below and parse to the member.
 */
export const MODIFIERS = [
  'CommandOrControl',
  'Command',
  'Super',
  'Control',
  'Alt',
  'AltGr',
  'Shift',
] as const
export type Modifier = (typeof MODIFIERS)[number]

/**
 * Written out rather than generated, and that is the whole point.
 *
 * These were `'ABC…'.split('')` and `Array.from({length: 24}, …)`, which
 * produce `string[]` — so `KEYS` was `readonly [...string[], 'Space', …]` and
 * `Key` was `string`. The closed grammar this module's header promises was open
 * the entire time: every `as Key` cast below was a no-op, and any string at all
 * satisfied a `Chord`. TypeScript cannot infer literal types out of a runtime
 * `split`, so the members have to be written down to exist in the type.
 */
const LETTERS = [
  'A',
  'B',
  'C',
  'D',
  'E',
  'F',
  'G',
  'H',
  'I',
  'J',
  'K',
  'L',
  'M',
  'N',
  'O',
  'P',
  'Q',
  'R',
  'S',
  'T',
  'U',
  'V',
  'W',
  'X',
  'Y',
  'Z',
] as const

const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'] as const

const FUNCTION_KEYS = [
  'F1',
  'F2',
  'F3',
  'F4',
  'F5',
  'F6',
  'F7',
  'F8',
  'F9',
  'F10',
  'F11',
  'F12',
  'F13',
  'F14',
  'F15',
  'F16',
  'F17',
  'F18',
  'F19',
  'F20',
  'F21',
  'F22',
  'F23',
  'F24',
] as const

/**
 * Keys, again as Electron spells them.
 *
 * Deliberately not every key it accepts. Media keys and `Escape` are omitted
 * because a GLOBAL shortcut on them takes them from every other application,
 * and this app has no business owning the escape key system-wide.
 */
export const KEYS = [
  ...LETTERS,
  ...DIGITS,
  ...FUNCTION_KEYS,
  'Space',
  'Tab',
  'Backspace',
  'Delete',
  'Insert',
  'Return',
  'Up',
  'Down',
  'Left',
  'Right',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Plus',
  'Minus',
] as const
export type Key = (typeof KEYS)[number]

export interface Chord {
  /**
   * At least one, enforced by the TYPE rather than by a check.
   *
   * An empty list serialises to a bare key — `toAccelerator` joins with `+`,
   * so `{ modifiers: [], key: 'M' }` becomes `"M"`, and Electron registers
   * that happily as a GLOBAL shortcut on the letter M. The user can then no
   * longer type M in any application, and nothing reports an error.
   *
   * A non-empty tuple rather than a branded type: the brand would also close
   * off duplicate and out-of-order members, but it costs a constructor at
   * every call site, and those two states are cosmetic where this one takes
   * a key away from the whole machine. Both constructors below canonicalise
   * anyway.
   */
  readonly modifiers: readonly [Modifier, ...Modifier[]]
  readonly key: Key
}

const MODIFIER_BY_NAME = new Map<string, Modifier>()
for (const modifier of MODIFIERS) MODIFIER_BY_NAME.set(modifier.toLowerCase(), modifier)
// The spellings people actually type, the ones v1 stored, and the two that name
// a member's key by another name. `commandorcontrol` is NOT here: the loop
// above already inserted it, lowercased, from MODIFIERS -- setting it again was
// a line that could only ever overwrite itself with the same value.
MODIFIER_BY_NAME.set('cmd', 'Command')
MODIFIER_BY_NAME.set('cmdorctrl', 'CommandOrControl')
MODIFIER_BY_NAME.set('ctrl', 'Control')
MODIFIER_BY_NAME.set('option', 'Alt')
MODIFIER_BY_NAME.set('opt', 'Alt')
MODIFIER_BY_NAME.set('meta', 'Super')

const KEY_BY_NAME = new Map<string, Key>()
for (const key of KEYS) KEY_BY_NAME.set(key.toLowerCase(), key)
KEY_BY_NAME.set('enter', 'Return')
KEY_BY_NAME.set('spacebar', 'Space')
KEY_BY_NAME.set('del', 'Delete')
KEY_BY_NAME.set('pgup', 'PageUp')
KEY_BY_NAME.set('pgdn', 'PageDown')

/**
 * Read one, or say no.
 *
 * Rejects a chord with NO modifier, which Electron would happily register: a
 * global shortcut on a bare letter takes that letter away from every
 * application on the machine, so the user could no longer type it. Electron
 * treats that as the caller's business; here it is a malformed shortcut.
 */
export function parseAccelerator(text: unknown): Chord | null {
  if (typeof text !== 'string') return null
  // Empty tokens are NOT discarded. `.filter(part => part !== '')` used to sit
  // here, which made `Control++M` and `+Control+M` parse as `Control+M`: a
  // typo silently became a valid, different shortcut. Nothing in this grammar
  // has an empty part -- the plus key is spelled `Plus` -- so an empty token
  // can only be a malformed string.
  const parts = text.split('+').map((part) => part.trim())
  if (parts.length < 2 || parts.some((part) => part === '')) return null

  const modifiers: Modifier[] = []
  for (const part of parts.slice(0, -1)) {
    const modifier = MODIFIER_BY_NAME.get(part.toLowerCase())
    // An unknown modifier is a rejection, never a skip. Dropping it would
    // register a DIFFERENT shortcut from the one that was asked for, silently.
    if (modifier === undefined) return null
    if (!modifiers.includes(modifier)) modifiers.push(modifier)
  }

  const last = parts[parts.length - 1]
  const key = last === undefined ? undefined : KEY_BY_NAME.get(last.toLowerCase())
  if (key === undefined) return null

  // No `modifiers.length === 0` check: `parts.length >= 2` means at least one
  // modifier token, and every token either pushed a member or returned above.
  // The sort is over MODIFIERS, so the result is canonically ordered and two
  // spellings of one chord serialise to one string.
  return canonical(modifiers, key)
}

/**
 * The one place a `Chord` is built.
 *
 * Sorts by MODIFIERS, drops duplicates, and proves to the type system that at
 * least one modifier survived. Both parsers go through it, so every chord in
 * the program is canonically ordered — which is what makes comparing two
 * serialised chords a correct answer to "is this already bound".
 */
function canonical(chosen: readonly Modifier[], key: Key): Chord | null {
  const ordered = MODIFIERS.filter((modifier) => chosen.includes(modifier))
  const [first, ...rest] = ordered
  // Unreachable from either caller, both of which check first. Returning null
  // rather than asserting keeps that true no matter who calls it next.
  if (first === undefined) return null
  return { modifiers: [first, ...rest], key }
}

/** The only way back to text. Always something Electron accepts. */
export function toAccelerator(chord: Chord): string {
  return [...chord.modifiers, chord.key].join('+')
}

/**
 * How a person reads it, which is not how Electron spells it.
 *
 * macOS writes chords as glyphs with no separator — `⇧⌃M`, not
 * `Shift+Control+M` — and a settings window that shows the Electron spelling
 * on a Mac looks like a debug string. Everywhere else the words are correct.
 */
export function describeAccelerator(chord: Chord, platform: string): string {
  if (platform !== 'darwin') {
    return [...chord.modifiers.map((m) => (m === 'CommandOrControl' ? 'Ctrl' : m)), chord.key].join(
      '+',
    )
  }
  // TOTAL, not Partial. As a partial record a missing entry fell through to
  // `?? ''` and the modifier simply vanished from the display -- the window
  // showing `⌘M` for a chord that is actually registered as Command+Alt+M.
  // Declared total, adding a modifier without a glyph is a compile error.
  const GLYPH: Readonly<Record<Modifier, string>> = {
    CommandOrControl: '⌘',
    Command: '⌘',
    Super: '⌘',
    Control: '⌃',
    Alt: '⌥',
    AltGr: '⌥',
    Shift: '⇧',
  }
  return `${chord.modifiers.map((m) => GLYPH[m]).join('')}${chord.key}`
}

/**
 * The parts of a keyboard event this needs. Not `KeyboardEvent` itself, so the
 * function is testable without a DOM and usable from anywhere.
 */
export interface KeyEvent {
  /** Physical key: `KeyM`, `Digit1`, `F1`, `Space`. */
  readonly code: string
  readonly ctrlKey: boolean
  readonly shiftKey: boolean
  readonly altKey: boolean
  readonly metaKey: boolean
}

/**
 * Turn a keypress into a chord, or refuse it.
 *
 * `code` rather than `key`, deliberately. `key` is what the layout produced —
 * pressing the same physical key with Shift held gives `M` on one layout and
 * something else on another, and on a Mac Option+letter produces a completely
 * different character. Electron matches accelerators against the physical key,
 * so recording the physical key is the only way what the user pressed and what
 * gets registered are the same thing.
 *
 * Returns null while only modifiers are down, which is the ordinary state
 * halfway through pressing a chord — the recorder shows "keep going" rather
 * than treating it as a failed attempt.
 */
export function chordFromEvent(event: KeyEvent, platform: string): Chord | null {
  const modifiers: Modifier[] = []
  // The meta key is a DIFFERENT key on different platforms, and this recorded
  // it as one. `metaKey` is Command on macOS and the Windows/Super key
  // elsewhere; mapping both to `CommandOrControl` meant a Windows user who
  // pressed Super+M had Control+M registered -- a chord they never chose, on a
  // modifier they never pressed, with the window showing them the wrong one.
  if (event.metaKey) modifiers.push(platform === 'darwin' ? 'CommandOrControl' : 'Super')
  if (event.ctrlKey) modifiers.push('Control')
  if (event.altKey) modifiers.push('Alt')
  if (event.shiftKey) modifiers.push('Shift')
  if (modifiers.length === 0) return null

  const key = keyFromCode(event.code)
  if (key === null) return null
  return canonical(modifiers, key)
}

/**
 * A physical key code, as one of the keys this grammar admits.
 *
 * Looked up, not cast. `letter[1] as Key` and `return code` used to appear
 * here, and both were no-ops that TypeScript accepted only because `Key` had
 * silently widened to `string` — so a code the regexes did not really cover
 * would have been handed on as a key. With the union closed, the compiler
 * refuses the cast and the lookup is the only way through.
 */
function keyFromCode(code: string): Key | null {
  const letter = /^Key([A-Z])$/.exec(code)
  if (letter !== null) return KEY_BY_NAME.get(letter[1]?.toLowerCase() ?? '') ?? null
  const digit = /^Digit([0-9])$/.exec(code)
  if (digit !== null) return KEY_BY_NAME.get(digit[1] ?? '') ?? null
  // The DOM and Electron spell F1..F24 identically, so there is nothing to
  // convert -- but it still has to be proven a member rather than asserted.
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return KEY_BY_NAME.get(code.toLowerCase()) ?? null
  const NAMED: Readonly<Record<string, Key>> = {
    Space: 'Space',
    Tab: 'Tab',
    Backspace: 'Backspace',
    Delete: 'Delete',
    Insert: 'Insert',
    Enter: 'Return',
    NumpadEnter: 'Return',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    Home: 'Home',
    End: 'End',
    PageUp: 'PageUp',
    PageDown: 'PageDown',
    Equal: 'Plus',
    Minus: 'Minus',
  }
  return NAMED[code] ?? null
}
