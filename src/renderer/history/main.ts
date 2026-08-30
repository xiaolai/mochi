import type { MochiSettingsApi, PersonaChange, SettingsView, SettingsWrite } from '@shared/ipc'
import type {
  HistoryConversation,
  HistoryHit,
  HistoryProblem,
  HistoryTurn,
  MochiHistoryApi,
  ShelfView,
  ToolUse,
} from '@shared/history-window'
import { DEFAULT_PRONOUN, forPronoun, type ByPronoun, type Pronoun } from '@shared/pronoun'
import { applyAccent } from '../design/apply-accent'
import { MAY_DO } from '../settings/pane/may-do'
import { PANES } from '../settings/panes'
import { type PaneHandlers } from '../settings/pane'
import { byDay, clockLabel, interruptions, lengthLabel } from './format'
import {
  dayHeadingLabel,
  dayKey,
  monthDays,
  monthNames,
  monthLabel,
  startOfDay,
  stepMonth,
  yearTyped,
  countByDay,
  openingDay,
} from './month'
import { assembledPanel, characterSheet } from './shelf'
import { characterRows } from './parts/rail'
import { characterSubject } from './parts/masthead'
import { machineNav } from './parts/machine-nav'
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
  countEl,
  dropHersEl,
  dropSomeEl,
  exportEl,
  listEl,
  machineEl,
  navEl,
  paneEl,
  pickEl,
  pickOffEl,
  queryEl,
  sureEl,
  sureNoEl,
  sureWhatEl,
  sureWhyEl,
  sureYesEl,
  talkEl,
  toolsEl,
  troublesEl,
  troublesBodyEl,
  troublesDrawerEl,
  troublesLabelEl,
  wakeEl,
  pageHersEl,
  pageMachineEl,
  railMachineEl,
  viewsEl,
  findingEl,
  permitsEl,
  marginHersEl,
  subjectEl,
  spreadEl,
  marginPermitsEl,
} from './elements'
import { receipt, say } from './status'
import { element } from '../element'
import { empty, facts, iconButton, marked } from './bits'
import { freshness } from './freshness'
import { PLACES, VIEWS, alongViews, isHers, type Place } from './tabs'
import { marginBlock, marginColumn, marginFacts } from './margin'
import { sureExportEl } from './elements'
import { offerACopyFirst } from './keep-a-copy'
import { afresh } from '../rules/afresh'
import { latest } from '../rules/latest'
import { writes } from '../rules/writes'
import { readEverything } from '../rules/boot'
import { picking as pickingMode } from '../rules/picking'
import { confirmation, saidOf, wordsFor, type Doomed } from '../rules/doomed'
import { showing } from '../rules/showing'

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
const picking = pickingMode()

/*
  D1 lives in `rules/doomed.ts` now, with its own tests.

  It was a type, a `let`, and an assignment order that a source-reading test
  asserted the shape of. The rule is a decision — take a snapshot, answer it
  once, drop it — so it is exercised there rather than grepped here.
*/
const sure = confirmation()

/** Put the drawer's controls in the state the mode says they should be in. */
function showPicking(): void {
  const here = place === 'archive'
  const on = picking.on()
  const many = picking.chosen().length
  /*
    NOTHING TO ACT ON IS NOTHING TO OFFER.

    On a new installation there are no conversations, and the bar still offered
    "Select…", "Delete all…" and an export of an empty archive. "Anything
    offering a period with nothing in it must not appear actionable" is written
    about the calendar and it is the same lie here: a control that answers with
    nothing is a control that should not have been there.

    Most people's first hour is exactly this state.
  */
  const any = conversations.length > 0
  pickEl.hidden = !here || on || !any
  pickOffEl.hidden = !here || !on
  dropSomeEl.hidden = !here || !on
  dropHersEl.hidden = !here || on || !any
  /*
    Export was `hidden` in the markup and nothing ever took it off.

    It moved into this bar with the deletions and did not get a line here, so
    §21 of the brief — export everything to a file — has been unreachable since
    the frame was rebuilt. Nothing failed: the button is in the document, it has
    its handler, and it has never been on screen.
  */
  exportEl.hidden = !here || !any
  dropSomeEl.disabled = many === 0
  dropSomeEl.textContent = many === 0 ? 'Delete' : `Delete ${String(many)}`
  listEl.classList.toggle('picking', on)
}

function stopPicking(): void {
  picking.stop()
  showPicking()
  renderList(Date.now())
}

/** The question's sentence, taken at the moment it is asked. See `Doomed`. */
function asWords(about: { readonly kind: Doomed['kind']; readonly tokens?: readonly string[] }): {
  readonly asks: string
  readonly because: string
} {
  return wordsFor(about, {
    hers: forPronoun(SAYS.dropHers, saying()),
    hersWhy: forPronoun(SAYS.dropHersWhy, saying()),
  })
}

/**
 * Ask, on a surface of its own.
 *
 * Not the arming pattern used elsewhere here -- click once to arm, again to
 * act. That is defeated by a double-click, has no Escape, and re-reads live
 * state on the second click. For the only irreversible action in the app, none
 * of those are acceptable.
 */
