/**
 * The settings window.
 *
 * Built from the DOM rather than a framework, because the whole window is one
 * form over one object and a framework would be the largest dependency in the
 * project for it. If this grows a second screen that judgement is worth
 * revisiting; it is recorded here so the revisit is a decision rather than a
 * drift.
 *
 * NOTHING here is trusted by main. Everything typed into these fields crosses
 * the bridge as data and is re-validated by `parsePersona` on the other side --
 * this file's validation exists to tell the user sooner, not to protect
 * anything.
 */

import type { SaveProblem, SettingsBridge, SettingsSnapshot } from '@shared/ipc'
import { forPronoun, label } from '@shared/pronoun'
import type { Persona } from '@shared/persona'
import {
  PANE_GROUPS,
  SETUP_SECTIONS,
  messagesFor,
  type LocaleTag,
  type PaneKey,
  type SetupSection,
} from '@shared/i18n'
import { Archive, Info, KeyRound, Users, type IconNode } from 'lucide'
import type { ThemeId } from '@shared/theme'
import { nextSignature } from './redraw'
import { createConfirmation } from './confirm'
import { refusalFor } from './hold'
import { readSnapshot } from './snapshot'
import { el, fieldProblem, forgetDrafts, moveDrafts } from './form'
import type { Copy } from './copy'
import { describeLoadProblem, describeProblem } from './refusal'
import { preservingFocus } from './focus'
import { authPane } from './panes/auth'
import { shortcutsPane } from './panes/shortcuts'
import { appearanceSection, colourPicker } from './panes/screen'
import { aboutPane } from './panes/about'
import { soundSection } from './panes/sound'
import { presenceSection } from './panes/presence'
import { delegationSection } from './panes/delegation'
import { keptPane } from './panes/kept'
import {
  PERSONA_CONTROLS,
  PERSONA_PATHS,
  holdKey,
  holdsFor,
  identitySection,
  momentFields,
  voiceSection,
  type PersonaPath,
} from './panes/voice'
import { focusCancel, isConfirming, personasPane, resetConfirmation } from './panes/personas'
import { icon } from '../design/icon'
import { accentVariables } from '../design/accent'

declare global {
  interface Window {
    readonly mochiSettings: SettingsBridge
  }
}

const found = document.getElementById('root')
if (found === null) throw new Error('no root')
// Rebound with an explicit type rather than relying on the narrowing above:
// this module ends in a top-level await, and the closures are analysed without
// it. The same reason `companion/main.ts` rebinds its canvas.
const root: HTMLElement = found

/**
 * The persona this window believes main is holding.
 *
 * ONE copy, not two. There used to be a `loaded` and a `draft`, because a Save
 * button had to be disabled until they differed. There is no Save button: every
 * field commits when it is left, so the only two states a value can be in are
 * "stored" and "the box is still being typed in" -- and the second belongs to
 * the box, not to the window. See `commitOnLeaving` in `form.ts`.
 *
 * It is written OPTIMISTICALLY, before main has answered. That is not a
 * shortcut: main does not broadcast on an ordinary persona save, so nothing
 * else would ever tell this window the value landed, and the next field's
 * commit builds its candidate from here. A refusal puts the previous value
 * back -- see `commit`.
 */
let loaded: Persona | null = null
let locale: LocaleTag = 'en'

/**
 * Fields whose typed value main would refuse, by `holdKey`.
 *
 * Persona-scoped, so a hold cannot be shown against a character it does not
 * belong to. Nothing is stored while a field is held; the box keeps the text
 * and the row keeps the reason.
 */
const held = new Map<string, SaveProblem>()

/** How many persona saves are in flight. See the broadcast handler. */
let savesInFlight = 0

/**
 * Store one field of the persona, or hold it and say why.
 *
 * The candidate is built from `loaded` at the moment of the commit, never from
 * the persona the pane was drawn with: two fields of one moment sit side by
 * side, and the second would otherwise put the first one back.
 */
