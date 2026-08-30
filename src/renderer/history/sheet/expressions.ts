import { EMOTIONS, type Emotion } from '@shared/avatar'
import { type ShelfCharacter, type ShelfView } from '@shared/history-window'
import { forPronoun } from '@shared/pronoun'
import { element } from '../../element'
import { permitted } from '../../rules/expressions'
import { faceTile } from './face-tile'
import { type ShelfHandlers, section } from './row'
import { SAYS } from '../shelf-says'

/**
 * Her eight expressions, each at the size she is actually drawn.
 *
 * ## Why this came back
 *
 * There were mood tiles once and they were deleted, correctly: nothing in this
 * application consulted a character's expression set to decide what she wears,
 * so the switch changed one sentence in her instructions and nothing else. What
 * went with them was the only place you could SEE her eight faces, which the
 * brief asks for in its own right (§3.5) and which the deletion took as
 * collateral.
 *
 * Both halves are back, and the switch is load-bearing this time —
 * `companion/face.ts` asks `rules/expressions.ts` what she may wear before the
 * waking perk. Restored as drawn against the old code, it would have decided
 * whether she is TOLD she has a face she cannot be asked to make: a control that
 * looks like it does something and answers with nothing, which is rule A1 one
 * layer up.
 *
 * ## Seeing one and permitting it are two actions — contract C5
 *
 * The tile draws the face whatever the switch says. A gallery that hid withheld
 * expressions would collapse the two questions into one control, and "you can
 * always look" is the rule the delivery states. It is also the more useful
 * behaviour: the reason to withhold one is usually that you have looked at it.
 *
 * ## At her desktop size, not at a thumbnail's
 *
 * The point of the screen is what she will actually look like. `size` is her
 * own, so a character drawn small on the desktop is drawn small here — a grid of
 * identical 118px faces would be a different claim about every character.
 */
export function expressionsSection(
  view: ShelfView,
  worn: ShelfCharacter,
  handlers: ShelfHandlers,
): HTMLElement {
  const grid = element('div', 'faces')

  for (const emotion of EMOTIONS) {
    const tile = element('div', 'face-tile')
    /*
      DRAWN whatever the switch says — C5.

      `faceTile` refuses a missing face rather than substituting a built-in, so a
      character with no file on disk gets the dashed placeholder here too, eight
      times, which is the honest answer and says so once per tile.
    */
    tile.append(faceTile(worn.face, Math.round(worn.size ?? 100), emotion))
    tile.append(element('div', 'face-name', NAMES[emotion]))
    tile.append(element('p', 'face-when', WHEN[emotion]))

    const allow = element('input')
    allow.type = 'checkbox'
    allow.id = `allow-${emotion}`
    allow.checked = permitted(worn.faces, emotion)
    allow.addEventListener('change', () => {
      /*
        The WHOLE set, mutated from what is stored — contract C2.

        Turning `happy` on and then `sad` on both computed from the set this pane
        was DRAWN with, so the second write carried a list with `sad` in it and
        `happy` missing. Reading `worn.faces` at the moment of the change rather
        than closing over a snapshot is the whole of the fix; the pane is rebuilt
        from what main holds after each write, so the next click reads the value
        the last one produced.
      */
      const next = allow.checked
        ? [...worn.faces, emotion].filter((one, at, all) => all.indexOf(one) === at)
        : worn.faces.filter((one) => one !== emotion)
      // In `EMOTIONS` order, always. The manifest is read by people, and a list
      // whose order records the sequence somebody clicked in is noise on disk.
      handlers.save({ id: worn.id, faces: EMOTIONS.filter((one) => next.includes(one)) })
    })
    const label = element('label', 'face-allow', allow.checked ? 'Allowed' : 'Withheld')
    label.htmlFor = allow.id
    const row = element('div', 'row')
    row.append(allow, label)
    tile.append(row)
    grid.append(tile)
  }

  const kept = worn.faces.length
  return section(
    forPronoun(SAYS.expressions, view.pronoun),
    `${String(EMOTIONS.length)} drawn · ${String(kept)} of ${String(EMOTIONS.length)} allowed`,
    element('p', 'note', forPronoun(SAYS.seeingAndPermitting, view.pronoun)),
    grid,
    element('p', 'note', forPronoun(SAYS.mayBeEmpty, view.pronoun)),
  )
}

/** The name on the tile. Sentence case, because it is a word rather than a key. */
const NAMES: Readonly<Record<Emotion, string>> = {
  neutral: 'Neutral',
  happy: 'Happy',
  shy: 'Shy',
  sad: 'Sad',
  angry: 'Angry',
  surprised: 'Surprised',
  thinking: 'Thinking',
  sleepy: 'Sleepy',
}

/**
 * When she wears it, in the fewest words that are true.
 *
 * Pronoun-free on purpose, and checked: every one is about an OCCASION rather
 * than about her, so none needs wording three ways. "good news, or you came
 * back" is the same sentence whoever is worn. `neutral` read "what she falls
 * back to" and `pronoun-copy.test.ts` caught it — the one entry here that was
 * about her rather than about a moment.
 */
const WHEN: Readonly<Record<Emotion, string>> = {
  neutral: 'the resting face, and the fallback',
  happy: 'good news, or you came back',
  shy: 'praised, or caught out',
  sad: 'bad news, or you left',
  angry: 'you can still see it here',
  surprised: 'cut off mid-sentence, and on waking',
  thinking: 'looking something up',
  sleepy: 'resting, or about to',
}
