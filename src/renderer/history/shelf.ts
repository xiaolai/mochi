import type {
  NoteAction,
  PersonaAction,
  PersonaChange,
  ShelfCharacter,
  ShelfView,
} from '@shared/ipc'
import { forPronoun, PRONOUNS, type ByPronoun, type Pronoun } from '@shared/pronoun'
import { EMOTIONS, type Emotion } from '@shared/avatar'
import type { FaceSpec } from '@shared/avatar-spec'
import { applyTheme, THEME_IDS } from '@shared/theme'
import { MochiAvatar } from '../companion/rig/mochi'

/**
 * Every sentence on this pane that is ABOUT her, one phrasing per pronoun.
 *
 * Collected here rather than written at each site because that is what makes
 * them reviewable as a set: a translator, or anybody adding a fourth pronoun,
 * has one list to read instead of a dozen. Nothing that is not about her is
 * here -- "calls you", "on waking", "colour" are labels for fields and are the
 * same words whoever is worn.
 */
const SAYS = {
  noFile: {
    she: 'the built-in, with no file of her own',
    he: 'the built-in, with no file of his own',
    it: 'the built-in, with no file of its own',
  },
  nextWake: {
    she: 'ten · a change is a reconnect, so it lands on her next wake',
    he: 'ten · a change is a reconnect, so it lands on his next wake',
    it: 'ten · a change is a reconnect, so it lands on its next wake',
  },
  bubble: {
    she: 'Show her words above her head while she speaks',
    he: 'Show his words above his head while he speaks',
    it: 'Show its words above it while it speaks',
  },
  moods: {
    she: 'eight drawn · she picks one per reply',
    he: 'eight drawn · he picks one per reply',
    it: 'eight drawn · it picks one per reply',
  },
  moodsHow: {
    she: 'A set_expression tool, offered on the wire like any other. She chooses from the ones left on; the rest are never in her tool list, so she cannot reach for a face this character does not use.',
    he: 'A set_expression tool, offered on the wire like any other. He chooses from the ones left on; the rest are never in his tool list, so he cannot reach for a face this character does not use.',
    it: 'A set_expression tool, offered on the wire like any other. It chooses from the ones left on; the rest are never in its tool list, so it cannot reach for a face this character does not use.',
  },
  noMoods: {
    she: 'None left on. She will be told she has no expressions to choose from, and will keep whatever face she has.',
    he: 'None left on. He will be told he has no expressions to choose from, and will keep whatever face he has.',
    it: 'None left on. It will be told it has no expressions to choose from, and will keep whatever face it has.',
  },
  colour: {
    she: 'eight themes · retints this window and her',
    he: 'eight themes · retints this window and him',
    it: 'eight themes · retints this window and it',
  },
  colourAuthored: {
    she: 'Her avatar file names its own five colours, so a theme would overwrite what somebody drew. Clear the file below to choose one.',
    he: 'His avatar file names its own five colours, so a theme would overwrite what somebody drew. Clear the file below to choose one.',
    it: 'Its avatar file names its own five colours, so a theme would overwrite what somebody drew. Clear the file below to choose one.',
  },
  whoSheIs: { she: 'Who she is', he: 'Who he is', it: 'What it is' },
  whoSheIsHint: {
    she: 'her manner, sent as the session instructions',
    he: 'his manner, sent as the session instructions',
    it: 'its manner, sent as the session instructions',
  },
  remembers: { she: 'What she remembers', he: 'What he remembers', it: 'What it remembers' },
  wroteThese: { she: 'she wrote these', he: 'he wrote these', it: 'it wrote these' },
  noNotes: {
    she: 'She has not written anything down about you yet.',
    he: 'He has not written anything down about you yet.',
    it: 'It has not written anything down about you yet.',
  },
  restore: {
    she: 'Put the built-in back as she ships',
    he: 'Put the built-in back as he ships',
    it: 'Put the built-in back as it ships',
  },
  assembled: {
    she: 'The exact string she is handed, assembled on her next wake. Nothing here is sent until then.',
    he: 'The exact string he is handed, assembled on his next wake. Nothing here is sent until then.',
    it: 'The exact string it is handed, assembled on its next wake. Nothing here is sent until then.',
  },
} as const satisfies Readonly<Record<string, ByPronoun>>

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
  readonly save: (change: PersonaChange) => void
  readonly persona: (action: PersonaAction) => void
  readonly memory: (action: NoteAction) => void
  /** Say what happened. Silence after a write reads as the write not landing. */
  readonly say: (text: string, bad?: boolean) => void
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const made = document.createElement(tag)
  if (className !== undefined) made.className = className
  if (text !== undefined) made.textContent = text
  return made
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
  entries: readonly { readonly value: string; readonly label: string }[],
  chosen: string,
  pick: (value: string) => void,
): HTMLElement {
  const wrap = element('div', className)
  for (const entry of entries) {
    const button = element('button', undefined, entry.label)
    button.type = 'button'
    button.setAttribute('aria-current', String(entry.value === chosen))
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
  const ctx = canvas.getContext('2d')
  if (ctx === null) return canvas
  const avatar = new MochiAvatar(ctx, { face, size: 'fit-canvas', random: () => 0.5 })
  avatar.resize(px, px, ratio)
  avatar.setIdle(false)
  if (emotion !== undefined) avatar.setEmotion({ emotion, intensity: 1 })
  // A quarter of a second of clock, at sixty a second. Long enough for the
  // squash spring to arrive at rest with `stiffness`/`damping` as shipped.
  for (let at = 0; at <= 256; at += 16) avatar.render(at)
  return canvas
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
    if (one.id === view.wornId) card.append(element('span', 'wearing', 'worn'))

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
 * what she is told, then what she remembers, then the cast itself. The order is
 * the artifact's and it is not arbitrary: it runs from what she IS toward what
 * has happened to her, so the sections that change identity are above the ones
 * that change history.
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
    fileSection(view, worn, handlers),
    promptSection(view, worn, handlers),
    memorySection(view, handlers),
    castSection(worn, view.pronoun, handlers),
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
    element('span', 'sep'),
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
    body.push(element('p', 'note', 'She wears a hue of her own; none of the eight is stored.'))
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
  thinking: {
    she: 'while a lookup is running',
    he: 'while a lookup is running',
    it: 'while a lookup is running',
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
    tile.append(
      faceTile(worn.face, 56, emotion),
      element('span', 'name', emotion),
      element('span', 'when', forPronoun(MOOD_WHEN[emotion], view.pronoun)),
    )

    const box = element('input')
    box.type = 'checkbox'
    box.checked = allowed
    box.id = `mood-${emotion}`
    box.addEventListener('change', () => {
      const next = new Set(on)
      if (box.checked) next.add(emotion)
      else next.delete(emotion)
      // The whole list, every time. `applyChange` sorts it back into `EMOTIONS`
      // order, so what is stored does not depend on the order they were clicked.
      handlers.save({ id: worn.id, faces: EMOTIONS.filter((one) => next.has(one)) })
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
  const pills = chooser(
    'pills',
    view.voices.map((one) => ({ value: one, label: one })),
    worn.voice,
    (value) => {
      handlers.save({ id: worn.id, voice: value })
    },
  )

  const bubble = element('input')
  bubble.type = 'checkbox'
  bubble.checked = worn.bubble
  bubble.id = 'bubble'
  bubble.addEventListener('change', () => {
    handlers.save({ id: worn.id, bubble: bubble.checked })
  })
  const label = element('label', undefined, forPronoun(SAYS.bubble, view.pronoun))
  label.htmlFor = bubble.id
  const row = element('div', 'row')
  row.append(bubble, label)

  return section('Voice', forPronoun(SAYS.nextWake, view.pronoun), pills, row)
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
 * Making, copying and removing characters.
 *
 * A NAME, never an id. The id is derived in main against what is already taken
 * AND what a pending deletion still reserves, because an id is what her memory
 * and her conversations are filed under: choosing one from here would be
 * choosing whose leftovers a new character inherits.
 */
function castSection(worn: ShelfCharacter, pronoun: Pronoun, handlers: ShelfHandlers): HTMLElement {
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
        remove.textContent = `Delete ${worn.name}, her notes and her conversations?`
        remove.classList.add('arming')
        return
      }
      handlers.persona({ kind: 'delete', id: worn.id })
    })
    row.append(remove)
  }

  return section('Cast', 'a character is a folder · deleting one takes its memory', row)
}

/**
 * The exact string she will be handed, not a summary of it.
 *
 * The artifact's right-hand column is literally `instructionsFor`'s output, and
 * main sends it as one string for that reason — a column that re-assembled it
 * here would be a second place her prompt is built, and the two would drift the
 * first time either changed.
 */
export function assembledPanel(view: ShelfView): readonly HTMLElement[] {
  const head = element('div', 'row')
  head.append(
    element('h3', undefined, 'Next wake'),
    element('span', 'grow'),
    element('span', 'meta', `${String(view.assembled.length)} chars`),
  )
  const note = element('p', 'note', forPronoun(SAYS.assembled, view.pronoun))
  const box = element('div', 'wake-box')
  const body = element('pre')
  body.textContent = view.assembled
  box.append(body)
  return [head, note, box]
}
