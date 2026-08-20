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
import {
  assembledPanel,
  characterCards,
  characterSheet,
  faceTile,
  type ShelfHandlers,
} from './shelf'

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
const troublesEl = need('troubles', HTMLButtonElement)
const troublesLabelEl = need('troubles-label', HTMLElement)
const exportEl = need('export', HTMLButtonElement)
const saidEl = need('said', HTMLElement)

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
 */
function say(text: string, bad = false): void {
  saidEl.textContent = text
  saidEl.classList.toggle('bad', bad)
}

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
 * Two facts and no more: whether she is awake, and whether the microphone is
 * open. They are separate — asleep is her attention, the grant is what this
 * machine permits — and either one alone closes it, so the pill answers for
 * both rather than for one.
 */
function renderState(view: ShelfView): void {
  const { asleep, microphone, restKey } = view.state
  stateEl.textContent = asleep ? 'asleep' : 'awake'
  stateHowEl.textContent =
    restKey === null
      ? 'no key — another application has it'
      : `${restKey} to ${asleep ? 'wake' : 'rest'}`

  const listening = !asleep && microphone
  micEl.classList.toggle('open', listening)
  micLabelEl.textContent = listening
    ? 'microphone open'
    : microphone
      ? 'microphone closed'
      : 'microphone not allowed'
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
}

/**
 * Her face beside the wordmark.
 *
 * The worn one, redrawn on every read, because switching character from the
 * tray while this window is open changes who the strip is about. One frame — a
 * blinking mark in a title bar is motion with nothing to say.
 */
function drawMark(face: ShelfView['face']): void {
  const px = 22
  const ratio = Math.min(window.devicePixelRatio || 1, 3)
  markEl.width = Math.round(px * ratio)
  markEl.height = Math.round(px * ratio)
  markEl.style.width = `${String(px)}px`
  markEl.style.height = `${String(px)}px`
  const ctx = markEl.getContext('2d')
  if (ctx === null) return
  const avatar = new MochiAvatar(ctx, { face, size: 'fit-canvas', random: () => 0.5 })
  avatar.resize(px, px, ratio)
  avatar.setIdle(false)
  avatar.render(0)
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

function renderPlaces(): void {
  shellTabsEl.replaceChildren(
    ...PLACES.map((one) => {
      const button = document.createElement('button')
      button.className = 'shell-tab'
      button.type = 'button'
      button.setAttribute('role', 'tab')
      button.textContent = one.label
      button.setAttribute('aria-current', String(one.id === place))
      button.addEventListener('click', () => {
        showPlace(one.id)
      })
      return button
    }),
  )
}

function renderWake(): void {
  if (shelf === null) return
  wakeEl.replaceChildren(...assembledPanel(shelf))
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
  detail: string,
  token: string,
  snippet: { text: string; term: string } | null,
): HTMLButtonElement {
  const button = document.createElement('button')
  button.className = 'entry'
  button.type = 'button'
  button.setAttribute('aria-current', String(token === open))

  const when = document.createElement('div')
  when.className = 'when'
  when.textContent = detail === '' ? label : `${label} · ${detail}`
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

  const facts: string[] = [`${String(turns.length)} ${turns.length === 1 ? 'turn' : 'turns'}`]
  // The last turn's timestamp, which is what `ended_at` is — see `lengthLabel`,
  // which is deliberate about not pretending to seconds for the same reason.
  const length = lengthLabel(first, last)
  if (length !== null) facts.push(length)
  const cut = interruptions(turns)
  if (cut > 0) facts.push(`${String(cut)} ${cut === 1 ? 'interruption' : 'interruptions'}`)

  const meta = document.createElement('div')
  meta.className = 'talk-facts'
  meta.textContent = facts.join(' · ')

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
    bubble.append(marked(turn.text, term))
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

/**
 * Every conversation, under the day it happened on.
 *
 * The headings are what make the column readable at length: 173 rows each
 * beginning with their own date is a list you scan rather than one you place
 * yourself in. `byDay` groups CONSECUTIVE runs, so an unordered list produces
 * two headings instead of being quietly rearranged.
 */
function renderList(now: number): void {
  if (conversations.length === 0) {
    empty(listEl, forPronoun(SAYS.noTalks, saying()))
    return
  }
  const parts: HTMLElement[] = []
  for (const group of byDay(conversations, now, (one) => one.startedAt)) {
    parts.push(dayHeading(group.day))
    for (const one of group.items) {
      const length = lengthLabel(one.startedAt, one.endedAt)
      const turns = `${String(one.turns)} ${one.turns === 1 ? 'turn' : 'turns'}`
      parts.push(
        row(
          clockLabel(one.startedAt),
          length === null ? turns : `${turns} · ${length}`,
          one.token,
          null,
        ),
      )
    }
  }
  listEl.replaceChildren(...parts)
}

interface HitGroup {
  readonly token: string
  readonly at: number
  readonly text: string
  readonly count: number
}

/** Search results, grouped so a conversation appears once with its best line. */
function renderHits(hits: readonly HitGroup[], term: string): void {
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
async function readConversations(): Promise<void> {
  try {
    const answer = await window.mochiHistory.list()
    conversations = answer.conversations
    // Her NAME, from the shelf, falling back to the id `history:list` answers
    // with. The cards say "Loki"; a title bar saying `loki` beside them would
    // be two names for one character in one window.
    const name = shelf?.characters.find((one) => one.id === answer.persona)?.name
    document.title = `Shelf · ${name ?? answer.persona}`
    const many = conversations.length
    countEl.textContent = `${String(many)} ${many === 1 ? 'conversation' : 'conversations'}`
    renderList(Date.now())
  } catch (error: unknown) {
    // Loud, and it SAYS what went wrong. A window that silently shows "no
    // conversations" when the store failed to open is indistinguishable from
    // one with nothing in it.
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
    .catch(() => {
      // Nothing to say. The strip is itself where failures are reported, and a
      // failure to read it has nowhere better to go than the console.
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
  const showing = PANES.find((one) => one.id === openGroup)
  if (showing === undefined) {
    machineEl.textContent = 'No settings to show.'
    return
  }
  const heading = document.createElement('h2')
  heading.textContent = paneLabel(showing.label, view.pronoun)
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
  machineEl.replaceChildren(heading, ...body)
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
  // Asked again on every click rather than kept: more can arrive while the
  // window is open — a capability that throws mid-conversation is exactly the
  // kind that does.
  void window.mochiHistory
    .problems()
    .then(renderProblems)
    .catch((error: unknown) => {
      empty(talkEl, `Could not read what went wrong: ${String(error)}`)
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

let searching: number | null = null
queryEl.addEventListener('input', () => {
  // Debounced. Every keystroke is an FTS5 query and an IPC round trip, and a
  // fast typist would queue a dozen of them to throw away eleven.
  if (searching !== null) clearTimeout(searching)
  generation += 1
  searching = window.setTimeout(() => {
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
  }, 140)
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
 * The title is "Shelf · <her name>", and the name comes from the character
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
