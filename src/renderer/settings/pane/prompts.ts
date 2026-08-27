/** The "prompts" group of settings. One pane per file; `panes.ts` keeps only the order. */
/** In the order they are drawn. `plan-shell.md` derives them; this is the list. */
/**
 * Every string this app puts in front of a model, and a box to rewrite it in.
 *
 * ## Why a pane rather than a file
 *
 * All of it was a literal in the module that used it: the tool descriptions,
 * the guidance she is handed when something fails, the framing on a workspace
 * lookup, the note rewriter's instruction. Readable only in the source, and
 * changeable only by editing it.
 *
 * ## Shown even where it is risky to change
 *
 * `askWorkspace.framing` carries the `sources` contract `parseFields` enforces
 * and the summariser names the fenced blocks it is told to distrust. Dropping
 * one of those phrases is very likely a mistake — so the pane says which phrase
 * went, under the box, and does not refuse the edit. Not editable and not
 * visible are different claims, and refusing here would make this a lock
 * wearing a warning's clothes.
 *
 * ## Reset deletes rather than restores
 *
 * Resetting removes the override, so the prompt goes back to tracking whatever
 * the app ships — including later improvements. Writing the current default
 * back would pin this release's wording for ever while reporting itself
 * unedited, which is the failure `store/prompt.ts` describes.
 */
import { element } from '../../element'
import { type Pane } from '../pane'
export const PROMPTS: Pane = {
  id: 'prompts',
  label: 'What she is told',
  attention: (view) => {
    // The count of prompts whose required phrasing has gone, because that is
    // the one state here somebody would want chasing. Edited-but-fine is not a
    // problem and must not wear a badge.
    const worrying = view.prompts.filter((one) => one.missing.length > 0).length
    return worrying === 0 ? null : String(worrying)
  },
  render(view, handlers) {
    const nodes: Node[] = []
    for (const one of view.prompts) {
      const head = element('div', 'row')
      head.append(element('h3', undefined, one.title))
      if (one.edited) head.append(element('span', 'meta', 'edited'))
      nodes.push(head)
      nodes.push(element('p', 'note', one.purpose))

      const box = element('textarea', 'wake-edit')
      box.value = one.text
      box.spellcheck = false
      box.rows = Math.min(10, Math.max(3, one.text.split('\n').length + 1))
      nodes.push(box)

      /*
        The bound, said while somebody is typing rather than after they save.

        `hearing.ts` refuses its own limit in the pane for this reason and
        states it: a control somebody can see should name the limit before a
        write is attempted. It cannot put a textarea back the way that pane puts
        a selection back — that would delete what was typed — so it holds the
        Save button instead and says why.
      */
      const overLong = element('p', 'note alarm')
      overLong.hidden = true
      const tooLong = (value: string): boolean =>
        one.limit !== undefined && value.length > one.limit
      const sayLength = (value: string): void => {
        if (one.limit === undefined) return
        overLong.hidden = !tooLong(value)
        overLong.textContent = `That is ${String(value.length)} characters and the most this one may be is ${String(one.limit)}. It is sent on every session and paid for as long as that session lasts.`
      }
      sayLength(one.text)
      nodes.push(overLong)

      if (one.missing.length > 0) {
        // Named, not counted: "it is missing something" sends somebody reading
        // the whole box to work out what.
        nodes.push(
          element(
            'p',
            'note alarm',
            `This no longer mentions ${one.missing.join(', ')}, which the code that reads it depends on.`,
          ),
        )
      }

      const save = element('button', 'btn primary', 'Save')
      save.type = 'button'
      save.disabled = true
      const reset = element('button', 'btn', 'Reset')
      reset.type = 'button'
      reset.disabled = !one.edited
      box.addEventListener('input', () => {
        // Enabled by a DIFFERENCE, not by having typed: typing a character and
        // deleting it is not a change to save. And never while it is over the
        // bound, which main would refuse anyway — an enabled button whose only
        // outcome is a refusal is a button that teaches people to distrust it.
        save.disabled = box.value === one.text || tooLong(box.value)
        sayLength(box.value)
      })
      save.addEventListener('click', () => {
        handlers.prompt(one.key, box.value)
      })
      reset.addEventListener('click', () => {
        handlers.prompt(one.key, null)
      })
      const actions = element('div', 'row')
      actions.append(save, reset)
      nodes.push(actions)
    }
    return nodes
  },
}
