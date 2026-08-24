import type { NoteAction, PersonaAction, PersonaChange } from '@shared/ipc'
import type { ShelfCharacter, ShelfView } from '@shared/history-window'
import { forPronoun, PRONOUNS, type ByPronoun, type Pronoun } from '@shared/pronoun'
import { SIDE_NAMES } from '@shared/persona'
import { EMOTIONS, type Emotion } from '@shared/avatar'
import type { FaceSpec } from '@shared/avatar-spec'
import { applyTheme, THEME_IDS } from '@shared/theme'
import { MochiAvatar } from '../companion/rig/mochi'
import { drawCentred } from './centre'
import { element } from '../element'
import { SAYS } from './shelf-says'

/**
 * The characters half of the shelf.
 *
 * ## Why this grew out of the conversations window rather than being a new one
 *
 * The handoff draws the shelf as a new 1440 × 900 window. It is cheaper than
 * that, and better: this window already had the list-and-pane layout, the
 * search, the problems strip and the export — it was the shelf's memory half
 * already. Adding the cast to it is a smaller change than a new window plus a
 * new renderer plus a preload role plus a new IPC surface, and it puts memory
 * and characters in one place, which is what the shelf is *for*.
 *
 * ## Everything here MOVED out of settings
 *
 * Not copied. `plan-shell.md`'s split decides what belongs where: a control is
 * the shelf's when it is about who she is or about what came of using her, and
 * settings' when it is true of this machine whoever is worn. Two places to set
 * one thing is what `menuHandlers` already exists to avoid.
 *
 * ## Sections, not plates
 *
 * The first build of this drew every field as an identical label-and-value
 * plate, which made her name, her colour and her memory look like rows of one
 * table. `Mochi Next.dc.html` draws them as SECTIONS in a document — a caps
 * heading, a hint in mono beside it, and whatever control the field actually
 * wants underneath. Eight themes want a grid of faces; a prompt wants a
 * textarea; a voice wants ten pills. A plate can only offer one shape.
 *
 * ## Every stored field has a control now
 *
 * `pronoun`, `addressUser`, `theme`, `style`, `greeting`, `farewell` and
 * `faces` were validated, migrated, persisted and reachable only by hand-editing
 * a manifest. `faces` was the sharpest: it narrows `set_expression`'s enum on
 * the wire and appears in her prompt, and it shipped with no UI at all.
 *
 * ## `document.createElement` and `textContent`, never `innerHTML`
 *
 * The same rule the rest of this window follows, and it matters more here: a
 * character's name and her prompt come out of a folder anybody can write to,
 * and the note below was written by a MODEL. Showing that text to a person is
 * safe; evaluating it is not.
 */

export interface ShelfHandlers {
  readonly wear: (id: string) => void
  /**
   * Put an expression on her, now, to look at it. Nothing is stored.
   *
   * Separate from `save` because it is not a change: the switch beside the tile
   * decides what she MAY use, and this decides nothing at all — it is how you
   * see the answer at the size she appears on the desktop rather than at 56px.
   */
  readonly tryFace: (face: Emotion) => void
  readonly save: (change: PersonaChange) => void
  readonly persona: (action: PersonaAction) => void
  readonly memory: (action: NoteAction) => void
  /** Store the system prompt document. Empty is a real answer. */
  readonly prompt: (text: string) => void
  /** Say what happened. Silence after a write reads as the write not landing. */
  readonly say: (text: string, bad?: boolean) => void
}

/** A caps heading, a hint in mono beside it, and the control underneath. */
function section(title: string, hint: string, ...body: readonly HTMLElement[]): HTMLElement {
  const wrap = element('section', 'section')
  const head = element('div', 'head')
  head.append(element('h3', undefined, title), element('span', 'hint', hint))
  wrap.append(head, ...body)
  return wrap
}

/** A row of buttons where exactly one is current. Used for pronoun and voice. */
function chooser(
  className: string,
  entries: readonly {
    readonly value: string
    readonly label: string
    /**
     * Whether this one carries a dot, and NOT what the dot means.
     *
     * The caller writes the sentence under the row; the dot is only a pointer
     * at it. A mark whose meaning lived here would be a claim made by a layout
     * helper — see `RECOMMENDED_VOICES` for how careful the claim has to be.
     */
    readonly marked?: boolean
  }[],
  chosen: string,
  pick: (value: string) => void,
): HTMLElement {
  const wrap = element('div', className)
  for (const entry of entries) {
    const button = element('button', undefined, entry.label)
    button.type = 'button'
    button.setAttribute('aria-current', String(entry.value === chosen))
    if (entry.marked === true) {
      /*
        A dot, and the WORD beside it in the accessible name.

        The same rule the microphone mark in the top strip states: an icon alone
        is only a statement to somebody already looking at it, so the fact is
        kept as text for anybody who is not. `aria-hidden` on the dot itself,
        because otherwise the graphic and the name both announce.
      */
      const dot = element('span', 'dot')
      dot.setAttribute('aria-hidden', 'true')
      button.append(dot)
      button.setAttribute('aria-label', `${entry.label} — recommended`)
      button.title = 'recommended for realtime'
    }
    button.addEventListener('click', () => {
      // Nothing to save when it is already the answer, and a write would
      // redraw the pane under the pointer for no change.
      if (entry.value !== chosen) pick(entry.value)
    })
    wrap.append(button)
  }
  return wrap
}

