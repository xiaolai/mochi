import type { MochiSettingsApi, SettingsView, SettingsWrite } from '@shared/ipc'
import { applyAccent } from '../design/apply-accent'
import { PANES, type PaneHandlers } from './panes'

declare global {
  interface Window {
    readonly mochiSettings: MochiSettingsApi
  }
}

/**
 * What is true regardless of character — six groups, one at a time.
 *
 * The per-character half — who she is, her voice, her face, her bubble, her
 * note, and making or removing characters — MOVED to the shelf, where the
 * characters already are. It was not copied: `plan-shell.md` settles the split,
 * and two places to set one thing is what `menuHandlers` exists to avoid.
 *
 * This file is the shell: the nav column, which pane is open, and saying what
 * happened. `panes.ts` holds the six groups and the argument for why they are
 * these six rather than the handoff's.
 *
 * `document.createElement` and `textContent`, never `innerHTML`. Some of what
 * is drawn here came out of a folder anybody can write to — a workspace path, a
 * capability description — and showing that text to a person is safe where
 * evaluating it is not.
 *
 * Every change is sent one at a time and the view is re-read from main
 * afterwards. Nothing is kept in a local model that could disagree with the
 * files: the store is the truth, and a window that believed its own copy would
 * be the second place a setting lives.
 */

const nav = document.querySelector('#nav')
const pane = document.querySelector('#pane')
const said = document.querySelector('#said')
if (
  !(nav instanceof HTMLElement) ||
  !(pane instanceof HTMLElement) ||
  !(said instanceof HTMLElement)
) {
  throw new Error('settings: the document is not the one this expects')
}
const navEl: HTMLElement = nav
const paneEl: HTMLElement = pane
const saidEl: HTMLElement = said

/** Which group is open. The first, until somebody picks another. */
let openPane = PANES[0]?.id ?? ''

/** Say what happened. Silence after a write reads as the write not landing. */
function say(text: string, bad = false): void {
  saidEl.textContent = text
  saidEl.classList.toggle('bad', bad)
}

/**
 * Do one thing, say what happened, then re-read the whole view.
 *
 * Re-read even on a refusal, so a control that was not accepted snaps back to
 * what is actually stored rather than sitting on a value nothing took — which
 * is the one failure a settings window must not have.
 */
async function write(act: () => Promise<SettingsWrite>, done: string): Promise<void> {
  let result: SettingsWrite
  try {
    result = await act()
  } catch (error: unknown) {
    say(String(error), true)
    return
  }
  if (!result.ok) {
    say(result.why, true)
    await load()
    return
  }
  say(done)
  await load()
}

const handlers: PaneHandlers = {
  lookup: (change) => {
    void write(() => window.mochiSettings.lookup(change), 'Saved. It applies to her next lookup.')
  },
  screen: (change) => {
    void write(() => window.mochiSettings.screen(change), 'Saved. She has moved her words already.')
  },
  grant: (change) => {
    /**
     * What is CLAIMED here has to be true of the grant that moved.
     *
     * "In force now" is right for three of the four and wrong for speaking
     * first, which is decided when she wakes. Main answers with a refusal
     * carrying its own sentence when the live session could not be told, so
     * this only ever speaks for the case where everything landed.
     */
    const when = change.id === 'speak_first' ? 'from her next wake' : 'now'
    void write(
      () => window.mochiSettings.grant(change),
      change.allowed
        ? `Allowed, and in force ${when}.`
        : `Turned off, and in force ${when}. She is told, so she will say she can no longer do ` +
            'it rather than quietly failing.',
    )
  },
  reveal: (what) => {
    window.mochiSettings.reveal(what)
  },
  say,
}

/**
 * The nav column, with a dot on any group that needs looking at.
 *
 * Rebuilt on every read rather than patched: the dot depends on the view, and a
 * nav that kept its own copy of "is anything wrong" would be a second answer to
 * a question main already answers.
 */
function renderNav(view: SettingsView): void {
  navEl.replaceChildren(
    ...PANES.map((one) => {
      const button = document.createElement('button')
      button.className = 'tab'
      button.type = 'button'
      button.setAttribute('aria-current', String(one.id === openPane))

      const label = document.createElement('span')
      label.textContent = one.label
      // The spacer, so the dot sits against the right edge whatever the label
      // is — the artifact's own row shape, and it survives translation.
      const grow = document.createElement('span')
      grow.className = 'grow'
      button.append(label, grow)

      const why = one.attention(view)
      if (why !== null) {
        const dot = document.createElement('span')
        dot.className = 'dot'
        // The reason lives ON the control, so the dot is not a puzzle. It is
        // short on purpose — the pane itself says the whole thing.
        button.title = why
        button.append(dot)
      }

      button.addEventListener('click', () => {
        openPane = one.id
        void load()
      })
      return button
    }),
  )
  // The standing sentence at the foot of the column, from 2b. It answers the
  // question every settings window is asked once — is there a Save? — and the
  // answer here is that only a character has one, on the shelf.
  const foot = document.createElement('p')
  foot.className = 'nav-note'
  foot.textContent = 'Changes apply as you make them. Only a character has a Save, on the shelf.'
  navEl.append(foot)
}

/** Which pane the content currently belongs to. See `renderPane`. */
let drawn: string | null = null

function renderPane(view: SettingsView): void {
  const showing = PANES.find((one) => one.id === openPane) ?? PANES[0]
  if (showing === undefined) {
    paneEl.textContent = 'No settings to show.'
    return
  }
  const heading = document.createElement('h2')
  heading.textContent = showing.label
  paneEl.replaceChildren(heading, ...showing.render(view, handlers))
  // Only when the GROUP changes. Every write re-reads and redraws, so a switch
  // toggled halfway down a pane used to throw the page back to the top under
  // the cursor that had just moved it — which reads as the control having done
  // something else entirely.
  if (drawn !== showing.id) {
    paneEl.scrollTop = 0
    drawn = showing.id
  }
}

async function load(): Promise<void> {
  const view = await window.mochiSettings.read()
  /**
   * HER colour, before anything is drawn with it.
   *
   * The design's second semantic rule — the accent is her — and the reason it
   * is applied on every read rather than once: the worn character can change
   * from the shelf or the tray while this window is open, and this window
   * re-reads on focus precisely so it never shows the last one's.
   */
  const unreadable = applyAccent(document.documentElement, view.face)
  renderNav(view)
  renderPane(view)
  if (unreadable.length > 0) {
    // Said out loud rather than silently corrected. Her colour becomes the
    // interface's colour, so falling back without a word leaves somebody
    // wondering why the character they chose had no effect.
    say(
      `That character's colour is not readable, so the built-in is used: ${unreadable.join('; ')}`,
      true,
    )
  }
}

/**
 * Read again whenever this window comes back.
 *
 * Some of what this window shows can be changed elsewhere — the tray offers the
 * bubble's side, and the shelf changes who is worn — and v1's note is explicit
 * that one setting behind two entry points is how a project ends up with two
 * refresh paths that drift. They share one handler in main; this is the other
 * half, so a change made on the tray is on screen here the moment somebody
 * looks.
 */
window.addEventListener('focus', () => {
  void load()
})

void load().catch((error: unknown) => {
  say(`Could not read your settings: ${String(error)}`, true)
})
