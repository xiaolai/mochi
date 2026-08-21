/**
 * The little speech-bubble button that appears at her shoulder on hover.
 *
 * One control, one job: open the conversations she remembers. It lives in her
 * window rather than in a menu because the window is the only surface she has —
 * there is no title bar, no dock entry, and nothing else to hang it on.
 *
 * ## It DOES take the mouse, and that is a deliberate exception
 *
 * `bubble.ts` rule 3 says a bubble must not enlarge her hit region, because
 * `hitTest` is the promise that only painted pixels take the mouse. This is not
 * that: a control nobody can click is not a control, so while it is visible its
 * rectangle is solid on purpose.
 *
 * The promise is kept by making the exception exactly as large as the control
 * and no larger — `hits()` is a rectangle, not a margin, and `face.ts` only
 * consults it while the chip is actually on screen. When she is not hovered,
 * the corner is empty desktop again.
 *
 * ## Why it must stay up while the pointer is on IT
 *
 * The obvious rule — "show it while the pointer is on her" — cannot be clicked.
 * The chip sits outside her silhouette (that is the point of a corner), so
 * moving towards it leaves her, which hides it, which un-solids it under the
 * cursor. `visible()` therefore takes both, and the two together are stable:
 * the pointer is always on one or the other along any path between them.
 *
 * ## It can be switched OFF, and not from here
 *
 * `readShoulderChip` is a preference, and `face.ts` is where it is honoured.
 * `visible()` answers "is the pointer on it", which is a question about
 * geometry with one right answer whatever anybody has switched; putting the
 * preference in it would make a geometric predicate lie. The gate sits at the
 * single place that decides whether the control exists this frame — the fade —
 * and that is what makes one line enough: at zero the mark is not painted, its
 * rectangle stops taking the mouse, and the click handler returns early.
 */

import type { Body, Room } from './place'

/** Its size, in CSS pixels. Small: it is a handle, not a button bar. */
const SIZE = 26

/**
 * Where it sits relative to her corner, and it is worth stating in one place
 * because both extremes were tried and rejected by eye.
 *
 * Centred on the corner put a quarter of the button inside her outline — the
 * two ran into each other. Nine pixels clear of it read as unrelated to her,
 * floating in the desktop. Zero is the corner itself: the button's inner corner
 * touches the corner of her bounding box, which — because she is a rounded dome
 * and her box is not — leaves a small diagonal gap where her edge falls away,
 * and no overlap anywhere.
 */
const CLEAR = 0

/**
 * A margin around it for the purpose of STAYING VISIBLE, and for nothing else.
 *
 * Moving it clear of her opened a strip of empty desktop between the two, and
 * the rule "show it while the pointer is on her or on it" hides it exactly
 * halfway across — which un-solids the rectangle the cursor is travelling
 * towards. The click region is still the button and only the button; this is
 * about not vanishing on the way.
 */
const GRACE = 12

/** The badge, in CSS pixels. A dot, not a number: at this size a digit is mush. */
const DOT = 5

export interface ChipColours {
  /**
   * The bubble itself: HER colour, taken deep enough to carry white.
   *
   * It was `ink` on a `paper` plate — a black glyph in a light rounded square,
   * which is a system tray icon rather than anything of hers. Two things were
   * wrong with it and only one of them was the colour: the plate made a button
   * out of a control that belongs to her, so it read as an application's chrome
   * that happened to be parked at her shoulder.
   *
   * `--her-deep` rather than `--her`: her body is a fill seen at two hundred
   * pixels inside her own outline, and the same value in a fourteen-pixel mark
   * on an unknown desktop is a smudge. This is that colour darkened by a fixed
   * amount — plainly hers, and legible alone.
   */
  readonly herDeep: string
  /** The three dots, knocked out of it. What `--her-deep` is derived to carry. */
  readonly herDeepInk: string
  /**
   * The unread-problems dot. Not themed, unlike everything else here.
   *
   * The rest of the colour is handed in so she can sit on a light desktop or a
   * dark one. This one is not decoration -- it means "read me" -- and a red that
   * politely adapts to its surroundings can lose that argument. It is `--alarm`
   * rather than a literal now, and `tokens.css` carries the four measurements
   * that let one value serve both schemes.
   */
  readonly alarm: string
  /**
   * The ring around that dot, and the LAST thing here still drawn on paper.
   *
   * The plate is gone, so this is no longer "the surface it sits on" — it is
   * one 6px halo whose whole job is to keep a red dot from disappearing into a
   * red pixel of somebody's wallpaper. A badge is not readable on its own the
   * way a glyph in her colour is, because red against an unknown backdrop is a
   * coincidence away from nothing.
   */
  readonly paper: string
}

