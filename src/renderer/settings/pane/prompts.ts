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
import { editing } from '../../rules/editing'
import { type Pane } from '../pane'
import { SAYS } from '../panes-says'
import { canSave, lengthNote } from './prompt-edit'
export const PROMPTS: Pane = {
  id: 'prompts',
  // A TABLE, because the name has a pronoun in it. It was the one pane label
  // that did and it was a bare string, so this group was called "What she is
  // told" whoever was worn — see `panes-says.ts`, whose header says in so many
  // words that group names are kept there for exactly this.
  label: SAYS.promptsLabel,
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
      const overLong = element('p', 'note bad')
      const sayLength = (value: string): void => {
        const note = lengthNote(value, one.limit)
        overLong.hidden = note === null
        if (note !== null) overLong.textContent = note
      }
      sayLength(one.text)
      nodes.push(overLong)

      if (one.missing.length > 0) {
        // Named, not counted: "it is missing something" sends somebody reading
        // the whole box to work out what.
        nodes.push(
          element(
            'p',
            // `bad`, not `alarm`. Nothing has ever styled `.alarm` — the
            // stylesheet's warning variant is `.note.bad` — so this warning,
            // which is the entire visible half of the `requires` mechanism, has
            // rendered as ordinary grey body text since it was written. Two
            // names for one thing, and this pane picked the one that does not
            // exist. `stylesheets.test.ts` now walks these files, which is what
            // turned it up.
            'note bad',
            `This no longer mentions ${one.missing.join(', ')}, which the code that reads it depends on.`,
          ),
        )
      }

      const save = element('button', 'btn primary', 'Save')
      save.type = 'button'
      const reset = element('button', 'btn', 'Reset')
      reset.type = 'button'
      /*
        The rule lives in `rules/editing`, which holds and tests the whole of
        C3: both controls go on dispatch, the box goes with them, and nothing
        re-enables here. `writeMachine` re-reads and this pane is rebuilt from
        what main actually holds, which is the one path that cannot show a state
        the store disagrees with — the rule `recheckCodex` states.
      */
      const doc = editing(one.text, {
        // A difference rather than having typed, and never over the bound.
        mayCommit: (draft, was) => canSave(draft, was, one.limit),
        // Reset restores what SHIPPED, so it is offered by the stored text
        // having been edited — not by anything having been typed here.
        mayRevert: () => one.edited,
      })
      const showState = (): void => {
        save.disabled = !doc.canCommit()
        reset.disabled = !doc.canRevert()
        box.disabled = doc.sending()
      }
      showState()
      box.addEventListener('input', () => {
        doc.typed(box.value)
        showState()
        sayLength(box.value)
      })
      save.addEventListener('click', () => {
        const text = doc.commit()
        if (text === null) return
        showState()
        handlers.prompt(one.key, text)
      })
      reset.addEventListener('click', () => {
        if (!doc.revertByWriting()) return
        showState()
        handlers.prompt(one.key, null)
      })
      const actions = element('div', 'row')
      actions.append(save, reset)
      nodes.push(actions)
    }
    return nodes
  },
}
