import { element } from '../../element'
import { type ShelfHandlers, section } from './row'
import { forPronoun } from '@shared/pronoun'
import { SAYS } from '../shelf-says'
import type { ShelfCharacter, ShelfView } from '@shared/history-window'

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
const BAND = { min: 50, max: 200, step: 5 } as const

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
  slider.step = String(BAND.step)
  slider.value = String(shown)

  const reading = element('span', 'size-reading', `${String(shown)}%`)

  // While DRAGGING, only the reading moves. A save per pointer event would be
  // a manifest write per pixel, and the window resize behind it.
  slider.addEventListener('input', () => {
    reading.textContent = `${slider.value}%`
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

  return section(
    forPronoun(SAYS.sizeHeading, view.pronoun),
    forPronoun(chosen === null ? SAYS.sizeAsFaceAsks : SAYS.sizeYours, view.pronoun),
    row,
    back,
  )
}
