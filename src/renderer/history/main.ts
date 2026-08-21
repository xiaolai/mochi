import type {
  HistoryConversation,
  HistoryHit,
  HistoryProblem,
  HistoryTurn,
  MochiHistoryApi,
  MochiSettingsApi,
  SettingsView,
  SettingsWrite,
  ShelfView,
} from '@shared/ipc'
import {
  DEFAULT_PRONOUN,
  forPronoun,
  label as paneLabel,
  type ByPronoun,
  type Pronoun,
} from '@shared/pronoun'
import { applyAccent } from '../design/apply-accent'
import { PANES, type PaneHandlers } from '../settings/panes'
import { MochiAvatar } from '../companion/rig/mochi'
import { byDay, clockLabel, dayLabel, highlight, interruptions, lengthLabel } from './format'
import { drawCentred } from './centre'
import { CUT, fact, RAN_FOR, TURNS } from './glyph'
import {
  dayHeadingLabel,
  dayKey,
  monthGrid,
  monthLabel,
  startOfDay,
  stepMonth,
  weekdayInitials,
} from './month'
import {
  assembledPanel,
  castActions,
  characterCards,
  characterSheet,
  faceTile,
  type ShelfHandlers,
} from './shelf'
import { installLogStamp } from '@shared/log'

/*
  A wall clock on every line this window prints, installed before it prints one.

  The three processes interleave on one stream and none of them used to stamp
  anything, so a settings write here and a refusal in main could not be ordered
  against each other. See `shared/log.ts`; the same call is the first statement
  in main and in the companion.
*/
installLogStamp()

declare global {
  interface Window {
    readonly mochiHistory: MochiHistoryApi
    /*
      Both, because this is one window with three places in it.

      The preload exposes both bridges to this role and each still guards its own
      channel list — the widening is that the document showing a transcript can
      also change a grant. What it does not gain is the companion's channels, so
      nothing here can mint a key or exchange an SDP offer.
    */
    readonly mochiSettings: MochiSettingsApi
  }
}

/**
 * The shelf: her characters, and everything belonging to one.
 *
 * Two halves in one window, which is what a shelf is. The cards and the sheet
 * are `shelf.ts`; the conversations are here, and they were here first — this
 * window grew rather than being replaced by a new one, because it already had
 * the list-and-pane layout, the search, the problems strip and the export.
 *
 * ## The layout is 1a's
 *
 * Her state across the top, because the handoff is blunt about why: *"a
 * microphone that is open with nothing saying so is the worst thing a desktop
 * companion can do."* Then the characters as cards, then a 1fr/380px body — the
 * open character on the left, an inspector on the right — and a strip along the
 * bottom for the things that are about the window rather than about her.
 *
 * Deleting a single CONVERSATION is still not offered, on purpose. The store
 * has `forget`, but it is a destructive action on the only copy of something
 * somebody said — it needs a confirmation, an undo window, or both, and
 * shipping the button before those is worse than not shipping it. Deleting a
 * CHARACTER is offered, in two steps, and it says out loud that it takes her
 * conversations with her.
 *
 * `document.createElement` and `textContent`, never `innerHTML`. Every string
 * here is either a person's words or hers, which is exactly the input a
 * transcript viewer must not evaluate.
 */

function need<T extends Element>(id: string, kind: new () => T): T {
  const found = document.querySelector(`#${id}`)
  // Fail loud. Rendering into nothing is indistinguishable from a slow start,
  // and `documents.test.ts` is what stops this being discovered at runtime.
  if (!(found instanceof kind)) throw new Error(`shelf: the document has no usable #${id}`)
  return found
}

const markEl = need('mark', HTMLCanvasElement)
const stateEl = need('state', HTMLElement)
const stateHowEl = need('state-how', HTMLElement)
const micEl = need('mic', HTMLElement)
const micLabelEl = need('mic-label', HTMLElement)
const countEl = need('count', HTMLElement)
const charactersEl = need('characters', HTMLElement)
const charactersCountEl = need('characters-count', HTMLElement)
const castEl = need('cast-actions', HTMLElement)
const paneEl = need('pane', HTMLElement)
const wakeEl = need('panel-wake', HTMLElement)
const talkEl = need('talk', HTMLElement)
const shellTabsEl = need('shell-tabs', HTMLElement)
const navEl = need('nav-groups', HTMLElement)
const toolsEl = need('machine-tools', HTMLElement)
const contextEl = need('topbar-context', HTMLElement)
const machineEl = need('machine-pane', HTMLElement)
const queryEl = need('q', HTMLInputElement)
const listEl = need('list', HTMLElement)
const calEl = need('calendar', HTMLElement)
const troublesEl = need('troubles', HTMLButtonElement)
const troublesLabelEl = need('troubles-label', HTMLElement)
const exportEl = need('export', HTMLButtonElement)
const saidEl = need('said', HTMLElement)
const saidWhatEl = need('said-what', HTMLElement)
const saidShutEl = need('said-shut', HTMLButtonElement)

/** Which conversation is open, so re-rendering the list does not lose it. */
let open: string | null = null
let conversations: readonly HistoryConversation[] = []
/** The character half, re-read on every change. Null until the first read. */
let shelf: ShelfView | null = null
/** Whether the main column is showing the open character rather than a transcript. */
let showingCharacter = true
/** Which inspector tab is up. */
/**
 * Which read the panes are currently showing.
 *
 * Bumped by every click, every search and every character switch. Each
 * asynchronous read captures it and throws its answer away if it has moved —
 * because these are IPC round trips into a store, and a slow one for the
 * conversation you closed used to land AFTER the fast one for the conversation
 * you opened, painting the wrong transcript. Debouncing the search stops queued
 * timers; it does nothing about a query already in flight.
 */
let generation = 0

/**
 * Say what happened. Silence after a write reads as the write not landing.
 *
 * Its own strip on its own opaque surface, rather than a button's label — the
 * handoff's structural rule, and it stops a character rename reporting itself
 * inside a control marked "Export…".
 *
 * ## It goes away
 *
 * It used to stay until the next write replaced it, so the last thing you did
 * sat over the window for the rest of the session — and a message about a
 * character you have since switched away from is worse than no message.
 *
 * Ten seconds, and the same ten for a failure. A failure that vanished with
 * nothing behind it would be a different argument, but everything reported here
 * as bad is ALSO in the problems strip, which does not time out.
 *
 * ## `hidden`, not empty
 *
 * The strip used to hide by way of `#said:empty`, which stopped being true the
 * moment it held a dismiss button. `[hidden]` is a state the renderer sets, and
 * `tokens.css` makes it beat any `display` an author writes.
 *
 * Shown BEFORE the text is set, deliberately: a live region that is not rendered
 * when its content changes is not announced, so setting the words first and
 * revealing after is a message a screen reader never hears.
 */
const SAID_FOR_MS = 10_000
let saidTimer: number | null = null

function hush(): void {
  if (saidTimer !== null) clearTimeout(saidTimer)
  saidTimer = null
  saidEl.hidden = true
  saidWhatEl.textContent = ''
  saidWhatEl.title = ''
}

