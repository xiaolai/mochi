/**
 * The shelf: everyone she could be, and which one is worn.
 *
 * ## Choosing is wearing
 *
 * There is exactly one notion of "which persona" in this app, and selecting a
 * row here moves it. Editing a character you are not wearing was the obvious
 * alternative and was rejected: it needs a second identity in main, alongside
 * the active one, and every defect this feature has had came from two surfaces
 * disagreeing about which persona was current. A design that makes that
 * disagreement legitimate would make those defects unreachable by any test.
 *
 * The cost is real and is stated in the pane rather than hidden: selecting
 * another persona ends a conversation in progress, because a switch is a
 * session boundary. Asleep it costs a repaint.
 *
 * ## Delete asks twice, in place
 *
 * A persona is prose somebody wrote and there is no undo. The second click is
 * the confirmation -- a modal would be the other way to do it, and it would be
 * the only modal in this window.
 */

import type { SaveProblem, SettingsSnapshot } from '@shared/ipc'
import { button, el, field, textArea } from '../form'
import type { Copy } from '../copy'
import { BUILT_IN_ID, type Persona } from '@shared/persona'
import { createConfirmation } from '../confirm'

export interface PersonaDeps {
  /** Runs an action and never lets its failure disappear. See `act` in main. */
  readonly act: (
    what: string,
    run: () => Promise<readonly SaveProblem[] | void>,
    after?: () => void,
  ) => void
  readonly showProblems: (problems: readonly SaveProblem[]) => void
  /**
   * Throw away what is being typed, because the user asked for exactly that.
   *
   * Every other path PRESERVES uncommitted text -- that is what the boxes hold
   * it for, so a stored API key arriving does not wipe a half-typed greeting.
   * Restoring is the one action whose entire meaning is "discard my changes",
   * so preserving it through this contradicts the button.
   */
  /** Discard one persona's unsaved edits. Named, never "the current one". */
  readonly forgetDraft: (personaId: string) => void
  /** Discard one machine-scoped draft, by its hold key. */
  readonly forgetHold: (hold: string) => void
  /** Re-read the snapshot, once the draft has been dealt with. */
  readonly refreshFromMain: () => Promise<void>
}

/**
 * Which row is asking to be confirmed.
 *
 * Module state rather than per-render, so a repaint caused by something else
 * does not silently arm or disarm a delete. The state machine itself lives in
 * `../confirm`, where a test can reach it -- this file builds DOM.
 */
const ask = createConfirmation()

export function resetConfirmation(): void {
  ask.cancel()
}

/** Whether a delete is waiting to be confirmed. Escape answers it with no. */
export function isConfirming(): boolean {
  return ask.pending !== null
}

/**
 * The id of the Cancel button for a row.
 *
 * Named so the pane can put focus on it after arming. `paint` rebuilds the
 * whole form, so the button that was just clicked no longer exists -- and
 * leaving focus on the body would drop a keyboard user out of the list
 * entirely, at the exact moment they most need a way out.
 */
export function cancelId(personaId: string): string {
  return `persona-cancel-${personaId}`
}

/** Put focus on Cancel, if a row is armed. Called after the repaint. */
export function focusCancel(): void {
  const pending = ask.pending
  if (pending === null) return
  // The SAFE one, deliberately. The destructive button is where focus would
  // naturally have been -- it is what was clicked -- and Enter pressed twice
  // in a row is a thing people do.
  document.getElementById(cancelId(pending))?.focus()
}

