/**
 * How long she stays awake when nobody is saying anything.
 *
 * ## Its own section, for one control
 *
 * It was nearly put under Sound, which is where the microphone lives and where
 * the cost of "never" is felt. Two things stopped that. The pane ends with
 * "these apply the next time she wakes", and this one applies immediately --
 * the lifecycle reads its settings on every tick -- so it would have sat under
 * a sentence that was false about it. And the question it answers is not about
 * the microphone: it is about how long she stays.
 *
 * ## The values are a set, not a number
 *
 * See `IDLE_CHOICES`. The short answer is that the useful values are not evenly
 * spread, so a free field's extra reach is reach into values nobody wants.
 *
 * ## "Never" states its price where it is chosen
 *
 * The same shape as the `anytime` delegation trigger, and for the same reason:
 * the expensive option stays reachable, and the cost is shown while it is
 * selected rather than hidden behind it. Here the cost is a meter -- an
 * open session bills for what it listens to -- which is exactly the sort of
 * thing somebody discovers a month later on an invoice.
 */

import {
  IDLE_CHOICES,
  idleFromKey,
  idleKey,
  type IdleChoice,
  type IdleKey,
} from '@shared/companion'
import type { SaveProblem, SettingsSnapshot } from '@shared/ipc'
import { el, field, select } from '../form'
import type { Copy } from '../copy'

/** What this section needs the window to do for it. */
export interface PresenceDeps {
  readonly act: (
    what: string,
    run: () => Promise<readonly SaveProblem[] | void>,
    after?: () => void,
  ) => void
  readonly showProblems: (problems: readonly SaveProblem[]) => void
}

export function presenceSection(
  { t, say }: Copy,
  snapshot: SettingsSnapshot,
  deps: PresenceDeps,
): HTMLElement {
  const save = (next: IdleChoice): void => {
    deps.act('could not change when she sleeps', async () => {
      const problems = await window.mochiSettings.saveIdle(next)
      if (problems.length > 0) {
        // PUT BACK. Main kept the previous value and sends no snapshot for a
        // refusal, so the select went on showing a choice that was never
        // stored -- and the cost line below it agreed with the wrong one. A
        // control that shows an unsaved value is the failure this window is
        // most careful about everywhere else.
        idle.value = idleKey(snapshot.idleMs)
        showCost(snapshot.idleMs === null)
      }
      // RETURNED rather than reported here, so `act` can drop a result that a
      // newer action has already superseded.
      return problems
    })
  }

  // `select` keys by string and these are durations, so the options travel as
  // `IdleKey` and come back through `idleFromKey`. Both are derived from
  // `IDLE_CHOICES` in `shared/companion.ts` -- there is no second list here to
  // fall out of step with it.
  const idle = select<IdleKey>(
    IDLE_CHOICES.map(idleKey),
    (value) => t.idleChoice[value],
    idleKey(snapshot.idleMs),
    (value) => {
      showCost(value === 'never')
      save(idleFromKey(value))
    },
  )

  // Built ONCE and shown or hidden, rather than conditionally constructed.
  //
  // The first version rendered it only when the SNAPSHOT said never, so the
  // price of the expensive choice did not appear until main echoed a new
  // snapshot back -- and never at all if the save failed. A cost the user sees
  // after committing is not the informed consent this line exists to give, so
  // it now follows the control rather than the round trip.
  const cost = el('p', { class: 'field-hint presence-cost' }, [
    document.createTextNode(say(t.idleNever)),
  ])
  const showCost = (show: boolean): void => {
    cost.hidden = !show
  }
  showCost(snapshot.idleMs === null)

  return el('div', { class: 'presence' }, [
    field('presence-idle', say(t.idleLabel), idle, say(t.idleHint)),
    cost,
  ])
}
