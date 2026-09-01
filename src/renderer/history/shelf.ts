import type { ShelfCharacter, ShelfView } from '@shared/history-window'
import { forPronoun } from '@shared/pronoun'
import { castDangerous } from './sheet/cast'
import { element } from '../element'
import { editing } from '../rules/editing'
import { SAYS } from './shelf-says'
import { colourSection } from './sheet/colour'
import { whoSection } from './sheet/who'
import { fileSection } from './sheet/file'
import { type ShelfHandlers } from './sheet/row'
import { bubbleSection, savingSection } from './sheet/saving'
import { voiceSection } from './sheet/voice'
import { sizeSection } from './sheet/size'
import { wakeCount } from './wake-count'
import { anchor } from '../field'
import { HER_FIELDS } from './sheet/fields'

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

/*
  `characterCards` was here, and it is `parts/rail.ts` now.

  This file also builds the whole character sheet — her colour, her voice, her
  prompt, her memory — so it was 414 lines doing two unrelated jobs, and a change
  to the rail meant opening the file that owns her identity. The v2 delivery
  draws the rail, the masthead and the machine's nav as three shared components
  and records that its own artboards drifted in exactly the places where they
  were not three. Three components in the design are three modules here.
*/

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

  /*
    FIVE SECTIONS, which is what A1 draws — not eleven.

    This built every screen the delivery gives her page into one endless scroll:
    her expressions, her notes and her instruction were sections here, and each
    of them is a SCREEN in the artboards with its own title and its own
    apparatus column. Her conversations retention moved to the machine's page,
    where B6 draws it.

    The order is the artboard's and it is not arbitrary: what she IS, then how
    she looks, then how she sounds, then how she speaks — identity first,
    history last. `Her file` joins them only when there is one, which is what A2
    draws and what "the built-in only — she has no file to delete" says on A1.
  */
  /*
    `savingSection` IS DRAWN, and it was not.

    It was written, exported, given a pronoun table, a note and a working save
    path — `handlers.save({ keeps })` reaches `writePolicy`, and main sends
    `worn.keeps` on every read — and then no caller. So the one control in this
    application that decides whether anything she says is written to disk at all
    existed in full and was on no screen.

    Its own header says where it goes: *"Per character, and on her sheet."*
    `storage.ts` says the same from the other side, listing retention among the
    things deliberately NOT on the machine's page because they belong beside the
    character they are filed under. Both comments described an arrangement the
    code did not have.

    After the bubble and before her file: the order runs from what she IS toward
    what is done with her, and whether her words are kept is the last thing about
    her rather than the first thing about her files.
  */
  page.append(
    whoSection(view, worn, handlers),
    colourSection(view, worn, handlers),
    sizeSection(view, worn, handlers),
    voiceSection(view, worn, handlers),
    bubbleSection(view, worn, handlers),
    savingSection(view, worn, handlers),
    fileSection(view, worn, handlers),
    deeper(view, worn),
  )
  /*
    Deleting her, or putting the built-in back, LAST.

    They were in the rail under the list of characters, where "Delete <her name>"
    named the worn character while sitting under all of them. Here there is one
    character the page is about, and the section is at the foot of it — the order
    runs from what she IS toward what can be done to her, and nothing below it
    would be read after somebody has decided to remove her.
  */
  page.append(castDangerous(worn, view.pronoun, handlers))
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
  readonly sizes: () => {
    readonly sent: number
    readonly tools: number
    readonly draft: number
    readonly limit: number
  }
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

/**
 * How the document stands right now, for A8's first apparatus block.
 *
 * Three states, because the middle one is real and visible: while a save is in
 * flight the box and both buttons go dead, and a column that said only
 * saved/unsaved would report the freeze as one of the other two.
 */
export type PromptState = 'saved' | 'unsaved' | 'saving'

