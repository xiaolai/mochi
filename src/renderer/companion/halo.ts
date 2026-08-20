import type { Body, Room } from './place'

/**
 * The halo over her head: the microphone, drawn on HER.
 *
 * ## Why this exists at all
 *
 * The one fact this repository calls the worst thing to get wrong — an open
 * microphone with nothing on screen saying so — lived in a window you had to
 * open. The shelf's strip says MICROPHONE OPEN in green, which is only true for
 * whoever is looking at the shelf, and the shelf is shut almost always. She is
 * the thing on screen all day, and she carried none of it.
 *
 * So the state moves onto her. A halo is small, it belongs to her at any size,
 * and it survives being drawn at 44px in a list — where a ground ellipse would
 * read as a shadow and a badge would read as chrome.
 *
 * ## Three states, and one of them draws nothing
 *
 * - `open` — filled, HER colour. The microphone is live.
 * - `closed` — a hairline. She is resting; the grant is intact and it comes back
 *   when she wakes.
 * - `off` — nothing at all. The grant is withheld, and an outline promising a
 *   microphone that cannot open is worse than no outline.
 *
 * `off` versus `closed` is not decoration. `face.hears()` is one boolean and
 * conflates them — main computes it as `!asleep && mayHear` — so the two are
 * told apart here from `resting`, which the rig already holds. Withheld and
 * resting look identical to the microphone and must not look identical to a
 * person: one is a decision somebody made and the other is a state that ends.
 *
 * ## The bead is a clock, not a spinner
 *
 * While she is waiting to answer, a bead travels the halo at ONE LAP PER SECOND.
 * That is deliberately not a progress indicator: §64 measured that nothing in
 * this app knows how long the wait will be — 1.47s at P90 for the best detector
 * and 1.99s for the shipped one — so a bar filling toward an end would be an
 * invention. A lap is elapsed time, which is a fact, and it gives the pause a
 * shape without claiming to know when it stops.
 *
 * This is the second attempt at that. The first drew a pill under her with three
 * dots and then the words "say that again?", and it was removed for reasons that
 * apply to any caption: it was written in the first person, so it read as HER
 * asking, while the fault it reported was that her audio never arrived. The bead
 * says nothing, blames nobody, and is on her rather than beside her.
 */

export type Halo = 'off' | 'closed' | 'open'

/**
 * Which state she is in, from the two booleans the rig already holds.
 *
 * A function rather than three lines inside the render closure, because this is
 * the whole semantic content of the halo and it deserves to be checkable without
 * a canvas. `hearing` conflates two causes — main computes it as
 * `!asleep && mayHear` — so `resting` is what tells resting apart from withheld.
 */
export function haloFor(hearing: boolean, resting: boolean): Halo {
  if (hearing) return 'open'
  return resting ? 'closed' : 'off'
}

export interface HaloColours {
  /** Her colour, filled — the open state. */
  readonly her: string
  /** Her colour as a film, for the interior of the open halo. */
  readonly veil: string
  /** Paper at low alpha: the closed ring, over a desktop of unknown colour. */
  readonly quiet: string
}

export interface HaloRect {
  /** Centre, in canvas CSS pixels. */
  readonly x: number
  readonly y: number
  /** Semi-axes, before the tilt. */
  readonly rx: number
  readonly ry: number
  readonly tilt: number
}

/** Its size. Narrower than she is, so it never widens her window. */
const WIDTH = 66
const HEIGHT = 16
/**
 * The lean. Enough to read as a halo in perspective, not enough to look knocked
 * off — and it is what makes the shape read as a ring rather than as a line.
 */
const TILT = (-12 * Math.PI) / 180
/** Daylight between her scalp and the lowest point of the tilted ellipse. */
const CLEAR = 6

/**
 * How far the tilted ellipse reaches above and below its own centre.
 *
 * `sqrt((a·sinθ)² + (b·cosθ)²)` — the half-height of a rotated ellipse's
 * bounding box. Computed rather than measured off a drawing, because `WIDTH`
 * and `TILT` are the kind of numbers somebody adjusts by eye and the clearance
 * above her head has to follow them.
 */
export function haloReach(): number {
  const a = WIDTH / 2
  const b = HEIGHT / 2
  return Math.sqrt((a * Math.sin(TILT)) ** 2 + (b * Math.cos(TILT)) ** 2)
}

/**
 * Where it sits: centred on her, above her head.
 *
 * Above ALWAYS, with no room-aware flip. The chip moves to her other side when
 * it would leave the screen because it is a control and an unreachable control
 * is broken; this is a readout, and a halo that jumped under her chin near the
 * top of the display would say something different every time she moved.
 */
export function haloRect(her: Body): HaloRect {
  return {
    x: her.left + her.width / 2,
    y: her.top - CLEAR - haloReach(),
    rx: WIDTH / 2,
    ry: HEIGHT / 2,
    tilt: TILT,
  }
}

/** Where a bead sits after `heldFor` seconds, in radians. One lap a second. */
export function beadAngle(heldFor: number): number {
  if (!Number.isFinite(heldFor) || heldFor <= 0) return 0
  return (heldFor % 1) * Math.PI * 2
}

/** The bead's own radius. Small enough to read as travelling ON the ring. */
const BEAD = 3

/**
 * Draw it.
 *
 * `opacity` fades the whole thing — she is drawn faint while she rests, and the
 * halo goes with her rather than staying at full strength over a sleeping face.
 *
 * It does NOT take the mouse, and that is the difference between this and the
 * chip: this is not a control, so `bubble.ts`'s rule that only painted pixels of
 * HERS take the mouse is untouched.
 */
export function drawHalo(
  ctx: CanvasRenderingContext2D,
  her: Body,
  colours: HaloColours,
  state: Halo,
  opacity: number,
  heldFor: number | null,
  _room?: Room,
): void {
  if (state === 'off' || opacity <= 0) return
  const ring = haloRect(her)

  ctx.save()
  ctx.globalAlpha = Math.min(1, Math.max(0, opacity))
  ctx.translate(ring.x, ring.y)
  ctx.rotate(ring.tilt)

  ctx.beginPath()
  ctx.ellipse(0, 0, ring.rx, ring.ry, 0, 0, Math.PI * 2)

  if (state === 'open') {
    // Filled, but as a FILM: solid her-colour over her head reads as a plate,
    // and the ring is the shape that has to survive, not the interior.
    ctx.fillStyle = colours.veil
    ctx.fill()
    ctx.strokeStyle = colours.her
    ctx.lineWidth = 2.5
  } else {
    ctx.strokeStyle = colours.quiet
    ctx.lineWidth = 1
  }
  ctx.stroke()

  if (heldFor !== null) {
    // On the ellipse, at the angle elapsed time puts it. Drawn inside the same
    // rotation as the ring, so it cannot drift off the path it is meant to run.
    const angle = beadAngle(heldFor)
    ctx.beginPath()
    ctx.arc(Math.cos(angle) * ring.rx, Math.sin(angle) * ring.ry, BEAD, 0, Math.PI * 2)
    ctx.fillStyle = state === 'open' ? colours.her : colours.quiet
    ctx.fill()
  }

  ctx.restore()
}
