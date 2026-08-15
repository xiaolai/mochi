/**
 * The two global shortcuts, each as a button that records what you press next.
 *
 * Its own module because the recorder has rules and the list does not: one
 * recording session per button however it was started, every key swallowed
 * while recording, and a rollback when main refuses the binding. Indented
 * inside a loop in a 700-line file, that read as incidental.
 */

import { chordFromEvent, toAccelerator } from '@shared/accelerator'
import { SHORTCUT_IDS, type ShortcutId } from '@shared/shortcuts'
import type { ByPronoun } from '@shared/pronoun'
import type { SaveProblem, SettingsSnapshot } from '@shared/ipc'
import { el } from '../form'
import type { Copy } from '../copy'

/** What this pane needs the window to do for it. */
export interface ShortcutsDeps {
  readonly act: (
    what: string,
    run: () => Promise<readonly SaveProblem[] | void>,
    after?: () => void,
  ) => void
  readonly showProblems: (problems: readonly SaveProblem[]) => void
}

/**
 * The two chords, and a way to change them.
 *
 * Recording rather than typing. A text field would mean the user spelling an
 * Electron accelerator by hand — `Control+Shift+M`, capitalised exactly — and
 * then finding out whether they got it right by pressing it. Pressing the keys
 * IS the input.
 */
export function shortcutsPane(
  copy: Copy,
  snapshot: SettingsSnapshot,
  deps: ShortcutsDeps,
): HTMLElement {
  const { t, say } = copy
  const rows: HTMLElement[] = []
  const label: Readonly<Record<ShortcutId, ByPronoun>> = {
    toggleVisible: t.keyToggleVisible,
    toggleAwake: t.keyToggleAwake,
    askWorkspace: t.keyAskWorkspace,
  }

  for (const id of SHORTCUT_IDS) {
    const current = snapshot.keys[id]
    // A description list, NOT the `.field` grid the rest of this pane uses,
    // and this is measured rather than inherited.
    //
    // `.field` puts labels in a shared 14ch column so controls line up down
    // the window. These labels do not fit it: "Wake them, or let them sleep"
    // measures 19.6ch, and the four English pronouns run 14.5-19.6ch. Moving
    // them in wraps every one of them onto a second line -- which is exactly
    // the failure that column was widened to 14ch to stop. They are sentences
    // about what a key does, not names of values, so the list sizes its column
    // to its content instead -- and, since it has to be wider, it is aligned
    // flush to the pane's right edge rather than left like everything else.
    // Wider on both sides reads as misaligned; wider on the left and square on
    // the right reads as a block. See `.key-list` in `settings.css`.
    //
    // What that layout does NOT excuse is the naming. A `<dt>` has no
    // programmatic relationship to anything, so each button's accessible name
    // was the chord printed on it: "Control Shift M, button" says which keys
    // and never what for. `aria-labelledby` supplies the association a
    // `<label for>` would have.
    const termId = `key-${id}-label`
    rows.push(
      el('dt', { id: termId, class: 'field-label' }, [document.createTextNode(say(label[id]))]),
    )

    const button = chordButton(copy, current, id, snapshot, deps)
    button.id = `key-${id}`
    button.setAttribute('aria-labelledby', `${termId} key-${id}`)
    const cell = el('dd', {}, [button])
    if (current.unavailable) {
      cell.append(el('span', { class: 'chord-note' }, [document.createTextNode(t.keyTaken)]))
    }
    rows.push(cell)
  }

  return el('div', { class: 'keys' }, [
    el('dl', { class: 'key-list' }, rows),
    el('p', {}, [document.createTextNode(t.keysHow)]),
  ])
}

/**
 * One binding, as a button that records the next chord you press.
 *
 * Lifted out of `shortcutsPane`, which was 87 lines mixing the list, the
 * recorder's lifecycle, event suppression, persistence and rollback -- so the
 * part with actual rules in it, the recorder, was indented inside a loop and
 * read as incidental.
 */
function chordButton(
  copy: Copy,
  current: SettingsSnapshot['keys'][ShortcutId],
  id: ShortcutId,
  snapshot: SettingsSnapshot,
  deps: ShortcutsDeps,
): HTMLElement {
  // The COPY, not a fresh `messagesFor(locale)`. Reaching for the module's
  // locale here was the last thing tying this button to the window's state.
  const { t } = copy
  const button = el('button', { class: 'chord', type: 'button' }, [
    document.createTextNode(current.shown),
  ])
  if (current.unavailable) button.classList.add('is-taken')

  /**
   * Listen for one chord, then stop.
   *
   * The listener is on the BUTTON and removed as soon as it resolves or the
   * button loses focus. A document-level recorder that outlives its own
   * button is a settings window that eats the next keystroke you type
   * anywhere in it.
   */
  const record = (): void => {
    // Bound to BOTH `click` and `focus`, because a shortcut must be
    // rebindable from the keyboard as well as the mouse. A mouse click on an
    // unfocused button fires both, so this ran twice and installed two
    // `keydown` listeners -- one keypress then sent the rebind twice, and
    // each listener's `stop()` removed only its own.
    if (button.classList.contains('is-recording')) return
    button.textContent = t.keyPress
    button.classList.add('is-recording')
    button.classList.remove('is-taken')

    const stop = (): void => {
      button.removeEventListener('keydown', onKey)
      button.removeEventListener('blur', cancel)
      button.classList.remove('is-recording')
    }
    const cancel = (): void => {
      stop()
      button.textContent = current.shown
      if (current.unavailable) button.classList.add('is-taken')
    }
    const onKey = (event: KeyboardEvent): void => {
      // Every key, including Tab and Escape, while recording: the point is to
      // capture what was pressed rather than let the browser act on it.
      event.preventDefault()
      event.stopPropagation()
      if (event.key === 'Escape') return cancel()

      const chord = chordFromEvent(event, window.mochiSettings.platform)
      // Null while only modifiers are down, which is the ordinary state
      // halfway through a chord. Keep waiting rather than rejecting.
      if (chord === null) return

      stop()
      const next = { ...accelerators(snapshot), [id]: toAccelerator(chord) }
      deps.act('could not rebind', async () => {
        const problems = await window.mochiSettings.saveShortcuts(next)
        // Main broadcasts a new snapshot on success and the pane rebuilds
        // from it, so there is nothing to write back here.
        if (problems.length > 0) {
          deps.showProblems(problems)
          cancel()
        }
      })
    }
    button.addEventListener('keydown', onKey)
    button.addEventListener('blur', cancel, { once: true })
  }
  button.addEventListener('click', record)
  button.addEventListener('focus', record)

  return button
}

/** The current bindings as Electron spells them, for sending back. */
function accelerators(snapshot: SettingsSnapshot): Record<ShortcutId, string> {
  const out = {} as Record<ShortcutId, string>
  for (const id of SHORTCUT_IDS) out[id] = snapshot.keys[id].accelerator
  return out
}
