/**
 * An Electron accelerator, spelled the way the operating system spells it.
 *
 * `Control+Shift+L` is how the combination is STORED and it is not how anybody
 * reads one on a Mac: the keycaps say ⌃ ⇧, every menu in the system says ⌃ ⇧,
 * and B5 draws ⌃ ⇧ L. A window that spells it out in English is asking somebody
 * to translate before they can compare it against the key they are about to
 * press.
 *
 * Pure, and given the platform rather than sniffing one. The glyphs are a macOS
 * convention; on Windows and Linux the words ARE the convention, and a renderer
 * guessing from a user-agent string is one that gets it wrong on some machine
 * and cannot be told it did. `SettingsAbout.platform` is `process.platform`.
 */

/** What each modifier looks like on a Mac keyboard, in the order Apple prints. */
const GLYPHS: Readonly<Record<string, string>> = {
  Control: '⌃',
  Ctrl: '⌃',
  Alt: '⌥',
  Option: '⌥',
  AltGr: '⌥',
  Shift: '⇧',
  Super: '⌘',
  Meta: '⌘',
  Command: '⌘',
  Cmd: '⌘',
  CommandOrControl: '⌘',
  CmdOrCtrl: '⌘',
}

/**
 * Apple's order, which is not the order an accelerator is written in.
 *
 * Every menu on the system prints ⌃⌥⇧⌘ left to right whatever order the binding
 * was declared in, so two combinations that differ only in how they were typed
 * look different here while being the same key. Sorting is what makes the
 * column comparable.
 */
const ORDER = ['⌃', '⌥', '⇧', '⌘']

export function keyGlyphs(accelerator: string, platform: string): string {
  if (platform !== 'darwin') return accelerator
  const parts = accelerator.split('+')
  const marks: string[] = []
  const rest: string[] = []
  for (const part of parts) {
    const glyph = GLYPHS[part]
    // Not `push` blindly: a combination that somehow names one modifier twice
    // would print it twice, and the sort would not tell you which.
    if (glyph === undefined) rest.push(part)
    else if (!marks.includes(glyph)) marks.push(glyph)
  }
  marks.sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b))
  /*
    A SPACE between them, which is B5's spacing and not decoration: ⌃⇧L set
    solid is one glyph cluster at 11px and the two marks are three pixels apart.
    Apple sets them solid at menu sizes; this column is smaller than a menu.
  */
  return [...marks, ...rest].join(' ')
}
