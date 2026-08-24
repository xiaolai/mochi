/** The "looking" group of settings. One pane per file; `panes.ts` keeps only the order. */
/**
 * How a lookup runs: where she reads, whether she may search, which profile.
 *
 * These were settable only by hand-editing `preferences.json` — a file nothing
 * documents — while the workspace is the thing that decides what she can read
 * at all. A capability nobody can point at a directory is a capability that
 * answers about an empty folder.
 */
import { element } from '../../element'
import { type Pane, type PaneHandlers } from '../pane'
import { CODEX_SAYS, REMEDY_SAYS } from '@shared/delegation'
import { type SettingsCodex, type SettingsView } from '@shared/ipc'
import { forPronoun } from '@shared/pronoun'
import { SAYS } from '../panes-says'
import { field, options } from '../pane'
export const LOOKING: Pane = {
  id: 'looking',
  label: 'Looking things up',
  /*
    Seven states rather than two, and the dot is on for six of them.

    It read `codexFound`, which is the first of three questions — installed,
    runs, login usable by us — and the one that fails least often. A machine
    whose Codex token went stale a fortnight ago answered `true` here and drew
    no dot at all, and the first anybody heard of it was her failing to speak.
  */
  attention: (view) =>
    view.lookup.codex.readiness === 'ready'
      ? null
      : `${CODEX_SAYS[view.lookup.codex.readiness]} ${forPronoun(SAYS.noCli, view.pronoun)}`,
  render(view, handlers) {
    const workspace = element('input')
    workspace.type = 'text'
    // Present so the field keeps an edge while it is empty — the rule in
    // `tokens.css` reads `:placeholder-shown`, and an empty box with nothing in
    // it does not say what it is for either. Never reachable in practice: the
    // workspace always resolves to at least the default.
    workspace.placeholder = 'a folder she may read'
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
    parts.unshift(codexBlock(view.lookup.codex, view.pronoun, handlers))
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

/**
 * What the machine's Codex is worth, said before anything that depends on it.
 *
 * ## Why it is here at all, and always
 *
 * It used to appear only when the CLI was missing, and to say one thing. Three
 * questions decide whether she can look anything up — is it installed, does it
 * run, is its login usable BY US — and only the first had a surface. The third
 * is the one that actually fails: Codex reports itself signed in while holding
 * an expired token, because it owns a refresh token and renews on its next run,
 * and this app cannot renew. So a perfectly ordinary machine can sit in a state
 * this pane called healthy and she cannot speak on it.
 *
 * Drawn in the ready case too, quietly. A pane that only ever shows a status
 * when something is wrong is a pane where "nothing there" has two meanings —
 * fine, and not checked yet — and this check has a genuine not-checked-yet.
 *
 * ## The button, and why it is not a relaunch
 *
 * Every remedy here is applied OUTSIDE this app: install the CLI, run `codex`
 * to sign in, or wait for a busy machine. Somebody who has just done one of
 * those is standing in front of a window telling them to do it, and without
 * this the only way to clear it is to quit the thing they were told to fix.
 */
function codexBlock(
  codex: SettingsCodex,
  pronoun: SettingsView['pronoun'],
  handlers: PaneHandlers,
): HTMLElement {
  const ready = codex.readiness === 'ready'
  const box = element('div', ready ? 'codex' : 'codex bad')

  /*
    ONE line: a light, what is true, and the button, in that order.

    The state was a paragraph with the control under it, which put the thing
    somebody came here to press below three sentences they had already read.
    Read left to right it is now the shape of an answer — is it working, why
    not, and what to do about it — and the button sits at the end of the line it
    acts on rather than at the end of the block.

    The LIGHT carries the state a second time, in a shape rather than in words.
    That is not decoration: this pane is scanned rather than read, and green or
    not-green is the whole question at a glance. It is the same argument the
    microphone mark in the top strip makes, and the reason `aria-hidden` is on
    it — the sentence beside it already says this to a screen reader, and a
    second announcement of the same fact is noise.
  */
  const head = element('div', 'codex-head')
  const light = element('span', ready ? 'light on' : 'light')
  light.setAttribute('aria-hidden', 'true')

  const again = element('button', 'btn', 'Check again')
  again.type = 'button'
  head.append(light, element('span', 'codex-said', CODEX_SAYS[codex.readiness]), again)
  box.append(head)

  if (codex.remedy !== null) {
    // Under it, not beside it: what is true and what to do are two sentences,
    // and joining them makes a paragraph somebody skims instead of an
    // instruction somebody follows.
    box.append(element('p', 'note', REMEDY_SAYS[codex.remedy]))
  }
  if (!ready) {
    // The consequence FOR HER, which is the only pronoun-bearing sentence here
    // — everything above is about a binary and a sign-in on this machine.
    box.append(element('p', 'note', forPronoun(SAYS.noCliLong, pronoun)))
  }

  again.addEventListener('click', () => {
    // Disabled for the whole round trip. Two checks in flight would spawn four
    // child processes and the later answer would not necessarily land last.
    again.disabled = true
    again.textContent = 'Checking…'
    void handlers.recheckCodex().then(
      () => {
        // Nothing to redraw here: main answers and the window re-reads, which
        // is the one path that cannot show a status the rest of the pane
        // disagrees with.
      },
      (error: unknown) => {
        again.disabled = false
        again.textContent = 'Check again'
        handlers.say(`Codex could not be checked: ${String(error)}`, true)
      },
    )
  })
  return box
}
