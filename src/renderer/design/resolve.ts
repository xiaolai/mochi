/**
 * The design tokens, as colours a canvas can actually use.
 *
 * ## Why this exists at all
 *
 * `tokens.css` is the one place colour is decided, and the two DOM windows get
 * that for free — they write `var(--paper)` and the cascade does the rest. The
 * companion cannot: she is drawn into a `<canvas>`, and `ctx.fillStyle` takes a
 * colour, not a custom property. So her colours were hard-coded, and they drifted
 * exactly as far as you would expect — `#f4f2ea` against `--paper`'s `#f4f1ea`,
 * one digit out, and `#2b2c25` against `--ink`'s `#16170f`, which is not a near
 * miss but a different colour. She also had no dark half at all, in the one
 * window that sits on the desktop where the scheme is most obvious.
 *
 * Reading the values back out of the cascade is what makes drift impossible
 * rather than merely discouraged. A second table of hexes in TypeScript, however
 * carefully checked in, is a second table.
 *
 * ## Why a probe element
 *
 * Custom properties are substitution-only: `getPropertyValue('--paper')` hands
 * back the token stream — the literal text `light-dark(#f4f1ea, #1a1b14)` — not
 * a colour. `light-dark()` is resolved against `color-scheme`, and only a real
 * property on a real element in the tree has one. So each token is assigned to a
 * colour-valued property on a throwaway span, and the computed style is read
 * back. It is the only arrangement that returns the value the user is seeing.
 *
 * Three different properties rather than three probes, because one element is one
 * style recalculation.
 *
 * ## A missing token THROWS
 *
 * `color: var(--nope)` is invalid at computed-value time, which makes `color`
 * fall back to inherited — a perfectly real colour, and the drawing would look
 * plausible and be wrong. So every token is read as `var(--x, magenta)` and a
 * magenta answer is treated as proof the sheet is not loaded. The companion
 * shipped for months with no stylesheet linked at all; this is the assertion
 * that would have said so on the first frame.
 */

/** What the companion draws with. Every one of these is a token, not a choice. */
export interface Palette {
  /** The opaque surface anything carrying words gets. */
  readonly paper: string
  readonly ink: string
  /**
   * The bubble's own four, which are NOT the window's.
   *
   * It sits on somebody's wallpaper rather than on this palette, so it carries
   * its own paper, its own ink, its own dimmed ink for what she has not said
   * yet, and its own edge. In dark the paper is `#0f0f11` against the window's
   * `#08080a` — lighter than the window on purpose, because a thing floating on
   * a desktop needs a little weight of its own.
   */
  readonly bubblePaper: string
  readonly bubbleInk: string
  readonly bubbleAhead: string
  readonly bubbleEdge: string
  /**
   * The unread-problems dot, and the one colour here that does NOT flip by
   * scheme — see `--alarm` in `tokens.css` for the argument and the four
   * measurements that let it stay one value.
   */
  readonly alarm: string
  /** Her colour, filled — the open halo's ring. Follows the worn character. */
  readonly her: string
  /**
   * Her colour taken deep enough to carry white — the shoulder chip's glyph.
   *
   * `--her` itself is her BODY, which is a fill meant to be seen at two hundred
   * pixels against her own outline. A fourteen-pixel mark in it, alone on
   * somebody's desktop, is a pale smudge. `accent.ts` derives this by a fixed
   * darkening of the same colour, so it is unmistakably hers and legible at the
   * size a glyph is actually drawn.
   */
  readonly herDeep: string
  /**
   * White, and the only reason it is read from the sheet rather than written
   * here is that this file's whole argument is that there is no second table of
   * colours. What makes it safe is `contrastFailures`, which refuses a hue
   * `--her-deep` is not dark enough for at load.
   */
  readonly herDeepInk: string
  /** Her colour as a film — the open halo's interior. */
  readonly herVeil: string
  /** Paper at low alpha: the closed ring, over a desktop of unknown colour. */
  readonly quiet: string
}

/**
 * Which property carries which token on the probe.
 *
 * They only have to be colour-valued and distinct; nothing is ever painted with
 * them. `border-top-color` needs no border to compute.
 */