export function personasPane(
  copy: Copy,
  snapshot: SettingsSnapshot,
  /**
   * The worn character as the WINDOW holds her, which is ahead of the snapshot.
   *
   * Main does not broadcast on an ordinary persona save, so `snapshot.personas`
   * still carries the name she had when this window opened. With no Save button
   * a rename lands the moment the box is left -- two rows below a
   * shelf that would otherwise go on showing the old one until the window was
   * closed and reopened.
   */
  person: Persona,
  deps: PersonaDeps,
  repaint: () => void,
): HTMLElement {
  const { t, say } = copy
  const rows = snapshot.personas.map((one) =>
    row(
      one.id === person.id ? { id: one.id, name: person.name } : one,
      person.id,
      copy,
      deps,
      repaint,
      snapshot.builtInEdited,
    ),
  )

  /**
   * The rules every persona is given, shown here because this is the pane about
   * who she is -- and hidden nowhere else, which was the problem.
   *
   * They live at MACHINE level rather than on a persona, and that follows from
   * why they exist at all: `persona.ts` holds them apart from `style` precisely
   * because they must reach every character. Putting them on one would recreate
   * the bug that split them out, where the second persona silently lost them.
   */
  const stored = snapshot.spokenRules.stored
  const rules: HTMLElement[] = [
    field(
      'spoken-rules',
      t.spokenRules,
      textArea('spoken-rules', stored ?? '', snapshot.spokenRules.builtIn, (next) => {
        deps.act('could not change the rules every persona is given', async () => {
          deps.showProblems(await window.mochiSettings.saveSpokenRules(next))
        })
      }),
      say(t.spokenRulesHint),
    ),
  ]
  if (stored !== null) {
    rules.push(
      el('div', { class: 'actions' }, [
        button(t.useDefault, () => {
          deps.act('could not put the rules back', async () => {
            // Empty means the built-in, which is also what clearing the box does.
            const problems = await window.mochiSettings.saveSpokenRules('')
            if (problems.length > 0) return problems
            // The DRAFT goes too, and that is the whole button.
            //
            // A draft outlives a repaint on purpose, so resetting stored the
            // built-in and the next paint resumed whatever was still in the
            // box -- the default appeared not to take effect, and the old text
            // was resubmitted on the next blur. "Put it back" is the one
            // action whose entire meaning is "discard what I typed".
            deps.forgetHold('spoken-rules')
            return problems
          })
        }),
      ]),
    )
  }

  return el('section', { class: 'section' }, [
    el('p', { class: 'hint' }, [document.createTextNode(say(t.personaHowEditing))]),
    el('ul', { class: 'personas' }, rows),
    el('div', { class: 'actions' }, [addButton(t, deps), revealButton(t, deps)]),
    ...rules,
  ])
}

