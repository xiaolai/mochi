import type { MochiSettingsApi, SettingsView, SettingsWrite } from '@shared/ipc'
import type {
  HistoryConversation,
  HistoryHit,
  HistoryProblem,
  HistoryTurn,
  MochiHistoryApi,
  ShelfView,
  ToolUse,
} from '@shared/history-window'
import { DEFAULT_PRONOUN, forPronoun, label as paneLabel, type Pronoun } from '@shared/pronoun'
import { applyAccent } from '../design/apply-accent'
import { PANES } from '../settings/panes'
import { type PaneHandlers } from '../settings/pane'
import { MochiAvatar } from '../companion/rig/mochi'
import { byDay, clockLabel, dayLabel, interruptions, lengthLabel } from './format'
import { drawCentred } from './centre'
import { CUT, fact } from './glyph'
import {
  dayHeadingLabel,
  dayKey,
  monthGrid,
  monthLabel,
  startOfDay,
  stepMonth,
  weekdayInitials,
  countByDay,
  openingDay,
} from './month'
import { assembledPanel, characterCards, characterSheet } from './shelf'
import { castActions } from './sheet/cast'
import { faceTile } from './sheet/face-tile'
import { type ShelfHandlers } from './sheet/row'
import { installLogStamp } from '@shared/log'
import { SAYS } from './main-says'
/*
  The settings panes' own copy, aliased because this file already has a `SAYS`.

  Imported rather than restated: the sentence about when a saved setting takes
  effect is drawn in the hearing pane AND said in the message when one is saved,
  and two copies of it is how one of them keeps saying "her" after the other is
  fixed — which is the failure this whole sweep is about.
*/
import { SAYS as MACHINE_SAYS } from '../settings/panes-says'
import {
  calEl,
  castEl,
  charactersCountEl,
  charactersEl,
  contextEl,
  countEl,
  dropHersEl,
  dropSomeEl,
  exportEl,
  listEl,
  machineEl,
  markEl,
  micEl,
  micLabelEl,
  navEl,
  need,
  paneEl,
  pickEl,
  pickOffEl,
  queryEl,
  shellTabsEl,
  stateEl,
  stateHowEl,
  sureEl,
  sureNoEl,
  sureWhatEl,
  sureWhyEl,
  sureYesEl,
  talkEl,
  toolsEl,
  troublesEl,
  troublesLabelEl,
  wakeEl,
} from './elements'
import { say } from './status'
import { empty, facts, iconButton, marked, toolChips } from './bits'
import { freshness } from './freshness'
import { PLACES, alongTabs, type Place } from './tabs'
import { sureExportEl } from './elements'
import { offerACopyFirst } from './keep-a-copy'

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

/** Which conversation is open, so re-rendering the list does not lose it. */
let open: string | null = null

/* ---- choosing what to delete --------------------------------------------- */

/**
 * Whether the list is being used to CHOOSE rather than to read.
 *
 * A mode, rather than a delete control on every row. The list is meant to be
 * read; a destructive affordance on each line while reading is noise and a
 * misclick surface at once. It is entered deliberately, cleared on leaving, and
 * changes nothing else about the page.
 */
let picking = false

/** The conversations chosen so far, by token. */
const chosen = new Set<string>()

/**
 * What the confirmation was opened ABOUT, frozen at that moment.
 *
 * The whole reason the confirmation is a separate surface. Re-reading `chosen`
 * and the worn character when the second button is pressed means whatever
 * changed in between is silently what gets deleted -- and both can change,
 * because the tray can switch character and the list is still live underneath.
 * A confirmation that can target moving state is not a confirmation.
 */
type Doomed =
  | { readonly kind: 'some'; readonly id: string; readonly tokens: readonly string[] }
  | { readonly kind: 'hers'; readonly id: string; readonly who: string }
  | { readonly kind: 'everything' }

let doomed: Doomed | null = null

/** Put the drawer's controls in the state the mode says they should be in. */
function showPicking(): void {
  const here = place === 'archive'
  pickEl.hidden = !here || picking
  pickOffEl.hidden = !here || !picking
  dropSomeEl.hidden = !here || !picking
  dropHersEl.hidden = !here || picking
  dropSomeEl.disabled = chosen.size === 0
  dropSomeEl.textContent = chosen.size === 0 ? 'Delete' : `Delete ${String(chosen.size)}`
  listEl.classList.toggle('picking', picking)
}

