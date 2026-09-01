import { element } from '../../element'
import { type ShelfHandlers, section } from './row'
import { forPronoun } from '@shared/pronoun'
import { SAYS } from '../shelf-says'
import type { ShelfCharacter, ShelfView } from '@shared/history-window'
import { FACE_BOUNDS } from '@shared/avatar-spec'
import { anchor } from '../../field'
import { HER_FIELDS } from './fields'

/**
 * How big she is drawn, and the way back to her own answer.
 *
 * ## Why this control exists at all
 *
 * `FaceSpec.size` was reachable only by hand-editing an avatar file — which is
 * the exact thing the face format exists to prevent one level up. Its own
 * comment says so: size is part of the face "because leaving it out made it a
 * code change". Leaving the control out made it a file edit, which is the same
 * mistake one storey down.
 *
 * ## Why a persona field rather than one number for the app
 *
 * The value it overrides is declared per face, so a single global number would
 * fight whichever face it did not suit. A tiny sprite and a large figure want
 * different answers, and "her size" is a sentence about her.
 */
/**
 * The band, from the one table that owns it.
 *
 * This held its own copy of the three numbers. `FACE_BOUNDS.size` is where a
 * user-supplied size is refused, and that table says in as many words why a
 * second copy is wrong: "Two copies would let the editor offer a value the
 * loader rejects, which presents to a user as 'I designed this and the app
 * ignored it'." There had come to be four.
 */
const BAND = FACE_BOUNDS.size

/**
 * What a range input's `step` should be to hold this value.
 *
 * Extracted and exported so it can be ASSERTED. The suite runs in node with no
 * DOM emulator — deliberately, and the config says why: "Decisions worth
 * testing are written as pure functions with their dependencies injected." The
 * decision here is arithmetic; the element around it is not.
 *
 * `'any'` is a real value for the attribute and means "no grid", which is the
 * honest answer when the number in force is not on one.
 */
export function stepFor(value: number, band: { min: number; step: number } = BAND): string {
  const onGrid = Number.isInteger((value - band.min) / band.step)
  return onGrid ? String(band.step) : 'any'
}

export function sizeSection(
  view: ShelfView,
  worn: ShelfCharacter,
  handlers: ShelfHandlers,
): HTMLElement {
  const chosen = worn.size
  const shown = chosen ?? view.face.size

  const slider = element('input', 'size-slider')
  slider.type = 'range'
  slider.min = String(BAND.min)
  slider.max = String(BAND.max)
  /*
    THE STEP WIDENS when the value in force is not on the grid.

    `step` is documented in `FACE_BOUNDS` as "Granularity a slider should offer.
    Not enforced -- a spec may be finer" — so a face is entitled to declare 52,
    and one does not have to be hand-written for this to happen. Assigning that
    to a `step: 5` range input does not fail: the browser SANITISES it to the
    nearest valid step and the control silently holds 50.

    The reading was built from `shown` rather than from the control, so the pane
    then said "52%" over a slider sitting at 50 — and the first drag would save
    a number nobody chose. Two wrongs pointing the same way: the control
    misrepresents the setting, and the label misrepresents the control.

    So the grid is offered when it can be, and stood down when it cannot.
  */
  slider.step = stepFor(shown)
  slider.value = String(shown)

  // From the CONTROL, not from `shown`. Whatever the browser did with the
  // assignment above, these two now cannot disagree.
  const reading = element('span', 'size-reading', `${slider.value}%`)

  /*
    HOW FAR ALONG, as a number the sheet can paint with.

    The track is drawn here rather than left to the browser — see `.size-slider`
    — and a two-tone bar needs to know where the join is. There is no CSS that
    answers "how far along is this range", and the one Chromium pseudo-element
    that fills the left half disappears the moment `appearance: none` lets us
    style the track at all. So the value is written back as a percentage and the
    gradient reads it.

    Set on every `input`, not on `change`: the fill has to follow the thumb
    while it is being dragged, which is the whole point of it.
  */
  const paint = (): void => {
    const min = Number(slider.min)
    const span = Number(slider.max) - min
    const along = span === 0 ? 100 : ((Number(slider.value) - min) / span) * 100
    slider.style.setProperty('--along', `${String(along)}%`)
  }
  paint()

  // While DRAGGING, only the reading moves. A save per pointer event would be
  // a manifest write per pixel, and the window resize behind it.
  slider.addEventListener('input', () => {
    reading.textContent = `${slider.value}%`
    paint()
  })
  slider.addEventListener('change', () => {
    handlers.save({ id: worn.id, size: Number(slider.value) })
  })

  const back = element('button', 'btn', forPronoun(SAYS.sizeOwn, view.pronoun))
  back.type = 'button'
  // Absent when she has not disagreed with it: a button that undoes nothing is
  // a button somebody has to work out the meaning of.
  back.disabled = chosen === null
  back.addEventListener('click', () => {
    handlers.save({ id: worn.id, size: null })
  })

  const row = element('div', 'size-row')
  row.append(slider, reading)

  return anchor(
    HER_FIELDS.size,
    section(
      forPronoun(SAYS.sizeHeading, view.pronoun),
      forPronoun(chosen === null ? SAYS.sizeAsFaceAsks : SAYS.sizeYours, view.pronoun),
      row,
      back,
    ),
  )
}