function say(text: string, bad = false): void {
  if (saidTimer !== null) clearTimeout(saidTimer)
  saidEl.classList.toggle('bad', bad)
  saidEl.hidden = false
  saidWhatEl.textContent = text
  // The drawer is one line tall, so a long message is ellipsed — and a message
  // that is only half available is a message somebody has to guess at. The
  // tooltip carries the rest; the live region still announces the whole thing,
  // because that reads `textContent` rather than what is painted.
  saidWhatEl.title = text
  saidTimer = window.setTimeout(hush, SAID_FOR_MS)
}

saidShutEl.addEventListener('click', hush)

function empty(parent: HTMLElement, text: string): void {
  const said = document.createElement('p')
  said.className = 'empty'
  said.textContent = text
  parent.replaceChildren(said)
}

/** One line, with the query marked inside it. See `highlight` for why not HTML. */
function marked(text: string, term: string): DocumentFragment {
  const fragment = document.createDocumentFragment()
  for (const segment of highlight(text, term)) {
    if (!segment.hit) {
      fragment.append(document.createTextNode(segment.text))
      continue
    }
    const hit = document.createElement('mark')
    hit.textContent = segment.text
    fragment.append(hit)
  }
  return fragment
}

/* ---- her state, across the top ----------------------------------------- */

/**
 * The strip the handoff puts first, and the reason it is first.
 *
 * One fact, where there were two. Whether she is awake IS whether the
 * microphone is open now: the `microphone` grant was the other half — what this
 * machine permitted, as against where she was left — and it is gone, because
 * macOS already owns that answer and resting already hands the device back.
 * `@shared/grants` carries the argument.
 */
function renderState(view: ShelfView): void {
  const { asleep, restKey } = view.state
  stateEl.textContent = asleep ? 'asleep' : 'awake'
  stateHowEl.textContent =
    restKey === null
      ? 'no key — another application has it'
      : `${restKey} to ${asleep ? 'wake' : 'rest'}`

  /*
    TWO states on the mark, where there were three.

    The third was `off` — a grant this machine withheld, drawn with a line
    through the microphone so that a decision somebody made could not read as
    "she happens to be resting". With that grant gone, her attention is the
    whole of it: open or closed, and nothing else can close it.
  */
  micEl.classList.toggle('open', !asleep)

  const words = asleep ? 'microphone closed' : 'microphone open'
  // The words survive the pill. `#mic-label` is off-screen rather than deleted,
  // so a screen reader still gets the sentence; `title` is what a pointer gets.
  micLabelEl.textContent = words
  micEl.title = words
}

/* ---- the characters ------------------------------------------------------ */

function renderCards(): void {
  if (shelf === null) return
  charactersEl.replaceChildren(
    ...characterCards(shelf, showingCharacter ? shelf.wornId : null, (id) => {
      showingCharacter = true
      open = null
      generation += 1
      // Wearing is what makes the switch real; the sheet follows from the
      // re-read rather than from a local guess about what changed.
      if (shelf !== null && id !== shelf.wornId) return handlers.wear(id)
      openCharacter()
    }),
  )
  const many = shelf.characters.length
  charactersCountEl.textContent = `${String(many)} ${many === 1 ? 'character' : 'characters'}`
  /*
    New, Duplicate and Delete, under the list they act on.

    They were the last section of the character sheet, which put the control
    that makes a second character below the fold of a long scroll — on the one
    install that has exactly one. See `castActions`.
  */
  castEl.replaceChildren(...castActions(shelf, handlers))
}

/**
 * Her face beside the wordmark.
 *
 * The worn one, redrawn on every read, because switching character from the
 * tray while this window is open changes who the strip is about. One frame — a
 * blinking mark in a title bar is motion with nothing to say.
 */
function drawMark(face: ShelfView['face']): void {
  // Sized to the wordmark beside it rather than to a number of its own: the two
  // are one lockup, and a 22px mark next to 15px caps read as a picture that
  // happened to be filed there.
  const px = 26
  const ratio = Math.min(window.devicePixelRatio || 1, 3)
  markEl.width = Math.round(px * ratio)
  markEl.height = Math.round(px * ratio)
  markEl.style.width = `${String(px)}px`
  markEl.style.height = `${String(px)}px`
  // Offscreen and blitted centred, exactly as `faceTile` does it and through the
  // same function: the rig reserves headroom for a worst-case pose, so drawn
  // straight in she sits low and the lockup looks out of line. See `centre.ts`.
  drawCentred(markEl, (offCtx) => {
    const avatar = new MochiAvatar(offCtx, { face, size: 'fit-canvas', random: () => 0.5 })
    avatar.resize(px, px, ratio)
    avatar.setIdle(false)
    avatar.render(0)
  })
}

/**
 * The worn character's face, for the avatar beside her runs.
 *
 * `undefined` rather than a substitute when there is no shelf yet or the
 * character has gone: `faceTile` refuses a missing face and draws the dashed
 * hole, which is the same answer the cards give and for the same reason.
 */
function wornFaceSpec(): ShelfView['face'] | undefined {
  return shelf?.characters.find((one) => one.id === shelf?.wornId)?.face
}

/**
 * What to call her at the top of a turn.
 *
 * The conversations listed are the worn character's, so the worn character is
 * who "her" turns belong to.
 */
function speaker(): string {
  const worn = shelf?.characters.find((one) => one.id === shelf?.wornId)
  return worn?.name ?? forPronoun(SAYS.spoke, saying())
}

/** Draw the open character in the main column. */
function openCharacter(): void {
  if (shelf === null) return
  const arriving = !showingCharacter
  showingCharacter = true
  paneEl.replaceChildren(characterSheet(shelf, handlers))
  // Only when the pane ARRIVES on the character. Every write re-reads and
  // redraws the sheet, so forgetting her notes — a button near the bottom —
  // would otherwise throw the page back to the top the moment it worked.
  if (arriving) paneEl.scrollTop = 0
  troublesEl.setAttribute('aria-current', 'false')
  for (const other of listEl.querySelectorAll('.entry')) other.setAttribute('aria-current', 'false')
  renderCards()
}

/* ---- the inspector ------------------------------------------------------- */

/**
 * Which of the three places is on screen.
 *
 * The inspector's own two tabs are gone with this: Cast used to carry a "next
 * wake" panel and a "conversations" panel side by side in a 380px column, and
 * conversations now have the whole window. One tab strip, one subject.
 */
type Place = 'cast' | 'archive' | 'machine'
let place: Place = 'cast'

const PLACES: readonly { readonly id: Place; readonly label: string }[] = [
  { id: 'cast', label: 'Cast' },
  { id: 'archive', label: 'Archive' },
  { id: 'machine', label: 'Machine' },
]

function showPlace(next: Place): void {
  place = next
  for (const one of PLACES) {
    need(`tab-${one.id}`, HTMLElement).hidden = one.id !== place
  }
  // Search belongs to the Archive and to nothing else. Hidden rather than
  // emptied, so what is typed in it survives a trip to Cast and back.
  contextEl.hidden = place !== 'archive'
  /*
    Cast repaints the open character on arrival.

    `showingCharacter` is turned OFF when a transcript or a problem report is
    opened, and nothing turned it back on: coming back to Cast left the pane
    holding whatever was last drawn there with no card marked current, and the
    next write's reload skipped repainting it because `openCharacter` is only
    reached through a card click.
  */
  if (place === 'cast' && shelf !== null && !showingCharacter) openCharacter()
  /*
    The transcript column says what it is FOR when nothing is open in it.

    Half a window of blank paper beside a list is indistinguishable from a
    transcript that failed to load, and it was the first thing on screen every
    time somebody opened the Archive. Only when nothing is open — a re-render
    while a conversation is up must not throw it away.
  */
  if (place === 'archive' && open === null && talkEl.childElementCount === 0) {
    empty(talkEl, forPronoun(SAYS.pickOne, saying()))
  }
  renderPlaces()
  // Read on arrival rather than held: the machine pane's answers come from disk
  // and from another window's writes, so a cached copy is stale the first time
  // it matters.
  if (place === 'machine') void loadMachine()
}