/**
 * Her face, drawn by the rig that draws her on the desktop.
 *
 * The artifact anchors every row and every swatch with a small coloured mochi;
 * this build shipped four lines of text where that face should be, on the one
 * screen whose whole job is telling characters apart. A picture of her is also
 * the only thing here that a persona's THEME changes, so without it two
 * characters with different colours looked identical.
 *
 * The rig rather than a stored thumbnail, for the reason `shipped-icons.test.ts`
 * had to be written: a second drawing of her is a second thing to keep in step.
 *
 * STILL, not a loop — a grid of blinking faces is motion competing with the one
 * thing on screen that is actually alive. An emotion is settled by stepping the
 * clock rather than by one frame at zero: the expression itself lands
 * immediately, but the body squash it asks for runs through a spring, so a
 * single frame draws `surprised` at its resting size.
 */
export function faceTile(
  face: FaceSpec | undefined,
  px: number,
  emotion?: Emotion,
): HTMLCanvasElement {
  const canvas = element('canvas', 'tile')
  /*
    A missing face is REFUSED, not quietly replaced.

    `MochiAvatar` falls back to the built-in when `face` is undefined, which is
    right for the companion — she must be drawn — and wrong here: every row
    then shows the same green mochi and the shelf silently stops doing the one
    job it has. That is exactly what a stale main process looked like, and it
    looked like a design decision. Empty is honest; the caller reports it.
  */
  if (face === undefined) return canvas
  const ratio = Math.min(window.devicePixelRatio || 1, 3)
  canvas.width = Math.round(px * ratio)
  canvas.height = Math.round(px * ratio)
  canvas.style.width = `${String(px)}px`
  canvas.style.height = `${String(px)}px`
  /*
    Drawn OFFSCREEN, then blitted into place centred on her own pixels.

    `fitToCanvas` scales her so the worst-case pose fits and stands her one
    breathing unit off the bottom, which leaves the unused headroom above her:
    measured at 16.5px above and 2.0px below in a 40px swatch. Right on her own
    window, where she stands on a floor and breathes into the room above it, and
    wrong in a tile that has neither. See `centre.ts` for why this is measured
    rather than computed and why the canvas itself cannot simply be moved.
  */
  drawCentred(canvas, (offCtx) => {
    const avatar = new MochiAvatar(offCtx, { face, size: 'fit-canvas', random: () => 0.5 })
    avatar.resize(px, px, ratio)
    avatar.setIdle(false)
    if (emotion === undefined) {
      // ONE frame. There is nothing to settle: the squash spring starts at rest
      // and only an expression moves it, so seventeen renders of a neutral tile
      // was seventeen times the cost of the same picture — multiplied by every
      // character in a list of unbounded length.
      avatar.render(0)
      return
    }
    avatar.setEmotion({ emotion, intensity: 1 })
    // A quarter of a second of clock, at sixty a second. Long enough for the
    // squash spring to arrive at rest with `stiffness`/`damping` as shipped.
    for (let at = 0; at <= 256; at += 16) avatar.render(at)
  })
  return canvas
}

/**
 * Which one she IS, as a check rather than as the word.
 *
 * The row already carries her name, her pronoun and her voice; a fourth caps
 * word in a pill was the loudest thing on it and said the least. A tick is read
 * without being read.
 *
 * It keeps the WORD for anybody not looking at it. `role="img"` plus an
 * `aria-label` is what makes a graphic announce as "worn" — dropping to a bare
 * icon otherwise deletes the fact from a screen reader entirely, which is a
 * regression that no screenshot shows.
 *
 * The span exists so the class is on an element `element()` made. `stylesheets.
 * test.ts` finds classes by reading `element('span', 'x')` out of the source,
 * and an SVG's class is set through `setAttribute` — invisible to that check,
 * which is how a rule quietly stops governing anything here.
 */
function wornMark(): HTMLElement {
  const NS = 'http://www.w3.org/2000/svg'
  const mark = element('span', 'wearing')
  mark.setAttribute('role', 'img')
  mark.setAttribute('aria-label', 'worn')

  const svg = document.createElementNS(NS, 'svg')
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('width', '15')
  svg.setAttribute('height', '15')
  // The graphic is announced by the span above it, so the shape itself is
  // hidden rather than announced twice.
  svg.setAttribute('aria-hidden', 'true')

  const tick = document.createElementNS(NS, 'path')
  tick.setAttribute('d', 'M3.5 8.6 6.4 11.5 12.5 4.8')
  tick.setAttribute('fill', 'none')
  // `currentColor`, so the mark takes her colour from the rule rather than
  // carrying a second copy of it in the markup.
  tick.setAttribute('stroke', 'currentColor')
  tick.setAttribute('stroke-width', '2')
  tick.setAttribute('stroke-linecap', 'round')
  tick.setAttribute('stroke-linejoin', 'round')

  svg.append(tick)
  mark.append(svg)
  return mark
}

/** SHE / HER, HE / HIM, IT / ITS — the caps line under her name. */
const PRONOUN_CAPS: ByPronoun = { she: 'she / her', he: 'he / him', it: 'it / its' }

