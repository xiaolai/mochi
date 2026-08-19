import type { GrantUse, LookupChange, Revealable, ScreenChange, SettingsView } from '@shared/ipc'
import { GRANT_SPECS } from '@shared/grants'
import { forPronoun, type ByPronoun } from '@shared/pronoun'

/**
 * The six groups, one at a time.
 *
 * ## Why these six and not the handoff's
 *
 * The handoff lists Voice, Sound, On screen, Keys, What is kept, About. Three
 * of those do not survive contact with this repository's model, and
 * `plan-shell.md`'s split is where that was settled rather than guessed:
 *
 * - **Voice** is a `Persona` field. `Persona.voice`'s own comment says it is
 *   part of the character, and §21 locks it after her first audio — so changing
 *   it is a reconnect, exactly like changing who she is. It is on the shelf.
 * - **What is kept** is `policies/<id>.json`, filed under her id beside her
 *   memory. `@shared/policy`'s header argues at length that it must survive her
 *   package being updated and must die with her. Per character, so it is not
 *   here either — the group survives with different membership, holding where
 *   the app's own files are.
 * - **Sound** would be empty. Nothing app-level exists to put in it — no output
 *   device, no level — and an empty pane is a pane people learn to skip.
 *
 * What replaces them is what this build actually grew: the four standing grants
 * (5b) and how a lookup runs, neither of which existed when the six were
 * written.
 *
 * ## A dot means somebody should look, not that something is off
 *
 * A withheld grant is not a problem — it is a decision. The two things that are
 * problems are a key another application took, and a Codex CLI that is not
 * installed; both are silent failures that otherwise present as her declining
 * to help. Everything else has no dot, ever, which is what keeps the dot worth
 * looking at.
 */

/**
 * Every sentence in this window that is ABOUT her, one phrasing per pronoun.
 *
 * Group NAMES are deliberately mixed in with them rather than kept apart:
 * "Looking things up" and "Keys" are the same words whoever is worn, and
 * writing each three times would put one word in three slots and invite
 * somebody to change one of them. `Pane.label` is therefore `string |
 * ByPronoun`, and `label()` is what reads either kind -- which is the case
 * `pronoun.ts` describes and the reason that function exists.
 */
const SAYS = {
  mayDo: { she: 'What she may do', he: 'What he may do', it: 'What it may do' },
  atOnce: {
    she:
      'Turning one off takes effect at once, and she is told — she will say she can no longer ' +
      'do it rather than quietly failing. Speaking first is the exception: it is decided when ' +
      'she wakes, so that one applies from her next wake.',
    he:
      'Turning one off takes effect at once, and he is told — he will say he can no longer ' +
      'do it rather than quietly failing. Speaking first is the exception: it is decided when ' +
      'he wakes, so that one applies from his next wake.',
    it:
      'Turning one off takes effect at once, and it is told — it will say it can no longer ' +
      'do it rather than quietly failing. Speaking first is the exception: it is decided when ' +
      'it wakes, so that one applies from its next wake.',
  },
  told: {
    she: 'What she is told she can do',
    he: 'What he is told he can do',
    it: 'What it is told it can do',
  },
  noTools: {
    she: 'Nothing. She is offered no tools at all, which is a fault in this build.',
    he: 'Nothing. He is offered no tools at all, which is a fault in this build.',
    it: 'Nothing. It is offered no tools at all, which is a fault in this build.',
  },
  noCli: {
    she: 'The Codex CLI could not be found, so she cannot look anything up.',
    he: 'The Codex CLI could not be found, so he cannot look anything up.',
    it: 'The Codex CLI could not be found, so it cannot look anything up.',
  },
  noCliLong: {
    she:
      'The Codex CLI could not be found on this machine, so nothing here has anything to ' +
      'run. She says so out loud rather than answering from memory.',
    he:
      'The Codex CLI could not be found on this machine, so nothing here has anything to ' +
      'run. He says so out loud rather than answering from memory.',
    it:
      'The Codex CLI could not be found on this machine, so nothing here has anything to ' +
      'run. It says so out loud rather than answering from memory.',
  },
  sides: {
    she:
      'A side that will not fit is not honoured — dragged into a corner she puts her words ' +
      'wherever there is room. Whether she shows them at all is per character, on the shelf.',
    he:
      'A side that will not fit is not honoured — dragged into a corner he puts his words ' +
      'wherever there is room. Whether he shows them at all is per character, on the shelf.',
    it:
      'A side that will not fit is not honoured — dragged into a corner it puts its words ' +
      'wherever there is room. Whether it shows them at all is per character, on the shelf.',
  },
  kept: {
    she:
      'What she remembers and how long conversations are kept are per character, and live ' +
      'on the shelf with the character they belong to.',
    he:
      'What he remembers and how long conversations are kept are per character, and live ' +
      'on the shelf with the character they belong to.',
    it:
      'What it remembers and how long conversations are kept are per character, and live ' +
      'on the shelf with the character they belong to.',
  },
  everythingOf: {
    she: 'Everything of hers is under ',
    he: 'Everything of his is under ',
    it: 'Everything of its is under ',
  },
  whoSheIs: {
    she:
      'Who she is — her name, her voice, her face, her prompt, her bubble and what she ' +
      'remembers about you — is on the shelf, with the character it belongs to. This ' +
      'window holds only what is true whoever is worn.',
    he:
      'Who he is — his name, his voice, his face, his prompt, his bubble and what he ' +
      'remembers about you — is on the shelf, with the character it belongs to. This ' +
      'window holds only what is true whoever is worn.',
    it:
      'Who it is — its name, its voice, its face, its prompt, its bubble and what it ' +
      'remembers about you — is on the shelf, with the character it belongs to. This ' +
      'window holds only what is true whoever is worn.',
  },
} as const satisfies Readonly<Record<string, ByPronoun>>

