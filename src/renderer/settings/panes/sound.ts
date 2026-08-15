/**
 * What this computer does with the microphone.
 *
 * ## The one that is not a preference
 *
 * `listenWhileSpeaking` is here because of a failure, not because somebody
 * wanted an option. On a laptop her own voice reaches the microphone; echo
 * cancellation removes most of it and not all of it; what survives is
 * speech-shaped, so the server's turn detector scores it as somebody talking
 * and she stops mid-sentence to listen to herself. Through earphones the loop
 * does not exist and the same session is flawless -- which is exactly why this
 * is a machine setting and not hers, and why the pane says which case it is
 * for rather than naming the mechanism.
 *
 * ## Applied on the next wake, and it says so
 *
 * All three are read when a session OPENS: two are `getUserMedia` constraints
 * and one is a `session.update` field. Changing them mid-conversation would
 * move the microphone under a turn already in flight. Saying "next time she
 * wakes" is smaller than the machinery to do it live, and honest.
 */

import { EAGERNESS, LISTENING, type Eagerness, type Listening, type Sound } from '@shared/sound'
import type { SaveProblem, SettingsSnapshot } from '@shared/ipc'
import { el, field, select } from '../form'
import type { Copy } from '../copy'

/** What this section needs the window to do for it. */
export interface SoundDeps {
  readonly act: (
    what: string,
    run: () => Promise<readonly SaveProblem[] | void>,
    after?: () => void,
  ) => void
  readonly showProblems: (problems: readonly SaveProblem[]) => void
}

export function soundSection(
  { t, say }: Copy,
  snapshot: SettingsSnapshot,
  deps: SoundDeps,
): HTMLElement {
  const sound = snapshot.sound

  /** Send the whole block, so a save cannot half-apply. */
  const save = (next: Sound): void => {
    deps.act('could not change the sound settings', async () => {
      deps.showProblems(await window.mochiSettings.saveSound(next))
    })
  }

  // Named after the SITUATION, not the mechanism. "Half duplex" is the
  // accurate term and nobody whose companion keeps interrupting herself would
  // search for it. `auto` is first and is the default: the two manual answers
  // exist because a measurement can be wrong, not because somebody should have
  // to maintain one.
  const listening = select<Listening>(
    LISTENING,
    (value) => t.soundListen[value],
    sound.listening,
    (value) => {
      save({ ...sound, listening: value })
    },
  )

  const eagerness = select<Eagerness>(
    EAGERNESS,
    (value) => t.soundEagerness[value],
    sound.eagerness,
    (value) => {
      save({ ...sound, eagerness: value })
    },
  )

  // A SELECT rather than a checkbox, and the reason is not taste: there is no
  // checkbox anywhere in this app. Every control here is a select, a radio, a
  // slider or a button, so a checkbox would be a new control in the design
  // system -- its own states, its own focus ring, its own dark-scheme fill --
  // introduced for one boolean.
  const cancel = select<'on' | 'off'>(
    ['on', 'off'],
    (value) => (value === 'on' ? t.soundEchoOn : t.soundEchoOff),
    sound.echoCancellation ? 'on' : 'off',
    (value) => {
      save({ ...sound, echoCancellation: value === 'on' })
    },
  )

  // What it HEARD, under the control that acts on it.
  //
  // An automatic decision nobody can see is one nobody can tell from a
  // malfunction -- and this one decides whether she can be interrupted, which
  // is the kind of thing a person notices and cannot explain. Shown only under
  // `auto`, because under the manual answers there is no judgement to show.
  const heard = (): string => {
    if (sound.listening !== 'auto') return ''
    if (snapshot.loopbackHeard === null) return say(t.soundHeardNothing)
    return snapshot.loopbackHeard ? say(t.soundHeardEcho) : say(t.soundHeardClear)
  }

  return el('div', { class: 'sound' }, [
    field('sound-listening', say(t.soundListening), listening, say(t.soundListeningHint)),
    ...(heard() === ''
      ? []
      : [el('p', { class: 'field-hint sound-heard' }, [document.createTextNode(heard())])]),
    el('p', { class: 'field-hint sound-advice' }, [document.createTextNode(say(t.soundPrefer))]),
    field('sound-aec', t.soundEcho, cancel, t.soundEchoHint),
    field('sound-eagerness', say(t.soundTurn), eagerness, t.soundTurnHint),
    el('p', { class: 'field-hint sound-when' }, [document.createTextNode(say(t.soundNextWake))]),
  ])
}