/**
 * The cast, down the left.
 *
 * Clicking one WEARS her, which is the handoff's own interaction: the sections
 * re-read and the assembled prompt re-renders. A wake opens a new session, so
 * nothing has to be torn down — switching is a different string on the next
 * wake, and the window says so.
 *
 * It is also what keeps the transcript channels honest. They read whoever is
 * worn, decided in main; a row that merely SELECTED somebody would mean the
 * conversations pane had to name a persona to a query, which is exactly the
 * property this window's allowlist exists to keep.
 *
 * A COLUMN, not a row of cards across the top. The row spent the widest part of
 * the window on the characters you are not editing and pushed the one you are
 * into a narrow strip beneath; a list holds as many as you like in the space
 * four cards needed.
 */
export function characterCards(
  view: ShelfView,
  openId: string | null,
  onOpen: (id: string) => void,
): readonly HTMLElement[] {
  return view.characters.map((one) => {
    const card = element('button', 'card')
    card.type = 'button'
    card.setAttribute('aria-current', String(one.id === openId))
    card.append(faceTile(one.face, 44))
    // Said out loud rather than shown as an identical row of built-in mochis.
    if (one.face === undefined) card.classList.add('faceless')

    const titles = element('div', 'titles')
    titles.append(element('div', 'name', one.name))
    // Which words she takes and which voice she speaks in — the two facts that
    // tell two characters apart at a glance once the face has. Whether she is
    // WORN is the pill on the right, not part of this line: it changes on a
    // click and the rest of the line does not.
    titles.append(
      element('div', 'worn', `${PRONOUN_CAPS[one.pronoun] ?? one.pronoun} · ${one.voice}`),
    )
    card.append(titles, element('span', 'grow'))
    if (one.id === view.wornId) card.append(wornMark())

    card.addEventListener('click', () => {
      onOpen(one.id)
    })
    return card
  })
}

/**
 * The open character, as `Mochi Next.dc.html` draws her.
 *
 * Her, then her colour, then her moods, then her voice, then her file, then
 * what she is told, then what she remembers. The order is the artifact's and it
 * is not arbitrary: it runs from what she IS toward what has happened to her,
 * so the sections that change identity are above the ones that change history.
 *
 * ## Making and deleting characters is NOT one of these
 *
 * It was, as an eighth section, and it is the one thing on this pane that is
 * not about the open character at all — New, Duplicate and Delete act on the
 * LIST. Under that order it also landed at the very bottom of a long scrolling
 * column, so on a first run with one character the control that makes the
 * second one was below the fold.
 *
 * It lives under the list now — see `castActions`, which the column draws as
 * its footer, the way the drawer is the window's.
 */
export function characterSheet(view: ShelfView, handlers: ShelfHandlers): HTMLElement {
  const worn = view.characters.find((one) => one.id === view.wornId)
  const page = element('div', 'sheet')
  if (worn === undefined) {
    page.append(element('p', 'empty', 'No characters loaded.'))
    return page
  }

  page.append(
    whoBand(view, worn, handlers),
    colourSection(view, worn, handlers),
    moodSection(view, worn, handlers),
    voiceSection(view, worn, handlers),
    bubbleSection(view, worn, handlers),
    savingSection(view, worn, handlers),
    fileSection(view, worn, handlers),
    promptSection(view, worn, handlers),
    memorySection(view, handlers),
  )
  return page
}

/**
 * Her face, her name, what she calls you, which words she takes, where she
 * lives.
 *
 * The name is an h1-sized field with no box until it is touched, per the
 * artifact: the largest thing on the pane is her name, and the fact that it is
 * editable is worth less than the fact that it is her name.
 */
function whoBand(view: ShelfView, worn: ShelfCharacter, handlers: ShelfHandlers): HTMLElement {
  // `who-band`, not `who`: this window already styles `.who` as the speaker
  // label over a turn in a transcript. See the stylesheet for the four earlier
  // collisions of exactly this shape.
  const band = element('div', 'who-band')
  band.append(faceTile(worn.face, 108))

  const name = element('input', 'who-name')
  name.type = 'text'
  // Her name can be cleared to nothing in the field before it is put back on
  // `change`, and the h1 has no box of its own — so without this there is one
  // keystroke of a pane with nothing on it. See the field rule in `tokens.css`.
  name.placeholder = 'her name'
  name.value = worn.name
  name.addEventListener('change', () => {
    if (name.value.trim() === worn.name) {
      // Nothing to save — and the field is put back rather than left showing
      // the spaces somebody added. A control displaying a value that was never
      // stored is the small version of the failure this window avoids.
      name.value = worn.name
      return
    }
    handlers.save({ id: worn.id, name: name.value })
  })

  const called = element('input', 'inline')
  called.type = 'text'
  called.value = worn.addressUser
  // The placeholder is what she DOES when the field is empty, not a suggestion.
  // `addressLine` omits the instruction entirely rather than telling her to call
  // somebody "you", so an empty box is a real answer and says which one.
  called.placeholder = 'nobody has said'
  called.addEventListener('change', () => {
    if (called.value.trim() === worn.addressUser) {
      called.value = worn.addressUser
      return
    }
    handlers.save({ id: worn.id, addressUser: called.value })
  })

  const facts = element('div', 'who-facts')
  facts.append(
    element('span', 'label', 'calls you'),
    called,
    chooser(
      'switchers',
      PRONOUNS.map((one) => ({ value: one, label: one })),
      worn.pronoun,
      (value) => {
        handlers.save({ id: worn.id, pronoun: value })
      },
    ),
    element('span', 'grow'),
    // Where her file is — the one line that answers "which of these on disk am
    // I editing".
    element('span', 'meta', worn.source ?? forPronoun(SAYS.noFile, view.pronoun)),
  )

  const of = element('div', 'who-of')
  of.append(name, facts)
  band.append(of)
  return band
}