function commit(path: PersonaPath, patch: (person: Persona) => Partial<Persona>): void {
  const before = loaded
  if (before === null) return
  const candidate: Persona = { ...before, ...patch(before) }
  const control = PERSONA_CONTROLS[path]
  const key = holdKey(before.id, path)

  // Judged by the REAL parser, not by a second copy of its rules -- see
  // `hold.ts`. Nothing is sent while a field is illegal: the alternative is
  // either an input that silently undoes your deletion, or a persona on disk
  // that the loader will refuse the next time it reads it.
  const refusal = refusalFor(candidate, path)
  if (refusal !== null) {
    held.set(key, refusal)
    fieldProblem(control, describeProblem(refusal, copyNow()))
    return
  }
  held.delete(key)
  fieldProblem(control, null)

  loaded = candidate
  savesInFlight += 1
  let stored = false
  act(
    'could not save the persona',
    async () => {
      // RE-STAMPED with whoever `loaded` is by the time this actually sends.
      //
      // Saves overlap -- two fields edited quickly is the ordinary way somebody
      // fills in a form -- and the built-in's first save RENAMES her. A
      // candidate built before that landed carried the now-obsolete built-in
      // id, and main refused it: the second edit was simply lost, and only when
      // the first happened to be the fork.
      //
      // The id is the only part that can go stale this way. Everything else in
      // the candidate came from `loaded` at commit time, which is exactly the
      // value the user was looking at.
      const sending =
        loaded !== null && loaded.id !== candidate.id ? { ...candidate, id: loaded.id } : candidate
      const problems = await window.mochiSettings.savePersona(sending)
      if (problems.length > 0) {
        showProblems(problems)
        return
      }
      stored = true
      // A FORK renames her under us. Editing the built-in cannot change her --
      // her id is reserved -- so main writes a copy, broadcasts it, and that
      // broadcast has landed by the time this line runs. Taking the candidate
      // regardless left this window editing an id main would refuse from the
      // very next save onward: saving once broke saving again.
      const settled = current?.persona
      if (settled !== undefined && settled.id !== sending.id) {
        // The held drafts and refusals move WITH her.
        //
        // Everything in `held` and in the form's drafts is keyed by persona id,
        // and the id just changed under them. Left behind, a half-edited field
        // simply vanishes from the pane -- change the built-in's colour while
        // her greeting is mid-sentence and the greeting disappears -- and the
        // orphaned entries stay in the map under an id nothing will ask for
        // again.
        adoptPersonaId(sending.id, settled.id)
        loaded = settled
        // REPAINTED, because the broadcast that carried `settled` was rendered
        // while this save was still in flight and therefore drew the OLD
        // optimistic persona. Without this the pane goes on calling the
        // built-in active, and every control it holds is still scoped to an id
        // main has already replaced -- so the next edit is filed against a
        // persona that no longer exists.
        repaintNow()
      }
    },
    () => {
      savesInFlight -= 1
      // BOTH ways this can end with nothing written: main refusing the value,
      // and the call itself giving way -- the channel torn down mid-save, main
      // gone. Only the first was undone, so an IPC rejection left this window
      // believing a persona that had never reached disk, and the next field's
      // save then carried it.
      //
      // Reference equality, not a value comparison: if anything has moved on
      // since -- a broadcast, or a later commit -- that is newer than this
      // baseline, and putting an older one back over it would be the worse
      // half of the same mistake. The BOX keeps what was typed either way,
      // beside the sentence saying it did not save.
      if (!stored) {
        // The REVERT is conditional and the REPAINT is not.
        //
        // Reference equality guards the revert for a good reason: if anything
        // has moved on since -- a broadcast, a later commit -- that is newer
        // than this baseline and putting an older value back over it would be
        // the worse half of the same mistake.
        //
        // The repaint had no business being inside that guard. A box remembers
        // what it last sent, so without a rebuild a failed save leaves the
        // control believing its value is stored: blurring it again sends
        // nothing, and the user has to change the text and change it back
        // before the app will retry. Rebuilding resets that memory while the
        // draft keeps what they typed.
        if (loaded === candidate) loaded = before
        repaintNow()
      }
    },
  )

  // A pronoun change rewords the whole sheet, so the whole sheet is repainted.
  // Bound to a local first: `current` is module state, so a closure over it
  // loses the null check.
  const showing = current
  if (candidate.pronoun !== before.pronoun && showing !== null) {
    preservingFocus(() => paint(showing))
  }
}

/** The snapshot on screen. Needed by anything that repaints outside `paint`. */
let current: SettingsSnapshot | null = null

let problemList: HTMLUListElement | null = null

/**
 * The strings and the pronoun, from whatever the window currently believes.
 *
 * `paint` used to build this inline, which left `showProblems` -- called from
 * four save handlers, outside any render -- with no way to reach it. One
 * function, so a problem message and the pane around it cannot disagree about
 * which pronoun is in force.
 */