/**
 * The three tabs, built ONCE and thereafter only marked.
 *
 * They used to be recreated on every `showPlace`, which is a re-render fired
 * from inside a tab's own click handler: the element being clicked is detached
 * mid-event and replaced by a new one, so keyboard focus lands on `<body>` and
 * the next Tab starts over from the top of the window. A strip of three buttons
 * that cannot be operated twice from the keyboard is a strip that only works
 * with a mouse.
 */
const tabs = new Map<Place, HTMLButtonElement>()

function renderPlaces(): void {
  if (tabs.size === 0) {
    for (const one of PLACES) {
      const button = document.createElement('button')
      button.className = 'shell-tab'
      button.type = 'button'
      button.setAttribute('role', 'tab')
      button.textContent = one.label
      button.addEventListener('click', () => {
        showPlace(one.id)
      })
      tabs.set(one.id, button)
      shellTabsEl.append(button)
    }
  }
  for (const [id, button] of tabs) button.setAttribute('aria-current', String(id === place))
}

function renderWake(): void {
  if (shelf === null) return
  wakeEl.replaceChildren(...assembledPanel(shelf, handlers))
}

/* ---- doing things -------------------------------------------------------- */

/**
 * Clicking a card WEARS her — the handoff's own interaction (1a) — so the
 * plates, the assembled prompt and the conversations list all follow from one
 * click. A wake opens a new session, so nothing is torn down; the sheet says
 * as much rather than leaving somebody to wonder whether it took.
 */
/**
 * Every message this window writes that is ABOUT her, one phrasing per pronoun.
 *
 * Read against `shelf.pronoun`, which is re-read on every draw, so a character
 * switch rewords these on the same pass that redraws the sheet.
 */
const SAYS = {
  worn: {
    she: 'Worn. She will be this character from her next wake.',
    he: 'Worn. He will be this character from his next wake.',
    it: 'Worn. It will be this character from its next wake.',
  },
  saved: {
    she: 'Saved. It takes effect on her next wake.',
    he: 'Saved. It takes effect on his next wake.',
    it: 'Saved. It takes effect on its next wake.',
  },
  deleted: {
    she: 'Deleted, with her notes and her conversations. The built-in is worn now.',
    he: 'Deleted, with his notes and his conversations. The built-in is worn now.',
    it: 'Deleted, with its notes and its conversations. The built-in is worn now.',
  },
  restored: {
    she: 'The built-in is back as she ships.',
    he: 'The built-in is back as he ships.',
    it: 'The built-in is back as it ships.',
  },
  made: {
    she: 'Made, and worn. She will be this character from her next wake.',
    he: 'Made, and worn. He will be this character from his next wake.',
    it: 'Made, and worn. It will be this character from its next wake.',
  },
  /**
   * The fallback speaker label, when the character whose conversation this is
   * has gone from the shelf.
   *
   * Her NAME is what a transcript uses, and what this build shipped instead was
   * the object pronoun: a paragraph headed "HIM" above a paragraph headed "YOU",
   * which is not how anybody writes down a conversation. The name is only
   * missing if the persona was deleted while a transcript of hers was open, and
   * then this is better than a blank.
   */
  spoke: { she: 'her', he: 'him', it: 'it' },
  cutEarly: {
    she: 'interrupted before she got a word out',
    he: 'interrupted before he got a word out',
    it: 'interrupted before it got a word out',
  },
  noTalks: {
    she: 'Nothing has been kept yet. Conversations appear here once she has been awake and retention is on.',
    he: 'Nothing has been kept yet. Conversations appear here once he has been awake and retention is on.',
    it: 'Nothing has been kept yet. Conversations appear here once it has been awake and retention is on.',
  },
  machineIsFor: {
    she: 'Who she is is on the Cast tab. This holds only what is true whoever is worn.',
    he: 'Who he is is on the Cast tab. This holds only what is true whoever is worn.',
    it: 'What it is is on the Cast tab. This holds only what is true whoever is worn.',
  },
  pickOne: {
    she: 'Pick a conversation on the left, or search everything she has ever said.',
    he: 'Pick a conversation on the left, or search everything he has ever said.',
    it: 'Pick a conversation on the left, or search everything it has ever said.',
  },
  noTroubles: {
    she: 'Nothing has gone wrong since she woke up.',
    he: 'Nothing has gone wrong since he woke up.',
    it: 'Nothing has gone wrong since it woke up.',
  },
  troubles: {
    she: 'Things she could not load since she woke up. Each one fell back to a working default, so nothing here stopped her — but a file you edited may not be the one she is using.',
    he: 'Things he could not load since he woke up. Each one fell back to a working default, so nothing here stopped him — but a file you edited may not be the one he is using.',
    it: 'Things it could not load since it woke up. Each one fell back to a working default, so nothing here stopped it — but a file you edited may not be the one it is using.',
  },
} as const satisfies Readonly<Record<string, ByPronoun>>

/**
 * Which words to use right now.
 *
 * `DEFAULT_PRONOUN` until the first read answers, which is the same fallback
 * `parsePersona` applies to a file that does not say -- not a guess invented
 * here.
 */
function saying(): Pronoun {
  return shelf?.pronoun ?? DEFAULT_PRONOUN
}

const handlers: ShelfHandlers = {
  wear: (id) => {
    generation += 1
    void write(() => window.mochiHistory.wear(id), forPronoun(SAYS.worn, saying()))
  },
  save: (change) => {
    void write(() => window.mochiHistory.saveCharacter(change), forPronoun(SAYS.saved, saying()))
  },
  tryFace: (face) => {
    /*
      NOT through `write`, and the difference is the reload.

      `write` re-reads the whole shelf after every outcome, because the controls
      are drawn from the last read and a refused change would otherwise leave a
      switch showing a value nothing took. Nothing is stored here — this is a
      look, not a change — so there is no stale control to correct, and a reload
      would rebuild the grid under the pointer that just clicked it.
    */
    void (async () => {
      try {
        const result = await window.mochiHistory.wearFace(face)
        // Named, so the status line says which face went on. "Done" over eight
        // tiles that look alike at 56px says nothing anybody can check.
        say(result.ok ? `${face} — look at her.` : result.why, !result.ok)
      } catch (error: unknown) {
        say(String(error), true)
      }
    })()
  },
  persona: (action) => {
    void write(
      () => window.mochiHistory.character(action),
      action.kind === 'delete'
        ? forPronoun(SAYS.deleted, saying())
        : action.kind === 'restore-built-in'
          ? forPronoun(SAYS.restored, saying())
          : forPronoun(SAYS.made, saying()),
    )
  },
  memory: (action) => {
    void write(
      () => window.mochiHistory.memory(action),
      action.kind === 'restore' ? 'Put back as it was.' : 'Forgotten.',
    )
  },
  prompt: (text) => {
    void write(
      () => window.mochiHistory.prompt(text),
      // What actually happens, rather than "Saved". It is stored now and she
      // is handed it on her next wake — `session.update` could carry it, and
      // replacing who she is mid-sentence is a character switch without the
      // reconnect a character switch gets.
      text.trim() === ''
        ? 'The system prompt is empty. She is still told her character.'
        : forPronoun(SAYS.saved, saying()),
    )
  },
  say,
}

