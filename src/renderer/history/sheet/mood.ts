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
import { faceTile } from './face-tile'
import { type ShelfHandlers, section } from './row'
import { EMOTIONS, type Emotion } from '@shared/avatar'
import { moods, type Moods } from '../../rules/moods'
import { type ShelfCharacter, type ShelfView } from '@shared/history-window'
import { type ByPronoun, forPronoun } from '@shared/pronoun'
/**
 * What each face is for. The artifact's captions, in `EMOTIONS` order.
 *
 * `ByPronoun` for all eight even though only two of them name her, because a
 * table where six entries are strings and two are objects is a table somebody
 * adds the ninth to in the wrong shape. Two DID name her and were missed on the
 * first pass: a he/him character's tiles read "what she falls back to".
 */
export const MOOD_WHEN: Readonly<Record<Emotion, ByPronoun>> = {
  neutral: {
    she: 'the default, and what she falls back to',
    he: 'the default, and what he falls back to',
    it: 'the default, and what it falls back to',
  },
  happy: {
    she: 'good news, or you came back',
    he: 'good news, or you came back',
    it: 'good news, or you came back',
  },
  shy: {
    she: 'praised, or caught being wrong',
    he: 'praised, or caught being wrong',
    it: 'praised, or caught being wrong',
  },
  sad: {
    she: 'bad news she has to deliver',
    he: 'bad news he has to deliver',
    it: 'bad news it has to deliver',
  },
  angry: {
    she: 'rarely, and never at you',
    he: 'rarely, and never at you',
    it: 'rarely, and never at you',
  },
  surprised: {
    she: 'a number that was not expected',
    he: 'a number that was not expected',
    it: 'a number that was not expected',
  },
  /*
    What she chooses, not what the app sets.

    This read "while a lookup is running", which was a caption for machinery
    that does not exist: nothing in the build has ever set this face, and
    `setEmotion` has no caller outside the rig and this preview. A
    running lookup is now drawn by the bead travelling her halo — see
    `halo.ts` — which is the app's own statement about the app's own wait, and
    leaves this face meaning what the tool says it means.
  */
  thinking: {
    she: 'working something out, when she says so',
    he: 'working something out, when he says so',
    it: 'working something out, when it says so',
  },
  sleepy: { she: 'the hour ran out', he: 'the hour ran out', it: 'the hour ran out' },
}

/**
 * The eight faces, and which of them she may reach for.
 *
 * `faces` used to narrow `set_expression`'s enum. That tool is gone (2026-08-26,
 * never called in 275 sessions), and nothing has taken its place: no code reads
 * `persona.faces` to decide what she wears. What this switchboard decides today
 * is which tiles the preview below offers, and what her prompt says she has.
 * The old note read: it narrowed the enum
 * before it goes on the wire and appears in her prompt, and until now the only
 * way to change it was hand-editing a manifest.
 *
 * Each tile draws HER at that expression, in her colour, so the switch is
 * beside the thing it decides. Turning one off is not a rule she is asked to
 * follow — it is not in her tool list at all.
 */
/**
 * One face: what it looks like, when she wears it, and whether she may.
 *
 * Its own function because `moodSection` was one loop whose body was the entire
 * function — eight tiles built inline, with the rationale for the button, the
 * checkbox and the mutation rule stacked in the middle of a grid assembly.
 *
 * `on` is passed in and MUTATED rather than copied, which is load-bearing and
 * documented below: two toggles before the reload lands must see each other.
 */
function moodTile(
  emotion: Emotion,
  on: Moods,
  view: ShelfView,
  worn: ShelfCharacter,
  handlers: ShelfHandlers,
): HTMLElement {
  const allowed = on.allowed().includes(emotion)
  const tile = element('div', allowed ? 'mood' : 'mood off')
  /*
    The DRAWING is the button, not the tile around it.

    Clicking it puts that expression on her at the size she appears on the
    desktop, and it is the ONLY way to see six of the eight. Two are reached
    without asking — neutral when she sleeps, a perk when she wakes — and
    nothing else changes her face at all.

    Two earlier versions of this note were wrong about why, which is worth
    recording because both sounded right. The first said `set_expression`'s
    manifest told her not to change face every reply; that tool is gone. The
    second said her face was driven by how long she had been left alone;
    `repose.ts` drives MOTION and contains no expression code.

    Wrapping the whole tile was the first version and it is invalid HTML — the
    `allowed` checkbox lives inside it, and interactive content nested in a
    `<button>` is not reliably clickable in Chromium. So the target is the one
    thing somebody is actually looking at, and the switch beside it keeps its
    own job with nothing to disambiguate.
  */
  const tryIt = element('button', 'mood-try')
  tryIt.type = 'button'
  // What it DOES. The name under it is what the expression is called; a
  // tooltip repeating that would tell nobody anything they cannot see.
  tryIt.title = `See ${emotion}${forPronoun(SAYS.seeMoodOn, view.pronoun)}`
  tryIt.append(faceTile(worn.face, 56, emotion))
  tryIt.addEventListener('click', () => {
    handlers.tryFace(emotion)
  })
  tile.append(
    tryIt,
    element('span', 'name', emotion),
    element('span', 'when', forPronoun(MOOD_WHEN[emotion], view.pronoun)),
  )

  const box = element('input')
  box.type = 'checkbox'
  box.checked = allowed
  box.id = `mood-${emotion}`
  box.addEventListener('change', () => {
    /*
      `on` is MUTATED, not copied.

      Each toggle sent the whole list, rebuilt from the set as it was at
      RENDER time. Two toggles before the reload lands therefore both start
      from the same snapshot, and the second one's payload has no idea the
      first happened — turning `happy` on and then `sad` on wrote a list with
      `sad` and without `happy`, silently undoing a change the tile still
      showed as made.

      Mutating the live set makes the second payload include the first, which
      is what somebody clicking two tiles in a row asked for.
    */
    // The live set, mutated rather than rebuilt from a render-time snapshot —
    // and the whole list every time, in `EMOTIONS` order. Both are C2's rule,
    // and both live in `rules/moods.ts` where they are exercised.
    handlers.save({ id: worn.id, faces: on.allow(emotion, box.checked) })
  })
  const label = element('label', undefined, 'allowed')
  label.htmlFor = box.id
  const allow = element('span', 'allow')
  allow.append(box, label)
  tile.append(allow)
  return tile
}

export function moodSection(
  view: ShelfView,
  worn: ShelfCharacter,
  handlers: ShelfHandlers,
): HTMLElement {
  const on = moods(worn.faces)
  const grid = element('div', 'moods')
  for (const emotion of EMOTIONS) {
    grid.append(moodTile(emotion, on, view, worn, handlers))
  }

  const how = element('p', 'note', forPronoun(SAYS.moodsHow, view.pronoun))
  const body: HTMLElement[] = [how, grid]
  // Empty is LEGAL and is not the same as "all of them" — `readFaces` gives
  // every face to a manifest that does not mention them, and an empty list is
  // somebody saying none. The tool refuses in as many words; the pane should
  // not let that be a surprise.
  if (on.allowed().length === 0)
    body.push(element('p', 'note bad', forPronoun(SAYS.noMoods, view.pronoun)))
  return section('Moods', forPronoun(SAYS.moods, view.pronoun), ...body)
}