const READ = [
  { key: 'paper', token: '--paper', property: 'color' },
  { key: 'ink', token: '--ink', property: 'background-color' },
  { key: 'alarm', token: '--alarm', property: 'border-top-color' },
  { key: 'bubblePaper', token: '--bubble-paper', property: 'outline-color' },
  { key: 'bubbleInk', token: '--bubble-ink', property: 'text-emphasis-color' },
  { key: 'bubbleAhead', token: '--bubble-ahead', property: 'caret-color' },
  { key: 'bubbleEdge', token: '--bubble-edge', property: 'text-decoration-color' },
  /*
    The halo's three. `--her` and `--her-veil` are written onto the document by
    `applyAccent` from the WORN face, so reading them here is what makes the ring
    her colour rather than the built-in's — and it is why the palette has to be
    re-read when she is worn, not only when the scheme flips.
  */
  { key: 'her', token: '--her', property: 'border-right-color' },
  /*
    The chip's two. Plain colour properties, like the six above: they only have
    to be colour-valued and distinct, and nothing is ever painted with them.
  */
  { key: 'herDeep', token: '--her-deep', property: '-webkit-text-stroke-color' },
  { key: 'herDeepInk', token: '--her-deep-ink', property: 'column-rule-color' },
  { key: 'herVeil', token: '--her-veil', property: 'border-bottom-color' },
  { key: 'quiet', token: '--ring-thinking', property: 'border-left-color' },
] as const satisfies readonly { key: keyof Palette; token: string; property: string }[]

/** What a token that does not exist resolves to, and therefore what to refuse. */
/**
 * Two fallbacks, and a token is missing only when the two DISAGREE.
 *
 * A single sentinel cannot work here, and the reason is `--her`: `applyAccent`
 * writes it from the worn face, and §13 says in terms that the accent is **user
 * data** — `FaceSpec.colBody` can be set to anything in the tuner, which is why
 * that entry's contrast guarantee is proved by sweeping the whole colour cube.
 * So the sentinel is inside the space of legal values, and a persona whose
 * colour happened to be `#ff00ff` resolved to exactly it and was reported as a
 * document that does not load `tokens.css` — throwing out of `resolvePalette`
 * and taking the palette down over a colour somebody was entitled to pick.
 *
 * Any pair works: a token that IS defined resolves to its own value under both
 * fallbacks, and a token that is not resolves to whichever fallback was given.
 * That is a property of `var()` rather than of the two colours, so no user value
 * can collide with it — which is what a single sentinel could never promise.
 */
const ABSENT = ['magenta', 'cyan'] as const

/**
 * Which tokens did not resolve, given what each probe read back.
 *
 * Extracted so it can be asserted. `resolvePalette` needs `getComputedStyle`
 * and this suite runs in node on purpose — the repository's own note is that a
 * fake DOM "would only make the rig look tested" — so the DOM half stays
 * untested and the DECISION does not.
 */
export function tokensThatDidNotResolve(
  reads: readonly { readonly token: string; readonly under: readonly [string, string] }[],
): readonly string[] {
  return reads.filter(({ under: [a, b] }) => a !== b).map(({ token }) => token)
}

export function resolvePalette(root: HTMLElement): Palette {
  const document = root.ownerDocument
  const probes = ABSENT.map((fallback) => {
    const probe = document.createElement('span')
    probe.setAttribute('aria-hidden', 'true')
    // Out of flow and unpaintable: this must not disturb a window whose whole job
    // is being transparent.
    probe.style.position = 'absolute'
    probe.style.opacity = '0'
    probe.style.pointerEvents = 'none'
    for (const one of READ) probe.style.setProperty(one.property, `var(${one.token}, ${fallback})`)
    root.append(probe)
    return probe
  })

  const computed = probes.map((probe) => getComputedStyle(probe))
  const read = READ.map(
    (one, index) =>
      [
        one,
        computed[0]?.getPropertyValue(one.property) ?? '',
        computed[1]?.getPropertyValue(one.property) ?? '',
        index,
      ] as const,
  )
  for (const probe of probes) probe.remove()

  const missing = tokensThatDidNotResolve(
    read.map(([one, a, b]) => ({ token: one.token, under: [a, b] as const })),
  )
  if (missing.length > 0) {
    throw new Error(
      `design: ${missing.join(', ')} did not resolve — this document does not load tokens.css`,
    )
  }
  return Object.fromEntries(read.map(([one, value]) => [one.key, value])) as unknown as Palette
}

/**
 * Re-read when the scheme flips.
 *
 * Resolving once at startup is what every hard-coded palette effectively did,
 * and it is wrong for the same reason: somebody switches macOS to dark at dusk
 * and she is still painted for daylight. Cheap — one recalculation per flip, not
 * per frame, which is why this is a subscription and not a call in the render
 * loop.
 *
 * Returns the unsubscribe, so a window that closes does not leave a listener
 * holding a reference to its document.
 */
export function whenSchemeChanges(root: HTMLElement, run: (palette: Palette) => void): () => void {
  const dark = root.ownerDocument.defaultView?.matchMedia('(prefers-color-scheme: dark)')
  if (dark === undefined) return () => {}
  const onChange = (): void => {
    run(resolvePalette(root))
  }
  dark.addEventListener('change', onChange)
  return () => {
    dark.removeEventListener('change', onChange)
  }
}