function row(
  one: { readonly id: string; readonly name: string },
  activeId: string,
  { t }: Copy,
  deps: PersonaDeps,
  repaint: () => void,
  builtInEdited: boolean,
): HTMLElement {
  const worn = one.id === activeId
  // The built-in has no file, so there is nothing to delete. That is the same
  // fact `sources` expresses in main -- she is a constant, not a record.
  // Compared against the SHARED id: a literal here would be a second place
  // that has to change if she is ever renamed, and the one that would not.
  const builtIn = one.id === BUILT_IN_ID

  const label = el('span', { class: 'persona-name' }, [document.createTextNode(one.name)])
  const badge = worn
    ? el('span', { class: 'persona-badge' }, [document.createTextNode(t.personaActive)])
    : builtIn
      ? el('span', { class: 'persona-badge persona-badge-quiet' }, [
          document.createTextNode(t.personaBuiltIn),
        ])
      : null

  const controls: HTMLElement[] = []
  if (!worn) {
    const wear = el('button', { class: 'button', type: 'button' }, [
      document.createTextNode(t.personaWear),
    ])
    wear.addEventListener('click', () => {
      deps.act('could not wear that persona', async () => {
        deps.showProblems(await window.mochiSettings.switchPersona(one.id))
      })
    })
    controls.push(wear)
  }
  if (!builtIn) {
    const armed = ask.isArmed(one.id)
    if (armed) {
      // CANCEL FIRST, and it is the one that gets focus.
      //
      // The armed state used to offer nothing but the destructive button, so
      // somebody who clicked Delete by mistake had exactly two ways out:
      // click the thing again -- which deletes -- or work out that leaving the
      // group disarms it. An undoable action can afford that; a persona is
      // prose somebody wrote and there is no undo.
      //
      // Cancel is also FIRST in the DOM, so tabbing forward from the row
      // reaches the safe one before the destructive one.
      const cancel = el('button', { class: 'button', type: 'button', id: cancelId(one.id) }, [
        document.createTextNode(t.personaDeleteCancel),
      ])
      cancel.addEventListener('click', () => {
        ask.cancel()
        repaint()
      })

      const confirm = el('button', { class: 'button button-danger', type: 'button' }, [
        document.createTextNode(t.personaDeleteConfirm),
      ])
      confirm.addEventListener('click', () => {
        // The id the QUESTION was about, not the one this closure captured. A
        // repaint between the two can move what the pane thinks this row is.
        const answered = ask.confirm()
        if (answered === null) return
        deps.act('could not delete that persona', async () => {
          deps.showProblems(await window.mochiSettings.deletePersona(answered))
        })
      })
      controls.push(cancel, confirm)
    } else {
      const remove = el('button', { class: 'button', type: 'button' }, [
        document.createTextNode(t.personaDelete),
      ])
      remove.addEventListener('click', () => {
        // ARMED, not deleted. The second click is the confirmation -- a modal
        // here would be the only one in this window.
        ask.arm(one.id)
        repaint()
      })
      controls.push(remove)
    }
  } else if (builtInEdited) {
    // Offered only when there IS something to undo, and only on her row --
    // every other persona's original is a file the user still has.
    //
    // Not armed like Delete. Restoring discards wording somebody typed, which
    // is a loss, but her transcripts and her notes are untouched and the edit
    // can simply be typed again; a two-step confirm on a reversible action is
    // what teaches people to click through the one on the irreversible one.
    const restore = el('button', { class: 'button', type: 'button' }, [
      document.createTextNode(t.personaRestore),
    ])
    restore.addEventListener('click', () => {
      deps.act('could not restore the built-in', async () => {
        const problems = await window.mochiSettings.restoreBuiltIn()
        deps.showProblems(problems)
        if (problems.length > 0) return
        // FORGET, then read. Main deliberately does not broadcast to this
        // window, so this order is ours to choose -- and it is the only order
        // that works: refreshing first would resume the draft and repaint the
        // discarded name before it was dropped.
        deps.forgetDraft(BUILT_IN_ID)
        await deps.refreshFromMain()
      })
    })
    controls.push(restore)
  }

  return el('li', { class: worn ? 'persona persona-worn' : 'persona' }, [
    label,
    ...(badge === null ? [] : [badge]),
    el('span', { class: 'persona-controls' }, controls),
  ])
}

/**
 * Open the worn persona's folder.
 *
 * The only authoring surface there is. Her prompt, voice and colour are edited
 * in this window; her artifact and its data are files, and finding them
 * otherwise means knowing where an Electron app keeps its userData.
 *
 * Acts on whoever is WORN rather than taking a row, for two reasons: editing
 * in this window already applies to the worn persona, and "Add a copy" wears
 * the copy — so copy, open, edit is one movement without choosing a target
 * twice.
 */
function revealButton(t: Copy['t'], deps: PersonaDeps): HTMLElement {
  return actionButton(
    t.personaReveal,
    'could not open the folder',
    deps,
    async () => await window.mochiSettings.revealPackage(),
  )
}

/**
 * A button that runs one non-idempotent action and cannot be pressed twice.
 *
 * `revealButton` and `addButton` were the same eight lines with a different
 * label, and the single-flight guard existed on neither until a double click
 * made two personas. One builder means the guard cannot be present on one and
 * missing on the other, which is exactly how it came to be missing.
 */
function actionButton(
  label: string,
  failure: string,
  deps: PersonaDeps,
  run: () => Promise<readonly SaveProblem[]>,
): HTMLElement {
  const node = el('button', { class: 'button', type: 'button' }, [document.createTextNode(label)])
  node.addEventListener('click', () => {
    if (node.hasAttribute('disabled')) return
    node.setAttribute('disabled', 'true')
    // Re-enabled whether it succeeded or failed, so a failure does not leave a
    // dead button.
    deps.act(failure, run, () => node.removeAttribute('disabled'))
  })
  return node
}

function addButton(t: Copy['t'], deps: PersonaDeps): HTMLElement {
  // Adding a persona is not idempotent -- each press writes a package and
  // wears it -- so a double click made two and left the copy of the copy
  // active. `actionButton` is where that guard lives now.
  return actionButton(
    t.personaAdd,
    'could not add a persona',
    deps,
    async () => await window.mochiSettings.addPersona(),
  )
}
