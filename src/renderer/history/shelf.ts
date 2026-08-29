import type { ShelfView } from '@shared/history-window'
import { forPronoun } from '@shared/pronoun'
import { element } from '../element'
import { editing } from '../rules/editing'
import { SAYS } from './shelf-says'
import { colourSection } from './sheet/colour'
import { PRONOUN_CAPS, faceTile, wornMark } from './sheet/face-tile'
import { fileSection } from './sheet/file'
import { memorySection } from './sheet/memory'
import { moodSection } from './sheet/mood'
import { promptSection } from './sheet/prompt'
import { type ShelfHandlers } from './sheet/row'
import { bubbleSection, savingSection } from './sheet/saving'
import { voiceSection } from './sheet/voice'
import { whoBand } from './sheet/who'
import { sizeSection } from './sheet/size'
import { wakeCount } from './wake-count'

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
 * a manifest. `faces` was the sharpest: it narrowed `set_expression`'s enum on
 * the wire and appears in her prompt, and it shipped with no UI at all.
 *
 * ## `document.createElement` and `textContent`, never `innerHTML`
 *
 * The same rule the rest of this window follows, and it matters more here: a
 * character's name and her prompt come out of a folder anybody can write to,
 * and the note below was written by a MODEL. Showing that text to a person is
 * safe; evaluating it is not.
 */

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
    sizeSection(view, worn, handlers),
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
/** Which of the three wake panes is up. Three now, so no longer a boolean. */
type WakePane = 'sent' | 'tools' | 'write'

/**
 * The three-way switcher over the wake panes, and what it shows.
 *
 * Its own function because it was thirty lines in the middle of a panel that is
 * otherwise about a text box: a loop building buttons, four `hidden`
 * assignments and a counter, between the editor's construction and the editor's
 * wiring. Nothing in it reads the prompt and nothing in the prompt reads it.
 *
 * The panes are passed as elements rather than looked up, so this knows nothing
 * about the shelf — and `sizes` is a THUNK because the draft's length changes
 * under it while somebody types.
 */
function wakeTabs(parts: {
  readonly panes: Readonly<Record<WakePane, HTMLElement>>
  readonly actions: HTMLElement
  readonly count: HTMLElement
  readonly sizes: () => { readonly sent: number; readonly tools: number; readonly draft: number }
}): { readonly element: HTMLElement; readonly draw: () => void } {
  const strip = element('div', 'switchers wake-tabs')
  let showing: WakePane = 'sent'

  const draw = (): void => {
    strip.replaceChildren()
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
      strip.append(button)
    }
    for (const [id, pane] of Object.entries(parts.panes)) pane.hidden = id !== showing
    parts.actions.hidden = showing !== 'write'
    parts.count.textContent = wakeCount(showing, parts.sizes())
  }

  return { element: strip, draw }
}

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
  editor.placeholder = `${forPronoun(SAYS.promptEmpty, view.pronoun)}\n\nSlots move a piece instead of leaving it where it goes: ${view.prompt.slots.map((one) => `{${one}}`).join(' ')} and {name}.`

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

  const { element: tabs, draw } = wakeTabs({
    panes: { sent, tools: toolsBox, write: editor },
    actions,
    count,
    sizes: () => ({
      sent: view.assembled.length,
      tools: view.toolsSent.length,
      draft: editor.value.length,
    }),
  })

  /*
    The rule lives in `rules/editing`, which holds and tests the whole of C3 —
    including THE BOX GOING WITH THE BUTTONS. Only the buttons were disabled
    once, so the box stayed live for the whole round trip, and the save ends in
    a `reload` that rebuilds this panel from what main now holds. Anything typed
    in between was replaced without a word: the caret jumped, the words went,
    and the only thing that had happened was a save somebody asked for.

    Cancel is the LOCAL way back — it restores the draft and writes nothing, so
    it must not take the lock. The catalogued prompts' Reset is the other shape,
    a write that restores what shipped. Same rule, two verbs.
  */
  const doc = editing(view.prompt.text)
  const showState = (): void => {
    save.disabled = !doc.canCommit()
    cancel.disabled = !doc.canRevert()
    editor.disabled = doc.sending()
    count.textContent = wakeCount('write', {
      sent: view.assembled.length,
      tools: view.toolsSent.length,
      draft: editor.value.length,
    })
  }
  save.disabled = true
  cancel.disabled = true

  editor.addEventListener('input', () => {
    doc.typed(editor.value)
    showState()
  })
  save.addEventListener('click', () => {
    const text = doc.commit()
    if (text === null) return
    showState()
    handlers.prompt(text)
  })
  cancel.addEventListener('click', () => {
    if (!doc.canRevert()) return
    doc.revert()
    // Back to what is stored, not to empty. Cancel undoes the edit; there is a
    // separate and deliberate way to store nothing, which is to clear the box
    // and Save.
    editor.value = doc.draft()
    showState()
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
