/** The "may-do" group of settings. One pane per file; `panes.ts` keeps only the order. */
/**
 * When a grant's capability was last called, in words.
 *
 * Three answers, never two. `not-recorded` is not `never`: the microphone is
 * not a tool call and nothing writes a time for it, and a row that said "never
 * used" about a microphone somebody has been talking into all morning would be
 * making a claim rather than admitting a gap.
 */
import { element } from '../../element'
import { sectionHead } from '../../history/sheet/row'
import { type Pane } from '../pane'
import { GRANT_SPECS } from '@shared/grants'
import { type GrantUse } from '@shared/ipc'
import { forPronoun } from '@shared/pronoun'
import { SAYS } from '../panes-says'
/**
 * When it was last used, and when a change to it takes effect.
 *
 * TWO facts on one line, because A7 draws them that way and they answer the two
 * questions a switch raises: has this been doing anything, and if I move it,
 * when does that matter. "use is not recorded · applies from her next wake",
 * "last used 14 May · 13:01", "never used · in force now".
 *
 * Sentence case, because it is a machine fact rather than a label — it was
 * "Use is not recorded", which reads as a heading for something.
 */
function lastUsedLabel(use: GrantUse, when: string): string {
  const used =
    use.kind === 'not-recorded'
      ? 'use is not recorded'
      : use.kind === 'never'
        ? 'never used'
        : `last used ${new Date(use.at).toLocaleString([], {
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
          })}`
  return `${used} · ${when}`
}

/** 5b's four standing grants, and everything she is told she can do. */
export const MAY_DO: Pane = {
  id: 'may-do',
  label: SAYS.mayDo,
  attention: () => null,
  render(view, handlers) {
    const rows = view.grants.map((grant) => {
      const spec = GRANT_SPECS.find((one) => one.id === grant.id)
      const row = element('div', 'grant')

      const left = element('div')
      left.append(
        element('div', 'name', spec?.label ?? grant.id),
        element('p', 'desc', spec === undefined ? '' : forPronoun(spec.detail, view.pronoun)),
      )

      const allowed = element('input')
      allowed.type = 'checkbox'
      allowed.checked = grant.allowed
      allowed.id = `grant-${grant.id}`
      allowed.addEventListener('change', () => {
        handlers.grant({ id: grant.id, allowed: allowed.checked })
      })
      /*
        THE WORD SAYS THE STATE, and it said "Allowed" whatever the state was.

        A withheld grant rendered an off switch with "Allowed" beside it — so the
        only text on the row contradicted the only mark on it, and the reader who
        cannot see the knob's position was told the opposite of the truth.

        "开关一律配一个词。标记带的意思必须也以文字存在,给不看它的人" — every switch
        carries a word, and the meaning the mark carries must also exist as text
        for somebody who does not see it. A word that does not move with the mark
        is worse than no word: it is a second signal that disagrees.
      */
      const label = element('label', 'switch-word', grant.allowed ? 'Allowed' : 'Withheld')
      allowed.addEventListener('change', () => {
        label.textContent = allowed.checked ? 'Allowed' : 'Withheld'
      })
      label.htmlFor = allowed.id
      const wrap = element('div', 'switch')
      wrap.append(allowed, label)

      /*
        WHEN IT BITES, which differs per grant and is not decoration.

        Turning one off takes effect at once and she is told; turning one ON is
        part of what she is handed at a wake. A row that says only "last used"
        leaves somebody to guess which, and the guess that costs something is
        believing a withheld tool is still reachable.

        SO AN ALLOWED ONE APPLIES FROM HER NEXT WAKE and a withheld one is in
        force now — which is what A7 draws, and the opposite of what this said.
        The comment above was already right; the ternary under it was inverted,
        so every row on the screen carried the reassurance meant for the other
        state: a tool somebody had just switched on claimed to be reachable
        immediately, and one they had just switched off claimed it would take
        until she woke.

        IN THE LEFT COLUMN, under the description — A7 draws all three lines
        about the capability in one stack and puts only the word and the switch
        on the right. It was appended under the switch, which made a sentence
        about when a tool last ran read as a caption for the control, right-
        aligned in a 120px column against text set left in a 600px one.
      */
      const bites = forPronoun(grant.allowed ? SAYS.grantAtWake : SAYS.grantInForce, view.pronoun)
      left.append(element('div', 'used', lastUsedLabel(grant.lastUsed, bites)))

      const right = element('div', 'right')
      right.append(wrap)
      row.append(left, right)
      return row
    })

    /*
      THE SECTION'S OWN HEADING, which this screen did not have.

      A7 draws two sections — "What you permit" over the switches and "What she
      is told she can do" over the capability list — and this had only the
      second. So the grants arrived under the view's name with no heading of
      their own, which on a page whose every other block is a titled section
      reads as content that fell out of one.

      `sectionHead` rather than `section`, because the rows are already siblings
      in the pane's column and wrapping them would nest a column inside a column
      for nothing.

      BARE, with no count beside it. It carried "3 of 3 allowed" and had a
      sentence under it saying whose grants these are — both of which the
      apparatus column now states, as "Withheld · 1 of 3" and "In force for ·
      mochi · the live one". A7 puts each of those in exactly one place, and a
      count restated two inches apart is a count that can be seen to disagree
      with itself while a save is in flight.
    */
    const permits = sectionHead(forPronoun(SAYS.mayDoHead, view.pronoun), '')

    const note = element('p', 'note', forPronoun(SAYS.atOnce, view.pronoun))

    /*
      The heading over the tool list, with the two facts A7 hangs on it: HOW
      MANY there are, and that this is not where they are edited.

      It was a bare `h3`, so the one thing somebody is most likely to try here —
      rewriting a description they disagree with — had no answer until they had
      tried it. "not editable here" is four words and it is the whole answer.
    */
    const heading = sectionHead(
      forPronoun(SAYS.told, view.pronoun),
      `${String(view.capabilities.length)} · not editable here`,
    )
    if (view.capabilities.length === 0) {
      return [
        permits,
        ...rows,
        note,
        heading,
        element('p', 'note', forPronoun(SAYS.noTools, view.pronoun)),
      ]
    }
    return [
      permits,
      ...rows,
      note,
      heading,
      element('p', 'note', forPronoun(SAYS.toolWording, view.pronoun)),
      ...view.capabilities.map((capability) => {
        const block = element('div', 'cap')
        block.append(
          element('div', 'name', capability.name),
          element('p', 'desc', capability.description),
        )
        return block
      }),
    ]
  },
}