function askFirst(about: Doomed): void {
  sure.ask(about)
  // FROM THE SNAPSHOT, never recomputed when the question is answered. See
  // `rules/doomed.ts` — the sentence is the whole of what the person answering
  // can see, so it is frozen with the thing it describes.
  sureWhatEl.textContent = about.asks
  sureWhyEl.textContent = about.because
  // Reset, because a "Saved 12" left from the last time would read as a copy
  // taken of THESE conversations.
  sureExportEl.textContent = 'Save a copy first'
  sureExportEl.disabled = false
  sureYesEl.disabled = false
  sureEl.showModal()
}

pickEl.addEventListener('click', () => {
  picking.start()
  showPicking()
  renderList(Date.now())
})

pickOffEl.addEventListener('click', () => {
  stopPicking()
})

dropSomeEl.addEventListener('click', () => {
  if (picking.chosen().length === 0) return
  // The snapshot: this set, this character, as they are NOW.
  const id = shelf?.wornId
  if (id === undefined) return
  const tokens = picking.chosen()
  askFirst({ kind: 'some', id, tokens, ...asWords({ kind: 'some', tokens }) })
})

dropHersEl.addEventListener('click', () => {
  const id = shelf?.wornId
  if (id === undefined) return
  askFirst({
    kind: 'hers',
    id,
    who: forPronoun(SAYS.droppedHers, saying()),
    ...asWords({ kind: 'hers' }),
  })
})

sureNoEl.addEventListener('click', () => {
  sure.drop()
  sureEl.close()
})

// Escape closes a `<dialog>` without any of this running, so the snapshot is
// dropped here too rather than left to be acted on by a later confirmation.
sureEl.addEventListener('close', () => {
  sure.drop()
})

offerACopyFirst()

sureYesEl.addEventListener('click', () => {
  // Answered ONCE. A second press — a double-click, a key repeat, a click
  // landing before the surface closes — gets null and deletes nothing.
  const about = sure.answer()
  sureEl.close()
  if (about === null) return
  void deleteThem(about)
})

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
  /*
    Her NOTES are not conversations, and go through a different door.

    `forget` deletes what was said; this deletes what she wrote down about
    somebody. They are separate stores with separate lifetimes — the design says
    so from the other side, in the sentence this confirmation carries: "What was
    said in your conversations is untouched."
  */
  if (about.kind === 'kept') {
    await write(
      () => window.mochiHistory.memory({ kind: 'clear', id: about.id }),
      forPronoun(SAYS.keptErased, saying()),
      { kind: 'note-cleared' },
    )
    return
  }
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
const looking = latest()

/*
  `renderState` stood here, and `drawMark` below it.

  They drew a strip across the top of this window carrying the application's
  mark, its name, whether she was awake, the key that changes that, and a
  microphone indicator. Every one of those is said better somewhere else:

  - The name is in the operating system's own title bar, which this window has —
    the strip was a second title bar under the real one.
  - Her state and the key are on the tray menu, and the key is a global shortcut
    that works whether or not this window is open.
  - The microphone is HER HALO. `halo.ts` says why in as many words: "The shelf's
    strip says MICROPHONE OPEN in green, which is only true for whoever is
    looking at the shelf, and the shelf is shut almost always. She is the thing
    on screen all day." The strip was the version of that fact that had already
    been judged inadequate, kept running beside its replacement.

  A duplicate of a fact is not free: it is a second thing to keep in step, and
  the one that is wrong is the one nobody is looking at.
*/

/* ---- the characters ------------------------------------------------------ */