/**
 * The translations and the pronoun, for one persona.
 *
 * Built here and nowhere else. The render had its own copy of these four
 * fields, so a fifth added to `Copy` -- or a change to how the pronoun is
 * chosen -- would apply to the pane and not to the sentences `act` reports, or
 * the reverse. The two are the same question asked at different moments.
 */
function copyFor(pronoun: Persona['pronoun']): Copy {
  return {
    t: messagesFor(locale).settings,
    locale,
    pronoun,
    say: (table) => forPronoun(table, pronoun),
  }
}

/** The same answer for callers outside a render, from whoever is loaded. */
function copyNow(): Copy {
  return copyFor(loaded?.pronoun ?? 'she')
}

/**
 * Run one settings action, and never let its failure disappear.
 *
 * Every action in this window was its own `void (async () => { try … catch })()`
 * and they had already drifted apart: a failed theme save listed a problem, a
 * failed size save only wrote to the console, and the user saw nothing at all
 * for one of the two. An IPC call can reject for reasons that have nothing to
 * do with the value -- main gone, the channel torn down mid-save -- and a
 * settings form that looks identical after a failure as after a success is the
 * one outcome it must never have.
 *
 * `then` after `catch` deliberately: `after` runs whether or not the action
 * threw, like a `finally`, but the caller writes it once at the call site.
 */
let actions = 0

function act(
  what: string,
  run: () => Promise<readonly SaveProblem[] | void>,
  after?: () => void,
): void {
  // ORDERED. Every action reports through here, and only the NEWEST one may.
  //
  // Actions share one problem list and finish in whatever order their IPC
  // happens to complete, so a slow success -- revealing a package, say --
  // landed after a later failure and erased it with an empty list. The user
  // pressed something, it failed, and the sentence explaining why vanished on
  // its own a moment later.
  const mine = (actions += 1)
  void (async () => {
    try {
      const problems = await run()
      if (problems !== undefined && mine === actions) showProblems(problems)
    } catch (error: unknown) {
      console.error(`[settings] ${what}:`, error)
      // A FAILURE is reported even when it is not the newest, because silence
      // here is the outcome this wrapper exists to prevent -- and it replaces
      // whatever a newer action has said only if that action has not spoken.
      if (mine === actions) showProblems([{ kind: 'save-failed' }])
    } finally {
      // `after` IS GUARDED TOO. It was chained after the catch, so a throw in
      // it -- and it repaints, which can throw -- became an unhandled rejection
      // with nothing on screen: the action looked as though it had worked. The
      // whole reason this wrapper exists is that a form must never look
      // identical after a failure and after a success.
      try {
        after?.()
      } catch (error: unknown) {
        console.error(`[settings] ${what} (while finishing):`, error)
        showProblems([{ kind: 'save-failed' }])
      }
    }
  })()
}

function showProblems(problems: readonly SaveProblem[]): void {
  if (problemList === null) return
  const copy = copyNow()
  problemList.replaceChildren(
    ...problems.map((problem) =>
      el('li', {}, [document.createTextNode(describeProblem(problem, copy))]),
    ),
  )
}

/**
 * Which of the six groups is open.
 *
 * Module state, and deliberately not persisted: a settings window reopening on
 * the group you were last in is a nice touch that also hides the other five
 * from somebody who came looking for one of them. It resets to Voice, which is
 * the group that has the most in it.
 */
type Pane = PaneKey
let pane: Pane = 'personas'

/**
 * One icon per group.
 *
 * Beside the label, never instead of it. An icon-only nav asks the reader to
 * learn a legend before they can find anything, and "what is kept" has no
 * glyph anybody would guess. These are a scanning aid for a list you already
 * read once.
 */
const PANE_ICON: Readonly<Record<Pane, IconNode>> = {
  personas: Users,
  kept: Archive,
  // The credential, because it is the one thing in that pane without which
  // nothing else in it matters -- and the section it names sits first.
  setup: KeyRound,
  about: Info,
}

/**
 * What the appearance controls need from the window.
 *
 * `adoptTheme` keeps this window's copy in step once main has ACCEPTED a
 * colour: main holds the new theme, and a field committed before the read-back
 * lands would carry the old one and quietly put her back.
 */
