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
import { readinessOf, type Certainty, type ReadinessAction } from '../../rules/readiness'
import { checkedLabel } from '../../rules/freshness'
import { forPronoun } from '@shared/pronoun'
import { SAYS } from '../panes-says'
import { field, options } from '../pane'

/**
 * Whether a Codex check is in flight, across redraws of this pane.
 *
 * Module scope on purpose. See the click handler below: the pane is rebuilt on
 * every read, a check causes a read, and a lock living on the button therefore
 * unlocked itself halfway through the thing it was locking.
 */
let checking = false
/**
 * The workspace field and the folder picker beside it.
 *
 * Its own function because `render` was building four unrelated controls in one
 * scroll — a field, a picker, a select and a profile row — and none of them
 * reads any of the others. A reader looking for how the workspace is chosen had
 * to scan past two things that are not it.
 */
function workspacePicker(view: SettingsView, handlers: PaneHandlers): HTMLElement {
  const workspace = element('input')
  workspace.type = 'text'
  /*
    Present so the field keeps an edge while it is empty — the rule in
    `tokens.css` reads `:placeholder-shown`, and an empty box with nothing in
    it does not say what it is for either.

    This used to end "Never reachable in practice: the workspace always
    resolves to at least the default", which is true of the value this pane is
    DRAWN with and not of the field. Clear the box and the placeholder is
    exactly what is on screen — and that is the one moment the styling matters,
    because a field with no edge and no text reads as a gap rather than a
    control. An audit read the comment and concluded the assignment was dead;
    it is the sentence that was wrong.
  */
  workspace.placeholder = forPronoun(SAYS.workspacePlaceholder, view.pronoun)
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

  /*
    The system folder panel, beside the field rather than instead of it.

    This was a bare text box for a filesystem path, with a refusal — "a
    workspace has to be a full path, starting with a slash" — as the only
    guidance anybody got. That is a control which asks somebody to type
    something they can see on screen in another application, and then tells
    them off for the way they typed it.

    The field STAYS. Pasting a path is faster than walking a panel to it when
    you already have one, and a picker that replaced the field would make the
    quick way impossible in order to make the slow way safe.

    The path is chosen and saved in main; nothing here names a folder. See
    `settings:choose-workspace`.
  */
  const browse = element('button', 'btn', 'Choose…')
  browse.type = 'button'
  browse.addEventListener('click', () => {
    /*
      Disabled for as long as the panel is open, which is `recheckCodex`'s
      reason: a second panel behind the first is two answers arriving in an
      order nobody chose.

      Nothing is redrawn from the answer either, for `recheckCodex`'s other
      reason: main has already written the workspace, and the handler re-reads
      — which is the one path that cannot leave this field showing a folder
      the store disagrees with.
    */
    browse.disabled = true
    void handlers.chooseWorkspace().then(
      (chosen) => {
        browse.disabled = false
        // Said nowhere at all when somebody changes their mind. A toast for a
        // dismissal is a toast that teaches people to stop reading them.
        if (!chosen.ok && chosen.cancelled) return
        handlers.say(
          chosen.ok ? forPronoun(SAYS.workspaceSaved, view.pronoun) + chosen.workspace : chosen.why,
          !chosen.ok,
        )
      },
      (error: unknown) => {
        browse.disabled = false
        handlers.say(`The folder could not be chosen: ${String(error)}`, true)
      },
    )
  })
  const wherever = element('div', 'picker')
  wherever.append(workspace, browse)
  return wherever
}

/**
 * The way into the profile's own file, beside the field that names it.
 *
 * B1 puts a "Show config" button on the profile's row, and that is a change of
 * shape rather than of wording: this was a `.folder` block of its own, printed
 * under every other setting in the group, saying "Settings for it live in
 * <path>" with a "Show" beside it. So the pane ended with a raw filesystem path
 * — the longest string on the page — under a heading it had nothing to do with,
 * and the button that acts on the profile was two settings away from the profile.
 *
 * The path itself is gone from the surface. It said where to go, and the button
 * goes there; a person who wants the path can copy it out of the panel the
 * button opens. A page that both names a location and offers to open it is
 * telling somebody to walk somewhere it will drive them.
 *
 * Null when there is no file to show — no profile at all, or a profile name for
 * a file nobody has written yet. A button that reveals nothing looks broken.
 */
