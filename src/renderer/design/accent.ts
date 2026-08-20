/**
 * The interface's accent, derived from HER.
 *
 * The obvious accent is the OS one, and the first version of the settings
 * window used it. It is wrong for this app: every other surface is her colour,
 * and borrowing the system blue makes the one window with her name on it look
 * like it belongs to something else. The accent is therefore computed from
 * `colBody` -- the same constant the renderer fills her with -- so retuning her
 * palette moves the interface with her and the two cannot drift. That is the
 * same reasoning as the tray icon: one graphical source, everything else
 * generated from it.
 *
 * Pure arithmetic and canvas-free, like the rest of the geometry, so the
 * contrast guarantee below is testable without a browser.
 */

// This was relative and .ts-suffixed, NOT `@shared/...`, for the same reason
// `geometry.ts` was: `scripts/make-icons.ts` imported this file and ran under
// bare node, which resolves no path aliases. Using the alias broke `pnpm icons`
// while every test, typecheck and build stayed green — the icon generator was
// the only thing that noticed, and it noticed at the point somebody needed a
// new icon.
//
// That generator went to the archive with the v1 rig, so the constraint no
// longer holds and the alias is correct again. The trap it describes has not
// gone anywhere: if a generator returns and runs outside the bundler, this line
// breaks silently. Give it a gate that runs the generator rather than restoring
// the relative path and hoping.
import { MOCHI, type FaceSpec } from '@shared/avatar-spec'

export interface Rgb {
  readonly r: number
  readonly g: number
  readonly b: number
}

/**
 * `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`. Alpha is parsed and discarded.
 *
 * The `#` is REQUIRED, matching what `parseFaceSpec` demands of a colour on
 * disk. Accepting a bare `8ec8a8` here made this parser laxer than the format
 * it serves: a face assembled in code rather than loaded from a file could
 * carry a value the validator would have rejected, and it would paint instead
 * of falling back. One notion of "a colour", used by both.
 */
const HEX = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/

export function parseHex(hex: string): Rgb | null {
  const text = hex.trim()
  // Checked BEFORE parsing, not after. `red` is three characters, so it took
  // the shorthand path and `parseInt('rr', 16)` handed back NaN channels --
  // a colour object that passes every null check and paints nothing.
  if (!HEX.test(text)) return null
  const body = text.slice(1)
  // Indexed rather than spread: the regex above has already restricted this to
  // ASCII hex, so code-point iteration buys nothing and the linter is right
  // that spreading a string is the wrong default habit to build.
  const expand = (index: number): number => Number.parseInt(body.charAt(index).repeat(2), 16)
  if (body.length <= 4) {
    return { r: expand(0), g: expand(1), b: expand(2) }
  }
  // No NaN check and no trailing `return null`: the regex admits exactly the
  // four lengths handled above and below, so both were unreachable and each
  // one implied a failure mode that cannot occur.
  const value = Number.parseInt(body.slice(0, 6), 16)
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 }
}

/** WCAG relative luminance. The gamma expansion is not optional — a plain
 * average of the channels misjudges green badly, and green is her whole body. */