function stopPicking(): void {
  picking = false
  chosen.clear()
  showPicking()
  renderList(Date.now())
}

/**
 * Ask, on a surface of its own.
 *
 * Not the arming pattern used elsewhere here -- click once to arm, again to
 * act. That is defeated by a double-click, has no Escape, and re-reads live
 * state on the second click. For the only irreversible action in the app, none
 * of those are acceptable.
 */
function askFirst(about: Doomed, what: string, why: string): void {
  doomed = about
  sureWhatEl.textContent = what
  sureWhyEl.textContent = why
  // Reset, because a "Saved 12" left from the last time would read as a copy
  // taken of THESE conversations.
  sureExportEl.textContent = 'Save a copy first'
  sureExportEl.disabled = false
  sureYesEl.disabled = false
  sureEl.showModal()
}

pickEl.addEventListener('click', () => {
  picking = true
  showPicking()
  renderList(Date.now())
})

pickOffEl.addEventListener('click', () => {
  stopPicking()
})

dropSomeEl.addEventListener('click', () => {
  if (chosen.size === 0) return
  // The snapshot: this set, this character, as they are NOW.
  const id = shelf?.wornId
  if (id === undefined) return
  const tokens = [...chosen]
  askFirst(
    { kind: 'some', id, tokens },
    tokens.length === 1
      ? 'Delete this conversation?'
      : `Delete ${String(tokens.length)} conversations?`,
    'What was said in them is removed from this machine. This cannot be undone.',
  )
})

dropHersEl.addEventListener('click', () => {
  const id = shelf?.wornId
  if (id === undefined) return
  askFirst(
    { kind: 'hers', id, who: forPronoun(SAYS.droppedHers, saying()) },
    forPronoun(SAYS.dropHers, saying()),
    forPronoun(SAYS.dropHersWhy, saying()),
  )
})

sureNoEl.addEventListener('click', () => {
  doomed = null
  sureEl.close()
})

// Escape closes a `<dialog>` without any of this running, so the snapshot is
// dropped here too rather than left to be acted on by a later confirmation.
sureEl.addEventListener('close', () => {
  doomed = null
})

offerACopyFirst()

sureYesEl.addEventListener('click', () => {
  const about = doomed
  doomed = null
  sureEl.close()
  if (about === null) return
  void deleteThem(about)
})

/** Say what happened, in the terms the store answered in. */
function saidOf(result: { gone: number | null; pending: boolean }, about: Doomed): string {
  const scrubbing = result.pending
    ? ' They are still being cleared from the file, which finishes on its own.'
    : ''
  if (about.kind === 'some') {
    // The count main really removed, which is not always the number chosen: a
    // conversation can have gone in another window since. Saying "3 deleted"
    // when 2 went would be a small lie in the one place people check.
    const gone = result.gone ?? about.tokens.length
    return `${gone === 1 ? 'One conversation' : `${String(gone)} conversations`} deleted.${scrubbing}`
  }
  if (about.kind === 'hers') return `${about.who}${scrubbing}`
  return `Every conversation deleted.${scrubbing}`
}

async function deleteThem(about: Doomed): Promise<void> {
  /*
    WRAPPED, for the reason `write()` above is wrapped.

    The only failure handled here was a refusal main chose to send. The `await`
    itself can reject -- a dead channel, a handler that threw, main gone -- and
    the caller is `void deleteThem(about)`, which discards the rejection
    entirely. So the destructive path was the one path in this window with no
    way to say it failed: the dialog closed, the rows stayed, and nothing said
    why.

    That is the worst place in the app for silence. Somebody who asked for
    something to be deleted and saw no error will believe it is gone.
  */
  let result: Awaited<ReturnType<typeof window.mochiHistory.forget>>
  try {
    result = await window.mochiHistory.forget(
      about.kind === 'some'
        ? { kind: 'some', id: about.id, tokens: about.tokens }
        : about.kind === 'hers'
          ? { kind: 'hers', id: about.id }
          : { kind: 'everything' },
    )
  } catch (error: unknown) {
    say(`They could not be deleted: ${String(error)}`, true)
    // Re-read for the same reason `write()` does after a throw: the rows on
    // screen are from the last read, and a delete that did not happen leaves a
    // window whose contents nobody has re-checked.
    await reload()
    return
  }
  if (!result.ok) {
    say(result.why ?? 'They could not be deleted.', true)
    return
  }
  // The transcript on screen may be one of the deleted, in which case leaving
  // it there is the page showing something that no longer exists.
  if (open !== null && (about.kind !== 'some' || about.tokens.includes(open))) {
    open = null
    talkEl.replaceChildren()
  }
  stopPicking()
  say(saidOf(result, about), false)
  await reload()
}
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
let place: Place = 'cast'

