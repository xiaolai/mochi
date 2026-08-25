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
import { type Pane } from '../pane'
import { GRANT_SPECS } from '@shared/grants'
import { type GrantUse } from '@shared/ipc'
import { forPronoun } from '@shared/pronoun'
import { SAYS } from '../panes-says'
function lastUsedLabel(use: GrantUse): string {
  if (use.kind === 'not-recorded') return 'Use is not recorded'
  if (use.kind === 'never') return 'Never used'
  return `Last used ${new Date(use.at).toLocaleString([], {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })}`
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
      const label = element('label', undefined, 'Allowed')
      label.htmlFor = allowed.id
      const wrap = element('div', 'switch')
      wrap.append(allowed, label)

      const right = element('div', 'right')
      right.append(wrap, element('div', 'used', lastUsedLabel(grant.lastUsed)))
      row.append(left, right)
      return row
    })

    // Above the switches, not below them: whose answer this is has to be read
    // before they are operated, not after.
    const whose = element('p', 'note', forPronoun(SAYS.mayDoWhose, view.pronoun))
    const note = element('p', 'note', forPronoun(SAYS.atOnce, view.pronoun))

    const heading = element('h3', undefined, forPronoun(SAYS.told, view.pronoun))
    if (view.capabilities.length === 0) {
      return [
        whose,
        ...rows,
        note,
        heading,
        element('p', 'note', forPronoun(SAYS.noTools, view.pronoun)),
      ]
    }
    return [
      whose,
      ...rows,
      note,
      heading,
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