const screenDeps = {
  act,
  showProblems,
  /**
   * Take a fresh snapshot after a theme change, in an order we control.
   *
   * Main does not broadcast to this window on that path, deliberately: a
   * snapshot arriving before the reply would carry the persona the fork has
   * just moved us off. Asking for it afterwards cannot race a reply already in
   * hand.
   */
  refreshFromMain: async (): Promise<void> => {
    const next = readSnapshot(await window.mochiSettings.read())
    if (!next.ok) {
      // THROWN, not logged and resolved. This runs inside `act`, and returning
      // quietly told it the whole action had succeeded -- so a theme change or
      // a restore could persist correctly and leave the window showing the old
      // state, with nothing anywhere saying the second half had not happened.
      throw new Error(`the refreshed settings could not be read: ${next.problems.join('; ')}`)
    }
    changedBeyondSize(next.snapshot)
    applyBroadcast(next.snapshot)
  },
  adoptTheme: (theme: ThemeId, personaId: string): void => {
    // Main holds the new colour NOW, and `refreshFromMain` has not run yet. A
    // field committed in between would build its candidate from here and put
    // the previous colour back -- so the window's copy moves with main's
    // answer rather than waiting for the read that follows it.
    //
    // The ID comes with it: picking a colour for the BUILT-IN forks her.
    if (loaded !== null) loaded = { ...loaded, theme, id: personaId }
  },
}

/**
 * Drop what is being typed against this character, because somebody asked.
 *
 * Every other path PRESERVES uncommitted text -- that is what the hold in
 * `form.ts` is for, so a broadcast does not wipe a half-typed greeting.
 * Restoring the built-in is the one action whose entire meaning is "discard my
 * changes", so preserving it through that contradicts the button.
 *
 * The held REFUSALS go too. A note saying why a box will not save is about
 * text that no longer exists once the box is refilled from her original.
 */
/**
 * Carry everything keyed by one persona id across to another.
 *
 * Called when a save FORKS her: main refuses to change the built-in, so it
 * writes a copy under a fresh id and this window has to follow. Both stores are
 * keyed by id -- the form's drafts and this file's refusals -- so without this
 * a half-typed field and the sentence explaining why it will not save both
 * disappear at the moment the fork lands, and the entries linger under an id
 * nothing asks for again.
 */
function adoptPersonaId(from: string, to: string): void {
  moveDrafts(PERSONA_PATHS.map((path) => [holdKey(from, path), holdKey(to, path)] as const))
  for (const path of PERSONA_PATHS) {
    const problem = held.get(holdKey(from, path))
    if (problem === undefined) continue
    held.delete(holdKey(from, path))
    held.set(holdKey(to, path), problem)
  }
}

/**
 * Discard one machine-scoped draft.
 *
 * The persona-scoped ones go through `forgetDraft`, which clears a whole
 * character's worth by id. The spoken rules belong to the MACHINE, so there is
 * no character to scope them by and the hold key is the whole address.
 */
function forgetHold(hold: string): void {
  forgetDrafts([hold])
}

function forgetDraft(personaId: string): void {
  // The id is PASSED, not read from `loaded`.
  //
  // Restoring the built-in is offered while another persona is worn, and the
  // await in that handler is long enough for the worn persona to change under
  // it. Reading `loaded` here therefore discarded whoever happened to be
  // current -- somebody's half-typed greeting, thrown away by a button that
  // says it discards the BUILT-IN's changes, while the built-in's own drafts
  // survived to be resumed on the next repaint.
  forgetDrafts(holdsFor(personaId))
  for (const path of PERSONA_PATHS) held.delete(holdKey(personaId, path))
}

/**
 * A titled block inside a pane.
 *
 * The four machine panes each used to be a pane with a title; merged, each is
 * a section with a heading. Written here rather than four times inside the
 * panes so the heading and the block cannot drift apart -- and so a pane
 * module stays a pane module, with no opinion about what it is nested in.
 */
function section(title: string, body: HTMLElement): HTMLElement {
  return el('section', { class: 'section' }, [
    el('h2', { class: 'section-title' }, [document.createTextNode(title)]),
    body,
  ])
}

/**
 * Which destructive action in the kept pane is waiting for a second press.
 *
 * Module state rather than per-render, for the same reason `panes/personas.ts`
 * keeps its own: a repaint caused by something else must not silently arm or
 * disarm a delete.
 */
/**
 * The Kept pane's armed delete, through the SAME machine the personas pane uses.
 *
 * It was a second implementation of `createConfirmation` with different method
 * names -- `is`/`arm`/`disarm` against `isArmed`/`arm`/`cancel` -- and it was
 * missing that module's behaviours: nothing here cancelled on Escape until the
 * handler was taught about it separately, and there was no "arming one disarms
 * the other". Two state machines for one question is how the two panes came to
 * answer Escape differently on the two buttons that erase every conversation on
 * the machine.
 *
 * Kept as an adapter rather than changing the pane's parameter type, because
 * the names are the pane's vocabulary and this is one file's translation of it.
 */