function showPlace(next: Place): void {
  place = next
  for (const one of PLACES) {
    need(`tab-${one.id}`, HTMLElement).hidden = one.id !== place
  }
  // Search belongs to the Archive and to nothing else. Hidden rather than
  // emptied, so what is typed in it survives a trip to Cast and back.
  contextEl.hidden = place !== 'archive'
  /*
    And so do the deletion controls, for the same reason.

    They act on conversations. Leaving them visible on the character sheet or on
    Machine would put "Delete all" under a heading that says something else,
    which is how a control's scope gets misread in the one direction that
    cannot be undone. Leaving the archive also LEAVES select mode: a selection
    the user can no longer see is one they have stopped agreeing to.
  */
  if (place !== 'archive' && picking) stopPicking()
  else showPicking()
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

/**
 * The whole `tab` contract, not a third of it.
 *
 * The strip declared `role="tablist"` and gave its buttons `role="tab"` — and
 * then marked the live one with `aria-current` alone. That is a valid attribute
 * and it is not the one this pattern is read through: assistive technology asks
 * a tab for `aria-selected`, and a tablist whose tabs never answer it presents
 * as three buttons with no state, inside a container promising state. Declaring
 * a role and then not honouring its contract is worse than declaring none,
 * because the promise is what a reader navigates by.
 *
 * `aria-current` STAYS. The stylesheet selects on it — `.shell-tab[aria-current='true']`
 * — and the two attributes are not rivals: one says "this is where you are in
 * the app", the other says "this tab is the selected one".
 *
 * ## And the keyboard
 *
 * A tablist is one stop, not three: `Tab` enters it and arrows move within it.
 * Three buttons each taking a tab stop is what the comment above this function
 * already complains about from the other direction. Roving `tabindex` is what
 * makes the container one stop.
 */
function renderPlaces(): void {
  if (tabs.size === 0) {
    for (const one of PLACES) {
      const button = document.createElement('button')
      button.className = 'shell-tab'
      button.type = 'button'
      button.setAttribute('role', 'tab')
      // Named, so the panel can point back at it and be labelled by the word
      // somebody clicked rather than by nothing.
      button.id = `tab-for-${one.id}`
      button.setAttribute('aria-controls', `tab-${one.id}`)
      button.textContent = one.label
      button.addEventListener('click', () => {
        showPlace(one.id)
      })
      button.addEventListener('keydown', (event: KeyboardEvent) => {
        const moved = alongTabs(event.key, one.id)
        if (moved === null) return
        // Taken, so the arrow does not also scroll the pane behind the strip.
        event.preventDefault()
        showPlace(moved)
        tabs.get(moved)?.focus()
      })
      tabs.set(one.id, button)
      shellTabsEl.append(button)
    }
  }
  for (const [id, button] of tabs) {
    const here = id === place
    button.setAttribute('aria-current', String(here))
    button.setAttribute('aria-selected', String(here))
    // ROVING: only the selected tab is a tab stop, so `Tab` enters the strip
    // once and the arrows move inside it.
    button.tabIndex = here ? 0 : -1
  }
}

function renderWake(): void {
  if (shelf === null) return
  wakeEl.replaceChildren(...assembledPanel(shelf, handlers))
}

/* ---- doing things -------------------------------------------------------- */

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
        say(result.ok ? `${face}${forPronoun(SAYS.lookAtHer, saying())}` : result.why, !result.ok)
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
        ? forPronoun(SAYS.promptNowEmpty, saying())
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
/** The shelf's queue. Same argument as `machineQueue`. */
let shelfQueue: Promise<void> = Promise.resolve()

async function write(act: () => Promise<SettingsWrite>, done: string): Promise<void> {
  const mine = shelfQueue.then(async () => {
    try {
      const result = await act()
      say(result.ok ? done : result.why, !result.ok)
    } catch (error: unknown) {
      say(String(error), true)
    }
    /*
      Re-read after EVERY outcome, including a throw.

      The controls are populated from the last read, so a change that was not
      accepted leaves a select or a checkbox showing a value nothing took. A
      refusal used to re-read and a throw used to return — so the one failure
      that says least about itself was also the one that left the window lying.
    */
    await reload()
  })
  shelfQueue = mine.catch(() => undefined)
  await mine
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

/** See `freshness`. Concurrent writes each call `reload`, which calls this. */
const shelfReads = freshness()

async function readShelf(): Promise<void> {
  const newest = shelfReads.begin()
  const view = await window.mochiHistory.shelf()
  // Two saves settling at once each re-read, and the slower one used to land
  // last: a stale sheet painted over a newer write, including her accent, which
  // is applied from this view on every read.
  if (!newest()) return
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
  /**
   * What the conversation was about, or null.
   *
   * Drawn on its own line under the clock, which is where the artifact has
   * always put it and where `plan-v2.md` W5 says it belongs. Null is ordinary
   * — a conversation is titled after it ends, and every conversation in an
   * archive written before this existed has none — so the line is absent
   * rather than empty.
   *
   * Drawn on a search hit too, above the matched text. The two answer different
   * questions: the subject says what the conversation was about and the snippet
   * says what matched, and somebody scanning results wants the first to decide
   * whether the second is the one they meant.
   */
  subject: string | null,
): HTMLButtonElement {
  const button = document.createElement('button')
  button.className = chosen.has(token) ? 'entry picked' : 'entry'
  button.type = 'button'
  button.setAttribute('aria-current', String(token === open))
  if (picking) button.setAttribute('aria-pressed', String(chosen.has(token)))

  const when = document.createElement('div')
  when.className = 'when'
  // Shown only in select mode, and it carries the state without relying on the
  // wash behind the row -- which a colour-blind reader may not separate from an
  // ordinary hover.
  const tick = document.createElement('span')
  tick.className = 'tick'
  tick.textContent = chosen.has(token) ? '☑' : '☐'
  tick.setAttribute('aria-hidden', 'true')
  when.append(tick)
  const stamp = document.createElement('span')
  stamp.textContent = label
  when.append(stamp)
  if (typeof detail === 'string') {
    if (detail !== '') when.append(` · ${detail}`)
  } else {
    for (const fact of detail) when.append(fact)
  }
  button.append(when)

  if (subject !== null) {
    const line = document.createElement('div')
    line.className = 'subject'
    line.textContent = subject
    button.append(line)
  }

  if (snippet !== null) {
    const line = document.createElement('div')
    line.className = 'snippet'
    line.append(marked(snippet.text, snippet.term))
    button.append(line)
  }

  button.addEventListener('click', () => {
    if (picking) {
      // Choosing, not reading. The transcript is deliberately NOT opened: the
      // point of the mode is that a click means "this one", and a click that
      // also navigated would make the two impossible to tell apart.
      if (chosen.has(token)) chosen.delete(token)
      else chosen.add(token)
      showPicking()
      renderList(Date.now())
      return
    }
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
 *
 * This lived in `bits.ts` until 2026-08-28, stacked above `iconButton`'s own
 * JSDoc and documenting neither: the function it describes is here, and the one
 * it sat on is a generic button builder. Moved rather than deleted — the
 * reasoning is the part worth keeping, and it is only misleading where it was.
 */
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
 * The artifact also draws a row of tool chips here: `ask_workspace ×2`. Those
 * were left out rather than invented, because nothing archived a call — the
 * store held turns and a capability's answer reached the model and the problem
 * log and never the record. `plan-v2.md` W5 wrote down what it would take;
 * `session_tool` is that table, written from the same observer that records
 * "last used", and these are its chips.
 *
 * They come from the CONVERSATION row rather than from the turns, because a
 * call is not a turn — she can look something up without saying anything, and
 * deriving chips from what was said would miss exactly the lookups that took
 * long enough to be worth showing.
 */
function transcriptHead(turns: readonly HistoryTurn[], tools: readonly ToolUse[]): HTMLElement {
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
  // Its own row, under the facts. A chip is a name and the facts are marks, so
  // a single line holding both reads as one list of unlike things — and the
  // ordinary conversation has no chips at all, which would leave the row empty
  // half the time if they shared it.
  if (tools.length > 0) {
    const called = document.createElement('div')
    called.className = 'talk-tools'
    called.append(...toolChips(tools))
    head.append(called)
  }
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
  // From the conversation the list already holds. `history:turns` answers turns
  // alone, and a second round trip for two numbers would be a request per open.
  transcript.append(
    transcriptHead(turns, conversations.find((one) => one.token === token)?.tools ?? []),
  )

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
  const counts = countByDay(conversations)
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
  picked ??= openingDay(conversations, now)
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
        one.subject,
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
          // From the conversation list the window already holds. A hit carries
          // the matched turn, not the conversation it is in.
          conversations.find((one) => one.token === hit.token)?.subject ?? null,
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

/** See `freshness`. Overlapping reads of the archive replace each other. */
const archiveReads = freshness()

async function readConversations(): Promise<void> {
  const newest = archiveReads.begin()
  try {
    const answer = await window.mochiHistory.list()
    // An older answer arriving last would repaint a list that has already been
    // replaced — or, on the failure path below, replace a list somebody can see
    // with an error about a read they are no longer waiting for.
    if (!newest()) return
    conversations = answer.conversations
    if (answer.persona !== listed) {
      listed = answer.persona
      picked = null
      onMonth = null
      /*
        And the SELECTION, which is about conversations rather than about the
        view of them.

        Without this, choosing three and then switching character left the
        drawer offering to delete three against a list belonging to somebody
        else. Nothing of the first character's could actually be deleted --
        `forgetSessions` is scoped by persona in main, so the tokens simply
        match nothing -- but the user would be told "0 conversations deleted"
        after confirming a deletion of three, which is the worst way to learn
        that a control was talking about the wrong thing.
      */
      if (picking) stopPicking()
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
    /*
      "12 times" rather than twelve blocks saying the same thing.

      `problems.ts` collapses a repeated fact into one entry with a count, so
      the number has to be drawn or it is a thing main computes and sends on
      every read that nobody sees. The time is the LAST occurrence, which is
      why the count belongs beside it rather than instead of it.
    */
    const times = problem.seen > 1 ? ` · ${String(problem.seen)} times` : ''
    where.textContent = `${problem.area} · ${clockLabel(problem.at)}${times}`
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
  forgetEveryTalk: () => {
    askFirst(
      { kind: 'everything' },
      'Delete every conversation, for every character?',
      'Every conversation this app has stored is removed from this machine, including any belonging to characters that are no longer here. Characters, voices and looks are untouched. This cannot be undone.',
    )
  },
  lookup: (change) => {
    void writeMachine(() => window.mochiSettings.lookup(change), 'Saved.')
  },
  chooseWorkspace: async () => {
    const chosen = await window.mochiSettings.chooseWorkspace()
    /*
      RE-READ whatever came back, including the refusals.

      `recheckCodex`'s rule: main is one read away and it is the only source.
      A dismissal changes nothing and re-reading is a no-op; a save changes the
      workspace AND the "nobody has chosen one, so this is the default" note
      under it, and patching the field alone would leave that note contradicting
      the value beside it.
    */
    await loadMachine()
    return chosen
  },
  showProfile: () => {
    window.mochiSettings.showProfile()
  },
  screen: (change) => {
    void writeMachine(() => window.mochiSettings.screen(change), 'Saved.')
  },
  hearing: (change) => {
    // Its own sentence rather than the shared "Saved.", because nothing on
    // screen changes and the setting does not reach the session she is in.
    void writeMachine(
      () => window.mochiSettings.hearing(change),
      `Saved. ${forPronoun(MACHINE_SAYS.nextWake, saying())}`,
    )
  },
  grant: (change) => {
    void writeMachine(() => window.mochiSettings.grant(change), 'Saved.')
  },
  key: (change) => {
    /*
      Its own sentence, because the two outcomes are not the same news.

      A rebind takes effect the moment it lands — `rebindShortcut` registers it
      — so there is no "on her next wake" here. A reset says what it did rather
      than "Saved.", for the reason the prompt reset does: nothing on screen
      distinguishes a key that went back to the default from one that was moved
      onto it, and those are different states in the file.
    */
    void writeMachine(
      () => window.mochiSettings.key(change),
      change.accelerator === null ? 'Back to the key the app ships.' : 'Saved.',
    )
  },
  prompt: (key, text) => {
    /*
      Its own sentence, for `hearing`'s reason and one more.

      A capability's description reaches her in the next `session.update`, which
      is her next wake; the guidance a capability hands back is read at CALL
      time, so that half lands sooner. Saying "on her next wake" is the honest
      floor — it is true of the slowest of them.
    */
    void writeMachine(
      () => window.mochiSettings.prompt(key, text),
      `${text === null ? 'Reset' : 'Saved'}. ${forPronoun(MACHINE_SAYS.nextWake, saying())}`,
    )
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

/**
 * Writes run ONE AT A TIME, in the order they were asked for.
 *
 * Every control here dispatches into the void — `hearing`, `grant`, `screen`
 * and the rest are `void writeMachine(...)` — so two changes in quick
 * succession were two independent chains racing to main. The second selection
 * could be written first and the first one last, leaving the setting on the
 * value somebody moved OFF, with a "Saved." for the one they moved to.
 *
 * `freshness` is the answer for READS, which replace each other and where the
 * newest wins. A write is not like that: every one has to happen, and the order
 * is the whole meaning. So they queue.
 *
 * The queue must never reject, or one failed write skips every later one. The
 * body already catches everything it can; the `catch` on the chain is for
 * whatever it cannot.
 */
let machineQueue: Promise<void> = Promise.resolve()

async function writeMachine(run: () => Promise<SettingsWrite>, ok: string): Promise<void> {
  const mine = machineQueue.then(async () => {
    try {
      const answer = await run()
      // Main's own refusal sentence when it has one — it knows why, and a generic
      // "could not save" would replace a reason with a shrug.
      say(answer.ok ? ok : answer.why, !answer.ok)
    } catch (error: unknown) {
      say(String(error), true)
    }
    await loadMachine()
  })
  machineQueue = mine.catch(() => undefined)
  await mine
}

/** See `freshness`. Tab entries, writes, workspace picks and rechecks all read. */
const machineReads = freshness()

async function loadMachine(): Promise<void> {
  const newest = machineReads.begin()
  try {
    const read = await window.mochiSettings.read()
    // Entering the tab twice, or a write settling while a recheck is in flight,
    // put two of these in the air. An older one landing last restores settings
    // that have been changed since.
    if (!newest()) return
    machine = read
  } catch (error: unknown) {
    // The same rule on the way out. An older FAILURE is the visible half of
    // this: it would tear down the nav and the tool column over a newer read
    // that had just succeeded.
    if (!newest()) return
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

/*
  THE LAST RESORT, and there was none.

  Everything this window knows how to report goes through `say`/`show` -- and
  every one of those is a path somebody thought of. An exception escaping a
  listener, or a promise nobody awaited, reached the devtools console and
  nothing else. In a packaged app nobody has devtools open, so the failures
  with no handler were also the failures with no evidence.

  Shown IN THIS WINDOW rather than routed to main's `problems`, unlike the
  companion's. This window's preload exposes `mochiHistory`/`mochiSettings` and
  NOT `mochi` -- `@shared/ipc` keeps those allowlists apart so that no window
  drawing a transcript can mint a key -- so `window.mochi.report` here would
  throw inside the error handler, which is strictly worse than having none.

  `say` is the right destination anyway: somebody is looking at this window.
*/
window.addEventListener('error', (event) => {
  say(`Something went wrong: ${event.message}`, true)
})

window.addEventListener('unhandledrejection', (event) => {
  say(`Something went wrong: ${String(event.reason)}`, true)
})