function showConfig(view: SettingsView, handlers: PaneHandlers): HTMLElement | null {
  if (view.lookup.profilePath === null || !view.lookup.profileExists) return null
  const open = element('button', 'btn', 'Show config')
  open.type = 'button'
  // No argument. Main holds the profile name and knows where Codex keeps its
  // files, so the page never names the path it is displaying.
  open.addEventListener('click', () => {
    handlers.showProfile()
  })
  return open
}

export const LOOKING: Pane = {
  id: 'looking',
  label: 'Looking things up',
  /*
    The dot means SOMEBODY SHOULD LOOK, which is not the same as "something is
    off" — `panes.ts` states that rule and this is the group it was written for.

    Asked of `rules/readiness.ts` rather than compared here, so the nav and the
    card cannot disagree about the same machine. It read `codexFound` once, which
    is the first of three questions and the one that fails least often: a machine
    whose token went stale a fortnight ago answered `true` and drew no dot, and
    the first anybody heard of it was her failing to speak.

    Anything not KNOWN USABLE gets one. That deliberately includes the two
    unknowns — a check that never came back is exactly a thing somebody should
    look at — and deliberately excludes `too-old`, which runs: it offers an
    update rather than presenting as her declining to help, and the dot is spent
    on silent failures.

    `checking: false`, because this is a standing property of the machine and the
    nav must not flicker for the two seconds a probe is out.
  */
  attention: (view) =>
    readinessOf({ readiness: view.lookup.codex.readiness, checking: false }).certainty === 'usable'
      ? null
      : `${CODEX_SAYS[view.lookup.codex.readiness]} ${forPronoun(SAYS.noCli, view.pronoun)}`,
  render(view, handlers) {
    const wherever = workspacePicker(view, handlers)

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

    /*
      The profile and the way into its file on ONE row — B1's shape, and the
      picker's shape, so the two settings on this page that name a thing on disk
      are composed the same way.
    */
    const chosen = element('div', 'picker')
    chosen.append(profile)
    const config = showConfig(view, handlers)
    if (config !== null) chosen.append(config)

    /*
      EACH NOTE UNDER THE SETTING IT IS ABOUT.

      There was one note on this pane, gated on `workspaceIsDefault` — a fact
      about the WORKSPACE — and appended after the last field, which is the
      profile. So a sentence about the workspace was drawn under "Codex profile"
      and read as being about the profile, and the workspace itself, the setting
      that decides everything she can read, was left with no sentence at all.
    */
    return [
      codexBlock(view.lookup.codex, view.pronoun, handlers),
      field('Workspace', wherever, {
        hint: view.lookup.workspaceIsDefault ? 'nobody has chosen one' : '',
        note: forPronoun(SAYS.workspaceNote, view.pronoun),
      }),
      field('Web search', search),
      field('Codex profile', chosen, {
        note:
          view.lookup.profile === null
            ? forPronoun(SAYS.profileDefault, view.pronoun)
            : forPronoun(SAYS.profileChosen, view.pronoun),
      }),
    ]
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
  /*
    ASKED, not derived here — B1b.

    `readiness === 'ready'` is a boolean over nine states, and the card drew two
    of them: green or not-green. Two of the nine say NOTHING EITHER WAY — a check
    still running, and one that never came back — and drawing either as
    not-green tells somebody to reinstall a working tool after a network blip,
    which is the advice `CODEX_SAYS['timed-out']` already refuses to give in
    words while the light contradicted it in shape.

    `certainty` is the third state the mark needed: filled when she can, hollow
    when she cannot, dashed when nobody knows.
  */
  const drawn = readinessOf({ readiness: codex.readiness, checking, version: codex.version })
  // `bad` only when it IS bad. An unknown is not a fault, and a card outlined
  // as one is the same wrong claim as the light being off.
  const box = element('div', drawn.certainty === 'unusable' ? 'codex bad' : 'codex')

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
  const light = element('span', `light ${MARK[drawn.certainty]}`)
  light.setAttribute('aria-hidden', 'true')

  const again = element('button', 'btn', ACTION_SAYS[drawn.action])
  again.type = 'button'
  /*
    WHAT IT IS, then WHEN WE LOOKED — two lines, because they age differently.

    B1 draws "checked 2 minutes ago · v0.148.0" under the sentence, and it is not
    decoration: the sentence above it is a claim about a machine that can change
    without this window hearing, so the reader needs to know how old the claim
    is. A card that says "installed and signed in" with no timestamp is asking to
    be believed indefinitely.

    The version is the same fact the too-old comparison runs on. Saying it here
    means somebody can check the comparison rather than trust it.
  */
  const said = element('div', 'codex-lines')
  said.append(element('div', 'codex-said', CODEX_SAYS[codex.readiness]))
  const when = checkedLabel({ checkedAt: codex.checkedAt, now: Date.now(), version: codex.version })
  if (when !== null) said.append(element('div', 'codex-when', when))
  head.append(light, said, again)
  box.append(head)

  if (codex.remedy !== null) {
    // Under it, not beside it: what is true and what to do are two sentences,
    // and joining them makes a paragraph somebody skims instead of an
    // instruction somebody follows.
    box.append(element('p', 'note', REMEDY_SAYS[codex.remedy]))
  }
  /*
    The consequence FOR HER, and only when there IS one.

    It was `if (!ready)`, which put "she cannot look anything up" under a check
    that had not come back — a claim about her made from an absence of
    information. `unknown` is not `unusable`, and this is the sentence where the
    difference is most expensive.
  */
  if (drawn.certainty === 'unusable') {
    box.append(element('p', 'note', forPronoun(SAYS.noCliLong, pronoun)))
  }

  /*
    THE LOCK IS ON THE MODULE, not on the button.

    `again.disabled = true` locks one ELEMENT, and this pane is rebuilt from
    scratch on every read — which a check itself causes, because main answers
    and the window re-reads. So the redraw handed back a brand new button with
    `disabled` false while the first check was still running, and a second click
    started a second one. Two checks spawn child processes and the later answer
    does not necessarily land last, so the shared Codex status could end up
    holding the OLDER result.

    A module-level flag survives the redraw, which is the whole point: the thing
    being guarded is the check, and the check outlives the button that started
    it.
  */
  again.disabled = checking
  again.addEventListener('click', () => {
    if (checking) return
    checking = true
    again.disabled = true
    again.textContent = 'Checking…'
    void handlers.recheckCodex().then(
      () => {
        // Cleared even though nothing is redrawn here: main answers and the
        // window re-reads, and the redraw reads this flag to decide whether the
        // button it is making should be live.
        checking = false
      },
      (error: unknown) => {
        checking = false
        again.disabled = false
        again.textContent = 'Check again'
        handlers.say(`Codex could not be checked: ${String(error)}`, true)
      },
    )
  })
  return box
}

/**
 * The shape the mark takes, per certainty.
 *
 * Three, not two. A filled dot means she can, a hollow one means she cannot, and
 * a dashed ring means nobody knows — which is the state a boolean had no way to
 * draw and therefore drew as "cannot".
 */
const MARK: Readonly<Record<Certainty, string>> = {
  usable: 'on',
  unusable: 'off',
  unknown: 'unknown',
}

/**
 * What the one button says, per action.
 *
 * The words are here rather than in `rules/readiness.ts` for the reason
 * `delegation.ts` gives about `Remedy`: a key travels, a sentence belongs beside
 * the control that shows it. An instruction, never a diagnosis.
 */
const ACTION_SAYS: Readonly<Record<ReadinessAction, string>> = {
  'check-again': 'Check again',
  'open-a-terminal': 'Open a terminal',
  'how-to-install': 'How to install it',
  'sign-in-again': 'Sign in again',
  'update-it': 'Update it',
  'try-again': 'Try again',
}
