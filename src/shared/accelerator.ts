/**
 * What a global key combination may be, written one way.
 *
 * ## Why a grammar exists rather than a text field
 *
 * `globalShortcut.register` THROWS on a malformed accelerator — `main/shortcuts.ts`
 * catches it and has always described that as a programming error, which it was
 * while the two combinations were constants in the source. They are settable
 * now, so the same throw is reachable from a control somebody operates, and the
 * difference between a refusal and a crashed launch is this file.
 *
 * ## One spelling, so equality is a string comparison
 *
 * Electron accepts the modifiers in any order and accepts several names for
 * each — `Cmd` and `Command`, `Ctrl` and `Control`, `Option` and `Alt`. That is
 * generous for a human writing a constant and wrong for a value being stored
 * and compared: `Shift+Control+L` and `Control+Shift+L` are the same key and
 * two different strings, so a check for "these two bindings collide" that
 * compared them would say no. Everything here produces the SAME order —
 * `Control`, `Alt`, `Shift`, `Command`, which is also the order macOS draws
 * ⌃⌥⇧⌘ in — and nothing else is accepted.
 *
 * ## At least one modifier that is not Shift
 *
 * A global shortcut fires while another application has focus. Bound to a bare
 * letter it takes that letter away from every text field on the machine, and
 * the application that did it is not the one in front of you — so the person it
 * happens to has no way to guess what to blame. `Shift` alone is the same
 * failure wearing a capital letter.
 *
 * That is a narrower rule than Electron enforces, deliberately. This is the one
 * mistake in this control that is both easy to make and very hard to undo,
 * because undoing it means typing into a field whose keystrokes are being
 * eaten.
 *
 * ## The physical key, not the character it produced
 *
 * `acceleratorFrom` reads `code` rather than `key`. On macOS `Alt` is the
 * compose modifier: pressing ⌥L reports `key` as `¬`, which is not an
 * accelerator Electron knows and not what anybody thinks they pressed. `code`
 * is the key that was struck, which is what a shortcut is about.
 */

/** In the order they are written, which is also the order macOS draws them. */
const MODIFIERS = ['Control', 'Alt', 'Shift', 'Command'] as const

/**
 * The named keys accepted beyond letters, digits and the function row.
 *
 * A CLOSED list, and short. Electron accepts more — punctuation, the numeric
 * keypad, media keys — and every one of those is a key whose position depends
 * on the keyboard layout, so a binding made on one layout is a binding somebody
 * cannot press on another. The set here is the set that is in the same place on
 * every keyboard this application runs on.
 */
const NAMED = [
  'Space',
  'Tab',
  'Backspace',
  'Delete',
  'Insert',
  'Return',
  'Escape',
  'Up',
  'Down',
  'Left',
  'Right',
  'Home',
  'End',
  'PageUp',
  'PageDown',
] as const

/** `code` values that are not their own accelerator name. */
const RENAMED: Readonly<Record<string, string>> = {
  Enter: 'Return',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
}

const FUNCTION = /^F([1-9]|1\d|2[0-4])$/

function isKeyName(value: string): boolean {
  if (/^[A-Z0-9]$/.test(value)) return true
  if (FUNCTION.test(value)) return true
  return (NAMED as readonly string[]).includes(value)
}

/**
 * Why this is not a usable key combination, or null when it is one.
 *
 * A SENTENCE rather than a boolean, because every one of these refusals is
 * shown to somebody who has just pressed a key and needs to know what to press
 * instead. `isAccelerator` is the same check for callers that only need the
 * answer.
 */
export function acceleratorProblem(value: unknown): string | null {
  if (typeof value !== 'string' || value === '') return 'That is not a key combination.'
  const parts = value.split('+')
  const key = parts[parts.length - 1]
  const modifiers = parts.slice(0, -1)
  if (key === undefined || !isKeyName(key)) {
    return 'A key has to be a letter, a digit, a function key, or one of Space, Tab, Backspace, Delete, Insert, Return, Escape, an arrow, Home, End, PageUp or PageDown.'
  }
  for (const one of modifiers) {
    if (!(MODIFIERS as readonly string[]).includes(one)) {
      return `${one} is not a modifier this build writes.`
    }
  }
  // The canonical ORDER, not merely the canonical set. Two spellings of one
  // combination is how a collision check quietly stops finding collisions.
  const canonical = MODIFIERS.filter((one) => modifiers.includes(one))
  if (canonical.join('+') !== modifiers.join('+')) {
    return 'The modifiers are in an order this build does not write.'
  }
  if (!modifiers.some((one) => one === 'Control' || one === 'Alt' || one === 'Command')) {
    // Shift alone is not a modifier for this purpose — see the header. A global
    // key with no real modifier takes that key away from the whole machine.
    return 'A global key needs Control, Option or Command — Shift on its own is not enough, because it would take that key away from every application.'
  }
  return null
}

/** Whether this is a key combination this build will register and store. */
export function isAccelerator(value: unknown): value is string {
  return acceleratorProblem(value) === null
}

/**
 * The combination a keydown describes, or null when it does not describe one.
 *
 * Null for a modifier pressed on its own, which is what makes a capture control
 * possible: somebody holding ⌃⇧ on the way to ⌃⇧K generates two events that
 * mean nothing yet, and a control that took the first would record `Control`
 * and stop listening.
 *
 * Null also for any key outside the accepted set, so the caller can say what is
 * accepted rather than storing something Electron would throw on. It does NOT
 * apply the "needs a real modifier" rule — that is `acceleratorProblem`'s, so
 * the pane can show the combination somebody pressed alongside the reason it
 * cannot be used, instead of appearing to ignore the keystroke.
 */
export function acceleratorFrom(event: {
  readonly code: string
  readonly ctrlKey: boolean
  readonly altKey: boolean
  readonly shiftKey: boolean
  readonly metaKey: boolean
}): string | null {
  const key = keyNameFrom(event.code)
  if (key === null) return null
  const held: string[] = []
  if (event.ctrlKey) held.push('Control')
  if (event.altKey) held.push('Alt')
  if (event.shiftKey) held.push('Shift')
  if (event.metaKey) held.push('Command')
  return [...held, key].join('+')
}

function keyNameFrom(code: string): string | null {
  const letter = /^Key([A-Z])$/.exec(code)
  if (letter?.[1] !== undefined) return letter[1]
  // `Digit`, never `Numpad`: the keypad reports its own codes and is absent
  // from most of the keyboards this runs on, so a binding made on one is a
  // binding that cannot be pressed on the others.
  const digit = /^Digit([0-9])$/.exec(code)
  if (digit?.[1] !== undefined) return digit[1]
  const renamed = RENAMED[code]
  if (renamed !== undefined) return renamed
  return isKeyName(code) ? code : null
}