export interface PaneHandlers {
  readonly lookup: (change: LookupChange) => void
  readonly screen: (change: ScreenChange) => void
  readonly grant: (change: { id: string; allowed: boolean }) => void
  readonly reveal: (what: Revealable) => void
  readonly say: (text: string, bad?: boolean) => void
}

export interface Pane {
  readonly id: string
  /** What the nav calls it. A table only when the name is about HER. */
  readonly label: string | ByPronoun
  /** Why this group needs looking at, or null. Drives the dot in the nav. */
  readonly attention: (view: SettingsView) => string | null
  readonly render: (view: SettingsView, handlers: PaneHandlers) => readonly Node[]
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const made = document.createElement(tag)
  if (className !== undefined) made.className = className
  if (text !== undefined) made.textContent = text
  return made
}

function field(label: string, control: HTMLElement): HTMLElement {
  const row = element('div', 'field')
  const name = element('label', undefined, label)
  row.append(name, control)
  return row
}

function options(
  select: HTMLSelectElement,
  entries: readonly { value: string; label: string }[],
  chosen: string,
): void {
  for (const entry of entries) {
    const option = document.createElement('option')
    option.value = entry.value
    option.textContent = entry.label
    option.selected = entry.value === chosen
    select.append(option)
  }
}

/**
 * When a grant's capability was last called, in words.
 *
 * Three answers, never two. `not-recorded` is not `never`: the microphone is
 * not a tool call and nothing writes a time for it, and a row that said "never
 * used" about a microphone somebody has been talking into all morning would be
 * making a claim rather than admitting a gap.
 */
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
const MAY_DO: Pane = {
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

    const note = element('p', 'note', forPronoun(SAYS.atOnce, view.pronoun))

    const heading = element('h3', undefined, forPronoun(SAYS.told, view.pronoun))
    if (view.capabilities.length === 0) {
      return [...rows, note, heading, element('p', 'note', forPronoun(SAYS.noTools, view.pronoun))]
    }
    return [
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

/**
 * How a lookup runs: where she reads, whether she may search, which profile.
 *
 * These were settable only by hand-editing `preferences.json` — a file nothing
 * documents — while the workspace is the thing that decides what she can read
 * at all. A capability nobody can point at a directory is a capability that
 * answers about an empty folder.
 */
const LOOKING: Pane = {
  id: 'looking',
  label: 'Looking things up',
  attention: (view) => (view.lookup.codexFound ? null : forPronoun(SAYS.noCli, view.pronoun)),
  render(view, handlers) {
    const workspace = element('input')
    workspace.type = 'text'
    workspace.value = view.lookup.workspace
    workspace.spellcheck = false
    workspace.addEventListener('change', () => {
      if (workspace.value.trim() === view.lookup.workspace) {
        // Put back, rather than left showing whitespace that was never saved.
        workspace.value = view.lookup.workspace
        return
      }
      handlers.lookup({ workspace: workspace.value })
    })

    const search = document.createElement('select')
    options(
      search,
      view.lookup.webSearchModes.map((mode) => ({
        value: mode,
        // `follow` is not one of Codex's own values — it is the ABSENCE of the
        // flag, leaving whatever the machine is configured for in charge.
        // Saying so is the difference between a choice and a mystery.
        label: mode === 'follow' ? 'follow the machine' : mode,
      })),
      view.lookup.webSearch,
    )
    search.addEventListener('change', () => {
      handlers.lookup({ webSearch: search.value })
    })

    const profile = element('input')
    profile.type = 'text'
    profile.value = view.lookup.profile ?? ''
    profile.spellcheck = false
    profile.placeholder = 'none'
    profile.addEventListener('change', () => {
      const name = profile.value.trim()
      handlers.lookup({ profile: name === '' ? null : name })
    })

    const parts: Node[] = [
      field('Workspace', workspace),
      field('Web search', search),
      field('Codex profile', profile),
    ]
    if (!view.lookup.codexFound) {
      // First, because everything below it is configuration for something that
      // cannot run. Without this the failure presents as her declining to help.
      parts.unshift(element('p', 'note bad', forPronoun(SAYS.noCliLong, view.pronoun)))
    }
    if (view.lookup.workspaceIsDefault) {
      parts.push(element('p', 'note', 'Nobody has chosen one, so this is the default.'))
    }
    if (view.lookup.profilePath !== null) {
      // The FILE is the thing somebody edits. "There is a profile, somewhere,
      // called something" is not an instruction anybody can follow.
      const note = element('p', 'note')
      const path = element('code', undefined, view.lookup.profilePath)
      note.append('Settings for it live in ', path)
      parts.push(note)
    }
    return parts
  },
}

/** Where she sits, and where her words go when she has any. */
const ON_SCREEN: Pane = {
  id: 'on-screen',
  label: 'On screen',
  attention: () => null,
  render(view, handlers) {
    const side = document.createElement('select')
    options(
      side,
      view.screen.sides.map((one) => ({
        value: one,
        label: one === 'auto' ? 'wherever there is room' : one,
      })),
      view.screen.bubbleSide,
    )
    side.addEventListener('change', () => {
      handlers.screen({ bubbleSide: side.value })
    })
    return [
      field('Speech bubble', side),
      element('p', 'note', forPronoun(SAYS.sides, view.pronoun)),
    ]
  },
}

/**
 * The two global keys, as claimed.
 *
 * Read-only. `shared/shortcuts.ts` holds two constants and `plan-v2.md` records
 * that not carrying v1's editable system over was deliberate — it cost an
 * accelerator parser, a conflict resolver, a pane and a persisted map. What
 * this adds is the half that was invisible: registration returns false when
 * another application owns the combination, and until now that failure only
 * reached a log.
 */
const KEYS: Pane = {
  id: 'keys',
  label: 'Keys',
  attention: (view) => {
    const taken = view.keys.filter((one) => one.refused !== null)
    if (taken.length === 0) return null
    return `${taken.map((one) => one.accelerator).join(' and ')} could not be claimed.`
  },
  render(view) {
    const rows = view.keys.map((key) => {
      const row = element('div', 'folder')
      const left = element('div')
      left.append(element('div', undefined, key.what))
      if (key.refused !== null) {
        left.append(element('div', 'refused', `not working — ${key.refused}`))
      }
      const combo = element('code', undefined, key.accelerator)
      row.append(left, combo)
      return row
    })
    return [
      ...rows,
      element(
        'p',
        'note',
        'Fixed, for now. They work while another application has focus, which is the whole ' +
          'point of them — and it is also why one can be taken.',
      ),
    ]
  },
}

/** Where the app's own files are, so somebody can go and edit one. */
const WHERE: Pane = {
  id: 'where',
  label: 'Where things live',
  attention: () => null,
  render(view, handlers) {
    const rows = (Object.keys(view.folders) as Revealable[]).map((kind) => {
      const row = element('div', 'folder')
      const left = element('div')
      left.append(element('div', undefined, kind), element('code', undefined, view.folders[kind]))
      const open = element('button', 'btn', 'Show')
      open.type = 'button'
      // A KIND, never the path beside it. The string on screen is for reading.
      open.addEventListener('click', () => {
        handlers.reveal(kind)
      })
      row.append(left, open)
      return row
    })
    return [...rows, element('p', 'note', forPronoun(SAYS.kept, view.pronoun))]
  },
}

/** What this build is, and where the rest of the settings went. */
const ABOUT: Pane = {
  id: 'about',
  label: 'About',
  attention: () => null,
  render(view) {
    const where = element('p', 'note')
    where.append(
      forPronoun(SAYS.everythingOf, view.pronoun),
      element('code', undefined, view.about.userData),
    )
    return [
      field('Application', element('div', undefined, `${view.about.name} ${view.about.version}`)),
      field('Electron', element('div', undefined, view.about.electron)),
      where,
      element('p', 'note', forPronoun(SAYS.whoSheIs, view.pronoun)),
    ]
  },
}

/** In the order they are drawn. `plan-shell.md` derives them; this is the list. */
export const PANES: readonly Pane[] = [MAY_DO, LOOKING, ON_SCREEN, KEYS, WHERE, ABOUT]
