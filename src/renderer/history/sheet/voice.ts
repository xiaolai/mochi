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

/*
  The ten samples, resolved by the bundler rather than by string arithmetic.

  `import.meta.glob` gives a map of source path to emitted URL, so a clip that
  is not there is a build-time absence rather than a 404 nobody hears. The files
  are made by `scripts/voice-clips.mjs`, which records each voice saying the
  same sentence — see its header for why they are recorded rather than spoken
  live on every press.
*/
const CLIPS = import.meta.glob('../../voices/*.ogg', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

/** The emitted URL for one voice, or null when nothing was recorded for it. */
function clipFor(voice: string): string | null {
  const found = Object.entries(CLIPS).find(([path]) => path.endsWith(`/${voice}.ogg`))
  return found === undefined ? null : found[1]
}

/*
  ONE at a time, and restarted rather than layered.

  Choosing a voice is a comparison — cedar, then marin, then cedar — and a
  second press before the first clip ends must replace it, not play over it.
  Two voices at once is the one sound this control must never make.

  Module-level rather than per-section, because the sheet is rebuilt on every
  save: a player owned by the section would be a new element per redraw, and the
  clip playing when the redraw landed would go on playing under the new one.
*/
let playing: HTMLAudioElement | null = null

function play(voice: string): void {
  const url = clipFor(voice)
  if (url === null) return
  if (playing !== null) {
    playing.pause()
    playing.currentTime = 0
  }
  const audio = new Audio(url)
  playing = audio
  /*
    A rejected play is not an error worth surfacing. Chromium refuses one that
    is not tied to a gesture, and this always is — but a stale element paused
    mid-load rejects too, and that is the ordinary case here rather than a
    fault.
  */
  void audio.play().catch(() => {})
}
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
  marked.append('for realtime. Press any of them to hear it.')

  /*
    PRESSING A VOICE PLAYS IT, as well as choosing it.

    A separate play control per pill would be a button inside a button, which
    is invalid and which no keyboard can reach sensibly. Pressing the name is
    the gesture people already make, and hearing the result is what they were
    trying to find out.

    Listened for on the ROW rather than added to each button, because `chooser`
    owns those and it dispatches only when the value CHANGES — so a second press
    on the voice already chosen saves nothing and would otherwise play nothing,
    which is exactly the press somebody makes when comparing two.
  */
  pills.addEventListener('click', (event) => {
    const from = event.target
    if (!(from instanceof HTMLElement)) return
    const pressed = from.closest('button')
    if (pressed === null || !pills.contains(pressed)) return
    play((pressed.textContent ?? '').trim())
  })

  const body: HTMLElement[] = [pills]
  // Only when there is something to explain. A legend for a mark that is not on
  // screen is a sentence about nothing, and this list comes from main.
  if (view.recommendedVoices.length > 0) body.push(marked)
  return section('Voice', forPronoun(SAYS.nextWake, view.pronoun), ...body)
}