/**
 * Do one thing, say what happened, then re-read EVERYTHING from main.
 *
 * Re-read rather than patched in place: main is the truth, and a window that
 * believed its own copy would be the second place a character lives. The
 * conversations are re-read too, because wearing somebody changes whose they
 * are — the archive is scoped per character.
 */
async function write(act: () => Promise<SettingsWrite>, done: string): Promise<void> {
  try {
    const result = await act()
    say(result.ok ? done : result.why, !result.ok)
  } catch (error: unknown) {
    say(String(error), true)
  }
  /**
   * Re-read after EVERY outcome, including a throw.
   *
   * The controls are populated from the last read, so a change that was not
   * accepted leaves a select or a checkbox showing a value nothing took. A
   * refusal used to re-read and a throw used to return — so the one failure
   * that says least about itself was also the one that left the window lying.
   */
  await reload()
}

/** Everything, from main, in the order the panes are drawn. */
async function reload(): Promise<void> {
  try {
    await readShelf()
    await readConversations()
    if (showingCharacter) openCharacter()
  } catch (error: unknown) {
    say(`Could not re-read: ${String(error)}`, true)
  }
}

async function readShelf(): Promise<void> {
  const view = await window.mochiHistory.shelf()
  shelf = view
  /**
   * HER colour, before anything is drawn with it.
   *
   * The design's second semantic rule — the accent is her — and it is applied
   * on every read because the worn character can change from this very window.
   */
  drawMark(view.face)
  const unreadable = applyAccent(document.documentElement, view.face)
  renderState(view)
  renderCards()
  renderWake()
  if (unreadable.length > 0) {
    say(`That character's colour is not readable, so the built-in is used.`, true)
  }
}

/* ---- the conversations --------------------------------------------------- */

/**
 * One row in the archive: when it was, and what it was made of.
 *
 * ONE line, not two. The day is the heading above a run of these, so the row
 * says the clock and the facts — `09:41 · 14 turns · 7 min` — where it used to
 * repeat "Today" on every entry under a list that was already in date order.
 *
 * The artifact draws a second line under it with a subject: "the three files,
 * and what moved this morning". Nothing writes one. A conversation is stored as
 * its turns and nothing summarises them, so a subject here would either be an
 * invention or the first line of the transcript wearing a title's clothes. It
 * is left out rather than faked, and `plan-v2.md` W5 carries what it would take.
 */
function row(
  label: string,
  /**
   * What follows the clock: a phrase, or facts drawn as glyphs.
   *
   * NODES rather than a string, because the archive's own two facts are now a
   * speech-bubble glyph and a clock glyph with numbers beside them, and a
   * search hit's is still a phrase. Building the separator here keeps that one
   * decision in one place — the alternative was every caller remembering the
   * middle dot, which is how one of them comes to be missing it.
   */
  detail: string | readonly Node[],
  token: string,
  snippet: { text: string; term: string } | null,
): HTMLButtonElement {
  const button = document.createElement('button')
  button.className = 'entry'
  button.type = 'button'
  button.setAttribute('aria-current', String(token === open))

  const when = document.createElement('div')
  when.className = 'when'
  const stamp = document.createElement('span')
  stamp.textContent = label
  when.append(stamp)
  if (typeof detail === 'string') {
    if (detail !== '') when.append(` · ${detail}`)
  } else {
    for (const fact of detail) when.append(fact)
  }
  button.append(when)

  if (snippet !== null) {
    const line = document.createElement('div')
    line.className = 'snippet'
    line.append(marked(snippet.text, snippet.term))
    button.append(line)
  }

  button.addEventListener('click', () => {
    open = token
    showingCharacter = false
    generation += 1
    renderCards()
    void show(token, snippet?.term ?? '')
    troublesEl.setAttribute('aria-current', 'false')
    for (const other of listEl.querySelectorAll('.entry')) {
      other.setAttribute('aria-current', String(other === button))
    }
  })
  return button
}

/**
 * Take one turn's words, on hover.
 *
 * The bubbles are selectable — `user-select: text` — but selecting one by hand
 * means dragging across a rounded shape and stopping before the next, and the
 * thing people want from a transcript is almost always one whole turn.
 *
 * The RAW text, not what is on screen. The rendered bubble is chopped into
 * `<mark>` elements when a search term is live, so reading it back out of the
 * DOM would copy the words with the highlighting's seams in them.
 *
 * Reachable by keyboard as well as by pointer: it is revealed on `:focus-within`
 * as well as on `:hover`, so tabbing through a transcript surfaces it rather
 * than moving focus to a control nobody can see.
 */
/**
 * A small square button whose whole content is an SVG path or two.
 *
 * `copyButton` and `arrow` each rebuilt the namespace, the viewBox, the sizing,
 * the `aria-hidden` on the graphic and the accessible name on the button — the
 * same eight lines twice, and the accessibility half is exactly the part that
 * is quietly dropped when somebody adds a third by copying one of them.
 *
 * The LABEL is on the button and the graphic is hidden, always. A path with no
 * name announces as "button", and a name on both announces twice.
 */
function iconButton(
  className: string,
  label: string,
  paths: readonly string[],
  px: number,
): HTMLButtonElement {
  const NS = 'http://www.w3.org/2000/svg'
  const button = document.createElement('button')
  button.className = className
  button.type = 'button'
  button.title = label
  button.setAttribute('aria-label', label)

  const svg = document.createElementNS(NS, 'svg')
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('width', String(px))
  svg.setAttribute('height', String(px))
  svg.setAttribute('aria-hidden', 'true')
  for (const d of paths) {
    const path = document.createElementNS(NS, 'path')
    path.setAttribute('d', d)
    svg.append(path)
  }
  button.append(svg)
  return button
}

function copyButton(text: string): HTMLButtonElement {
  const button = iconButton(
    'copy',
    'Copy this turn',
    ['M5.5 5.5h7v7h-7z', 'M10.5 5.5v-2h-7v7h2'],
    13,
  )

  button.addEventListener('click', () => {
    /*
      Through MAIN, not through `navigator.clipboard`.

      The browser's async clipboard refuses an unfocused document —
      `NotAllowedError: Document is not focused`, reproduced from a harness in
      two runs out of three. A click focuses the window first, so the browser
      path does work in practice; it just does not have to, and a button whose
      failure depends on which window was frontmost is one nobody can diagnose.

      REPORTED either way. A copy button that silently does nothing is
      indistinguishable from one that worked.
    */
    void window.mochiHistory
      .copy(text)
      .then((wrote) => {
        say(wrote.ok ? 'Copied.' : wrote.why, !wrote.ok)
      })
      .catch((error: unknown) => {
        say(`Could not copy: ${String(error)}`, true)
      })
  })
  return button
}