/**
 * Her colour, drawn as her.
 *
 * Eight swatches, each one HER at that theme rather than a square of paint:
 * the theme changes a face, so the face is what a person is choosing between.
 * `applyTheme` is the same function main applies when it resolves her, so the
 * swatch cannot show a colour the app would not use.
 *
 * An avatar FILE wins, and the section says so rather than offering swatches
 * that do nothing — see `resolveFaceFor`, which applies a theme only over the
 * built-in because `parseFaceSpec` requires all five colour fields and those
 * are somebody's deliberate choices.
 */
function colourSection(
  view: ShelfView,
  worn: ShelfCharacter,
  handlers: ShelfHandlers,
): HTMLElement {
  if (view.faceSource !== null) {
    const said = element('p', 'note', forPronoun(SAYS.colourAuthored, view.pronoun))
    return section('Colour', view.faceSource, said)
  }

  const grid = element('div', 'themes')
  for (const id of THEME_IDS) {
    const swatch = element('button', 'theme')
    swatch.type = 'button'
    swatch.title = id
    swatch.setAttribute('aria-current', String(id === worn.theme))
    swatch.append(faceTile(applyTheme(worn.face, id), 40))
    swatch.addEventListener('click', () => {
      if (id !== worn.theme) handlers.save({ id: worn.id, theme: id })
    })
    grid.append(swatch)
  }
  /*
    A hue of her own is SHOWN, not silently rounded to the nearest swatch.

    `Persona.theme` may be a `CustomTheme` object that no swatch can express, in
    which case `listPersonas` sends null. Lighting one of the eight would claim
    a value that is not stored, and clicking away from it would be the only way
    to find out it was never selected.
  */
  const body: HTMLElement[] = [grid]
  if (worn.theme === null) {
    body.push(element('p', 'note', forPronoun(SAYS.ownHue, view.pronoun)))
  }
  return section('Colour', forPronoun(SAYS.colour, view.pronoun), ...body)
}

/**
 * What each face is for. The artifact's captions, in `EMOTIONS` order.
 *
 * `ByPronoun` for all eight even though only two of them name her, because a
 * table where six entries are strings and two are objects is a table somebody
 * adds the ninth to in the wrong shape. Two DID name her and were missed on the
 * first pass: a he/him character's tiles read "what she falls back to".
 */