const keptAsk = createConfirmation()
const keptArming = {
  is: (what: string): boolean => keptAsk.isArmed(what),
  arm: (what: string): void => {
    keptAsk.arm(what)
  },
  disarm: (): void => {
    keptAsk.cancel()
  },
}
function paneBody(which: Pane, copy: Copy, snapshot: SettingsSnapshot): readonly HTMLElement[] {
  const { t } = copy
  const person = loaded ?? snapshot.persona
  switch (which) {
    case 'personas':
      // EVERYTHING that belongs to a character, in one sheet: who she could
      // be, who she is, what colour, what voice, and what she says at the two
      // moments the app chooses. They were spread across three groups, and
      // the test for which group a setting belonged to was the same question
      // this whole feature turns on -- would two characters disagree about
      // it? Three answers to one question is two too many.
      return [
        personasPane(
          copy,
          snapshot,
          // The WORN character as this window holds her, so the shelf and the
          // name box cannot disagree. Main does not broadcast on an ordinary
          // save, so `snapshot.personas` still carries the name she had when
          // the window opened -- and with Save gone, a rename lands the moment
          // the box is left, two rows below a shelf still showing the old one.
          person,
          // `refreshFromMain` is shared with the colour picker on purpose:
          // both act on a path where main deliberately does not broadcast to
          // this window, so both have to read back themselves.
          {
            act,
            showProblems,
            forgetDraft,
            forgetHold,
            refreshFromMain: screenDeps.refreshFromMain,
          },
          () => {
            repaintNow()
            // AFTER the rebuild. `paint` replaces the whole form, so the button
            // that was just clicked is gone -- without this a keyboard user is
            // dropped onto the body at the exact moment they most need the way
            // out.
            focusCancel()
          },
        ),
        identitySection(copy, person, commit),
        // Her colour, moved out of "On screen". It is a `Persona` field and it
        // sat beside `sizePercent`, which is this display's -- so the one pane
        // in the window held both halves of the split everything else obeys.
        colourPicker(copy, person, snapshot, screenDeps),
        voiceSection(copy, person, commit),
        el('section', { class: 'section' }, [
          ...momentFields(copy, person, 'greeting', t.greeting, commit),
        ]),
        el('section', { class: 'section' }, [
          ...momentFields(copy, person, 'farewell', t.farewell, commit),
        ]),
      ]
    case 'setup': {
      // Built by WALKING `SETUP_SECTIONS` rather than by listing four calls
      // here. The order is a decision -- sorted by what blocks what, so the
      // credential comes first and the two you keep coming back to sit last --
      // and a literal here plus a table over there are two orders that agree
      // only until somebody edits one of them.
      const build: Readonly<Record<SetupSection, () => HTMLElement>> = {
        auth: () => authPane(copy, snapshot, { act, showProblems }),
        delegation: () => delegationSection(copy, snapshot, { act, showProblems }),
        sound: () => soundSection(copy, snapshot, { act, showProblems }),
        presence: () => presenceSection(copy, snapshot, { act, showProblems }),
        shortcuts: () => shortcutsPane(copy, snapshot, { act, showProblems }),
        screen: () => appearanceSection(copy, snapshot, screenDeps),
      }
      return SETUP_SECTIONS.map((key) => section(t.sections[key], build[key]()))
    }
    case 'kept':
      return keptPane(copy, snapshot, { act, showProblems }, keptArming, repaintNow)
    case 'about':
      return [aboutPane(t, snapshot, act)]
  }
}

/**
 * The group list.
 *
 * Buttons rather than links: this navigates nothing, it swaps a pane, and a
 * link that does not navigate is a promise to the keyboard that the app cannot
 * keep.
 *
 * There is no "unsaved here" dot any more, and there is nothing for one to
 * mark: every control in this window stores when you leave it. A dot
 * that could never appear is worse than no dot -- it teaches the reader that
 * its absence means something.
 */