/**
 * What this conversation was, over the top of it.
 *
 * Read off the TURNS rather than looked up in the list. A search result can
 * open a conversation that is not in `conversations` at all — the list is the
 * worn character's recent ones and the search is everything ever said — so a
 * lookup would leave the header blank exactly when somebody arrived from a
 * search. The turns are already in hand and answer all three facts.
 *
 * The artifact also draws a row of tool chips here: `ask_workspace ×2`,
 * `remember_this ×1`. Nothing archives a call. `transcripts.ts` stores turns —
 * `{at, who, text, cut}` — and a capability's answer reaches the model and the
 * problem log and never the record, so those chips would be invented. Left out,
 * with what it would take written into `plan-v2.md` W5.
 */
function transcriptHead(turns: readonly HistoryTurn[]): HTMLElement {
  const head = document.createElement('div')
  head.className = 'talk-head'

  const first = turns[0]?.at ?? Date.now()
  const last = turns.at(-1)?.at ?? first
  const title = document.createElement('div')
  title.className = 'talk-when'
  title.textContent = `${dayLabel(first, Date.now())}, ${clockLabel(first)}`

  /*
    The SAME function the list beside this calls, and that is the point.

    These two facts were built as strings here and again over there, so a change
    to one of them was a change to one of them. The third fact is this header's
    alone: an interruption count is about the conversation being read, and the
    list is a column of six rows where a third mark on each would be noise.

    The last turn's timestamp is what `ended_at` is — see `lengthLabel`, which
    is deliberate about not pretending to seconds for the same reason.
  */
  const said: Node[] = [...facts(turns.length, lengthLabel(first, last))]
  const cut = interruptions(turns)
  if (cut > 0) {
    said.push(
      fact(CUT, String(cut), `${String(cut)} ${cut === 1 ? 'interruption' : 'interruptions'}`),
    )
  }

  const meta = document.createElement('div')
  meta.className = 'talk-facts'
  meta.append(...said)

  head.append(title, meta)
  return head
}

async function show(token: string, term: string): Promise<void> {
  const mine = generation
  let turns: readonly HistoryTurn[]
  try {
    turns = await window.mochiHistory.turns(token)
  } catch (error: unknown) {
    // Loud, and in the pane that failed. Leaving the previous transcript up
    // with no message is indistinguishable from this one having loaded.
    if (mine === generation) empty(talkEl, `Could not read that conversation: ${String(error)}`)
    return
  }
  // Somebody has moved on. Painting this now would replace what they asked for
  // with what they closed.
  if (mine !== generation || showingCharacter || open !== token) return
  if (turns.length === 0) {
    empty(talkEl, 'Nothing was kept from this conversation.')
    return
  }
  /*
    A conversation, drawn the way a conversation is drawn.

    Turns are GROUPED into runs by speaker, because that is what makes this read
    as a chat rather than as a log: nobody repeats the name above every line
    somebody says in a row. The name and her face appear once per run, and a run
    of six replies is six bubbles under one heading.

    Her face is the same rig that draws her on the desktop and on her card -- the
    third place it is used and still the only drawing of her, which is the whole
    argument `shipped-icons.test.ts` was written to defend.
  */
  const transcript = document.createElement('div')
  transcript.className = 'transcript'
  transcript.append(transcriptHead(turns))

  let run: HTMLElement | null = null
  let said: HTMLElement | null = null
  let speaking: HistoryTurn['who'] | null = null

  for (const turn of turns) {
    if (turn.who !== speaking) {
      speaking = turn.who
      run = document.createElement('div')
      run.className = `run ${turn.who}`
      said = document.createElement('div')
      said.className = 'said'
      const who = document.createElement('div')
      who.className = 'who'
      who.textContent = turn.who === 'her' ? speaker() : 'you'
      said.append(who)
      // Her face on the left of her own run. Yours is not drawn: the side of the
      // column a bubble is on is already unambiguous, and inventing an avatar
      // for a person this app has never seen would be a lie about knowing them.
      if (turn.who === 'her' && shelf !== null) {
        const face = wornFaceSpec()
        run.append(faceTile(face, 28))
        // The same admission the cards make: a missing face is a dashed hole
        // rather than the built-in mochi standing in for somebody else.
        if (face === undefined) run.classList.add('faceless')
      }
      run.append(said)
      transcript.append(run)
    }

    const bubble = document.createElement('div')
    bubble.className = 'bubble'
    bubble.append(marked(turn.text, term), copyButton(turn.text))
    said?.append(bubble)

    if (turn.cut) {
      // Said out loud rather than implied by a short line. The boundary is an
      // ESTIMATE (§60: -3% to -22%, always short), so a reader who can see that
      // it was cut can also discount the last few words. It follows the bubble
      // it belongs to rather than the run, because only one turn was cut.
      const note = document.createElement('div')
      note.className = 'cut'
      note.textContent = turn.text === '' ? forPronoun(SAYS.cutEarly, saying()) : 'interrupted'
      said?.append(note)
    }
  }

  talkEl.replaceChildren(transcript)
  talkEl.scrollTop = 0
}

/** A caps heading over a run of rows that share a day. */
function dayHeading(day: string): HTMLElement {
  const head = document.createElement('div')
  head.className = 'day'
  head.textContent = day
  return head
}

/* ---- the calendar, and the day it is showing ----------------------------- */

/**
 * Which day the list is filtered to, and which month the grid is on.
 *
 * Two pieces of state rather than one, because they move independently: paging
 * to November does not choose a day in November, and choosing a day in a month
 * you paged to does not page anywhere.
 */
let picked: number | null = null
let onMonth: { readonly year: number; readonly month: number } | null = null

/** How many conversations fall on each local day. */
function countByDay(): ReadonlyMap<number, number> {
  const found = new Map<number, number>()
  for (const one of conversations) {
    const key = dayKey(one.startedAt)
    found.set(key, (found.get(key) ?? 0) + 1)
  }
  return found
}

/**
 * Which day to open on: today, or the last one there is anything on.
 *
 * Today FIRST, because that is what somebody opening the Archive means. The
 * fallback matters on every other day: an app used twice a week would otherwise
 * open on an empty column most of the time, which reads as "nothing was kept"
 * rather than as "nothing today".
 */
function openingDay(now: number): number | null {
  const today = startOfDay(now)
  const counts = countByDay()
  if (counts.has(today)) return today
  const days = [...counts.keys()].sort((a, b) => b - a)
  return days[0] ?? null
}

function arrow(direction: 'back' | 'on', label: string, go: () => void): HTMLButtonElement {
  const button = iconButton(
    'step',
    label,
    [direction === 'back' ? 'M10 3 5 8l5 5' : 'M6 3l5 5-5 5'],
    13,
  )
  button.addEventListener('click', go)
  return button
}

/**
 * The month, with a dot on every day something was said.
 *
 * The dot is the reason a calendar beats a date field here: it answers "when
 * was I talking to her" before anybody clicks anything, which no list of rows
 * can do without being scrolled.
 *
 * A day with nothing on it is NOT a button. A cell that looks pressable and
 * answers with an empty column is the same lie as offering her a tool she
 * cannot call.
 */
