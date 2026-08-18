import type { HistoryConversation, HistoryHit, HistoryProblem, MochiHistoryApi } from '@shared/ipc'
import { highlight, lengthLabel, whenLabel } from './format'

declare global {
  interface Window {
    readonly mochiHistory: MochiHistoryApi
  }
}

/**
 * The conversations she remembers.
 *
 * Read-only, on purpose and for now. Deleting one is a real requirement and the
 * store already has `forget`, but it is a destructive action on the only copy of
 * something somebody said — it needs a confirmation, an undo window, or both,
 * and shipping the button before those is worse than not shipping it.
 *
 * `document.createElement` and `textContent`, never `innerHTML`. Every string
 * here is either a person's words or hers, which is exactly the input a
 * transcript viewer must not evaluate.
 */

const list = document.querySelector('#list')
const troubles = document.querySelector('#troubles')
const settings = document.querySelector('#settings')
const troublesLabel = document.querySelector('#troubles-label')
const pane = document.querySelector('#pane')
const query = document.querySelector('#q')
if (!(list instanceof HTMLElement) || !(pane instanceof HTMLElement)) {
  throw new Error('history: the document is not the one this expects')
}
if (!(query instanceof HTMLInputElement)) {
  throw new Error('history: the search field is missing')
}
if (!(troubles instanceof HTMLButtonElement) || !(troublesLabel instanceof HTMLElement)) {
  throw new Error('history: the problems strip is missing')
}
if (!(settings instanceof HTMLButtonElement)) {
  throw new Error('history: the settings button is missing')
}
settings.addEventListener('click', () => {
  window.mochiHistory.settings()
})
// Re-bound so the narrowing survives into the closures below.
const listEl: HTMLElement = list
const paneEl: HTMLElement = pane
const queryEl: HTMLInputElement = query
const troublesEl: HTMLButtonElement = troubles
const troublesLabelEl: HTMLElement = troublesLabel

/** Which conversation is open, so re-rendering the list does not lose it. */
let open: string | null = null
let conversations: readonly HistoryConversation[] = []

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
    void show(token, snippet?.term ?? '')
    troublesEl.setAttribute('aria-current', 'false')
    for (const other of listEl.querySelectorAll('.entry')) {
      other.setAttribute('aria-current', String(other === button))
    }
  })
  return button
}

async function show(token: string, term: string): Promise<void> {
  const turns = await window.mochiHistory.turns(token)
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
    empty(listEl, 'No conversations yet.')
    empty(
      paneEl,
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

interface HitGroup {
  readonly token: string
  readonly at: number
  readonly text: string
  readonly count: number
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
 * What main could not do, in the window that can actually show it.
 *
 * There are eleven `console.error` sites in main and a packaged app has no
 * console. Every one of them is a fallback that WORKED — a default persona, a
 * built-in avatar — so from outside they are indistinguishable from the app
 * ignoring the file somebody just wrote. That is the least debuggable outcome
 * this application can produce, and it was produced twice in one afternoon.
 *
 * A footer strip rather than a second tab: normally there is nothing here, and
 * a permanent tab onto an empty surface is a thing people learn to skip.
 */
function renderProblems(problems: readonly HistoryProblem[]): void {
  open = null
  for (const other of listEl.querySelectorAll('.entry')) other.setAttribute('aria-current', 'false')
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

troublesEl.addEventListener('click', () => {
  // Asked again on every click rather than kept: more can arrive while the
  // window is open — a capability that throws mid-conversation is exactly the
  // kind that does.
  void window.mochiHistory.problems().then(renderProblems)
})

let searching: number | null = null
queryEl.addEventListener('input', () => {
  // Debounced. Every keystroke is an FTS5 query and an IPC round trip, and a
  // fast typist would queue a dozen of them to throw away eleven.
  if (searching !== null) clearTimeout(searching)
  searching = window.setTimeout(() => {
    const term = queryEl.value.trim()
    if (term === '') {
      renderList(Date.now())
      return
    }
    void window.mochiHistory.search(term).then((hits) => {
      renderHits(group(hits), term)
    })
  }, 140)
})

void window.mochiHistory.problems().then((problems) => {
  if (problems.length === 0) return
  troublesEl.hidden = false
  troublesLabelEl.textContent = `${String(problems.length)} ${problems.length === 1 ? 'problem' : 'problems'}`
})

void window.mochiHistory
  .list()
  .then((answer) => {
    conversations = answer.conversations
    document.title = answer.persona === '' ? 'Conversations' : `Conversations · ${answer.persona}`
    // The newest one, opened. A window whose whole purpose is showing a
    // transcript should not open on a blank half — the first thing anybody
    // wants is the conversation they just had.
    open = conversations[0]?.token ?? null
    renderList(Date.now())
    if (open !== null) void show(open, '')
  })
  .catch((error: unknown) => {
    // Loud. A window that silently shows "no conversations" when the store
    // failed to open is indistinguishable from one with nothing in it.
    empty(listEl, 'Could not read the archive.')
    empty(paneEl, String(error))
  })