export interface Rect {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

/**
 * Which corner of her it sits on — the one with room for it ON SCREEN.
 *
 * Her top right by preference: it is the corner a badge belongs on, and the one
 * furthest from where the bubble's tail comes down. But she can be dragged into
 * any corner of the display, and a 26-pixel button pinned outside her top right
 * is half off the screen the moment she is against the right edge, and entirely
 * off it when she is against the top.
 *
 * The same question the bubble answers, at a twentieth of the size — so it is
 * asked the same way, against the `Room` rather than against the window.
 */
export function chipRect(her: Body, room?: Room): Rect {
  const rightOfHer = her.left + her.width + CLEAR
  const leftOfHer = her.left - CLEAR - SIZE
  const aboveHer = her.top - CLEAR - SIZE
  const belowHer = her.top + her.height + CLEAR

  // No room means the whole canvas, which is what every caller that does not
  // care about the screen — the tests, and anything drawing her in isolation —
  // should get.
  const x =
    room === undefined || rightOfHer + SIZE <= room.right
      ? rightOfHer
      : Math.max(room.left, leftOfHer)
  const y =
    room === undefined || aboveHer >= room.top ? aboveHer : Math.min(belowHer, room.bottom - SIZE)
  return { x, y, w: SIZE, h: SIZE }
}

/** Whether a point in CSS pixels is on it. */
export function hits(x: number, y: number, her: Body, room?: Room): boolean {
  const rect = chipRect(her, room)
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h
}

/**
 * Whether it should be on screen at all.
 *
 * `onHer` comes from the rig's silhouette test, which is per-pixel. The second
 * term is what makes it reachable — see the note above.
 */
export function visible(
  pointer: { x: number; y: number } | null,
  onHer: boolean,
  her: Body,
  room?: Room,
): boolean {
  /**
   * Hover, and nothing else — including when something has gone wrong.
   *
   * It showed itself unbidden while a problem was outstanding, on the argument
   * that somebody whose edited file was rejected has no reason to hover. That
   * argument was overruled: a control that appears on the desktop by itself is
   * a control that appears on the desktop by itself, however good its reason.
   *
   * What is kept is the mark ON it — see `drawChip` — so the hover that finds
   * it still says something is waiting. And the bubble's own copy of this
   * control keeps its unprompted badge, which is the common case: the bubble is
   * on by default, and the chip is only what remains when it is not.
   */
  if (pointer === null) return false
  if (onHer) return true
  // The button, plus the gap it now sits across. See `GRACE`.
  const rect = chipRect(her, room)
  return (
    pointer.x >= rect.x - GRACE &&
    pointer.x <= rect.x + rect.w + GRACE &&
    pointer.y >= rect.y - GRACE &&
    pointer.y <= rect.y + rect.h + GRACE
  )
}

/**
 * A speech bubble, drawn rather than shipped as an asset.
 *
 * Twenty lines of canvas against a file that has to be found, loaded, decoded,
 * scaled for two pixel ratios and kept in step with the theme. At this size the
 * drawing is also sharper, because it is drawn at the device ratio the window
 * happens to have rather than resampled to it.
 *
 * ## The glyph alone, at her colour
 *
 * There is no plate under it any more. It used to be a light rounded square
 * with a black bubble on it, which is a tray icon: a second application's
 * chrome standing beside her, in a colour belonging to neither the desktop nor
 * the character. What is left is the mark itself in `--her-deep`, so the one
 * control she carries looks like it is hers.
 *
 * ## The rectangle did not shrink with it
 *
 * `chipRect` is unchanged, so the glyph now fills a 26px target rather than
 * being a 14px glyph centred on a 26px plate. `hits()` still answers for the
 * whole rectangle and that is deliberate — the drawn mark is 20px across, which
 * is already at the bottom of what a pointer can be asked to find, and the
 * exception `chip.ts` makes to "only painted pixels take the mouse" was always
 * the size of the CONTROL rather than the size of the paint.
 */
export function drawChip(
  ctx: CanvasRenderingContext2D,
  her: Body,
  colours: ChipColours,
  opacity: number,
  problems = 0,
  room?: Room,
): void {
  if (opacity <= 0) return
  const { x, y, w, h } = chipRect(her, room)

  ctx.save()
  ctx.globalAlpha = opacity

  /*
    The glyph: a rounded speech bubble with a tail at the bottom left, and three
    dots — the shape that reads as "what was said" at this size.

    3 of padding rather than 6. The old number left room for a plate's corners
    around the mark; with the plate gone that margin is only a smaller drawing,
    and the mark is the whole control now.
  */
  const pad = 3
  const bx = x + pad
  const by = y + pad + 1
  const bw = w - pad * 2
  const bh = h - pad * 2 - 4

  ctx.fillStyle = colours.herDeep
  ctx.beginPath()
  ctx.roundRect(bx, by, bw, bh, 5)
  ctx.fill()

  ctx.beginPath()
  ctx.moveTo(bx + 4, by + bh)
  ctx.lineTo(bx + 4, by + bh + 4)
  ctx.lineTo(bx + 10, by + bh)
  ctx.closePath()
  ctx.fill()

  ctx.fillStyle = colours.herDeepInk
  for (let i = 0; i < 3; i += 1) {
    ctx.beginPath()
    ctx.arc(bx + bw / 2 + (i - 1) * 4.5, by + bh / 2, 1.4, 0, Math.PI * 2)
    ctx.fill()
  }

  /**
   * A dot, when something needs reading, ringed in the chip's own paper.
   *
   * The ring is what makes it legible against whatever is behind her — she may
   * be sitting on a photograph, and a bare red dot on a red pixel is nothing.
   * No count: at five pixels a digit is mush, and the number is on the other
   * side of one click anyway.
   */
  if (problems > 0) {
    ctx.fillStyle = colours.paper
    ctx.beginPath()
    ctx.arc(x + w - DOT, y + DOT, DOT + 1.5, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = colours.alarm
    ctx.beginPath()
    ctx.arc(x + w - DOT, y + DOT, DOT, 0, Math.PI * 2)
    ctx.fill()
  }

  ctx.restore()
}
