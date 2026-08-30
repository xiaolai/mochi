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
import { type SettingsKey } from '@shared/ipc'
import { forPronoun } from '@shared/pronoun'
import { SAYS } from '../panes-says'
import { keyGlyphs } from '../../rules/key-glyphs'
import { whatWasPressed } from './pressed'

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
      ...view.keys.map((key) => row(key, view.about.platform, handlers)),
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

function row(key: SettingsKey, platform: string, handlers: PaneHandlers): HTMLElement {
  const line = element('div', 'folder')
  const left = element('div')
  /*
    A NAME, then what it does — B5's two lines.

    It was one line carrying `what`, which is a sentence: "Let her rest, or wake
    her" over "Hide her, or bring her back" is a column of two descriptions
    somebody reads rather than two names they scan, and the difference matters
    on the one pane where people arrive knowing which key they want to change.
  */
  left.append(element('div', 'name', key.name), element('div', 'desc', key.what))
  if (key.refused !== null) {
    left.append(element('div', 'refused', `not working — ${key.refused}`))
  }

  /*
    A BUTTON that becomes a listener, rather than an input.

    It carries the combination as its label, so the thing you press to change it
    is the thing showing what it is — and a button announces itself as
    operable, which a `<code>` beside a field does not.
  */
  /*
    THE COMBINATION AS THIS SYSTEM SPELLS IT — `⌃ ⇧ L`, not `Control+Shift+L`.

    The keycaps say ⌃ ⇧ and so does every menu on the machine, so the stored
    form asks somebody to translate before they can compare it against the key
    they are about to press. `keyGlyphs` leaves the words alone off macOS,
    where the words are the convention.
  */
  const combo = element('button', 'btn key', keyGlyphs(key.accelerator, platform))
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
    combo.textContent = keyGlyphs(key.accelerator, platform)
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
      The DECISION is `whatWasPressed`, and it is somewhere a test can reach.

      This was five branches in the middle of a DOM builder, tangled with the
      button's label and the `listening` flag — so the rules could only be
      exercised by constructing the row, and the suite runs in node. That is why
      `Command+Escape` being unreachable went unnoticed: there was no seam.
    */
    const said = whatWasPressed(event, key.accelerator)
    if (said.kind === 'ignore') return
    if (said.kind === 'refuse') {
      // Said, and STILL LISTENING — somebody most of the way to a good answer
      // should not have to start again.
      // The same spelling the resting label uses. A refusal that echoes back
      // `Command+Escape` while the row beside it reads `⌃ ⇧ L` is two
      // vocabularies for one thing, one of them appearing only on failure.
      combo.textContent = keyGlyphs(said.pressed, platform)
      handlers.say(said.why, true)
      return
    }
    // Everything else ends the capture. A control with no way to leave it is
    // one that has to be escaped by pressing something you did not want.
    stop()
    if (said.kind === 'save') handlers.key({ id: key.id, accelerator: said.pressed })
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
