import type {
  GrantUse,
  HearingChange,
  LookupChange,
  Revealable,
  ScreenChange,
  SettingsCodex,
  SettingsView,
} from '@shared/ipc'
import { CODEX_SAYS, REMEDY_SAYS } from '@shared/delegation'
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
  halo: {
    she:
      'The ring over her head. Hiding it hides nothing you need: the menu bar item marks ' +
      'itself while the microphone is open, whatever this says and wherever she is, and macOS ' +
      'shows its own orange dot beside it that no application can turn off.',
    he:
      'The ring over his head. Hiding it hides nothing you need: the menu bar item marks ' +
      'itself while the microphone is open, whatever this says and wherever he is, and macOS ' +
      'shows its own orange dot beside it that no application can turn off.',
    it:
      'The ring over it. Hiding it hides nothing you need: the menu bar item marks itself ' +
      'while the microphone is open, whatever this says and wherever it is, and macOS shows ' +
      'its own orange dot beside it that no application can turn off.',
  },
  chipSwitch: {
    she: 'Show it while the pointer is on her',
    he: 'Show it while the pointer is on him',
    it: 'Show it while the pointer is on it',
  },
  chip: {
    she:
      'The little speech bubble at her shoulder, which opens her conversations. Turning it off ' +
      'closes no door: the same control sits inside her speech bubble whenever she has said ' +
      'something, and the menu bar opens the same window.',
    he:
      'The little speech bubble at his shoulder, which opens his conversations. Turning it off ' +
      'closes no door: the same control sits inside his speech bubble whenever he has said ' +
      'something, and the menu bar opens the same window.',
    it:
      'The little speech bubble at its shoulder, which opens its conversations. Turning it off ' +
      'closes no door: the same control sits inside its speech bubble whenever it has said ' +
      'something, and the menu bar opens the same window.',
  },
  rests: {
    she:
      'Resting closes the session and gives the microphone back, so nothing is connected while ' +
      'nobody is talking to her. She wakes from the menu bar, the key, or a click on her.',
    he:
      'Resting closes the session and gives the microphone back, so nothing is connected while ' +
      'nobody is talking to him. He wakes from the menu bar, the key, or a click on him.',
    it:
      'Resting closes the session and gives the microphone back, so nothing is connected while ' +
      'nobody is talking to it. It wakes from the menu bar, the key, or a click on it.',
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

/**
 * What each halo answer is called on screen.
 *
 * Here rather than in `HALO_WHEN`, because the store's list is the GRAMMAR — the
 * values main will accept — and these are words somebody reads. `?? one` in the
 * caller, so a value main starts offering before anybody writes a label for it
 * appears as itself rather than as a blank row.
 */
const HALO_LABELS: Readonly<Record<string, string>> = {
  always: 'always',
  listening: 'only while the microphone is open',
  never: 'never',
}

export interface PaneHandlers {
  readonly lookup: (change: LookupChange) => void
  /**
   * Ask the machine about Codex again, and hand back what it said.
   *
   * A PROMISE, because the check spawns two child processes with a deadline
   * each: a button that returned at once would look like it had done nothing on
   * the one machine where the answer takes a second. The pane disables the
   * control while this is outstanding and redraws from the result.
   */
  readonly recheckCodex: () => Promise<SettingsCodex>
  readonly screen: (change: ScreenChange) => void
  readonly hearing: (change: HearingChange) => void
  /** Rewrite one catalogued prompt; `null` resets it to what the app ships. */
  readonly prompt: (key: string, text: string | null) => void
  readonly grant: (change: { id: string; allowed: boolean }) => void
  /**
   * Ask about deleting every conversation there is.
   *
   * ASK. The pane raises the question and the confirmation surface answers it;
   * nothing is deleted by the time this returns. Handing the pane a function
   * that deleted would put the irreversible action one click from a list of
   * folder paths.
   */
  readonly forgetEveryTalk: () => void
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

/**
 * Which languages she should expect to hear.
 *
 * ## Why a control exists at all, rather than a good constant
 *
 * The transcriber decides what her ARCHIVE holds, and the archive is what
 * `recall_conversations` searches and what the summariser reads when it
 * maintains her note. A wrong transcript is not a cosmetic fault: she looks for
 * the words somebody actually said, finds different ones stored, and reports
 * that she has no record of a conversation that is plainly there.
 *
 * The application cannot know which languages get spoken at this desk, and
 * guessing is worse than asking — a pair of languages hinted at somebody who
 * speaks neither is a hint working against them. So the default is nothing
 * chosen, which means the model works it out for itself, and this is where
 * somebody who knows better says so.
 *
 * ## A multiple select, because the answer is genuinely plural
 *
 * Switching language mid-sentence is ordinary for this project, which is the
 * whole reason the field is `languages` and not `language`. A single picker
 * would make a bilingual conversation choose which half to transcribe well.
 */
const HEARING: Pane = {
  id: 'hearing',
  label: 'Hearing you',
  attention: () => null,
  render(view, handlers) {
    const chosen = new Set(view.hearing.languages)
    const languages = document.createElement('select')
    languages.multiple = true
    // Tall enough to show the common answers without scrolling, short enough
    // not to take the pane over. The list is main's; see `SettingsHearing`.
    languages.size = 8
    for (const one of view.hearing.choices) {
      const option = document.createElement('option')
      option.value = one.code
      option.textContent = one.label
      option.selected = chosen.has(one.code)
      languages.append(option)
    }
    languages.addEventListener('change', () => {
      const picked = [...languages.selectedOptions].map((one) => one.value)
      // Refused HERE as well as in main, so the message names the limit before
      // a write is attempted -- and the control is put back to what is actually
      // stored rather than left showing a selection that was never saved.
      if (picked.length > view.hearing.most) {
        for (const option of languages.options) option.selected = chosen.has(option.value)
        handlers.say(
          `Choose at most ${String(view.hearing.most)} languages, or none to let her work it out.`,
          true,
        )
        return
      }
      handlers.hearing({ languages: picked })
    })

    const parts: Node[] = [field('Languages spoken', languages)]
    parts.push(
      element(
        'p',
        'note',
        chosen.size === 0
          ? 'Nothing chosen, so she works out the language herself. Choose only languages that are actually spoken here — a hint for one nobody uses makes the transcript worse, not better.'
          : 'A hint, not a restriction. Anything else spoken is still transcribed; these are what she expects.',
      ),
    )
    // Said plainly, because nothing on screen changes when this is saved. The
    // voice locks after her first audio, so the configuration is re-sent on the
    // next session rather than to this one.
    parts.push(element('p', 'note', 'Takes effect on her next wake.'))
    return parts
  },
}

/** Where she sits, and where her words go when she has any. */
const ON_SCREEN: Pane = {
  id: 'on-screen',
  label: 'On screen',
  attention: () => null,
  render(view, handlers) {
    /*
      THREE answers, so a select rather than a switch.

      It was a checkbox over the resting hairline alone, and it had to be:
      while the halo was the only surface saying the microphone was open, an off
      switch was a way to make the worst thing this app can do happen. The tray
      marks itself while the microphone is live now — it cannot be hidden,
      dragged off a screen or switched off — so the halo is about her appearance
      and `never` is an ordinary answer.

      The choices come from main for the same reason `sides` does: a page
      holding its own list is a second answer to what may be chosen, and only
      one of the two is checked on the way back.
    */
    const halo = document.createElement('select')
    options(
      halo,
      view.screen.haloChoices.map((one) => ({ value: one, label: HALO_LABELS[one] ?? one })),
      view.screen.halo,
    )
    halo.addEventListener('change', () => {
      handlers.screen({ halo: halo.value })
    })

    /*
      The control at her shoulder, as a plain switch.

      Offerable in a way the halo is not, and the difference is worth stating
      beside them: the halo is the only thing on screen that says the microphone
      is open, so its switch had to be narrowed to the half that promises
      nothing. This one is a shortcut with two other doors — the same control is
      inside her bubble, and the menu bar opens the same window — so there is no
      half to hold back.
    */
    const chip = element('input')
    chip.type = 'checkbox'
    chip.checked = view.screen.shoulderChip
    chip.id = 'shoulder-chip'
    chip.addEventListener('change', () => {
      handlers.screen({ shoulderChip: chip.checked })
    })
    const chipLabel = element('label', undefined, forPronoun(SAYS.chipSwitch, view.pronoun))
    chipLabel.htmlFor = chip.id
    const chipSwitch = element('div', 'switch')
    chipSwitch.append(chip, chipLabel)

    /*
      How long she stays connected with nothing said.

      A `select` rather than a number field: the useful range is small and a
      free minute count invites a value that reads as reasonable and is not.
      The choices come from main for the same reason `sides` does — a page
      holding its own list is a second answer to what may be chosen, and only
      one of the two is checked on the way back.
    */
    const rest = document.createElement('select')
    options(
      rest,
      view.screen.sleepAfterChoices.map((minutes) => ({
        value: String(minutes),
        label: minutes === 0 ? 'never on her own' : `after ${String(minutes)} minutes`,
      })),
      String(view.screen.sleepAfterMinutes),
    )
    rest.addEventListener('change', () => {
      handlers.screen({ sleepAfterMinutes: Number(rest.value) })
    })

    return [
      field('Halo', halo),
      element('p', 'note', forPronoun(SAYS.halo, view.pronoun)),
      field('Shoulder button', chipSwitch),
      element('p', 'note', forPronoun(SAYS.chip, view.pronoun)),
      field('Rests', rest),
      element('p', 'note', forPronoun(SAYS.rests, view.pronoun)),
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
/** What this build is, and where the rest of the settings went. */
/**
 * What this install is, and where it keeps things.
 *
 * ## Two groups, and the second was inside the first already
 *
 * `Where things live` was a group of its own: two rows — avatars and personas —
 * each with a Show button. This pane ENDED with the sentence "Everything of
 * hers is under `~/…/Mochi`", which is the parent of those two folders. One
 * group named the root in prose and another listed two of its children with
 * buttons, and somebody looking for either had to know which of the two words
 * this repository had chosen for the same subject.
 *
 * `Looking things up` was the other candidate for absorbing it, and it is the
 * wrong one on the same test. Its folder — the workspace — is one the USER
 * points her at, deliberately outside anything of hers, and its first control
 * is a health check for a capability. A pane holding an amber "the Codex
 * sign-in has expired" card is not a pane about where files are.
 *
 * ## The order: what it is, then where it keeps things, then what is not here
 *
 * The rows sit between the version and the two notes rather than after them,
 * because the notes are about the rows: one says what folder they are inside,
 * the other says which of her things are deliberately not in this window at
 * all. A note that comes before what it qualifies is a note read twice.
 */
/**
 * The hatch that empties the archive for EVERY character.
 *
 * ## Why it is here and not in the archive
 *
 * The archive is scoped to whoever is worn, and its own delete controls say
 * "hers" because the surrounding page makes that legible. This one is not about
 * a character at all -- it reaches rows belonging to characters that were
 * deleted by hand, packages that have gone unreadable, and ids that were
 * refused as duplicates, none of which are in the catalogue to be named. Put
 * among per-character controls it would read as one more of them, and its
 * label would be false in exactly the situations somebody reaches for it.
 *
 * About is where this window keeps what is true whoever is worn. This is that.
 *
 * ## Why it looks like nothing much
 *
 * On purpose. It is placed last, under the notes rather than above them, and
 * carries no colour until the pointer is on it. Nobody should arrive here by
 * following the most prominent thing on the pane.
 */
function everything(handlers: PaneHandlers): HTMLElement {
  const wrap = element('div', 'folder')
  const left = element('div')
  left.append(
    element('div', undefined, 'Every conversation, every character'),
    element(
      'code',
      undefined,
      'Characters, voices and looks are untouched. This cannot be undone.',
    ),
  )
  const go = element('button', 'btn bad', 'Delete…')
  go.type = 'button'
  // It only ASKS. The confirmation is a separate surface, and the deletion
  // happens there or not at all.
  go.addEventListener('click', () => {
    handlers.forgetEveryTalk()
  })
  wrap.append(left, go)
  return wrap
}

const ABOUT: Pane = {
  id: 'about',
  label: 'About',
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

    const where = element('p', 'note')
    where.append(
      forPronoun(SAYS.everythingOf, view.pronoun),
      element('code', undefined, view.about.userData),
    )
    return [
      field('Application', element('div', undefined, `${view.about.name} ${view.about.version}`)),
      field('Electron', element('div', undefined, view.about.electron)),
      ...rows,
      where,
      // What is NOT here, and why. Her memory and her conversations are per
      // character and live on the shelf; this window holds only what is true
      // whoever is worn.
      element('p', 'note', forPronoun(SAYS.kept, view.pronoun)),
      element('p', 'note', forPronoun(SAYS.whoSheIs, view.pronoun)),
      everything(handlers),
    ]
  },
}

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
const PROMPTS: Pane = {
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
        // deleting it is not a change to save.
        save.disabled = box.value === one.text
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

export const PANES: readonly Pane[] = [MAY_DO, LOOKING, HEARING, PROMPTS, ON_SCREEN, KEYS, ABOUT]