function renderCalendar(now: number): void {
  if (onMonth === null) return
  const { year, month } = onMonth
  const counts = countByDay()
  const today = startOfDay(now)

  const head = document.createElement('div')
  head.className = 'head'
  const label = document.createElement('div')
  label.className = 'month'
  label.textContent = monthLabel(year, month)
  head.append(
    label,
    arrow('back', 'Previous month', () => {
      onMonth = stepMonth(year, month, -1)
      renderCalendar(Date.now())
    }),
    arrow('on', 'Next month', () => {
      onMonth = stepMonth(year, month, 1)
      renderCalendar(Date.now())
    }),
  )

  const grid = document.createElement('div')
  grid.className = 'grid'
  for (const initial of weekdayInitials()) {
    const cell = document.createElement('div')
    cell.className = 'initial'
    cell.textContent = initial
    grid.append(cell)
  }
  for (const week of monthGrid(year, month)) {
    for (const cell of week) {
      if (cell === null) {
        // `blank`, not `empty`: this window already styles `.empty` as the
        // sentence a pane shows when it has nothing in it, and it was sizing
        // two of the six week rows to 80px.
        const blank = document.createElement('div')
        blank.className = 'blank'
        grid.append(blank)
        continue
      }
      const many = counts.get(cell.at) ?? 0
      const day = document.createElement('button')
      day.className = `day${many > 0 ? ' has' : ''}${cell.at === today ? ' today' : ''}`
      day.type = 'button'
      day.textContent = String(cell.day)
      day.setAttribute('aria-current', String(cell.at === picked))
      day.disabled = many === 0
      if (many > 0) {
        day.title = `${String(many)} ${many === 1 ? 'conversation' : 'conversations'}`
        const dot = document.createElement('span')
        dot.className = 'dot'
        day.append(dot)
        day.addEventListener('click', () => {
          picked = cell.at
          renderCalendar(Date.now())
          renderList(Date.now())
        })
      }
      grid.append(day)
    }
  }

  calEl.replaceChildren(head, grid)
}

/**
 * One day's conversations, under the day they happened on.
 *
 * FILTERED, not scrolled to. The alternative — keep the whole list and jump it
 * to the date — preserves browsing across days at the cost of never being able
 * to say "this column is that day". This is the shape that was chosen: one day
 * is the subject, and the calendar above is how you reach another.
 */
function renderList(now: number): void {
  calEl.hidden = false
  if (conversations.length === 0) {
    calEl.hidden = true
    empty(listEl, forPronoun(SAYS.noTalks, saying()))
    return
  }
  picked ??= openingDay(now)
  const opened = new Date(picked ?? now)
  onMonth ??= { year: opened.getFullYear(), month: opened.getMonth() }
  renderCalendar(now)

  const day = picked
  if (day === null) {
    empty(listEl, forPronoun(SAYS.noTalks, saying()))
    return
  }

  const head = document.createElement('div')
  head.className = 'picked'
  const what = document.createElement('span')
  what.className = 'what'
  what.textContent = dayHeadingLabel(day)
  const mine = conversations.filter((one) => dayKey(one.startedAt) === day)
  const stat = document.createElement('span')
  stat.className = 'stat'
  stat.textContent = String(mine.length)
  head.append(what, stat)

  if (mine.length === 0) {
    // Only reachable from a stale render — a day with nothing on it is not a
    // button — so it says which day rather than leaving the column blank.
    const none = document.createElement('p')
    none.className = 'empty'
    none.textContent = 'Nothing was said on this day.'
    listEl.replaceChildren(head, none)
    return
  }

  listEl.replaceChildren(
    head,
    ...mine.map((one) =>
      row(
        clockLabel(one.startedAt),
        facts(one.turns, lengthLabel(one.startedAt, one.endedAt)),
        one.token,
        null,
      ),
    ),
  )
}

/**
 * How many turns, and how long — as glyphs, in the two places that draw them.
 *
 * ## Why not the words
 *
 * `14 turns · 7 min` on every row of a day's list is the same two nouns down
 * the whole column, and the numbers are what somebody is actually comparing.
 * The glyph carries the noun once, in a shape, and the sentence survives as the
 * accessible name — see `glyph.ts`, which states the rule the microphone in the
 * top strip already follows.
 *
 * ## The mark is per ROW, not per format
 *
 * The first version tested whether the label started with a digit, which left
 * `under a minute` — the one phrase `lengthLabel` used to return — bare, on the
 * grounds that a glyph belongs beside a number. A photograph of the column
 * settled it the other way: one row without the mark its six neighbours carry
 * reads as a row missing something, and the clock is not a unit — it is the
 * word "for". That phrase is gone and every answer is now `7 min` or `1 h 20
 * min`, so the case cannot recur; the rule it settled is what is kept.
 *
 * ## One function, called from both places
 *
 * These two facts were built as strings in the list and again in the transcript
 * header, so a change to one of them was a change to one of them.
 */
function facts(turns: number, length: string | null): readonly Node[] {
  const said: Node[] = [
    fact(TURNS, String(turns), `${String(turns)} ${turns === 1 ? 'turn' : 'turns'}`),
  ]
  // Null while she is still awake in it — see `lengthLabel`, which refuses to
  // answer at all rather than reporting a backwards span as a real duration.
  if (length !== null) said.push(fact(RAN_FOR, length, `ran for ${length}`))
  return said
}

interface HitGroup {
  readonly token: string
  readonly at: number
  readonly text: string
  readonly count: number
}

/** Search results, grouped so a conversation appears once with its best line. */
function renderHits(hits: readonly HitGroup[], term: string): void {
  /*
    The calendar goes away while a search is live.

    Searching spans every day there has ever been, so a grid highlighting one of
    them would be describing a filter that is not in force. Hidden rather than
    emptied, so clearing the field brings back the month somebody had paged to.
  */
  calEl.hidden = true
  if (hits.length === 0) {
    empty(listEl, 'Nothing matched.')
    return
  }
  const now = Date.now()
  const parts: HTMLElement[] = []
  for (const day of byDay(hits, now, (one) => one.at)) {
    parts.push(dayHeading(day.day))
    for (const hit of day.items) {
      parts.push(
        row(
          clockLabel(hit.at),
          `${String(hit.count)} ${hit.count === 1 ? 'match' : 'matches'}`,
          hit.token,
          { text: hit.text, term },
        ),
      )
    }
  }
  listEl.replaceChildren(...parts)
}

/** One entry per conversation, keeping the first line that matched. */
function group(hits: readonly HistoryHit[]): readonly HitGroup[] {
  const found = new Map<string, { token: string; at: number; text: string; count: number }>()
  for (const hit of hits) {
    const already = found.get(hit.token)
    if (already === undefined) {
      found.set(hit.token, { token: hit.token, at: hit.at, text: hit.text, count: 1 })
      continue
    }
    already.count += 1
  }
  return [...found.values()]
}

/**
 * The conversations, scoped to whoever is worn.
 *
 * Re-read on every character switch, not only at startup: the archive is
 * scoped per character, so a list left over from the previous one would be one
 * character's card ringed beside another character's words.
 */
/**
 * Whose conversations the calendar is currently describing.
 *
 * `picked` and `onMonth` are chosen once and then kept, which is right while
 * one character is worn and wrong the moment another is. Wearing somebody else
 * re-reads the list; without this the Archive stayed on the previous
 * character's day and rendered "Nothing was said on this day" for a date the
 * new character had never been awake on, with her own conversations one click
 * away and no sign of it.
 */
let listed: string | null = null