function navigation(copy: Copy, snapshot: SettingsSnapshot): HTMLElement {
  // TWO groups, each with a heading. The division is the question this whole
  // feature turns on -- would two characters have to disagree about it? --
  // made visible, so somebody hunting for a setting knows which half to read
  // before they start. Her colour is hers; her size is this screen's.
  const { t } = copy
  const groups = PANE_GROUPS.flatMap((group) => [
    // A heading, not a button. It navigates nowhere and must not be reachable
    // by tab: a stop that does nothing is a promise to the keyboard the window
    // cannot keep, and it is the same reason the items below are buttons
    // rather than links.
    el('li', { class: 'nav-group' }, [
      document.createTextNode(label(t.paneGroups[group.key], copy.pronoun)),
    ]),
    ...group.panes.map((which) => el('li', {}, [navItem(which, copy, snapshot)])),
  ])
  return el('nav', { class: 'nav', 'aria-label': t.title, 'data-scroll-key': 'nav' }, [
    el('ul', { class: 'nav-list' }, groups),
  ])
}

function navItem(which: Pane, copy: Copy, snapshot: SettingsSnapshot): HTMLElement {
  const item = el('button', { class: 'nav-item', type: 'button' }, [
    icon(PANE_ICON[which]),
    document.createTextNode(label(copy.t.panes[which], copy.pronoun)),
  ])
  if (which === pane) item.setAttribute('aria-current', 'page')
  item.addEventListener('click', () => {
    if (which === pane) return
    // An armed "Delete for good?" is a question about a click that just
    // happened. Walking away from the group answers it with no -- for the
    // shelf's confirmations and the kept pane's alike.
    resetConfirmation()
    keptArming.disarm()
    pane = which
    // `paint`, never `adopt`: switching group rebuilds the sheet, and the
    // boxes are refilled from their holds, so uncommitted text survives the
    // move. Re-adopting the snapshot would put main's copy back over it.
    paint(snapshot)
  })
  return item
}

/**
 * Repaint from whatever is on screen NOW, not from a captured snapshot.
 *
 * Every pane is built with the snapshot it was rendered from, and a callback
 * that closes over it repaints that one -- however long it waited. Main
 * broadcasts a fresh snapshot before replying to several actions, so the
 * sequence was: main writes, main broadcasts, this window paints the new
 * state, the action's own callback resolves and paints the OLD one over it.
 * The change was on screen and then gone, with nothing to say why.
 *
 * `current` is the snapshot last painted, so this always repaints the newest.
 */
function repaintNow(): void {
  if (current !== null) paint(current)
}

function paint(snapshot: SettingsSnapshot): void {
  // What this window believes, in preference to the snapshot it is drawing.
  // An ordinary persona save is not broadcast, so `loaded` is ahead of
  // `snapshot.persona` between a commit and the next thing main announces.
  const person = loaded ?? snapshot.persona
  current = snapshot
  // HERE, not in `boot`. Her colour is the interface's colour, and applying it
  // once at startup meant picking a new one recoloured HER and left this window
  // -- the one whose whole argument is that it takes its accent from her -- on
  // the previous character's palette until it was closed and reopened. The
  // snapshot rebuild was already happening; only these five custom properties
  // were left behind, so every button, focus ring and wash stayed stale while
  // the form around them redrew correctly.
  //
  // In `paint` rather than in `adopt` so that drawing the window without the
  // accent it belongs to is not expressible: one function builds the DOM, and
  // it is this one.
  for (const [name, value] of Object.entries(accentVariables(snapshot.face))) {
    document.documentElement.style.setProperty(name, value)
  }
  problemList = el('ul', { class: 'problems' })
  const copy = copyFor(person.pronoun)
  const { t } = copy

  root.replaceChildren(
    el('div', { class: 'shell' }, [
      navigation(copy, snapshot),
      el('div', { class: 'pane', 'data-scroll-key': 'pane' }, [
        el('header', { class: 'pane-head' }, [
          el('h1', { class: 'pane-title' }, [
            document.createTextNode(label(t.panes[pane], person.pronoun)),
          ]),
          el('p', { class: 'pane-about' }, [
            document.createTextNode(
              pane === 'about' ? t.paneAbout.about : copy.say(t.paneAbout[pane]),
            ),
          ]),
        ]),
        // ABOVE the pane, on every pane, and not in the save-problem list.
        // These are facts about startup rather than the outcome of something
        // you just pressed: they must not be cleared by the next save, and
        // they must not be hidden behind whichever group happens to be open.
        ...(snapshot.personaProblems.length === 0
          ? []
          : [
              el(
                'ul',
                { class: 'problems' },
                snapshot.personaProblems.map((problem) =>
                  el('li', {}, [document.createTextNode(describeLoadProblem(problem, copy))]),
                ),
              ),
            ]),
        ...paneBody(pane, copy, snapshot),
        // ALWAYS mounted, on every pane. It used to be built inside the
        // Save/Revert footer, which existed on one pane only -- so on Auth,
        // Shortcuts and Colour, `showProblems` wrote into a detached `<ul>`
        // left over from a previous render, or into nothing at all. A key that
        // failed to store, a shortcut that would not bind and a theme that
        // would not save each reported the failure to an element no longer in
        // the document, and the window looked exactly as it does on success.
        //
        // This is where a refused ACTION reports. A field that will not commit
        // says so beside itself instead -- see `fieldProblem`.
        problemList,
      ]),
    ]),
  )
  root.setAttribute('aria-busy', 'false')
  // AFTER the DOM exists, and for every held field rather than only the one
  // just touched. `replaceChildren` threw away the notes along with the boxes,
  // so a repaint caused by anything else -- a tray colour change, a key stored
  // in another group -- left an input still refusing to save with nothing on
  // screen saying why.
  refreshFieldProblems(person, copy)
}

