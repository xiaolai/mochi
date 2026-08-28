/** The "keys" group of settings. One pane per file; `panes.ts` keeps only the order. */
/**
 * The two global keys, as claimed — and now as chosen.
 *
 * ## Why it stopped being read-only
 *
 * `plan-v2.md` recorded that not carrying v1's editable system over was
 * deliberate, and priced it: an accelerator parser, a conflict resolver, a
 * settings pane and a persisted map. Three of those exist for other reasons
 * now, so what was left was the grammar. `shared/accelerator.ts` is it.
 *
 * The half that was already here stays and matters more, not less:
 * registration returns false when another application owns the combination, and
 * a combination somebody has just chosen is far likelier to be taken than one
 * this project picked for being empty.
 *
 * ## A capture control, not a text field
 *
 * A box you type `Control+Shift+L` into is a box you can type `Ctrl+Shift+L`
 * into, and `ctrl shift l`, and `⌃⇧L`. Every one of those is somebody being
 * reasonable and every one is a refusal — over a value they cannot see the
 * grammar for. Pressing the keys is the only input method that cannot be
 * spelled wrong, and it is also how the shortcut will actually be used.
 *
 * ## The keystroke is swallowed while it is being captured
 *
 * `preventDefault` on every keydown, including the ones that do not describe a
 * combination. Without it, capturing `Command+W` closes the window it is being
 * captured in — and the combinations somebody most wants to check for conflicts
 * are exactly the ones that already do something.
 */
import { element } from '../../element'
import { type Pane, type PaneHandlers } from '../pane'
import { acceleratorFrom, acceleratorProblem } from '@shared/accelerator'
import { type SettingsKey } from '@shared/ipc'
import { forPronoun } from '@shared/pronoun'
import { SAYS } from '../panes-says'

export const KEYS: Pane = {
  id: 'keys',
  label: 'Keys',
  attention: (view) => {
    const taken = view.keys.filter((one) => one.refused !== null)
    if (taken.length === 0) return null
    return `${taken.map((one) => one.accelerator).join(' and ')} could not be claimed.`
  },
  render(view, handlers) {
    return [
      ...view.keys.map((key) => row(key, handlers)),
      element(
        'p',
        'note',
        'These work while another application has focus, which is the whole point of them — and ' +
          'it is also why one can be taken. A combination needs Control, Option or Command: ' +
          'without one, that key would stop working everywhere on this machine.',
      ),
      element('p', 'note', forPronoun(SAYS.keysReset, view.pronoun)),
    ]
  },
}

function row(key: SettingsKey, handlers: PaneHandlers): HTMLElement {
  const line = element('div', 'folder')
  const left = element('div')
  left.append(element('div', undefined, key.what))
  if (key.refused !== null) {
    left.append(element('div', 'refused', `not working — ${key.refused}`))
  }

  /*
    A BUTTON that becomes a listener, rather than an input.

    It carries the combination as its label, so the thing you press to change it
    is the thing showing what it is — and a button announces itself as
    operable, which a `<code>` beside a field does not.
  */
  const combo = element('button', 'btn key', key.accelerator)
  combo.type = 'button'

  const reset = element('button', 'btn', 'Reset')
  reset.type = 'button'
  // Nothing to go back to when it is already on what ships. The same rule the
  // prompts pane follows, and it reads `edited` for the same reason: main
  // decides what counts as changed.
  reset.disabled = !key.edited

  let listening = false
  const stop = (): void => {
    listening = false
    combo.textContent = key.accelerator
    combo.classList.remove('listening')
    reset.disabled = !key.edited
    window.removeEventListener('keydown', onKey, true)
  }

  function onKey(event: KeyboardEvent): void {
    /*
      SWALLOWED first, whatever it turns out to be.

      Including the keys that do not describe a combination: a bare Escape has
      to reach the handler below rather than whatever else on the page listens
      for one, and `Command+W` must not close the window somebody is choosing a
      shortcut in.
    */
    event.preventDefault()
    event.stopPropagation()
    /*
      A BARE Escape leaves; Escape with a modifier is a combination.

      `Escape` is in the accepted key set, so `Command+Escape` is a shortcut
      somebody is entitled to choose — and this treated every event whose `key`
      is `Escape` as cancel, which made every combination containing it
      unreachable through the only control that can set one. A grammar that
      accepts a value and a control that cannot express it is the same defect as
      a limit checked in two units.
    */
    const bareEscape =
      event.key === 'Escape' && !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey
    if (bareEscape) {
      // Out, unchanged. A capture control with no way to leave it is a control
      // that has to be escaped by pressing something you did not want.
      stop()
      return
    }
    const pressed = acceleratorFrom(event)
    // A modifier on its own, or a key outside the accepted set. Neither ends
    // the capture: somebody on the way to ⌃⇧K holds two modifiers first, and a
    // control that gave up on the first would record `Control`.
    if (pressed === null) return
    const problem = acceleratorProblem(pressed)
    if (problem !== null) {
      // Said, and still listening. A combination that is refused for having no
      // real modifier is somebody most of the way to a good answer, and closing
      // the capture would make them start again.
      combo.textContent = pressed
      handlers.say(problem, true)
      return
    }
    stop()
    // Unchanged is not a change to save. It would round-trip cleanly — main
    // would release the combination and take it straight back — and it would
    // put a "Saved." over a key nobody moved.
    if (pressed === key.accelerator) return
    handlers.key({ id: key.id, accelerator: pressed })
  }

  combo.addEventListener('click', () => {
    if (listening) {
      stop()
      return
    }
    listening = true
    combo.textContent = 'Press a combination…'
    combo.classList.add('listening')
    // Disabled while capturing, because `Reset` is reachable by keyboard and a
    // capture that ate the key which triggered it would be listening for a
    // combination nobody meant to press.
    reset.disabled = true
    /*
      On the WINDOW and in the capture phase.

      A listener on the button alone misses everything once focus moves, and
      the bubbling phase is too late to stop the page's own handlers — the
      conversations window binds keys of its own, and the whole point here is
      that no combination is off limits to capture.
    */
    window.addEventListener('keydown', onKey, true)
  })
  // A capture left running because somebody clicked elsewhere is a window that
  // eats every keystroke until it is closed.
  combo.addEventListener('blur', stop)

  reset.addEventListener('click', () => {
    // `null`, never the shipped combination spelled out here. It deletes the
    // stored answer, so this key keeps tracking whatever later releases ship —
    // the rule `store/prompts.ts` argues and `store/keys.ts` repeats.
    handlers.key({ id: key.id, accelerator: null })
  })

  const right = element('div', 'keys-right')
  right.append(combo, reset)
  line.append(left, right)
  return line
}