async function readConversations(): Promise<void> {
  try {
    const answer = await window.mochiHistory.list()
    conversations = answer.conversations
    if (answer.persona !== listed) {
      listed = answer.persona
      picked = null
      onMonth = null
    }
    // Her NAME, from the shelf, falling back to the id `history:list` answers
    // with. The cards say "Loki"; a title bar saying `loki` beside them would
    // be two names for one character in one window.
    const name = shelf?.characters.find((one) => one.id === answer.persona)?.name
    // "Mochi", not "Shelf". The shelf is one of this window's three places —
    // the archive and this machine are the other two — and the tray's single
    // item names the application for the same reason.
    document.title = `Mochi · ${name ?? answer.persona}`
    const many = conversations.length
    countEl.textContent = `${String(many)} ${many === 1 ? 'conversation' : 'conversations'}`
    /*
      A live query WINS over the calendar.

      Every reload rendered the day list, so a reload triggered while something
      was typed in the search field — wearing a character, saving a field —
      replaced the results with a day's conversations under a populated search
      box. The field said one thing and the column showed another, with nothing
      to say which was in force.
    */
    if (queryEl.value.trim() === '') renderList(Date.now())
    else runSearch()
  } catch (error: unknown) {
    /*
      Loud, and it SAYS what went wrong. A window that silently shows "no
      conversations" when the store failed to open is indistinguishable from one
      with nothing in it.

      The cached list goes with it. It used to survive, so the calendar kept its
      dots, a date stayed clickable, and clicking one served the PREVIOUS
      character's conversations under the new character's name — a failure that
      presents as the archive working.
    */
    conversations = []
    listed = null
    picked = null
    onMonth = null
    calEl.replaceChildren()
    calEl.hidden = true
    empty(listEl, 'Could not read the archive.')
    countEl.textContent = ''
    say(`Could not read the archive: ${String(error)}`, true)
  }
}

/* ---- what went wrong ----------------------------------------------------- */

/**
 * What main could not do, in the window that can actually show it.
 *
 * Every `console.error` in main is a fallback that WORKED — a default persona,
 * a built-in avatar — so from outside they are indistinguishable from the app
 * ignoring the file somebody just wrote. That is the least debuggable outcome
 * this application can produce, and it was produced twice in one afternoon.
 *
 * A strip along the bottom rather than a tab: normally there is nothing here,
 * and a permanent tab onto an empty surface is one people learn to skip.
 */
function renderProblems(problems: readonly HistoryProblem[]): void {
  open = null
  showingCharacter = false
  generation += 1
  renderCards()
  troublesEl.setAttribute('aria-current', 'true')

  const page = document.createElement('div')
  page.className = 'report'
  const lead = document.createElement('p')
  lead.className = 'lead'
  // Says what it is AND what it is not. Everything here already fell back to
  // something working, so the reader is being told about a file that was
  // ignored, not about a broken app.
  if (problems.length === 0) {
    /*
      Its own sentence, because the lead below is about failures and a lead
      about failures with nothing under it reads as a list that failed to load.
      This is the state somebody reaches by clicking a chip that says 0.
    */
    lead.textContent = forPronoun(SAYS.noTroubles, saying())
    page.append(lead)
    talkEl.replaceChildren(page)
    talkEl.scrollTop = 0
    return
  }

  lead.textContent = forPronoun(SAYS.troubles, saying())
  page.append(lead)

  for (const problem of problems) {
    const block = document.createElement('div')
    block.className = 'problem'
    const where = document.createElement('div')
    where.className = 'where'
    where.textContent = `${problem.area} · ${clockLabel(problem.at)}`
    const detail = document.createElement('p')
    detail.textContent = problem.detail
    block.append(where, detail)
    if (problem.subject !== null) {
      const subject = document.createElement('div')
      subject.className = 'subject'
      subject.textContent = problem.subject
      block.append(subject)
    }
    page.append(block)
  }
  talkEl.replaceChildren(page)
  talkEl.scrollTop = 0
}

/**
 * How many things went wrong, re-read whenever this window comes back.
 *
 * Read only at startup, this was a strip that could never appear: problems
 * happen LATER — a capability that threw mid-conversation is the common case —
 * and a count of zero taken at launch hid the button for the life of the
 * window, so the one surface that can show them was unreachable exactly when
 * there was something to show.
 */
function readProblemCount(): void {
  void window.mochiHistory
    .problems()
    .then((problems) => {
      troublesEl.hidden = problems.length === 0
      troublesLabelEl.textContent = `${String(problems.length)} ${problems.length === 1 ? 'problem' : 'problems'}`
    })
    .catch((error: unknown) => {
      // The console, as the comment always claimed. It said the console was
      // where this goes and then wrote nothing to it, so a strip stuck on a
      // stale count had no trace anywhere. Not `say()`: the strip is itself
      // where failures are reported, and a toast about failing to count them
      // would be noise on every launch that cannot reach the store.
      console.error('[shell] could not count problems', error)
    })
}

/* ---- machine: the six groups, in this window --------------------------- */

/**
 * The settings window, folded in as a pane.
 *
 * `PANES` is imported whole and unchanged — the six groups, their attention
 * dots and everything they draw were never the problem, and a second window was.
 * What is gone is `settings/main.ts`: its job was owning a window, and this
 * window already exists.
 */
let machine: SettingsView | null = null
let openGroup = PANES[0]?.id ?? ''

const machineHandlers: PaneHandlers = {
  lookup: (change) => {
    void writeMachine(() => window.mochiSettings.lookup(change), 'Saved.')
  },
  screen: (change) => {
    void writeMachine(() => window.mochiSettings.screen(change), 'Saved.')
  },
  grant: (change) => {
    void writeMachine(() => window.mochiSettings.grant(change), 'Saved.')
  },
  recheckCodex: async () => {
    const found = await window.mochiSettings.recheckCodex()
    /*
      RE-READ, not patched in place.

      The status decides three things on this pane — the block itself, the
      attention dot in the nav, and whether the rest of the group is
      configuration for something that can run — and writing the new value into
      the held view would leave whichever of those nobody remembered to redraw
      showing the old answer. Main is one read away and it is the only source.
    */
    await loadMachine()
    return found
  },
  reveal: (what) => {
    window.mochiSettings.reveal(what)
  },
  say: (text, bad) => {
    say(text, bad === true)
  },
}

async function writeMachine(run: () => Promise<SettingsWrite>, ok: string): Promise<void> {
  try {
    const answer = await run()
    // Main's own refusal sentence when it has one — it knows why, and a generic
    // "could not save" would replace a reason with a shrug.
    say(answer.ok ? ok : answer.why, !answer.ok)
  } catch (error: unknown) {
    say(String(error), true)
  }
  await loadMachine()
}

async function loadMachine(): Promise<void> {
  try {
    machine = await window.mochiSettings.read()
  } catch (error: unknown) {
    /*
      The OLD view goes with the error, and so do the controls beside it.

      `machine`, the group navigation and the tool column all survived a failed
      read: the error appeared in the middle column while the nav kept its six
      buttons, and clicking one called `renderMachine`, which returns early only
      on `null` — so it repainted the previous read's settings over the error.
      A stale switch that looks live is worse than no switch, because it is one
      somebody will operate.
    */
    machine = null
    navEl.replaceChildren()
    toolsEl.replaceChildren()
    empty(machineEl, `Could not read the settings: ${String(error)}`)
    return
  }
  renderMachine()
}

