/** The "on-screen" group of settings. One pane per file; `panes.ts` keeps only the order. */

import { SAYS } from '../panes-says'
import { element } from '../../element'
import { type Pane, field, options } from '../pane'
import { HALO_LABELS } from '../panes-says'
import { forPronoun } from '@shared/pronoun'

/** Where she sits, and where her words go when she has any. */
export const ON_SCREEN: Pane = {
  id: 'on-screen',
  label: 'On screen',
  attention: () => null,
  render(view, handlers) {
    /*
      THREE answers, so a select rather than a switch.

      It was a checkbox over the resting hairline alone, and it had to be:
      while the halo was the only surface saying the microphone was open, an off
      switch was a way to make the worst thing this app can do happen. The tray
      marks itself while the microphone is live now — it cannot be hidden,
      dragged off a screen or switched off — so the halo is about her appearance
      and `never` is an ordinary answer.

      The choices come from main for the same reason `sides` does: a page
      holding its own list is a second answer to what may be chosen, and only
      one of the two is checked on the way back.
    */
    const halo = document.createElement('select')
    options(
      halo,
      view.screen.haloChoices.map((one) => ({ value: one, label: HALO_LABELS[one] ?? one })),
      view.screen.halo,
    )
    halo.addEventListener('change', () => {
      handlers.screen({ halo: halo.value })
    })

    /*
      The control at her shoulder, as a plain switch.

      Offerable in a way the halo is not, and the difference is worth stating
      beside them: the halo is the only thing on screen that says the microphone
      is open, so its switch had to be narrowed to the half that promises
      nothing. This one is a shortcut with two other doors — the same control is
      inside her bubble, and the menu bar opens the same window — so there is no
      half to hold back.
    */
    const chip = element('input')
    chip.type = 'checkbox'
    chip.checked = view.screen.shoulderChip
    chip.id = 'shoulder-chip'
    chip.addEventListener('change', () => {
      handlers.screen({ shoulderChip: chip.checked })
    })
    const chipLabel = element('label', undefined, forPronoun(SAYS.chipSwitch, view.pronoun))
    chipLabel.htmlFor = chip.id
    const chipSwitch = element('div', 'switch')
    chipSwitch.append(chip, chipLabel)

    /*
      How long she stays connected with nothing said.

      A `select` rather than a number field: the useful range is small and a
      free minute count invites a value that reads as reasonable and is not.
      The choices come from main for the same reason `sides` does — a page
      holding its own list is a second answer to what may be chosen, and only
      one of the two is checked on the way back.
    */
    const rest = document.createElement('select')
    options(
      rest,
      view.screen.sleepAfterChoices.map((minutes) => ({
        value: String(minutes),
        label:
          minutes === 0
            ? forPronoun(SAYS.restsNever, view.pronoun)
            : `after ${String(minutes)} minutes`,
      })),
      String(view.screen.sleepAfterMinutes),
    )
    rest.addEventListener('change', () => {
      handlers.screen({ sleepAfterMinutes: Number(rest.value) })
    })

    return [
      field('Halo', halo),
      element('p', 'note', forPronoun(SAYS.halo, view.pronoun)),
      field('Shoulder button', chipSwitch),
      element('p', 'note', forPronoun(SAYS.chip, view.pronoun)),
      field('Rests', rest),
      element('p', 'note', forPronoun(SAYS.rests, view.pronoun)),
    ]
  },
}