export function assembledPanel(
  view: ShelfView,
  handlers: ShelfHandlers,
  /**
   * Called whenever the draft's standing changes.
   *
   * A8's column opens with "Right now · unsaved", and it is the only fact on
   * that screen that moves while somebody is looking at it — everything else
   * there is about a file. The panel owns the state (`editing()` holds it) so
   * the margin is told rather than asked; asking would mean a second reading of
   * the same draft, which is how the two come to disagree mid-edit.
   */
  onState?: (state: PromptState) => void,
): readonly HTMLElement[] {
  const head = element('div', 'row')
  const count = element('span', 'meta')
  head.append(
    element('h3', undefined, forPronoun(SAYS.instruction, view.pronoun)),
    element('span', 'grow'),
    count,
  )

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
  /*
    ABANDON, not Cancel — A8's word, and the more truthful one.

    "Cancel" is what a dialogue says, and it reads as backing out of the screen
    rather than out of the edit: pressing it here keeps you exactly where you
    are and throws away what you typed. Abandon says which of the two it does.
  */
  const cancel = element('button', 'btn', 'Abandon')
  cancel.type = 'button'
  const actions = element('div', 'row wake-actions')
  /*
    The rule about saving sits ON the row with the buttons.

    Every other control on this shelf writes on `change`, so somebody arriving
    here has been taught that leaving a field is enough. The one control that
    breaks that habit has to say so where the hand is going, not in the
    paragraph above the box.
  */
  actions.append(save, cancel, element('span', 'note', forPronoun(SAYS.notAsYouType, view.pronoun)))

  const { element: tabs, draw } = wakeTabs({
    panes: { sent, tools: toolsBox, write: editor },
    actions,
    count,
    sizes: () => ({
      sent: view.assembled.length,
      tools: view.toolsSent.length,
      draft: editor.value.length,
      limit: view.prompt.limit,
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
    onState?.(doc.sending() ? 'saving' : doc.canRevert() ? 'unsaved' : 'saved')
    save.disabled = !doc.canCommit()
    cancel.disabled = !doc.canRevert()
    editor.disabled = doc.sending()
    count.textContent = wakeCount('write', {
      sent: view.assembled.length,
      tools: view.toolsSent.length,
      draft: editor.value.length,
      limit: view.prompt.limit,
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

  // Once before anything is typed, so the column opens agreeing with the box.
  onState?.('saved')
  draw()
  return [
    head,
    note,
    where,
    sent,
    toolsBox,
    editor,
    actions,
    // Said before the box goes dead, so the freeze reads as a rule rather than
    // as the window hanging. See `editing.ts` for the lock it describes.
    element('p', 'note', forPronoun(SAYS.whileSaving, view.pronoun)),
  ]
}

/**
 * The way into the three screens that are not sections.
 *
 * Her expressions, her notes and her instruction each have their own title and
 * their own apparatus column in the delivery — A2c, A2b and A8 — so they are
 * screens rather than blocks in a scroll. `HerHead` hard-codes three view pills
 * and none of the three appears in them, so they are reached from HERE: the view
 * they belong to, from the thing they are about.
 *
 * Rows rather than buttons in a corner, because each one carries the fact that
 * says whether it is worth opening — how many she has kept, how many faces she
 * may wear, how long her instruction is. A door with nothing written on it is a
 * door people stop trying.
 */
function deeper(view: ShelfView, worn: ShelfCharacter): HTMLElement {
  /*
    THE DOOR IS WHAT SEARCH REACHES, not the screen behind it.

    Her expressions, her notes and her instruction are SCREENS of their own —
    each with its own title and apparatus column — reached by pressing one of
    these rows. Search takes somebody to the row rather than through it, and
    that is the honest stopping point: opening a drill-down from a search box
    would leave them somewhere with no memory of how they arrived, and this
    window already has one way in that they can see.
  */
  const rows = [
    {
      to: 'faces' as const,
      field: HER_FIELDS.faces,
      name: forPronoun(SAYS.deeperFaces, view.pronoun),
      fact: `${String(worn.faces.length)} of 8 allowed`,
    },
    {
      to: 'notes' as const,
      field: HER_FIELDS.notes,
      name: forPronoun(SAYS.deeperNotes, view.pronoun),
      fact: countOf(view.note.text),
    },
    {
      to: 'instruction' as const,
      field: HER_FIELDS.instruction,
      name: forPronoun(SAYS.deeperInstruction, view.pronoun),
      fact: forPronoun(SAYS.sentAtWake, view.pronoun),
    },
  ]
  const wrap = element('div', 'deeper')
  for (const one of rows) {
    const row = anchor(one.field, element('button', 'deeper-row'))
    row.type = 'button'
    row.dataset.opens = one.to
    row.append(element('span', 'deeper-name', one.name), element('span', 'deeper-fact', one.fact))
    wrap.append(row)
  }
  return wrap
}

/** Lines she has kept, said the way the apparatus column says it. */
function countOf(text: string): string {
  const lines = text === '' ? 0 : text.split('\n').length
  return lines === 0 ? 'nothing yet' : `${String(lines)} kept`
}
