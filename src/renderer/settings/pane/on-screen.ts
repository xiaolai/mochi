/** The "on-screen" group of settings. One pane per file; `panes.ts` keeps only the order. */

import { SAYS } from '../panes-says'
import { element } from '../../element'
import { type Pane, type Field, field, options } from '../pane'
import { HALO_LABELS } from '../panes-says'
import { forPronoun } from '@shared/pronoun'

/**
 * The three settings this group holds, named once.
 *
 * Keywords are what somebody TYPES, which is rarely what the setting is called:
 * nobody hunting for the ring around her face types "halo", and nobody looking
 * for how long she waits before sleeping types "rest". See `Field`.
 */
const FIELDS: Readonly<Record<'halo' | 'chip' | 'rest', Field>> = {
  halo: {
    id: 'halo',
    label: 'Halo',
    // `microphone` and `listening` because this ring is the one surface that
    // says the microphone is open — which is the whole argument for why its
    // choices are three rather than an off switch, twenty lines below.
    keywords: ['ring', 'glow', 'microphone', 'listening', 'hide'],
  },
  chip: {
    id: 'shoulder-button',
    label: 'Shoulder button',
    keywords: ['chip', 'settings button', 'bubble'],
  },
  rest: {
    id: 'rest',
    label: 'Rest',
    keywords: ['sleep', 'idle', 'timeout', 'disconnect', 'after minutes'],
  },
}

/** Where she sits, and where her words go when she has any. */
export const ON_SCREEN: Pane = {
  id: 'on-screen',
  label: 'On screen',
  attention: () => null,
  fields: () => [FIELDS.halo, FIELDS.chip, FIELDS.rest],
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
    /*
      THE STORED VALUE IS ALWAYS ONE OF THE CHOICES, even when it is not one of
      ours.

      `sleepAfterMinutes` is any whole number of minutes — `isSleepAfterMinutes`
      says so, and `preferences.json` is hand-editable — while this offers a
      short list. A stored 47 matched no option, so nothing was marked selected
      and the browser showed the FIRST one, which is "never".

      That is the worst possible default to show wrongly: the pane claimed she
      never rests while she rested every 47 minutes, and the next touch of any
      other control on this pane would have saved the lie.

      Unioned and sorted rather than appended, so an unusual value sits where it
      belongs in the list instead of announcing itself at the end.
    */
    const offered = [
      ...new Set([...view.screen.sleepAfterChoices, view.screen.sleepAfterMinutes]),
    ].sort((a, b) => a - b)
    options(
      rest,
      offered.map((minutes) => ({
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

    /*
      EACH NOTE INSIDE THE SECTION IT IS ABOUT.

      Three sections and three sentences, and every sentence was a SIBLING of the
      section it explains — so the column's 26px gap fell between a control and
      its own note, and the note sat closer to the next heading than to the thing
      it describes. `looking.ts` had the same shape and it put a sentence about
      the workspace under "Codex profile".
    */
    return [
      field(FIELDS.halo, view, halo, { note: forPronoun(SAYS.halo, view.pronoun) }),
      field(FIELDS.chip, view, chipSwitch, { note: forPronoun(SAYS.chip, view.pronoun) }),
      field(FIELDS.rest, view, rest, { note: forPronoun(SAYS.rests, view.pronoun) }),
    ]
  },
}