/**
 * Put back every "this will not save" note that still applies.
 *
 * Walks the KNOWN fields rather than the held map, so a hold left behind by a
 * character who is no longer worn cannot paint a note onto somebody else's
 * sheet -- and so a field that has since become legal is actively cleared
 * rather than merely not re-added.
 */
function refreshFieldProblems(person: Persona, copy: Copy): void {
  for (const path of PERSONA_PATHS) {
    const problem = held.get(holdKey(person.id, path))
    fieldProblem(
      PERSONA_CONTROLS[path],
      problem === undefined ? null : describeProblem(problem, copy),
    )
  }
}

/** Take a snapshot as the truth, and draw it. One paint, one place. */
function adopt(snapshot: SettingsSnapshot): void {
  // EXCEPT while a save is in flight. Main's copy is then older than this
  // window's by exactly the field being written, and adopting it would show
  // the previous value back in the box for as long as the round trip takes.
  // The one broadcast that must win is a FORK, and `commit` takes that from
  // the reply rather than from here -- so the two cannot arrive in the wrong
  // order.
  if (savesInFlight === 0) loaded = snapshot.persona
  locale = snapshot.locale
  document.title = messagesFor(locale).settings.title
  paint(snapshot)
}

/**
 * Take a broadcast, keeping the reader where they were.
 *
 * The subscription used to answer a half-edited form with `return`, dropping
 * the whole snapshot: with one character typed into her name, storing an API
 * key changed nothing on screen, a rebound shortcut did not appear, and a
 * theme picked from the tray never arrived. Nothing is dropped now. Text
 * somebody is still typing survives because it is held by the BOX (see
 * `commitOnLeaving`), filed under the character it belongs to -- so a snapshot
 * can be adopted whole without anything being lost to it.
 */
function applyBroadcast(snapshot: SettingsSnapshot): void {
  preservingFocus(() => adopt(snapshot))
}

/**
 * Say what went wrong, in the window.
 *
 * A settings window has exactly one catastrophic failure mode and it is being
 * BLANK: the user cannot tell a broken build from a lost configuration from an
 * app that never opened, and the error is in a devtools console nobody has
 * open. Anything visible beats that, including an ugly English string -- this
 * is the one place a hardcoded message is right, because the i18n table itself
 * may be what failed to load.
 */
function fail(what: string, error: unknown): void {
  console.error(`[settings] ${what}:`, error)
  root.setAttribute('aria-busy', 'false')
  root.replaceChildren(
    el('section', { class: 'section' }, [
      el('h2', { class: 'section-title' }, [document.createTextNode('Settings failed to load')]),
      el('p', {}, [document.createTextNode(`${what}: ${String(error)}`)]),
    ]),
  )
}

/** The last snapshot rendered, as a signature. See `redraw.ts`. */
let rendered: string | null = null

function changedBeyondSize(next: SettingsSnapshot): boolean {
  const signature = nextSignature(rendered, next)
  if (signature === null) return false
  rendered = signature
  return true
}