export function luminance({ r, g, b }: Rgb): number {
  const channel = (value: number): number => {
    const s = value / 255
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** WCAG contrast ratio, 1..21. */
export function contrast(a: Rgb, b: Rgb): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return ((high ?? 0) + 0.05) / ((low ?? 0) + 0.05)
}

const NEAR_BLACK: Rgb = { r: 20, g: 26, b: 23 }
const NEAR_WHITE: Rgb = { r: 252, g: 253, b: 252 }
const PURE_BLACK: Rgb = { r: 0, g: 0, b: 0 }
const PURE_WHITE: Rgb = { r: 255, g: 255, b: 255 }

/** WCAG AA for body text. */
export const AA_BODY = 4.5

/**
 * Ink that can actually be read on a given background.
 *
 * CHOSEN by measurement rather than fixed to white. Her body is a light green:
 * white text on it lands near 1.8:1, which is illegible and is exactly what a
 * hardcoded `AccentColorText` would have produced on a button filled with her
 * colour.
 *
 * Two pairs rather than one, because a single pair cannot cover the space. The
 * softened pair reads better and handles nearly every real palette; a saturated
 * mid-tone defeats it, and pure black and white are the only pair whose worst
 * case still clears AA. The test sweeps the whole cube, so this is a property
 * rather than a claim.
 */
export function readableInk(background: Rgb): Rgb {
  const better = (a: Rgb, b: Rgb): Rgb =>
    contrast(background, a) >= contrast(background, b) ? a : b

  // The softened pair first, because pure black on a coloured button is harsh
  // and this is the case almost every real palette lands in.
  const soft = better(NEAR_BLACK, NEAR_WHITE)
  if (contrast(background, soft) >= AA_BODY) return soft

  // A saturated mid-tone -- a vivid purple, say -- is too dark for the soft
  // white and too light for the soft black, and lands near 4.16. Pure black
  // and white are the only pair that can carry it: the mathematical worst case
  // against them is 4.58, just clear of AA. Softness is the thing that gives
  // way here, never the threshold.
  return better(PURE_BLACK, PURE_WHITE)
}

export function toHex({ r, g, b }: Rgb): string {
  const part = (value: number): string =>
    Math.max(0, Math.min(255, Math.round(value)))
      .toString(16)
      .padStart(2, '0')
  return `#${part(r)}${part(g)}${part(b)}`
}

/**
 * Move a colour toward black or white by `amount`, **-1..1**.
 *
 * The sign chooses the target and the magnitude is the distance travelled:
 * negative darkens toward black, positive lightens toward white, and 0 is
 * identity. Documented as `0..1` until an audit noticed every darkening caller
 * was passing a value the contract called out of range.
 */
export function shade(colour: Rgb, amount: number): Rgb {
  const t = Math.max(-1, Math.min(1, amount))
  const target = t < 0 ? 0 : 255
  const k = Math.abs(t)
  return {
    r: colour.r + (target - colour.r) * k,
    g: colour.g + (target - colour.g) * k,
    b: colour.b + (target - colour.b) * k,
  }
}

/**
 * The custom properties the token sheet expects.
 *
 * Returned as data rather than written to the document, so the derivation is
 * testable and the caller decides which element carries them.
 */
export function accentVariables(face: FaceSpec): Readonly<Record<string, string>> {
  // The built-in green is the fallback for an unparseable colour. The face has
  // already been validated as hex by `parseFaceSpec`, so this is defence
  // against a future caller rather than against today's data.
  //
  // READ from `MOCHI` rather than retyped as literal channels. A second copy of
  // her palette that no test compares against the first is stale the moment she
  // is retuned -- and this file's whole argument is that there is one source.
  const base = parseHex(face.colBody) ?? parseHex(MOCHI.colBody) ?? NEAR_BLACK
  const ink = parseHex(face.colInk) ?? NEAR_BLACK
  return {
    // Her fill and its label do NOT vary by scheme: she is one colour whatever
    // the OS is set to, and the label is measured against HER rather than
    // against the page, so there is nothing for a scheme to change.
    /**
     * HER colour, under her own names. It used to be written as `--accent`,
     * which made every button, focus ring and selected row take the persona's
     * colour.
     *
     * ## What this comment used to claim, and did not do
     *
     * It said: *"The new system gives the chrome a fixed gold and leaves her
     * two jobs: the worn persona and the chosen swatch. See `--gold` in
     * tokens.css."* There is no `--gold` in `tokens.css` and there never has
     * been. The sentence recorded an intention as though it were a state, which
     * is the one thing a comment must not do — it is why nobody finished the
     * migration and why nobody noticed for months.
     *
     * **What is actually true today.** Her colour drives the chrome in all
     * three windows: the settings nav's open group, the shelf's card ring, the
     * inspector's open tab, a selected row, a search hit. `tokens-additive.css`
     * — the handoff of 2026-08-19 — specifies exactly that, and
     * `Mochi Extended.dc.html` renders it, with 70 uses of `--green-deep` and
     * 60 of `--green` and no gold anywhere.
     *
     * ## The gold is real, and it does not clear the floor
     *
     * It exists in `site/index.html`: `#b68235` light, `#e1ad66` dark. Measured
     * with the `contrast()` below, against the surfaces in `tokens.css`:
     *
     * | | on `--paper` | on `--gold-wash` |
     * | --- | --- | --- |
     * | light `#b68235` | **2.99:1** | **3.08:1** |
     * | dark `#e1ad66` | 8.57:1 | 7.03:1 |
     *
     * The dark half is comfortable. The light half is below `AA_BODY`, and so
     * is white on a filled gold button (3.37:1). The site has the same problem
     * with its own surfaces — `.status` sets gold text at 0.78rem on the wash —
     * so this is a colour that was never measured rather than one that was
     * measured against a different page.
     *
     * Adopting it as TEXT needs a darker light value. `shade(gold, -0.22)` —
     * `#8e6529` — is the nearest one that clears: 4.59:1 on `--paper`, 4.73:1
     * on the wash, 4.92:1 on `--paper-2`. As a ring or a border only, the bar
     * is 3:1 and the shipped value misses even that, at 2.99:1.
     *
     * That is a decision about a brand colour, so it is not made here. What is
     * recorded here is the arithmetic, so whoever makes it does not have to
     * rediscover it.
     */
    '--her': toHex(base),
    '--her-hover': toHex(shade(base, -0.12)),
    '--her-ink': toHex(readableInk(base)),
    // These two DO vary, because they are read against the page.
    //
    // A wash is her colour barely there — which on paper means a pale tint and
    // on a dark page means a dark one. Emitting a single pale value left the
    // dark scheme with a near-white band, and anything written on it measured
    // about 1:1. Same for her colour as TEXT: `colInk` is a dark green designed
    // to read on paper, so on a dark page it disappears.
    //
    // `light-dark()` is composed here rather than declared in the sheet because
    // both sides are derived from her, and the sheet cannot see her. The dark
    // counterpart of her ink comes from her BODY rather than from `colInk` —
    // the format has no "light ink" field, and lightening the one colour she
    // definitely has keeps the role hers.
    '--her-wash': pair(shade(base, 0.82), shade(base, -0.68)),
    '--ink-brand': pair(ink, shade(base, 0.25)),
    /*
      Her hue deep enough to carry WHITE, and the same value in both schemes.
      
      The one place this file's own argument is reversed: her colour under white
      text, on the surfaces that ARE about which character is worn — the open tab,
      the button that commits, a checked box. That was `--gold` while the chrome
      had a hue to spend; it does not any more, and grey leaves a checked box
      unreadable as a state.
      
      It does not flip by scheme because it is not read against the page — white
      is read against IT. A dark-scheme variant would be a second colour doing the
      same job, and the pairing that matters is unchanged either way.
    */
    '--her-deep': toHex(deep(base)),
    '--her-deep-ink': '#ffffff',
  }
}

/**
 * Her colour taken deep enough for white to sit on it.
 *
 * A fixed darkening rather than a target ratio, so it stays plainly HER hue
 * rather than sliding toward black for the light themes and stopping early for
 * the dark ones. `contrastFailures` is what refuses a hue this is not enough for
 * — the derivation is honest about being a rule of thumb, and the check is not.
 */
function deep(base: Rgb): Rgb {
  return shade(base, -0.42)
}

/** A `light-dark()` value, so one custom property covers both schemes. */
function pair(light: Rgb, dark: Rgb): string {
  return `light-dark(${toHex(light)}, ${toHex(dark)})`
}

/**
 * Is every pairing this palette produces actually readable?
 *
 * The eight named themes are scanned by a TEST, once, because their hues are
 * known in advance -- eight themes by five pairings by two schemes, all above
 * AA. A hue a package chose has never been seen by anything, and her colour
 * becomes the INTERFACE's colour, so shipping a persona is shipping a UI
 * theme. Without this, installing a yellow one makes the settings window
 * unreadable with no error anywhere.
 *
 * Checked at LOAD rather than at build, because that is the only time a
 * stranger's hue exists.
 */
export function contrastFailures(face: FaceSpec): readonly string[] {
  const base = parseHex(face.colBody)
  const ink = parseHex(face.colInk)
  if (base === null || ink === null) return ['the colours could not be read']

  const failures: string[] = []
  const check = (what: string, a: Rgb, b: Rgb): void => {
    const ratio = contrast(a, b)
    if (ratio < AA_BODY) failures.push(`${what} (${ratio.toFixed(2)}:1)`)
  }

  // The same pairings the theme test sweeps, and the same threshold. Two
  // different answers to "is this readable" would make one of them a lie.
  check('her colour behind its own label', base, readableInk(base))
  /*
    White on her deepened colour — the FOURTH pairing, added when the palette
    started putting her under white text.
    
    Without it a persona could ship an open tab, a commit button and a checked
    box that nobody can read, and every existing check would still pass: the
    three below all ask about her colour as TEXT, and this is the one place she
    is the SURFACE. The worst built-in is moss at 5.64:1; the floor is 4.50.
  */
  check('white on her colour', { r: 255, g: 255, b: 255 }, deep(base))
  for (const [name, page] of [
    ['on paper', shade(base, 0.82)],
    ['on a dark page', shade(base, -0.68)],
  ] as const) {
    check(`her colour as text ${name}`, name === 'on paper' ? ink : shade(base, 0.25), page)
  }
  return failures
}