function renderMachine(): void {
  const view = machine
  if (view === null) return
  navEl.replaceChildren(
    ...PANES.map((one) => {
      const button = document.createElement('button')
      button.className = 'tab'
      button.type = 'button'
      button.setAttribute('aria-current', String(one.id === openGroup))
      const label = document.createElement('span')
      label.textContent = paneLabel(one.label, view.pronoun)
      button.append(label)
      // A dot means somebody should look, not that something is off — see
      // `panes.ts`. A withheld grant is a decision and never wears one.
      if (one.attention(view) !== null) {
        const dot = document.createElement('span')
        dot.className = 'dot'
        button.append(dot)
      }
      button.addEventListener('click', () => {
        openGroup = one.id
        renderMachine()
        machineEl.scrollTop = 0
      })
      return button
    }),
  )
  /*
    What this whole tab is for, under the six groups.

    The artifact puts it there and it earns its place: the Cast tab and this one
    both hold switches about her, and the difference between them — who she IS
    versus what is true whoever is worn — is `plan-shell.md`'s split, which
    nothing on screen said out loud. It is the sentence that stops somebody
    looking for her voice in here.
  */
  const foot = document.createElement('p')
  foot.className = 'nav-foot'
  foot.textContent = forPronoun(SAYS.machineIsFor, view.pronoun)
  navEl.append(foot)

  const showing = PANES.find((one) => one.id === openGroup)
  if (showing === undefined) {
    machineEl.textContent = 'No settings to show.'
    return
  }
  const drawn = [...showing.render(view, machineHandlers)]

  /*
    The tool list moves out of the scroll and into its own column.

    `panes.ts` returns one flat list with the capabilities after the grants and
    a heading between them, which put the thing the grants are ABOUT below the
    fold — when a withheld grant is exactly what removes a row from it. Split on
    that heading rather than restructuring the pane: `panes.ts` is imported by
    this window unchanged, and its own tests still describe what it returns.
  */
  const at = drawn.findIndex((node) => node instanceof HTMLHeadingElement)
  const body = at === -1 ? drawn : drawn.slice(0, at)
  const tools = at === -1 ? [] : drawn.slice(at)
  /*
    NO title over the body.

    The nav names the open group and highlights it; a 28px heading twenty pixels
    to its right said the same four words again, which is the artifact's own
    arrangement being ignored — it names the group once, in the nav, and starts
    the body with the section that is actually in it.
  */
  machineEl.replaceChildren(...body)
  if (tools.length === 0) {
    toolsEl.replaceChildren()
  } else {
    const card = document.createElement('div')
    card.className = 'tool-card'
    card.append(...tools)
    toolsEl.replaceChildren(card)
  }
}

/* ---- wiring -------------------------------------------------------------- */

troublesEl.addEventListener('click', () => {
  /*
    ARCHIVE first, because that is the pane the report is drawn into.

    `renderProblems` writes to `talkEl`, which lives inside `#tab-archive`. From
    Cast or Machine that pane is `hidden`, so the button read the problems,
    painted them into a hidden element, and looked like it did nothing — on two
    of the three tabs. The button is in the strip along the bottom, visible from
    all three, so it was unreachable more often than not.
  */
  showPlace('archive')
  // Asked again on every click rather than kept: more can arrive while the
  // window is open — a capability that throws mid-conversation is exactly the
  // kind that does.
  generation += 1
  const mine = generation
  void window.mochiHistory
    .problems()
    .then((found) => {
      // The same staleness rule every other read here follows. Without it a
      // slow problems read lands on top of a conversation opened after the
      // click, and the transcript is replaced by a report nobody asked for now.
      if (mine !== generation) return
      renderProblems(found)
    })
    .catch((error: unknown) => {
      if (mine === generation) empty(talkEl, `Could not read what went wrong: ${String(error)}`)
    })
})

/**
 * Everything she has, written where the person says.
 *
 * The label carries the outcome, because the save panel closing is ambiguous on
 * its own — it looks the same whether the file was written or the person
 * changed their mind. Cancelling says nothing at all: somebody who dismissed
 * the panel has not made a mistake and does not need telling.
 */
let exportReset: number | null = null
exportEl.addEventListener('click', () => {
  exportEl.disabled = true
  // One timer, not one per export. Two within six seconds and the first one's
  // timer wiped the second one's result.
  if (exportReset !== null) clearTimeout(exportReset)
  void window.mochiHistory
    .exportAll()
    .then((result) => {
      if (result.ok) {
        exportEl.textContent = `Exported ${String(result.conversations)}`
        say(`Exported ${String(result.conversations)} to ${result.path}`)
      } else if (!result.cancelled) {
        say(`Could not export: ${result.why}`, true)
      }
    })
    .catch((error: unknown) => {
      say(`Could not export: ${String(error)}`, true)
    })
    .finally(() => {
      exportEl.disabled = false
      exportReset = window.setTimeout(() => {
        exportReset = null
        exportEl.textContent = 'Export…'
      }, 6000)
    })
})

/**
 * Run whatever is in the field, or fall back to the day list when it is empty.
 *
 * A function rather than the body of the input handler, because a RELOAD has to
 * be able to run it too: the archive column is either showing a search or
 * showing a day, and every reload used to assume the second even while the
 * field held a term.
 *
 * A declaration, so `readConversations` above can call it.
 */
function runSearch(): void {
  const term = queryEl.value.trim()
  if (term === '') {
    renderList(Date.now())
    return
  }
  const mine = generation
  void window.mochiHistory
    .search(term)
    .then((hits) => {
      // The debounce stops QUEUED queries; it does nothing about one already
      // running, and FTS5 answers a short term far more slowly than a long
      // one — so the results for `a` used to land after `apple` and replace
      // them.
      if (mine !== generation) return
      renderHits(group(hits), term)
    })
    .catch((error: unknown) => {
      if (mine === generation) empty(listEl, `Could not search: ${String(error)}`)
    })
}

let searching: number | null = null
queryEl.addEventListener('input', () => {
  // Debounced. Every keystroke is an FTS5 query and an IPC round trip, and a
  // fast typist would queue a dozen of them to throw away eleven.
  if (searching !== null) clearTimeout(searching)
  generation += 1
  searching = window.setTimeout(runSearch, 140)
})

window.addEventListener('focus', readProblemCount)
readProblemCount()
renderPlaces()
showPlace('cast')

/*
  Main asking for a place — the menu bar's "Settings…", and the shelf's old
  button before it was removed.

  Checked HERE rather than in the bridge: what counts as a place is this
  window's business, and an unknown one is ignored rather than throwing, because
  a newer main talking to an older window should degrade to doing nothing.
*/
window.mochiHistory.onShow((asked) => {
  const known = PLACES.find((one) => one.id === asked)
  if (known !== undefined) showPlace(known.id)
})

/**
 * The characters FIRST, then the conversations. Sequenced, not raced.
 *
 * The title is "Mochi · <her name>", and the name comes from the character
 * half — run in parallel, the title lost the race about half the time and
 * settled on her id, which is the one string the cards beside it never show.
 *
 * `finally` rather than `then`, so a character half that could not be read
 * still leaves the conversations loading. The two are independent everywhere
 * except in the order they run.
 */
void readShelf()
  .then(() => {
    openCharacter()
  })
  .catch((error: unknown) => {
    empty(charactersEl, `Could not read the characters: ${String(error)}`)
  })
  .finally(() => {
    void readConversations()
  })
