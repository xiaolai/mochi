/**
 * What every section of her sheet is built from: a heading, and a row of
 * choices where exactly one is current.
 *
 * Below the sections rather than beside them. `shelf.ts` holds the ORDER the
 * sections appear in and imports each one; each one needs this vocabulary, so
 * leaving it in `shelf.ts` would have made every section import the file that
 * imports it.
 */

import { SAYS } from '../shelf-says'
import { element } from '../../element'
import { type ShelfHandlers, chooser, section } from './row'
import { type ShelfCharacter, type ShelfView } from '@shared/history-window'
import { forPronoun } from '@shared/pronoun'
/**
 * Her voice, and whether her words are shown.
 *
 * Pills rather than a `<select>`, per the artifact: there are ten, they are all
 * one word, and the whole set fits in the width a closed dropdown would take.
 * §21 locks the voice after her first audio, so a change is a reconnect rather
 * than an update — the hint says so.
 */
export function voiceSection(
  view: ShelfView,
  worn: ShelfCharacter,
  handlers: ShelfHandlers,
): HTMLElement {
  const recommended = new Set(view.recommendedVoices)
  const pills = chooser(
    'pills',
    view.voices.map((one) => ({ value: one, label: one, marked: recommended.has(one) })),
    worn.voice,
    (value) => {
      handlers.save({ id: worn.id, voice: value })
    },
  )

  /*
    What the dot means, said once under the row rather than in ten tooltips.

    Careful about whose claim it is. §25's "What is NOT established" is explicit
    that latency and quality are entirely unmeasured here — nobody in this
    project has listened to ten voices and ranked them — so this points at
    somebody else's recommendation instead of making one. The one fact measured
    on this machine is in §24 §3: the service's own default output voice is
    `marin`, which is one of the two.
  */
  const marked = element('p', 'note')
  const dot = element('span', 'dot')
  dot.setAttribute('aria-hidden', 'true')
  marked.append(dot, ` ${view.recommendedVoices.join(' and ')} are the two OpenAI recommends `)
  marked.append('for realtime. The rest all work; nothing here has measured how they sound.')

  const body: HTMLElement[] = [pills]
  // Only when there is something to explain. A legend for a mark that is not on
  // screen is a sentence about nothing, and this list comes from main.
  if (view.recommendedVoices.length > 0) body.push(marked)
  return section('Voice', forPronoun(SAYS.nextWake, view.pronoun), ...body)
}