function boot(value: unknown): void {
  const read = readSnapshot(value)
  if (!read.ok) {
    // Every problem, named. This used to report only that the snapshot was
    // unreadable and dump the JSON, so the reader diffed two objects by eye to
    // find the one bad field.
    fail(
      'main sent a settings snapshot this window cannot read (restart `pnpm dev` if the main process is older than the renderer)',
      read.problems.join('; '),
    )
    return
  }
  // The NORMALISED snapshot, not the raw value. The parsers fill in fields that
  // are allowed to be absent -- a persona written before themes existed has no
  // `theme` -- and rendering the original meant reading `undefined` from a
  // field the type says is a `ThemeId`.
  const snapshot = read.snapshot
  try {
    // The accent is applied inside `paint`, so the first frame carries it too
    // and no frame is ever shown in the fallback green.
    adopt(snapshot)
    // AFTER the render, not before it. `changedBeyondSize` records the
    // signature as "what is on screen", and recording it first meant a render
    // that threw left the window showing the previous snapshot while claiming
    // to show this one -- so an identical snapshot arriving later was
    // discarded as a no-op and the failure became permanent.
    changedBeyondSize(snapshot)
  } catch (error: unknown) {
    fail('could not render the settings form', error)
  }
}

/**
 * Escape means no.
 *
 * The third way out of an armed delete, after Cancel and leaving the group.
 * Registered once on the document rather than per button, because the question
 * belongs to the window's state and not to whichever control happens to have
 * focus -- somebody who has clicked away still expects Escape to dismiss it.
 */
document.addEventListener('keydown', (event) => {
  // BOTH panes arm destructive actions, and Escape means no to either.
  //
  // This asked only the personas pane. A "Delete for good?" armed in the Kept
  // pane stayed armed through an Escape that visibly dismissed nothing --
  // against the general contract this handler is written under, and on the two
  // buttons that erase every conversation on the machine.
  //
  // Still conditional: an unconditional handler would swallow the Escape the
  // chord recorder in the Shortcuts group is waiting for.
  const armed = isConfirming() || keptAsk.pending !== null
  if (event.key !== 'Escape' || !armed) return
  event.preventDefault()
  resetConfirmation()
  keptArming.disarm()
  const showing = current
  if (showing !== null) preservingFocus(() => paint(showing))
})

void (async () => {
  // SUBSCRIBED before the first read, and the two are ordered by a flag rather
  // than by hope. Reading first left a window between the reply and the
  // subscription in which a change from main reached nobody -- the form then
  // showed a persona that was already stale, indefinitely, because nothing
  // sends a second notification for an update already broadcast.
  //
  // Anything arriving before the read completes is held rather than applied:
  // it is NEWER than the read in flight, so letting the read's older answer
  // land on top of it would reintroduce the same staleness from the other
  // direction.
  let booted = false
  let pending: unknown = null

  // Main can change things underneath this window, and MOST of those changes
  // must not rebuild the form. Dragging the size slider makes main broadcast a
  // new snapshot; re-running `boot()` on it replaced the DOM mid-drag --
  // destroying the very control under the pointer and discarding any unsaved
  // persona edits with it.
  //
  // So a notification only rebuilds when the persona itself changed AND there
  // is nothing to lose. Everything else is reconciled in place.
  window.mochiSettings.onChanged((next) => {
    const checked = readSnapshot(next)
    if (!checked.ok) {
      // SAID, not swallowed. A dropped notification leaves the window showing
      // stale settings indefinitely -- nothing re-broadcasts -- and the user's
      // experience is a save that did nothing. Dropping it is still right;
      // doing it silently is what left no way to find out.
      console.error(`[settings] ignored an unreadable update: ${checked.problems.join('; ')}`)
      return
    }
    const snapshot = checked.snapshot
    if (!booted) {
      pending = snapshot
      return
    }
    // Rebuild when ANYTHING but her size changed.
    //
    // This used to compare only the persona, which meant a broadcast caused by
    // storing or removing an API key changed nothing on screen: the key was
    // written and deleted correctly, and the pane went on showing the previous
    // state, so Remove looked like it had done nothing at all.
    //
    // `sizePercent` is the one field excluded, and the exclusion is the whole
    // reason this guard exists: the slider is live, so main broadcasts once per
    // animation frame while somebody drags, and rebuilding on those destroys
    // the control under the pointer.
    if (!changedBeyondSize(snapshot)) {
      // RECONCILED, not discarded. `current` is what navigation repaints from,
      // so a size-only broadcast that changed nothing here left it holding the
      // value from before the drag -- and moving to another group and back
      // showed the slider snapped to the old size, while main had kept the new
      // one. The number is copied in WITHOUT repainting, which is what keeps
      // the control under the pointer intact.
      if (current !== null) current = { ...current, sizePercent: snapshot.sizePercent }
      return
    }
    applyBroadcast(snapshot)
  })

  let first: unknown
  try {
    first = await window.mochiSettings.read()
  } catch (error: unknown) {
    fail('could not reach the main process', error)
    return
  }
  booted = true
  boot(pending ?? first)
})()
