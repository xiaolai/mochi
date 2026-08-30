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
/* The brightest surface the halo can land on. Somebody's wallpaper is not
   knowable; white is the worst case it has to survive. */
const WHITE: Rgb = { r: 255, g: 255, b: 255 }

/** WCAG AA for body text. */
export const AA_BODY = 4.5
/**
 * The floor for a MARK, and it is the only one her colour has to clear now.
 *
 * v1 spent her hue on the window — selected rows, primary buttons, her words as
 * text — so 4.5 was right: all of those are text or carry it. v2 takes the hue
 * out of the chrome entirely. Her colour survives in exactly two places, her
 * FACE and the halo above it, and both are marks.
 *
 * Judging a mark at the text floor is not caution, it is a wrong answer: it
 * rejects hues that are perfectly legible for what they are actually used for.
 * The design says so in as many words, and it is right.
 */
export const AA_MARK = 3.0

/*
  Two page colours were declared here, to measure her face against. They went
  when the pairing that used them did — see `contrastFailures`. A constant kept
  for a check that no longer exists is the same defect as a token kept for a
  rule that no longer exists.
*/

/*
  `readableInk` was here — ink chosen by measurement so a label on a button
  FILLED with her colour stayed readable, sweeping the whole colour cube to
  prove it. Nothing fills anything with her colour any more: v2 spends no hue on
  controls, and `--her-ink` went with `--her-wash` and `--ink-brand`.

  Removed rather than kept for later. It was reachable only from its own tests,
  which is a producer with no consumer wearing a coat of green — and the
  argument it encodes is not lost, it is in this comment and in the git history
  the moment anybody puts a label back on her colour.

  `NEAR_WHITE`, `PURE_BLACK` and `PURE_WHITE` went with it — the two pure ones
  existed only for its saturated-mid-tone fallback. `NEAR_BLACK` stays: it is the
  last-resort fallback when a face's colours cannot be parsed at all.
*/

/**
 * Her colour, taken far enough from a surface to be a MARK on it.
 *
 * ## Why this is not a fixed shade
 *
 * The halo is her colour and it is a safety indicator: an open microphone with
 * nothing on screen saying so is the failure `halo.ts` opens by calling the one
 * this repository most cannot get wrong. So the ring has to clear `AA_MARK`
 * against whatever it sits on, and it sits on a desktop nobody chose.
 *
 * `deep()` is `shade(base, -0.42)`, one fixed step. That is right for the
 * built-in and says nothing about anybody else's: a persona whose colour is a
 * pale yellow is still pale yellow after one step, and the step that rescues it
 * would blacken a colour that was already dark. Stepping until the ratio clears
 * is the only version that holds for a hue this code has never seen.
 *
 * Returns the base unchanged when it already reads — darkening a colour that
 * passes would be taking her hue away for nothing.
 */
export function readableAgainst(base: Rgb, surface: Rgb, floor: number): Rgb {
  if (contrast(base, surface) >= floor) return base
  // Toward black or toward white, whichever the surface is not.
  const away = luminance(surface) > 0.5 ? -1 : 1
  let best = base
  for (let step = 1; step <= 20; step += 1) {
    best = shade(base, away * (step / 20))
    if (contrast(best, surface) >= floor) return best
  }
  // Nothing in twenty steps: black or white, whichever this was heading for.
  return best
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
    /*
      TWO HALVES, and they are not interchangeable — board 09 says so directly.

      This was one value, `toHex(base)`, written over the `light-dark()` pair in
      `tokens.css` on every read. So the corrected token never survived: the
      built-in's ring came out `#a5d8bd` on a light desktop, which is **1.60:1
      against white** — below the 3.0 an open microphone's only indicator has to
      clear, and worse than the 1.8:1 the delivery's own audit called its most
      serious finding. It is item A of that audit, and the token was fixed while
      the thing that overwrites it was not.

      Derived rather than tabulated. The pair in `tokens.css` is the built-in's
      and a persona this code has never seen needs the same guarantee, which is
      a ratio and not a hex.

      The LIGHT half is taken to `AA_BODY`, not to `AA_MARK`. The ring is a mark
      and 3.0 is its floor, but that floor is measured against white — and white
      is the BEST case for a desktop, not the worst. The delivery's own light
      value measures 5.54:1, well past 3.0, and the margin is what a background
      nobody chose costs. The dark half keeps the mark floor because it is
      measured against near-black, where her colour is already far away.
    */
    '--her': `light-dark(${toHex(readableAgainst(base, WHITE, AA_BODY))}, ${toHex(
      readableAgainst(base, NEAR_BLACK, AA_MARK),
    )})`,
    /*
      FOUR properties, down from eight.

      `--her-hover`, `--her-ink`, `--her-wash` and `--ink-brand` went with the
      window's hue. Every one of them existed so her colour could paint chrome —
      a hover state, a label on her fill, a selected row's wash, her colour as
      text — and v2 has none of those: "her colour appears on her face and the
      halo above it, and nowhere else".

      They are removed rather than left emitting into the void. A custom
      property written onto the document that no sheet declares and nothing
      reads is a producer with no consumer, and this repository has a test named
      for how expensive that is.
    */
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
    /*
      Her colour as a FILM — the interior of the halo over her head.

      Derived rather than declared, because the halo is the one place her colour
      is drawn over an unknown desktop: a fixed tint would be some other
      character's green sitting inside her ring.
    */
    /*
      The film inside the open ring, at the boards' two alphas: 14% on light,
      22% on dark. It was 22% for both — a tint meant to sit under a dark ring,
      used under a light one.
    */
    '--her-veil': `light-dark(rgb(${String(base.r)} ${String(base.g)} ${String(base.b)} / 14%), rgb(${String(base.r)} ${String(base.g)} ${String(base.b)} / 22%))`,
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

/*
  `pair` was here — a `light-dark()` composer, for the two properties that were
  read against the page. Both went with the window's hue: what is left of her
  colour is her face and the halo, and neither is read against this palette. A
  helper with no caller is the same defect as a token with no consumer.
*/

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
  const check = (what: string, a: Rgb, b: Rgb, floor: number): void => {
    const ratio = contrast(a, b)
    if (ratio < floor) failures.push(`${what} (${ratio.toFixed(2)}:1)`)
  }

  /*
    THREE pairings, and all four of the old ones are gone — not loosened.

    They asked whether her colour worked as chrome: as a fill under an
    automatic label, as a surface under white text, and as TEXT on her own wash
    in each scheme. v2 draws none of those. A check whose subject has been
    deleted does not fail, it passes forever, and a suite full of that is the
    thing `rebuild-contract.md` marks rules **moot** to avoid.

    What is left is ONE pairing: her features have to read on her body.

    A second was drafted and measured its way out — her body colour against the
    two page colours, on the reasoning that her face now has to be findable in
    the rail and the masthead. Her own built-in is `#a5d8bd` on white: **1.91:1**,
    and the palest of the eight themes is 2.74. A check that rejects the
    shipping character is not a floor the palette is failing, it is the wrong
    question: her face is a DRAWN FIGURE with an outline, shading and dark
    features, not a flat swatch, so its legibility is internal to it and does not
    live in the fill.

    The halo is the other place her colour survives, and it cannot be checked
    here at all — it is drawn over an unknown desktop. That is handled by
    construction instead: `halo.ts` gives the ring a dark outer stroke for
    exactly this reason, and says so.
  */
  check('her features on her body', ink, base, AA_MARK)
  return failures
}