function renderCards(): void {
  if (shelf === null) return
  charactersEl.replaceChildren(
    ...characterRows(shelf, showingCharacter ? shelf.wornId : null, (id) => {
      showingCharacter = true
      open = null
      looking.moved()
      /*
        Pressing a name has to LAND somewhere, and from the machine's page it
        did not.

        `showPlace` is the only thing that moves between the two pages and this
        handler never called it. So from the machine, pressing a character drew
        her sheet into a column that was `hidden`, marked her row current, and
        left the window showing the machine — the rail is this window's table of
        contents and one of its entries did nothing.

        Only when the window is not already on one of her views. Switching from
        one character to another while reading what she has said should stay on
        what she has said; it is the same view of a different person.
      */
      if (!isHers(place)) showPlace('cast')
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

/**
 * View III: what she may do, and what she is told she can.
 *
 * ## Why this is one of HER views rather than a group on the machine's page
 *
 * The grants are per-character — each one is stored against the worn character
 * and reads differently for a character worn as `he`. They sat in the Machine
 * tab beside the keyboard shortcuts, which are true whoever is worn, so the one
 * page in this window that mixed the two was the one page that could not say
 * which it was about. Rule 6 of the delivery is the same observation from the
 * other side: "The machine is not her."
 *
 * ## The split
 *
 * "What you permit" is the reading column — the switches, which are the thing
 * you came here to operate. "What she is told she can do" is the margin: the
 * capability descriptions are the largest body of text the model is handed,
 * they are not editable, and they are apparatus by the margin's own definition.
 *
 * Both are drawn because §9 of the brief asks for both by name — "the assembled
 * instruction, and separately the capability descriptions that accompany it" —
 * so the assembled panel sits under the capabilities rather than being dropped
 * for want of a column.
 */
function renderPermits(): void {
  if (machine === null) {
    empty(permitsEl, forPronoun(SAYS.readingPermits, saying()))
    return
  }
  const drawn = [...MAY_DO.render(machine, machineHandlers)]
  /*
    Split on the pane's own heading rather than restructuring it.

    `panes.ts` is imported unchanged and its tests still describe what it
    returns; the heading is where "what you permit" stops and "what she is told
    she can do" starts, and it is already there because the pane always drew
    both.
  */
  const at = drawn.findIndex((node) => node instanceof HTMLHeadingElement)
  permitsEl.replaceChildren(...(at === -1 ? drawn : drawn.slice(0, at)))
  /*
    The capability descriptions are apparatus and go in the margin; the
    assembled instruction is the THING ITSELF and goes in the reading column.

    Both were in the margin, which is 236px — so her instructions, the largest
    body of prose in this window, were rendered in a column narrower than the
    sentence you are reading. The margin's own definition is what settles it:
    "where a thing is stored, when it was last used, whose recommendation it is.
    Never the thing itself."
  */
  marginPermitsEl.replaceChildren(...(at === -1 ? [] : drawn.slice(at)))
  wakeEl.replaceChildren(...(shelf === null ? [] : assembledPanel(shelf, handlers)))
}

/**
 * The margin of view II: what this conversation is, beside what was said in it.
 *
 * Every fact here was the transcript's first block — a heading giving the time,
 * the turn count and the length, above the first thing anybody said. That put
 * apparatus where the subject goes, and it is the failure the brief records as
 * "the thing a person came to read must be more prominent than when it
 * happened".
 *
 * "What it was about" is drawn even when there is nothing to say, because the
 * absence is the normal case and it is not a failure: the summary comes from a
 * separate model call that often does not run. An empty block would be
 * indistinguishable from one that could not be read.
 */
function renderTalkMargin(turns: readonly HistoryTurn[], tools: readonly ToolUse[]): void {
  const her = saying()
  const first = turns[0]?.at ?? Date.now()
  const last = turns.at(-1)?.at ?? first
  const cut = interruptions(turns)
  const lines = [
    `began ${clockLabel(first)}`,
    `ended ${clockLabel(last)}`,
    `${String(turns.length)} ${turns.length === 1 ? 'turn' : 'turns'} · ${lengthLabel(first, last)}`,
  ]
  // Only when there was one. A line reading "0 interrupted" is a fact nobody
  // needs and it makes the ordinary conversation look like a report.
  if (cut > 0) lines.push(`${String(cut)} interrupted`)

  const used = [...new Set(tools.map((one) => one.name))]
  /*
    Rendered into the transcript's head rather than into the margin. Same blocks,
    same function, one destination — the margin is not on this page.
  */
  talkFacts.replaceChildren(
    ...marginColumn(
      marginBlock(forPronoun(SAYS.marginTalkHead, her), marginFacts(...lines)),
      marginBlock(forPronoun(SAYS.marginAbout, her), forPronoun(SAYS.marginNoSummary, her)),
      marginBlock(
        forPronoun(SAYS.marginUsedHead, her),
        used.length === 0 ? forPronoun(SAYS.marginUsedNone, her) : marginFacts(...used),
      ),
    ),
  )
}

/**
 * The margin of view I: what the controls beside it are, and where she lives.
 *
 * Apparatus about her sheet rather than more of her sheet. The two notes are the
 * ones the delivery writes out, and they are the two facts about these controls
 * that are not visible from operating them: that her colour is enforced against
 * a contrast floor and may be refused, and that an empty expression set is legal.
 */
function renderHerMargin(): void {
  if (shelf === null) return
  const her = saying()
  // The WORN character's file, because `characterSheet` draws the worn one and
  // this margin sits beside it. Reading a different character here would put
  // one character's path under another's controls.
  const stored = shelf.characters.find((one) => one.id === shelf?.wornId)?.source ?? null
  marginHersEl.replaceChildren(
    ...marginColumn(
      marginBlock('In the margin', forPronoun(SAYS.marginIs, her)),
      marginBlock(forPronoun(SAYS.marginColourHead, her), forPronoun(SAYS.marginColour, her)),
      marginBlock(forPronoun(SAYS.marginFacesHead, her), forPronoun(SAYS.marginFaces, her)),
      marginBlock(
        forPronoun(SAYS.marginStored, her),
        // The path, or the honest answer that there is not one. A built-in with
        // no file of her own is a real state, not a missing value.
        marginFacts(stored ?? forPronoun(SAYS.marginBuiltIn, her)),
      ),
    ),
  )
}

/** Her face and her name, at the size the view on screen calls for. */
function renderSubject(): void {
  if (shelf === null) return
  const subject = characterSubject(shelf)
  subjectEl.replaceChildren(...(subject === null ? [] : [subject]))
}

/** Draw the open character in the main column. */
function openCharacter(): void {
  if (shelf === null) return
  const arriving = !showingCharacter
  showingCharacter = true
  paneEl.replaceChildren(characterSheet(shelf, handlers))
  // The subject sits above the views, outside the scrolling column: her name is
  // what they are views OF, and it scrolled away with the rest of the sheet.
  renderSubject()
  renderHerMargin()
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
  /*
    Two pages, not three panels.

    Her page holds the three numbered views; the machine is a page of its own
    because it is not about her. `[hidden]` carries it, with the `!important`
    the token file argues for — this window has shipped a hidden panel that was
    on screen twice, both times because an author `display` outranked the UA's.
  */
  /*
    Her scale follows the view.

    On "Who she is" the delivery draws her at 104px with a 46px name; on the
    other two, 52 and 30. That is not decoration — the first view IS her, so she
    is the subject at full size, and the other two are about what she said and
    what she may do, where she is the heading over somebody else's material.
    One class, because the sizes belong to the sheet and the view belongs here.
  */
  subjectEl.classList.toggle('subject-large', place === 'cast')
  /*
    The archive is the one page with three columns competing, so it is the one
    page whose body is laid out differently — the list becomes a track and the
    apparatus column gives up its place to it. See `.spread.three`.
  */
  spreadEl.classList.toggle('three', place === 'archive')
  // Redrawn, not rescaled: her face is a canvas and it has to be rendered at
  // the size it is shown.
  renderSubject()
  pageHersEl.hidden = !isHers(place)
  pageMachineEl.hidden = isHers(place)

  // One body per view in the reading column, and one in the margin. Separate
  // elements rather than one that is rebuilt, so a transcript survives a trip
  // to her sheet and back.
  paneEl.hidden = place !== 'cast'
  marginHersEl.hidden = place !== 'cast'
  talkEl.hidden = place !== 'archive'
  listEl.hidden = place !== 'archive'
  permitsEl.hidden = place !== 'permits'
  wakeEl.hidden = place !== 'permits'
  marginPermitsEl.hidden = place !== 'permits'

  // Search and the day strip belong to what she has said and to nothing else.
  // Hidden rather than emptied, so what is typed survives a trip away and back.
  findingEl.hidden = place !== 'archive'
  calEl.hidden = place !== 'archive'
  countEl.hidden = place !== 'archive'
  /*
    And so do the deletion controls, for the same reason.

    They act on conversations. Leaving them visible on her sheet or on the
    machine would put "Delete all" under a heading that says something else,
    which is how a control's scope gets misread in the one direction that
    cannot be undone.
  */
  // T3: leaving the archive cancels picking. The rule is `rules/picking.ts`'s.
  picking.wentTo(place)
  showPicking()
  /*
    Her sheet repaints the open character on arrival.

    `showingCharacter` is turned OFF when a transcript or a problem report is
    opened, and nothing turned it back on: coming back left the pane holding
    whatever was last drawn there with no row marked current.
  */
  if (place === 'cast' && shelf !== null && !showingCharacter) openCharacter()
  if (place === 'permits') renderPermits()
  /*
    The reading column says what it is FOR when nothing is open in it.

    Half a window of blank paper beside a list is indistinguishable from a
    transcript that failed to load, and it was the first thing on screen every
    time somebody opened what she has said.
  */
  /*
    Only when there IS something to pick.

    With nothing kept, this stacked a second empty state under the first: the
    list said she has not said anything yet and the column beneath it invited
    you to pick one of them. Two answers to one question, and the invitation was
    the wrong one.
  */
  if (
    place === 'archive' &&
    open === null &&
    talkEl.childElementCount === 0 &&
    conversations.length > 0
  ) {
    empty(talkEl, forPronoun(SAYS.pickOne, saying()))
  }
  renderPlaces()
  // Read on arrival rather than held: the machine's answers come from disk and
  // from another window's writes, so a cached copy is stale when it matters.
  // Both the machine page and view III read from the machine's answers, and
  // both come from disk and from another window's writes — so a cached copy is
  // stale the first time it matters.
  if (place === 'machine' || place === 'permits') void loadMachine()
}

/**
 * The three views, built ONCE and thereafter only marked.
 *
 * They used to be recreated on every `showPlace`, which is a re-render fired
 * from inside a view's own click handler: the element being clicked is detached
 * mid-event and replaced, so keyboard focus lands on `<body>` and the next Tab
 * starts over from the top of the window.
 */
const views = new Map<Place, HTMLButtonElement>()

/** Which wording belongs to which view. The tables are in `shelf-says.ts`. */
const VIEW_SAYS: Readonly<Record<'cast' | 'archive' | 'permits', ByPronoun>> = {
  cast: SAYS.viewCast,
  archive: SAYS.viewArchive,
  permits: SAYS.viewPermits,
}

/**
 * The whole `tab` contract, not a third of it.
 *
 * The strip declared `role="tablist"` and gave its buttons `role="tab"` — and
 * then marked the live one with `aria-current` alone. That is a valid attribute
 * and it is not the one this pattern is read through: assistive technology asks
 * a tab for `aria-selected`, and a tablist whose tabs never answer it presents
 * as buttons with no state inside a container promising state.
 *
 * `aria-current` STAYS: the stylesheet selects on it, and the two are not
 * rivals — one says "this is where you are", the other "this one is selected".
 *
 * ## And the keyboard
 *
 * A tablist is one stop, not three: `Tab` enters it and arrows move within it.
 * Roving `tabindex` is what makes the container one stop. Arrowing cannot reach
 * the machine — see `alongViews`, which is where that rule is held and tested.
 */
function renderPlaces(): void {
  if (views.size === 0) {
    for (const one of VIEWS) {
      const button = document.createElement('button')
      button.className = 'view'
      button.type = 'button'
      button.setAttribute('role', 'tab')
      button.id = `tab-for-${one.id}`
      button.setAttribute('aria-controls', 'reading')
      // The numeral and the title, because these are parts of one document
      // rather than three destinations.
      const numeral = document.createElement('span')
      numeral.className = 'view-numeral'
      numeral.textContent = one.numeral
      const label = document.createElement('span')
      label.className = 'view-label'
      button.append(numeral, label)
      button.addEventListener('click', () => {
        showPlace(one.id)
      })
      button.addEventListener('keydown', (event: KeyboardEvent) => {
        const moved = alongViews(event.key, one.id)
        if (moved === null) return
        // Taken, so the arrow does not also scroll the column behind the strip.
        event.preventDefault()
        showPlace(moved)
        views.get(moved)?.focus()
      })
      views.set(one.id, button)
      viewsEl.append(button)
    }
    railMachineEl.addEventListener('click', () => {
      showPlace('machine')
    })
  }
  for (const [id, button] of views) {
    const here = id === place
    /*
      The wording is re-resolved every time, not written once at creation.

      These are three sentences about her, and the worn character can change
      from the tray while this window is open — a label set at build time would
      go on saying "Who she is" for a character worn as `he`, which is the exact
      failure `SettingsView.pronoun` records.
    */
    const label = button.querySelector('.view-label')
    const wording = id === 'machine' ? null : VIEW_SAYS[id]
    if (label !== null && wording !== null) label.textContent = forPronoun(wording, saying())
    button.setAttribute('aria-current', String(here))
    button.setAttribute('aria-selected', String(here))
    // ROVING: only the selected view is a tab stop, so `Tab` enters once and
    // the arrows move inside.
    button.tabIndex = here ? 0 : -1
  }
  railMachineEl.setAttribute('aria-current', String(place === 'machine'))
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
    looking.moved()
    void write(() => window.mochiHistory.wear(id), forPronoun(SAYS.worn, saying()))
  },
  save: (change) => {
    /*
      WHICH field changed, so the receipt can be about it.

      Every character write came through here and said "Saved." — one sentence
      for a voice that lands at a wake that has not happened, a rename that moves
      a name in three places, and a switch whose whole effect is elsewhere.
      `rules/said.ts` has a sentence for the ones worth a line and nothing for
      the rest; this is what lets it be asked.

      The change carries exactly one field in practice — each control saves its
      own — so the first key IS the kind. `voice` is the one that also needs the
      value, because the sentence names it.
    */
    const [kind] = Object.keys(change).filter((one) => one !== 'id')
    void write(
      () => window.mochiHistory.saveCharacter(change),
      forPronoun(SAYS.saved, saying()),
      kind === undefined ? undefined : { kind, value: describe(change, kind) },
    )
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
    const naming = action.kind === 'create' || action.kind === 'duplicate'
    void write(
      () => window.mochiHistory.character(action),
      action.kind === 'delete'
        ? forPronoun(SAYS.deleted, saying())
        : action.kind === 'restore-built-in'
          ? forPronoun(SAYS.restored, saying())
          : forPronoun(SAYS.made, saying()),
    ).then(() => {
      /*
        THE CURSOR GOES TO HER NAME.

        The rail has no field to type one in — the design draws two words and
        nothing else — so a new character arrives called "New character" and the
        one place this window renames a character is put in front of you,
        already selected. Without this the default name is a thing you have to
        go and find, and the first character somebody makes stays called that.

        After the write, because the reload rebuilds the sheet: focusing the
        field that is about to be replaced focuses nothing.
      */
      if (!naming) return
      const field = subjectEl.querySelector('input')
      if (field === null) return
      field.focus()
      field.select()
    })
  },
  memory: (action) => {
    void write(
      () => window.mochiHistory.memory(action),
      action.kind === 'restore' ? 'Put back as it was.' : 'Forgotten.',
      { kind: action.kind === 'restore' ? 'note-undone' : 'note-cleared', value: 'the last line' },
    )
  },
  askToErase: (id) => {
    // The same surface every other destruction in this window uses — contract
    // D2. This was an armed button, which a double-click defeats.
    askFirst({ kind: 'kept', id, ...asWords({ kind: 'kept' }) })
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
/** The shelf's queue. Same argument as `machineWrites`; see `rules/writes.ts`. */
const shelfWrites = writes()

/**
 * `kind` is what `rules/said.ts` knows a write by.
 *
 * Given one, the RULE decides the sentence and the caller's `done` is the
 * fallback for a kind it has no opinion about. Two places writing the same
 * receipt is how a voice change came to be announced one way here and another
 * way on the machine's page.
 */
async function write(
  act: () => Promise<SettingsWrite>,
  done: string,
  said?: { readonly kind: string; readonly value?: string },
): Promise<void> {
  await shelfWrites.add(async () => {
    try {
      const result = await act()
      const sentence = said === undefined ? done : (receipt({ ...said, ok: true }) ?? done)
      say(result.ok ? sentence : result.why, !result.ok)
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
  const unreadable = applyAccent(document.documentElement, view.face)
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
  button.className = picking.chosen().includes(token) ? 'entry picked' : 'entry'
  button.type = 'button'
  button.setAttribute('aria-current', String(token === open))
  if (picking.on()) button.setAttribute('aria-pressed', String(picking.chosen().includes(token)))

  const when = document.createElement('div')
  when.className = 'when'
  // Shown only in select mode, and it carries the state without relying on the
  // wash behind the row -- which a colour-blind reader may not separate from an
  // ordinary hover.
  const tick = document.createElement('span')
  tick.className = 'tick'
  tick.textContent = picking.chosen().includes(token) ? '☑' : '☐'
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
    // A4: what a click MEANS is `rules/picking.ts`'s decision, not this row's.
    if (picking.click(token).kind === 'selected') {
      showPicking()
      renderList(Date.now())
      return
    }
    open = token
    showingCharacter = false
    looking.moved()
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

/*
  `transcriptHead` stood here.

  It drew the conversation's time, turn count, length and interruption count as
  the first block of the transcript — apparatus above the subject, which is the
  arrangement the delivered design inverts. Every fact it built is now in
  `renderTalkMargin`, in the margin, and the reading column starts with what was
  actually said.
*/

async function show(token: string, term: string): Promise<void> {
  const stillWanted = looking.request()
  let turns: readonly HistoryTurn[]
  try {
    turns = await window.mochiHistory.turns(token)
  } catch (error: unknown) {
    // Loud, and in the pane that failed. Leaving the previous transcript up
    // with no message is indistinguishable from this one having loaded.
    if (stillWanted()) empty(talkEl, `Could not read that conversation: ${String(error)}`)
    return
  }
  // Somebody has moved on. Painting this now would replace what they asked for
  // with what they closed.
  if (!stillWanted() || showingCharacter || open !== token) return
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
  // The head is APPARATUS and it lives in the margin now — "Subject first,
  // apparatus in the margin. Nothing to the right of the rule is a thing you
  // came to read." What she said leads the column.
  renderTalkMargin(turns, conversations.find((one) => one.token === token)?.tools ?? [])
  transcript.append()

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

  /*
    THE TRANSCRIPT'S FACTS SIT ON THE TRANSCRIPT — A3.

    They were a block in the margin, which the archive does not have: that page
    spends its side column on the list of conversations, and 232 + 368 + 224
    leaves 456 for a transcript holding a 600px measure. So the apparatus had
    nowhere to be, and as a third child of a two-column grid it wrapped onto a
    row of its own underneath.

    Above the turns rather than beside them, which is where the delivery draws
    it: "13:00 · 4 turns · 3 min · no capabilities used" is a head for the thing
    below it, and a head is not apparatus about a page — it is the page's own
    first line.
  */
  talkEl.replaceChildren(talkFacts, transcript)
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
 * The month, and a way to reach one that is not next door.
 *
 * ## Why a popover and not two more arrows
 *
 * The arrows move one month, which is right for "the conversation I am thinking
 * of was last week". They are hopeless for "some time in 2024" — thirty presses,
 * each one a re-render. A person who knows roughly when should be able to say
 * so, and a person who does not should not be made to count.
 *
 * ## The native `popover`, not a hand-built menu
 *
 * It closes on Escape and on a click outside, it is put in the top layer so it
 * cannot be clipped by the column it hangs off, and its focus behaviour is the
 * platform's. Every one of those is a thing this window would otherwise get
 * wrong once and fix twice — the archive already had a dropdown that could be
 * clipped by an overflow, and that is where the rule about not hand-building
 * these comes from.
 *
 * ## The year REFUSES rather than clamping
 *
 * See `yearTyped`. A field that silently turns 20 into 2000 has answered a
 * question nobody asked.
 */
function monthPicker(year: number, month: number): HTMLElement {
  const wrap = element('span', 'month-wrap')
  const open = element('button', 'month', monthLabel(year, month))
  open.type = 'button'
  open.setAttribute('popovertarget', 'month-pick')
  open.setAttribute('aria-label', `${monthLabel(year, month)} — choose another`)

  const pick = element('div', 'month-pick')
  pick.id = 'month-pick'
  pick.setAttribute('popover', '')

  const field = element('input', 'month-year')
  field.type = 'text'
  field.value = String(year)
  field.placeholder = 'year'
  field.setAttribute('aria-label', 'Year')
  const go = (): void => {
    const asked = yearTyped(field.value)
    if (asked === null) {
      // Put back what is in force, so the field never shows a year the strip
      // below it is not on.
      field.value = String(year)
      say('That is not a year this archive can hold.', true)
      return
    }
    onMonth = { year: asked, month }
    pick.hidePopover()
    renderCalendar(Date.now())
    renderList(Date.now())
  }
  field.addEventListener('change', go)
  field.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key !== 'Enter') return
    // Taken, or the field's own form-less Enter reloads nothing and the popover
    // stays open over a strip that has already moved.
    event.preventDefault()
    go()
  })

  const grid = element('div', 'month-grid')
  for (const [at, name] of monthNames().entries()) {
    const one = element('button', 'month-one', name)
    one.type = 'button'
    one.setAttribute('aria-current', String(at === month))
    one.addEventListener('click', () => {
      const asked = yearTyped(field.value) ?? year
      onMonth = { year: asked, month: at }
      pick.hidePopover()
      renderCalendar(Date.now())
      renderList(Date.now())
    })
    grid.append(one)
  }

  pick.append(field, grid)
  wrap.append(open, pick)
  return wrap
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
  /*
    `month-nav`, NOT `head`.

    `.head` is the PAGE header — her subject row and the views — and it carries
    `padding: 30px 40px 0`. This one is three controls inside the day strip, and
    it inherited that padding: thirty pixels of it, which is why the month sat a
    line and a half below the numerals it belongs beside. `.daystrip .head` is
    more specific and sets no padding, so the page header's won.

    The eighth collision of this shape in this file. Two meanings for one name
    is the defect; naming the specific thing is the fix, and it is the same
    answer `.who-band`, `.machine-spread` and `.rail-row` were given.
  */
  head.className = 'month-nav'
  head.append(
    arrow('back', 'Previous month', () => {
      onMonth = stepMonth(year, month, -1)
      renderCalendar(Date.now())
    }),
    monthPicker(year, month),
    arrow('on', 'Next month', () => {
      onMonth = stepMonth(year, month, 1)
      renderCalendar(Date.now())
    }),
  )

  /*
    ONE ROW, not a grid of weeks.

    "A whole month at a glance. Days with nothing in them are pale and do not
    respond — they are not offering anything." The weekday initials go with the
    grid: a strip answers "when did we talk", and the day of the week is a
    different question this window never asked.
  */
  const strip = document.createElement('div')
  strip.className = 'strip'
  if (conversations.length === 0) {
    strip.classList.add('strip-empty')
    strip.textContent = forPronoun(SAYS.noDay, saying())
    calEl.replaceChildren(head, strip)
    return
  }
  for (const cell of monthDays(year, month)) {
    const many = counts.get(cell.at) ?? 0
    const day = document.createElement('button')
    day.className = `day${many > 0 ? ' has' : ''}${cell.at === today ? ' today' : ''}`
    day.type = 'button'
    const numeral = document.createElement('span')
    numeral.className = 'day-n'
    numeral.textContent = String(cell.day)
    day.append(numeral)
    day.setAttribute('aria-current', String(cell.at === picked))
    // A1: a day with nothing on it is not a button you can press. A cell that
    // looks pressable and answers with an empty column is the same lie as a
    // tool she cannot call.
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
    strip.append(day)
  }

  calEl.replaceChildren(head, strip)
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
  countEl.hidden = false
  if (conversations.length === 0) {
    /*
      The month stays; the strip becomes a sentence.

      Thirty-one inert numerals is a row of days that "must not appear
      actionable" and does not appear to be anything else either. The delivery's
      first-hour state keeps the month and its arrows — moving back through
      months is still a real question — and says in words that no day has
      anything in it.
    */
    countEl.hidden = true
    /*
      The month has to be decided before it can be drawn, and with nothing kept
      there is no conversation to take it from — so it is THIS month. Without
      this `onMonth` was still null, `renderCalendar` returned at its first
      line, and the strip was simply absent rather than saying why.
    */
    const here = new Date(now)
    onMonth ??= { year: here.getFullYear(), month: here.getMonth() }
    renderCalendar(now)
    /*
      ONE empty state, and it says what is true of the machine.

      There were two, stacked: the list said "nothing has been kept yet" and the
      transcript column beneath it said "pick a conversation on the left" — an
      instruction to pick from a list that had just said it was empty, pointing
      at a side the list is no longer on.

      The second line distinguishes NOTHING TO SHOW from FAILED TO READ, which
      an empty page cannot do on its own: it names whether conversations are
      being kept at all. Somebody whose retention is off learns it here rather
      than after a week of talking to an archive that was never going to fill.
    */
    const keeps = shelf?.characters.find((one) => one.id === shelf?.wornId)?.keeps ?? true
    empty(listEl, forPronoun(SAYS.noTalks, saying()))
    listEl.append(
      element('p', 'note', `${forPronoun(SAYS.noTalksWhy, saying())} ${keeps ? 'ON' : 'OFF'}`),
    )
    talkEl.replaceChildren()
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
  /*
    BOTH numbers, because they are different questions — A4.

    A match is a TURN, so one long conversation can match twenty times. The rows
    are grouped so a conversation appears once, which is right and which on its
    own makes "20 results" a lie in one direction and "1 result" a lie in the
    other. The delivery states the rule plainly: the count says both numbers.

    Above the day headings rather than beside the field, because it describes
    what is in this list rather than what was typed — and the list is what
    changes when a day is picked out from under a search.
  */
  const matches = hits.reduce((sum, one) => sum + one.count, 0)
  const found = element('p', 'found')
  found.textContent =
    `${String(matches)} ${matches === 1 ? 'match' : 'matches'} in ` +
    `${String(hits.length)} ${hits.length === 1 ? 'conversation' : 'conversations'}`
  parts.push(found)
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
      if (picking.on()) stopPicking()
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
    // A5's decision is `rules/showing.ts`'s, so every caller that repaints this
    // column gets the same answer — the defect was that one of them did not.
    if (showing(queryEl.value) === 'a day') renderList(Date.now())
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
  /*
    IT RISES, it does not navigate.

    This used to set `open = null`, clear the character, re-render the cards and
    switch to the archive — because the report was painted into that view's
    transcript pane. So asking what had gone wrong cost you whatever you were
    looking at, and answering a question about the window moved the window.

    The drawer is in the top layer over whatever page is open, which is where a
    thing reachable from every page belongs.
  */
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
    showTroubles(page)
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
  showTroubles(page)
}

/**
 * Put the report in the drawer and open it.
 *
 * `showPopover` is idempotent only in one direction — calling it on an open
 * popover throws — so the state is asked rather than assumed. The window
 * re-reads its problem count whenever it comes back to the front, and that
 * re-read repaints an open drawer in place rather than closing and reopening
 * it under somebody's pointer.
 */
function showTroubles(page: HTMLElement): void {
  troublesBodyEl.replaceChildren(page)
  troublesBodyEl.scrollTop = 0
  if (!troublesDrawerEl.matches(':popover-open')) troublesDrawerEl.showPopover()
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
      /*
        SAID either way, rather than hidden when there is nothing.

        An empty corner is the same picture whether nothing has gone wrong or
        the count could not be read, and the status bar exists precisely so the
        window's two standing questions have one place to be answered. "nothing
        has gone wrong" is an answer; an absence is not.
      */
      const many = problems.length
      troublesEl.hidden = false
      troublesEl.classList.toggle('quiet', many === 0)
      troublesEl.disabled = many === 0
      troublesLabelEl.textContent =
        many === 0
          ? 'nothing has gone wrong'
          : `${String(many)} ${many === 1 ? 'problem' : 'problems'}`
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
    askFirst({ kind: 'everything', ...asWords({ kind: 'everything' }) })
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
const machineWrites = writes()

async function writeMachine(run: () => Promise<SettingsWrite>, ok: string): Promise<void> {
  await machineWrites.add(async () => {
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
  // View III draws from the same read. Without this it keeps whatever it had
  // when the write went out, which is the state somebody just changed.
  if (place === 'permits') renderPermits()
}

function renderMachine(): void {
  const view = machine
  if (view === null) return
  navEl.replaceChildren(
    ...machineNav(view, openGroup, (id) => {
      openGroup = id
      renderMachine()
      machineEl.scrollTop = 0
    }),
  )

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

/**
 * The open transcript's own facts, above its turns.
 *
 * Built once and re-filled, like every other pane in this window: a fresh
 * element per render would drop the scroll position of the pane it sits in.
 */
const talkFacts = element('div', 'talk-facts')

/**
 * The part of a change a receipt names, when it names one.
 *
 * Only a few sentences take a value — the voice, the new name — and the rest are
 * about the fact that something landed somewhere you cannot see. A string is
 * always returned rather than sometimes; `said` ignores it for kinds whose
 * sentence has no slot.
 */
function describe(change: PersonaChange, kind: string): string {
  // Through `unknown`, because `PersonaChange` is a closed shape and TypeScript
  // is right that it does not overlap an open record. The lookup is by a key
  // taken from the same object a line earlier, so the widening is safe and the
  // narrowing back to `string` is what makes it honest.
  const value = (change as unknown as Readonly<Record<string, unknown>>)[kind]
  return typeof value === 'string' ? value : ''
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
  looking.moved()
  const stillWanted = looking.request()
  void window.mochiHistory
    .problems()
    .then((found) => {
      // The same staleness rule every other read here follows. Without it a
      // slow problems read lands on top of a conversation opened after the
      // click, and the transcript is replaced by a report nobody asked for now.
      if (!stillWanted()) return
      renderProblems(found)
    })
    .catch((error: unknown) => {
      if (stillWanted()) empty(talkEl, `Could not read what went wrong: ${String(error)}`)
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
  if (showing(queryEl.value) === 'a day') {
    renderList(Date.now())
    return
  }
  const stillWanted = looking.request()
  void window.mochiHistory
    .search(term)
    .then((hits) => {
      // The debounce stops QUEUED queries; it does nothing about one already
      // running, and FTS5 answers a short term far more slowly than a long
      // one — so the results for `a` used to land after `apple` and replace
      // them.
      if (!stillWanted()) return
      renderHits(group(hits), term)
    })
    .catch((error: unknown) => {
      if (stillWanted()) empty(listEl, `Could not search: ${String(error)}`)
    })
}

let searching: number | null = null
queryEl.addEventListener('input', () => {
  // Debounced. Every keystroke is an FTS5 query and an IPC round trip, and a
  // fast typist would queue a dozen of them to throw away eleven.
  if (searching !== null) clearTimeout(searching)
  looking.moved()
  searching = window.setTimeout(runSearch, 140)
})

// The launch read and the read on return are one registration, so neither can
// exist without the other — see `rules/afresh` for the session-long blind spot
// that came of writing them as two statements.
afresh(window, readProblemCount)
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
void readEverything({
  characters: async () => {
    await readShelf()
    openCharacter()
  },
  conversations: readConversations,
  characterTrouble: (error) => {
    empty(charactersEl, `Could not read the characters: ${String(error)}`)
  },
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