const MOOD_WHEN: Readonly<Record<Emotion, ByPronoun>> = {
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
    `set_expression` is the only caller of `setEmotion` outside the rig. A
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
 * This closes the gap the audit named: `faces` narrows `set_expression`'s enum
 * before it goes on the wire and appears in her prompt, and until now the only
 * way to change it was hand-editing a manifest.
 *
 * Each tile draws HER at that expression, in her colour, so the switch is
 * beside the thing it decides. Turning one off is not a rule she is asked to
 * follow — it is not in her tool list at all.
 */
function moodSection(view: ShelfView, worn: ShelfCharacter, handlers: ShelfHandlers): HTMLElement {
  const on = new Set(worn.faces)
  const grid = element('div', 'moods')
  for (const emotion of EMOTIONS) {
    const allowed = on.has(emotion)
    const tile = element('div', allowed ? 'mood' : 'mood off')
    /*
      The DRAWING is the button, not the tile around it.

      Clicking it puts that expression on her at the size she appears on the
      desktop, which is the only way to see six of the eight: `set_expression`'s
      own manifest tells her not to change face every reply, rightly, so in
      ordinary conversation most of them almost never come up.

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
    tryIt.title = `See ${emotion} on her`
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
      if (box.checked) on.add(emotion)
      else on.delete(emotion)
      // The whole list, every time. `applyChange` sorts it back into `EMOTIONS`
      // order, so what is stored does not depend on the order they were clicked.
      handlers.save({ id: worn.id, faces: EMOTIONS.filter((one) => on.has(one)) })
    })
    const label = element('label', undefined, 'allowed')
    label.htmlFor = box.id
    const allow = element('span', 'allow')
    allow.append(box, label)
    tile.append(allow)
    grid.append(tile)
  }

  const how = element('p', 'note', forPronoun(SAYS.moodsHow, view.pronoun))
  const body: HTMLElement[] = [how, grid]
  // Empty is LEGAL and is not the same as "all of them" — `readFaces` gives
  // every face to a manifest that does not mention them, and an empty list is
  // somebody saying none. The tool refuses in as many words; the pane should
  // not let that be a surprise.
  if (on.size === 0) body.push(element('p', 'note bad', forPronoun(SAYS.noMoods, view.pronoun)))
  return section('Moods', forPronoun(SAYS.moods, view.pronoun), ...body)
}

/**
 * Her voice, and whether her words are shown.
 *
 * Pills rather than a `<select>`, per the artifact: there are ten, they are all
 * one word, and the whole set fits in the width a closed dropdown would take.
 * §21 locks the voice after her first audio, so a change is a reconnect rather
 * than an update — the hint says so.
 */
function voiceSection(view: ShelfView, worn: ShelfCharacter, handlers: ShelfHandlers): HTMLElement {
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

/**
 * Her words on your desktop: whether they are drawn, and where.
 *
 * ## A section of its own, and the hint is why
 *
 * Both halves lived in Voice — the switch because it had always been there, the
 * side because it moved off the Machine tab to join it. That section's hint
 * says "a change is a reconnect, so it lands on its next wake", which is true
 * of a voice and of the switch and NOT of the side: `setBubbleSide` pushes
 * straight to her window, deliberately, because somebody who picks a side wants
 * to see her words move now.
 *
 * A hint makes a promise about everything under it. One control disobeying it
 * is the section being wrong rather than the control, so the two that belong
 * together got a heading and a hint that covers both honestly.
 *
 * ## "Show it", not a sentence
 *
 * The switch read *"Show her words beside her while she speaks"* — prose in a
 * column of controls, and it carried its own location claim next to the control
 * that sets the location. The heading names the thing; the switch says what it
 * does. That is the shape every other control in these windows already has,
 * and with no pronoun left in it the label stops being a three-way table.
 */
/**
 * Whether anything she says is written down at all.
 *
 * ## The name is the feature
 *
 * It says "Save NEW conversations", and the note underneath says plainly that
 * turning it off leaves the existing ones alone and points at where they are
 * removed. Calling this "retention" is what let the old website sentence lie
 * for months: a privacy switch whose scope has to be inferred will be inferred
 * in the unsafe direction, and the person doing the inferring will be somebody
 * who wanted their words gone.
 *
 * ## Per character, and on her sheet
 *
 * The policy is filed per character, so the control is where the character is.
 * It is NOT on her manifest -- see `SettingsPersona.keeps` -- so a package
 * cannot arrive having decided this for whoever installs it.
 */
function savingSection(
  view: ShelfView,
  worn: ShelfCharacter,
  handlers: ShelfHandlers,
): HTMLElement {
  const keeps = element('input')
  keeps.type = 'checkbox'
  keeps.checked = worn.keeps
  keeps.id = 'keeps'
  keeps.addEventListener('change', () => {
    handlers.save({ id: worn.id, keeps: keeps.checked })
  })
  const label = element('label', undefined, 'Save new conversations')
  label.htmlFor = keeps.id
  const row = element('div', 'row')
  row.append(keeps, label)

  return section(
    'Conversations',
    forPronoun(SAYS.keeps, view.pronoun),
    row,
    element('p', 'note', forPronoun(SAYS.keptAlready, view.pronoun)),
  )
}

function bubbleSection(
  view: ShelfView,
  worn: ShelfCharacter,
  handlers: ShelfHandlers,
): HTMLElement {
  const bubble = element('input')
  bubble.type = 'checkbox'
  bubble.checked = worn.bubble
  bubble.id = 'bubble'
  bubble.addEventListener('change', () => {
    handlers.save({ id: worn.id, bubble: bubble.checked })
  })
  const label = element('label', undefined, 'Show it')
  label.htmlFor = bubble.id
  const row = element('div', 'row')
  row.append(bubble, label)

  const side = document.createElement('select')
  for (const one of worn.bubbleSides) {
    const option = document.createElement('option')
    option.value = one
    /*
      The names the TRAY uses, from the one table both read.

      This drew `above`, `left`, `wherever there is room` — a second vocabulary
      for a setting the menu bar already had words for. Somebody who picked
      "To her left" from the tray and then opened her sheet found "left", and
      had to decide whether those were the same thing.
    */
    // `?? auto` keeps a side this table has no name for readable rather than
    // blank — the tray's own submenu makes the same allowance for the same
    // reason: `bubbleSides` crosses the wire as strings.
    const named = (SIDE_NAMES as Record<string, ByPronoun>)[one] ?? SIDE_NAMES.auto
    option.textContent = forPronoun(named, view.pronoun)
    option.selected = one === worn.bubbleSide
    side.append(option)
  }
  side.addEventListener('change', () => {
    handlers.save({ id: worn.id, bubbleSide: side.value })
  })
  const where = element('div', 'field')
  where.append(element('label', undefined, 'Which side'), side)

  return section(
    'Speech bubble',
    forPronoun(SAYS.bubbleWhen, view.pronoun),
    row,
    where,
    element('p', 'note', forPronoun(SAYS.bubbleSide, view.pronoun)),
  )
}

/**
 * Which avatar file she wears.
 *
 * A `<select>` and not pills: this is a list of files on disk, it is as long as
 * somebody's folder, and unlike the ten voices it has no bounded set to draw.
 */
function fileSection(view: ShelfView, worn: ShelfCharacter, handlers: ShelfHandlers): HTMLElement {
  const file = document.createElement('select')
  /*
    Every avatar on disk — plus the one she names that ISN'T, when there is one.

    A persona may legally hold an avatar id whose file has since been deleted:
    `resolveFaceFor` falls back to the built-in and reports it, and the id
    stays. Listing only what exists made the control show "Built-in" as though
    that were the stored value, and choosing it fired no change event — so the
    one way to clear a dangling reference was the one option that did nothing.
  */
  const missing =
    worn.avatarId !== null && !view.avatars.some((one) => one.id === worn.avatarId)
      ? [{ value: worn.avatarId, label: `${worn.avatarId} — missing` }]
      : []
  for (const entry of [
    ...missing,
    ...view.avatars.map((one) => ({
      // The built-in is stored as `null`; the empty string is only how a
      // `<select>` can carry that, and it is turned back at the boundary below.
      value: one.id ?? '',
      label: one.id ?? 'Built-in',
    })),
  ]) {
    const option = document.createElement('option')
    option.value = entry.value
    option.textContent = entry.label
    option.selected = entry.value === (worn.avatarId ?? '')
    file.append(option)
  }
  file.addEventListener('change', () => {
    handlers.save({ id: worn.id, avatarId: file.value === '' ? null : file.value })
  })
  return section('Face', resolvedFace(view, worn), file)
}

/** Where her face actually resolved to, not where it was asked to look. */
function resolvedFace(view: ShelfView, worn: ShelfCharacter): string {
  if (view.faceSource !== null) return `reading ${view.faceSource}`
  // A named avatar that resolved to nothing fell back to the built-in, and
  // saying so is the whole point — "the app ignored my file" is the least
  // debuggable outcome this feature can have.
  return worn.avatarId === null ? 'the shipped face' : `${worn.avatarId} could not be read`
}

/**
 * Her manner, and the two moments she is given words for.
 *
 * Editable here now, not only in her file. `style` is what `instructionsFor`
 * sends as the character half of the prompt; the two `SpokenMoment`s decide
 * what she conveys on waking and on going back to sleep.
 */
function promptSection(
  view: ShelfView,
  worn: ShelfCharacter,
  handlers: ShelfHandlers,
): HTMLElement {
  const style = element('textarea')
  style.rows = 5
  style.value = worn.style
  style.spellcheck = false
  style.addEventListener('change', () => {
    if (style.value === worn.style) return
    handlers.save({ id: worn.id, style: style.value })
  })

  const moments = element('div', 'moments')
  for (const moment of [
    { key: 'greeting', label: 'On waking', value: worn.greeting },
    { key: 'farewell', label: 'On going to sleep', value: worn.farewell },
  ] as const) {
    const box = element('input')
    box.type = 'text'
    // Both of these are legitimately empty — a character can have nothing to
    // convey on waking — and an unboxed empty field is a blank patch of paper.
    box.placeholder = 'nothing in particular'
    box.value = moment.value
    box.addEventListener('change', () => {
      if (box.value.trim() === moment.value) {
        box.value = moment.value
        return
      }
      handlers.save({ id: worn.id, [moment.key]: box.value })
    })
    // `moment`, not `field`: the Machine tab already styles `.field` as a
    // label-beside-control grid, and it would centre these.
    const field = element('div', 'moment')
    field.append(element('span', 'label', moment.label), box)
    moments.append(field)
  }
  /*
    The INSTRUCTION half only, and the section does not pretend otherwise.

    A `SpokenMoment` also carries `verbatim` — exact words a manifest author
    wrote for her to say. There is no control for it here and `applyChange`
    leaves it alone, so editing this field narrows what she is told to convey
    without discarding words somebody chose.
  */
  return section(
    forPronoun(SAYS.whoSheIs, view.pronoun),
    forPronoun(SAYS.whoSheIsHint, view.pronoun),
    style,
    moments,
  )
}

/**
 * What she remembers, with the one step back.
 *
 * The note is the one thing on this pane a MODEL writes — `remember_this` when
 * somebody asks out loud, and the sleep summariser when it lands — so it is the
 * one thing that needs an undo at all.
 */
function memorySection(view: ShelfView, handlers: ShelfHandlers): HTMLElement {
  const undo = element('button', 'btn', 'Undo the last change')
  undo.type = 'button'
  // Null means nothing has ever been rewritten. That is NOT the same as going
  // back to an empty note, which is a real version somebody may want.
  undo.disabled = view.note.previous === null
  undo.addEventListener('click', () => {
    /*
      DISABLED on dispatch, not on the reload that follows it.

      `remember` keeps one step of history, so two restores in flight swap the
      note back to where it started — a double-click on "Undo the last change"
      undid the undo, and the pane looked like the button had done nothing.
    */
    undo.disabled = true
    forget.disabled = true
    // NAMED. The pane stays clickable while a character switch is in flight,
    // and main refuses an action for anybody but whoever is worn now.
    handlers.memory({ kind: 'restore', id: view.wornId })
  })

  // TWO STEPS rather than a dialog. This throws away something a person may
  // have spent months accumulating, and a button that does it on one click is a
  // button somebody hits by accident. It is undoable, and it should still ask.
  const forget = element('button', 'btn', 'Forget everything')
  forget.type = 'button'
  forget.disabled = view.note.text === ''
  let armed = false
  forget.addEventListener('click', () => {
    if (!armed) {
      armed = true
      forget.textContent = 'Really forget it all?'
      forget.classList.add('arming')
      return
    }
    handlers.memory({ kind: 'clear', id: view.wornId })
  })

  const text = element('pre')
  text.textContent = view.note.text === '' ? forPronoun(SAYS.noNotes, view.pronoun) : view.note.text
  if (view.note.text === '') text.classList.add('empty-note')

  const wrap = section(
    forPronoun(SAYS.remembers, view.pronoun),
    forPronoun(SAYS.wroteThese, view.pronoun),
    text,
  )
  // Into the section's own head, beside the hint, which is where the artifact
  // puts the two buttons — a second row of controls under the heading would
  // read as belonging to the note rather than to the section.
  const head = wrap.querySelector('.head')
  head?.append(element('span', 'grow'), undo, forget)
  return wrap
}

/**
 * Making, copying and removing characters — under the LIST they act on.
 *
 * ## Why it is not a section of the sheet
 *
 * It was the eighth one, and it was the only thing on that pane not about the
 * open character: New, Duplicate and Delete change what is in the column, not
 * who somebody is. `characterSheet`'s own ordering argues that the pane runs
 * "from what she IS toward what has happened to her", and none of these is
 * either. Being last also put the control that makes a second character below
 * the fold of a long scroll on the one install that has exactly one.
 *
 * ## It still names the open character, and has to
 *
 * "Duplicate Loki" and "Delete Loki" are about whoever is open, which on this
 * shelf is whoever is worn — clicking a card wears them. So it takes the same
 * `worn` the sheet does, and the two cannot disagree because there is one
 * answer to who that is.
 *
 * A NAME, never an id. The id is derived in main against what is already taken
 * AND what a pending deletion still reserves, because an id is what her memory
 * and her conversations are filed under: choosing one from here would be
 * choosing whose leftovers a new character inherits.
 */
export function castActions(view: ShelfView, handlers: ShelfHandlers): readonly HTMLElement[] {
  const worn = view.characters.find((one) => one.id === view.wornId)
  // Nothing to duplicate or delete when nothing is loaded, and "New" alone
  // wants the empty state's own words rather than a lone button under a list
  // that is not there.
  if (worn === undefined) return []
  return castRow(worn, view.pronoun, handlers)
}

function castRow(
  worn: ShelfCharacter,
  pronoun: Pronoun,
  handlers: ShelfHandlers,
): readonly HTMLElement[] {
  const row = element('div', 'row')

  const name = element('input')
  name.type = 'text'
  name.placeholder = 'name'
  const named = (): string => name.value.trim()

  /**
   * Disabled the moment one is pressed, and left that way.
   *
   * The write is asynchronous and the pane is replaced when it lands, so an
   * ordinary double-click sent TWO create actions — and each derives its own id
   * against what was taken when it ran, so it made two characters rather than
   * failing. They are re-enabled by the re-render, which is what the reload
   * does.
   */
  const guarded: HTMLButtonElement[] = []
  const once = (act: () => void): void => {
    for (const button of guarded) button.disabled = true
    act()
  }

  const make = element('button', 'btn primary', 'New')
  make.type = 'button'
  make.addEventListener('click', () => {
    if (named() === '') return handlers.say('A new character needs a name.', true)
    once(() => {
      handlers.persona({ kind: 'create', name: named() })
    })
  })

  const copy = element('button', 'btn', `Duplicate ${worn.name}`)
  copy.type = 'button'
  copy.addEventListener('click', () => {
    if (named() === '') return handlers.say('Give the copy a name first.', true)
    once(() => {
      handlers.persona({ kind: 'duplicate', name: named() })
    })
  })

  row.append(name, make, copy)
  guarded.push(make, copy)

  if (worn.source === null) {
    // The built-in has no file to delete. What somebody actually wants here is
    // her original prompt back, which lives in the source and not in this
    // window — so without this, editing her is a one-way door.
    const restore = element('button', 'btn', forPronoun(SAYS.restore, pronoun))
    restore.type = 'button'
    restore.addEventListener('click', () => {
      once(() => {
        handlers.persona({ kind: 'restore-built-in' })
      })
    })
    row.append(restore)
    guarded.push(restore)
  } else {
    // TWO STEPS. This takes her notes and her conversations with her, and unlike
    // the note there is no one-step undo waiting behind it.
    const remove = element('button', 'btn', `Delete ${worn.name}`)
    remove.type = 'button'
    let armed = false
    remove.addEventListener('click', () => {
      if (!armed) {
        armed = true
        // The pronoun, not "her". A he/him character was told his own deletion
        // would take "her notes and her conversations".
        remove.textContent = `Delete ${worn.name}, ${forPronoun(SAYS.deleting, pronoun)}?`
        remove.classList.add('arming')
        return
      }
      /*
        Through the SAME guard the other three actions use.

        Delete went straight out. The arming step means two clicks are needed,
        and the second and third land before the reload replaces the pane — so a
        double-click on the confirm sent two deletions, and the second answered
        "there is no character called …" over a deletion that had just worked.
      */
      once(() => {
        handlers.persona({ kind: 'delete', id: worn.id })
      })
    })
    row.append(remove)
    guarded.push(remove)
  }

  /*
    A footer, not a section, and not a wrapper either.

    `section()` draws a caps heading with a hint beside it, which is the shape
    the SHEET uses for a field. Under the list this is the same thing the drawer
    is to the window — controls that belong to what is above them — so it gets
    the one-line note and no second heading, because the column already says
    "Characters" a few pixels above the list these act on.

    Returned as a LIST rather than inside a `div` of its own: `#cast-actions`
    already exists in the markup with the padding and the rule on it, and a
    second box inside it would be two containers for one thing — the mistake
    `#panel-wake` was carrying when it wore `.panel` inside `.cast-wake`.
  */
  return [row, element('p', 'note', 'a character is a folder · deleting one takes its memory')]
}

/**
 * The system prompt: the document you write, and the string it produces.
 *
 * ## Two views of one thing, and both are needed
 *
 * WRITE is the document — a markdown file the user owns, empty on a fresh
 * install, with Save and Cancel. SENT is `instructionsFor`'s output: the exact
 * string she is handed once her character, her notes and her tool list have
 * been folded in.
 *
 * Neither replaces the other. Editing without seeing what it produces is
 * writing into a box and hoping; seeing without editing was this panel until
 * now. And the sent half stays main's — a column that re-assembled it here
 * would be a second place her prompt is built, and the two would drift the
 * first time either changed.
 *
 * ## Save and Cancel, and why THIS control has them
 *
 * Every other control on this shelf autosaves on `change`, which is right for a
 * voice or a swatch: the value is small, the change is one gesture, and an
 * accidental one is one gesture to undo. A system prompt is none of those.
 * Tabbing out of a half-written paragraph would commit it, and there would be
 * nothing to go back to.
 */
export function assembledPanel(view: ShelfView, handlers: ShelfHandlers): readonly HTMLElement[] {
  const head = element('div', 'row')
  const count = element('span', 'meta')
  head.append(element('h3', undefined, 'System prompt'), element('span', 'grow'), count)

  const editor = element('textarea', 'wake-edit')
  editor.value = view.prompt.text
  editor.spellcheck = false
  editor.rows = 10
  // What it is FOR, in the window rather than in the file. Markdown has no
  // comment a model cannot read, so anything put in the document to explain it
  // would be text she is handed — see `store/prompt.ts`.
  editor.placeholder = `Empty. She is still told her character, what she remembers and what she can do — this is prose of your own, above all of it.\n\nSlots move a piece instead of leaving it where it goes: ${view.prompt.slots.map((one) => `{${one}}`).join(' ')} and {name}.`

  const sent = element('div', 'wake-box')
  const body = element('pre')
  body.textContent = view.assembled
  sent.append(body)

  /*
    The other half of what she is handed, and it used to be shown nowhere.

    `whatSheMayDo` returns `{ instructions, tools }`; this panel drew the first
    and the second went on the wire unseen. Those descriptions are the largest
    body of model-facing prose in the app and none of it is editable — which is
    argued and deliberate, and is not a reason to hide it. `textContent`, like
    everything else here.
  */
  const toolsBox = element('div', 'wake-box')
  const toolsBody = element('pre')
  toolsBody.textContent = view.toolsSent
  toolsBox.append(toolsBody)

  /*
    One pane at a time, and WRITE is not the default.

    Opening on the editor would put a text box where a readout used to be, on a
    panel most visits do not come to edit. Sent is the answer to "what will she
    be told", which is what the column is for; Write is a step you take.
  */
  const save = element('button', 'btn primary', 'Save')
  save.type = 'button'
  const cancel = element('button', 'btn', 'Cancel')
  cancel.type = 'button'
  const actions = element('div', 'row wake-actions')
  actions.append(save, cancel)

  const tabs = element('div', 'switchers wake-tabs')
  /** Which pane is up. Three now, so no longer a boolean. */
  let showing: 'sent' | 'tools' | 'write' = 'sent'

  const draw = (): void => {
    tabs.replaceChildren()
    for (const [id, label] of [
      ['sent', 'Sent'],
      ['tools', 'Tools'],
      ['write', 'Write'],
    ] as const) {
      const button = element('button', undefined, label)
      button.type = 'button'
      button.setAttribute('aria-current', String(id === showing))
      button.addEventListener('click', () => {
        if (id === showing) return
        showing = id
        // The draft survives the switch. Looking at what it produces and coming
        // back is exactly what somebody does while writing one.
        draw()
      })
      tabs.append(button)
    }
    sent.hidden = showing !== 'sent'
    toolsBox.hidden = showing !== 'tools'
    editor.hidden = showing !== 'write'
    actions.hidden = showing !== 'write'
    // The count names the pane's own quantity rather than one number for all
    // three — "sent" beside a tool list would be counting the wrong thing.
    if (showing === 'write') count.textContent = `${String(editor.value.length)} chars`
    else if (showing === 'tools') count.textContent = `${String(view.toolsSent.length)} chars`
    else count.textContent = `${String(view.assembled.length)} sent`
  }

  editor.addEventListener('input', () => {
    // The Save is enabled by there being a difference, not by having typed —
    // typing a character and deleting it is not a change to save.
    const changed = editor.value !== view.prompt.text
    save.disabled = !changed
    cancel.disabled = !changed
    count.textContent = `${String(editor.value.length)} chars`
  })
  save.disabled = true
  cancel.disabled = true

  save.addEventListener('click', () => {
    save.disabled = true
    cancel.disabled = true
    handlers.prompt(editor.value)
  })
  cancel.addEventListener('click', () => {
    // Back to what is stored, not to empty. Cancel undoes the edit; there is a
    // separate and deliberate way to store nothing, which is to clear the box
    // and Save.
    editor.value = view.prompt.text
    save.disabled = true
    cancel.disabled = true
    count.textContent = `${String(editor.value.length)} chars`
  })

  head.append(tabs)
  const note = element('p', 'note', forPronoun(SAYS.assembled, view.pronoun))
  /*
    Where the file is, so it can be opened in a real editor — this box is a text
    area, not somewhere anybody should have to write a long prompt.

    UNDER THE NOTE, not under the box. It says what this panel is, which is what
    the note above it does, and the foot of the column belongs to Save and
    Cancel now: the box grows to fill the sidebar, so whatever is listed after
    it lands on the bottom edge, and a two-line path down there would push the
    buttons off it.
  */
  const where = element('p', 'note')
  where.append(element('code', undefined, view.prompt.path))

  draw()
  return [head, note, where, sent, toolsBox, editor, actions]
}
