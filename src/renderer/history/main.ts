import type {
  HistoryConversation,
  HistoryHit,
  HistoryProblem,
  HistoryTurn,
  MochiHistoryApi,
  SettingsWrite,
  ShelfView,
} from '@shared/ipc'
import { applyAccent } from '../design/apply-accent'
import { highlight, lengthLabel, whenLabel } from './format'
import { assembledPanel, characterCards, characterSheet, type ShelfHandlers } from './shelf'

declare global {
  interface Window {
    readonly mochiHistory: MochiHistoryApi
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

const stateEl = need('state', HTMLElement)
const stateHowEl = need('state-how', HTMLElement)
const micEl = need('mic', HTMLElement)
const micLabelEl = need('mic-label', HTMLElement)
const countEl = need('count', HTMLElement)
const charactersEl = need('characters', HTMLElement)
const charactersCountEl = need('characters-count', HTMLElement)
const paneEl = need('pane', HTMLElement)
const tabsEl = need('tabs', HTMLElement)
const wakeEl = need('panel-wake', HTMLElement)
const talksEl = need('panel-talks', HTMLElement)
const queryEl = need('q', HTMLInputElement)
const listEl = need('list', HTMLElement)
const troublesEl = need('troubles', HTMLButtonElement)
const troublesLabelEl = need('troubles-label', HTMLElement)
const exportEl = need('export', HTMLButtonElement)
const settingsEl = need('settings', HTMLButtonElement)
const saidEl = need('said', HTMLElement)

/** Which conversation is open, so re-rendering the list does not lose it. */
let open: string | null = null
let conversations: readonly HistoryConversation[] = []
/** The character half, re-read on every change. Null until the first read. */
let shelf: ShelfView | null = null
/** Whether the main column is showing the open character rather than a transcript. */
let showingCharacter = true
/** Which inspector tab is up. */
let tab: 'wake' | 'talks' = 'wake'
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

const TABS: readonly { readonly id: 'wake' | 'talks'; readonly label: string }[] = [
  { id: 'wake', label: 'Next wake' },
  { id: 'talks', label: 'Conversations' },
]

function renderTabs(): void {
  tabsEl.replaceChildren(
    ...TABS.map((one) => {
      const button = document.createElement('button')
      button.className = 'tab'
      button.type = 'button'
      button.textContent = one.label
      button.setAttribute('aria-current', String(one.id === tab))
      button.addEventListener('click', () => {
        tab = one.id
        renderTabs()
      })
      return button
    }),
  )
  wakeEl.hidden = tab !== 'wake'
  talksEl.hidden = tab !== 'talks'
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
const handlers: ShelfHandlers = {
  wear: (id) => {
    generation += 1
    void write(
      () => window.mochiHistory.wear(id),
      'Worn. She will be this character from her next wake.',
    )
  },
  save: (change) => {
    void write(
      () => window.mochiHistory.saveCharacter(change),
      'Saved. It takes effect on her next wake.',
    )
  },
  persona: (action) => {
    void write(
      () => window.mochiHistory.character(action),
      action.kind === 'delete'
        ? 'Deleted, with her notes and her conversations. The built-in is worn now.'
        : action.kind === 'restore-built-in'
          ? 'The built-in is back as she ships.'
          : 'Made, and worn. She will be this character from her next wake.',
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
  const unreadable = applyAccent(document.documentElement, view.face)
  renderState(view)
  renderCards()
  renderWake()
  if (unreadable.length > 0) {
    say(`That character's colour is not readable, so the built-in is used.`, true)
  }
}

/* ---- the conversations --------------------------------------------------- */

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
  when.textContent = label
  const count = document.createElement('div')
  count.className = 'count'
  count.textContent = detail
  button.append(when, count)

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

async function show(token: string, term: string): Promise<void> {
  const mine = generation
  let turns: readonly HistoryTurn[]
  try {
    turns = await window.mochiHistory.turns(token)
  } catch (error: unknown) {
    // Loud, and in the pane that failed. Leaving the previous transcript up
    // with no message is indistinguishable from this one having loaded.
    if (mine === generation) empty(paneEl, `Could not read that conversation: ${String(error)}`)
    return
  }
  // Somebody has moved on. Painting this now would replace what they asked for
  // with what they closed.
  if (mine !== generation || showingCharacter || open !== token) return
  if (turns.length === 0) {
    empty(paneEl, 'Nothing was kept from this conversation.')
    return
  }
  const transcript = document.createElement('div')
  transcript.className = 'transcript'
  for (const turn of turns) {
    const block = document.createElement('div')
    block.className = `turn ${turn.who}`
    const who = document.createElement('div')
    who.className = 'who'
    who.textContent = turn.who === 'her' ? 'her' : 'you'
    const said = document.createElement('p')
    said.append(marked(turn.text, term))
    block.append(who, said)
    if (turn.cut) {
      // Said out loud rather than implied by a short line. The boundary is an
      // ESTIMATE (§60: −3% to −22%, always short), so a reader who can see that
      // it was cut can also discount the last few words.
      const note = document.createElement('div')
      note.className = 'cut'
      note.textContent = turn.text === '' ? 'interrupted before she got a word out' : 'interrupted'
      block.append(note)
    }
    transcript.append(block)
  }
  paneEl.replaceChildren(transcript)
  paneEl.scrollTop = 0
}

function renderList(now: number): void {
  if (conversations.length === 0) {
    empty(
      listEl,
      'Nothing has been kept yet. Conversations appear here once she has been awake and retention is on.',
    )
    return
  }
  listEl.replaceChildren(
    ...conversations.map((one) => {
      const length = lengthLabel(one.startedAt, one.endedAt)
      const turns = `${String(one.turns)} ${one.turns === 1 ? 'turn' : 'turns'}`
      return row(
        whenLabel(one.startedAt, now),
        length === null ? turns : `${turns} · ${length}`,
        one.token,
        null,
      )
    }),
  )
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
  listEl.replaceChildren(
    ...hits.map((group) =>
      row(
        whenLabel(group.at, Date.now()),
        `${String(group.count)} ${group.count === 1 ? 'match' : 'matches'}`,
        group.token,
        { text: group.text, term },
      ),
    ),
  )
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
  page.className = 'transcript'
  const lead = document.createElement('p')
  lead.className = 'lead'
  // Says what it is AND what it is not. Everything here already fell back to
  // something working, so the reader is being told about a file that was
  // ignored, not about a broken app.
  lead.textContent =
    'Things she could not load since she woke up. Each one fell back to a working default, so nothing here stopped her — but a file you edited may not be the one she is using.'
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
  paneEl.replaceChildren(page)
  paneEl.scrollTop = 0
}

/** Wall-clock, not "3 minutes ago": these are all from one launch. */
function clockLabel(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
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

/* ---- wiring -------------------------------------------------------------- */

settingsEl.addEventListener('click', () => {
  window.mochiHistory.settings()
})

troublesEl.addEventListener('click', () => {
  // Asked again on every click rather than kept: more can arrive while the
  // window is open — a capability that throws mid-conversation is exactly the
  // kind that does.
  void window.mochiHistory
    .problems()
    .then(renderProblems)
    .catch((error: unknown) => {
      empty(paneEl, `Could not read what went wrong: ${String(error)}`)
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
renderTabs()

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
