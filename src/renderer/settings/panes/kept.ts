/**
 * What is kept, and what it would take to stop keeping it.
 *
 * ## Three halves, and where the split falls
 *
 * Whether text is written down and for how long are HERS: a persona somebody
 * talks to about work and one they think out loud with are exactly the case
 * where two characters must disagree, and that boundary is why personas are
 * plural. What was actually said is hers too. Where the file lives, how big it
 * is, and that it is not encrypted are this MACHINE's, and they are here
 * rather than in About because About now means "this build" -- filing a
 * privacy fact there would be hiding it.
 *
 * ## It says text, never recording
 *
 * What is stored is the transcript. There is no audio anywhere in this app,
 * and calling it a recording would tell somebody it does something it does
 * not.
 *
 * ## The retention controls apply on the spot
 *
 * They used to write into the persona draft, and the Save footer was mounted
 * only on the personas group -- so turning storage off and closing the window
 * did nothing, silently. They are not part of the persona any more (see
 * `@shared/policy`), and for a privacy switch "applies when you touch it" is
 * the right semantics anyway: the failure mode of a form is forgetting to
 * submit it, and here that failure means still recording.
 *
 * ## Browsing state lives in the module
 *
 * Which conversation is open and what was typed into the search box survive a
 * repaint, because a repaint happens every time anything here changes and a
 * list that collapsed under you on every keystroke would be unusable. It is
 * reset when the worn persona changes -- see `resetKeptBrowsing`, and the
 * assertion in the test that it does: showing one character's conversation
 * under another's name is the exact scope confusion this split exists to stop.
 */

import type { KeptHit, KeptSession, KeptTurn, SaveProblem, SettingsSnapshot } from '@shared/ipc'
import { KEEP_DAYS, type KeepChoice, type Policy } from '@shared/policy'
import { el, field, select } from '../form'
import type { Copy } from '../copy'

/** Which destructive action is waiting for its second press. */
export interface Arming {
  readonly is: (what: string) => boolean
  readonly arm: (what: string) => void
  readonly disarm: () => void
}

export interface KeptDeps {
  readonly act: (
    what: string,
    run: () => Promise<readonly SaveProblem[] | void>,
    after?: () => void,
  ) => void
  readonly showProblems: (problems: readonly SaveProblem[]) => void
}

/**
 * How long history may be kept.
 *
 * `forever` is a real answer and the default. "Keep nothing" is deliberately
 * NOT on this list -- the switch above already says that, and a duration that
 * also means off is one that turns itself off when somebody drags it too far.
 */

/** What the pane is looking at. Survives a repaint; cleared on a switch. */
interface Browsing {
  /** Which conversation is open, by its token. Null is the list. */
  opened: string | null
  query: string
  sessions: readonly KeptSession[] | null
  turns: readonly KeptTurn[] | null
  hits: readonly KeptHit[] | null
  /**
   * What the last import came to, as a sentence to show.
   *
   * Held here rather than pushed through `showProblems`, because the repaint
   * that follows an import rebuilds the problem list and erased it -- so the
   * one outcome the user needed to read was the one guaranteed to vanish.
   */
  imported: string | null
  /**
   * The retention this pane last SENT, until main confirms it.
   *
   * Both controls used to spread the policy captured at render time, so
   * changing the switch and then the duration before the first repaint landed
   * sent the second change built on a copy that predated the first -- and the
   * first was silently undone. Composing from here instead makes two quick
   * changes two changes.
   */
  chosen: Policy | null
  /** Whose conversations these are, so a stale answer can be dropped. */
  who: string
}

const browsing: Browsing = {
  opened: null,
  query: '',
  sessions: null,
  turns: null,
  hits: null,
  imported: null,
  chosen: null,
  who: '',
}

/**
 * Forget what is on screen, because it belongs to somebody else now.
 *
 * Called when the worn persona changes. Without it, switching from A to B
 * leaves A's conversation list under B's name until the next fetch lands --
 * which is the widened scope this pane refuses, arriving as a stale frame rather
 * than as a query.
 */
/**
 * Drop the transcripts on screen, keeping where the reader is.
 *
 * Used after a delete. `resetKeptBrowsing` is for a persona SWITCH, which is a
 * different event: that one also forgets what was typed into the search box
 * and which persona these belonged to.
 */
function forgetWhatIsOnScreen(): void {
  browsing.opened = null
  browsing.turns = null
  browsing.sessions = null
  browsing.hits = null
  browsing.imported = null
}

export function resetKeptBrowsing(): void {
  browsing.opened = null
  browsing.query = ''
  browsing.sessions = null
  browsing.turns = null
  browsing.hits = null
  browsing.imported = null
  browsing.chosen = null
  browsing.who = ''
}

/** Bytes, in the largest unit that leaves a number somebody can picture. */
export function sizeOf(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(0)} KB`
  return `${(kb / 1024).toFixed(1)} MB`
}

/** A moment, in the reader's own locale rather than an invented format. */
export function momentOf(at: number, locale: string): string {
  return new Date(at).toLocaleString(locale)
}

export function keptPane(
  copy: Copy,
  snapshot: SettingsSnapshot,
  deps: KeptDeps,
  armed: Arming,
  repaint: () => void,
): readonly HTMLElement[] {
  const { t, say } = copy
  const personaId = snapshot.persona.id
  // A different character since the last paint. Dropped rather than shown, for
  // the reason `resetKeptBrowsing` exists.
  if (browsing.who !== personaId) {
    resetKeptBrowsing()
    browsing.who = personaId
    // And an armed delete is disarmed with them. It named an action, not a
    // persona, so leaving it set would offer a one-press "Delete for good?"
    // for somebody the reader has only just put on.
    armed.disarm()
  }

  // What was last sent, until main's answer matches it. Showing the snapshot
  // while a change is still in flight makes a control snap back to its old
  // position and then forward again.
  if (
    browsing.chosen !== null &&
    browsing.chosen.keeps === snapshot.policy.keeps &&
    browsing.chosen.keepDays === snapshot.policy.keepDays
  ) {
    browsing.chosen = null
  }
  const policy = browsing.chosen ?? snapshot.policy

  /** Change one part of the policy, keeping every other part as it stands. */
  const put = (patch: Partial<Policy>): void => {
    // Read at CALL time, not from the render-time `policy` above. That copy is
    // as old as the paint, so a second change made before the first repaint
    // was built on a policy that predated it -- which is the whole defect this
    // is supposed to fix, reintroduced one line lower down.
    const next = { ...(browsing.chosen ?? snapshot.policy), ...patch }
    browsing.chosen = next
    deps.act(
      'could not change what is kept',
      async () => {
        const problems = await window.mochiSettings.savePolicy(next)
        deps.showProblems(problems)
        // Refused? Then the pane must stop showing it as chosen, or the
        // control keeps a position the app is not honouring.
        if (problems.length > 0) browsing.chosen = null
      },
      repaint,
    )
  }

  const keeps = select<'on' | 'off'>(
    ['on', 'off'],
    (value) => (value === 'on' ? t.keptOn : t.keptOff),
    policy.keeps ? 'on' : 'off',
    (value) => {
      put({ keeps: value === 'on' })
    },
  )

  const howLong = select<KeepChoice>(
    KEEP_DAYS,
    (value) => (value === 'forever' ? t.keptForever : t.keptDays[value]),
    policy.keepDays === null ? 'forever' : nearest(policy.keepDays),
    (value) => {
      put({ keepDays: value === 'forever' ? null : Number(value) })
    },
  )

  /** One destructive action, armed by a first press. Never a single click. */
  const danger = (
    what: string,
    label: string,
    confirm: string,
    run: () => Promise<readonly SaveProblem[]>,
    /**
     * Whether success invalidates the conversations on screen.
     *
     * False for the notes button. Sharing one cleanup across every destructive
     * action meant deleting her NOTES collapsed the open conversation and
     * refetched the list -- work nobody asked for, on data that had not
     * changed. These are independent actions, and that has
     * to hold for what they do to the view as well as to the disk.
     */
    touchesTranscripts = true,
  ): HTMLElement => {
    if (!armed.is(what)) {
      const button = el('button', { class: 'button', type: 'button' }, [
        document.createTextNode(label),
      ])
      button.addEventListener('click', () => {
        armed.arm(what)
        repaint()
      })
      return button
    }
    const button = el('button', { class: 'button button-danger', type: 'button' }, [
      document.createTextNode(confirm),
    ])
    button.addEventListener('click', () => {
      // Consumed on the way in. It answers "was this the second press", and a
      // press that is being acted on is not waiting for another one.
      armed.disarm()
      deps.act(`could not ${what}`, async () => {
        const problems = await run()
        deps.showProblems(problems)
        // What is on screen came from the disk that was just emptied. Without
        // this, deleting her conversations left the list, the open transcript
        // and the search hits all still rendered -- readable, and clickable
        // into a conversation that no longer exists. A delete that leaves the
        // text visible is one somebody reasonably believes did not happen.
        if (problems.length === 0 && touchesTranscripts) {
          forgetWhatIsOnScreen()
          repaint()
        }
      })
    })
    return button
  }

  /** Fetch, then repaint. Answers for a persona nobody is wearing are dropped. */
  const fetchInto = <T>(what: string, run: () => Promise<T>, land: (value: T) => void): void => {
    deps.act(what, async () => {
      const value = await run()
      // The worn persona may have changed while this was in flight. Landing it
      // anyway would put one character's words under another's name, which is
      // the scope widening this pane is most able to produce by accident.
      if (browsing.who !== personaId) return
      land(value)
      repaint()
    })
  }

  if (browsing.sessions === null) {
    fetchInto(
      'could not list her conversations',
      () => window.mochiSettings.listSessions(),
      (v) => {
        browsing.sessions = v
      },
    )
  }
  if (browsing.opened !== null && browsing.turns === null) {
    const token = browsing.opened
    fetchInto(
      'could not read that conversation',
      () => window.mochiSettings.readSession(token),
      (v) => {
        // The conversation too, not only the persona. Opening A and then B
        // before A's turns arrive would otherwise show A's words under B's
        // heading -- same character, wrong conversation, and nothing on
        // screen saying so.
        if (browsing.opened !== token) return
        browsing.turns = v
      },
    )
  }

  const hers = el('section', { class: 'section' }, [
    el('h2', { class: 'section-title' }, [document.createTextNode(say(t.keptHers))]),
    field('kept-on', say(t.keptWriting), keeps, t.keptWritingHint),
    // Hidden rather than disabled when nothing is being kept: a greyed control
    // for a policy that cannot apply is a question with no answer.
    ...(policy.keeps ? [field('kept-days', t.keptHowLong, howLong, t.keptHowLongHint)] : []),
    el('p', { class: 'field-hint kept-count' }, [
      document.createTextNode(
        snapshot.kept.sessions === 0
          ? t.keptNothing
          : `${String(snapshot.kept.sessions)} · ${String(snapshot.kept.turns)}`,
      ),
    ]),
    el('div', { class: 'kept-actions' }, [
      danger('forget her transcripts', t.keptForget, t.keptForgetConfirm, () =>
        window.mochiSettings.forgetTranscripts(),
      ),
      exportButton(t.keptExport, deps),
      importButton(t.keptImport, t, deps, repaint),
    ]),
    // Below the buttons that produced it, and only when there is something to
    // say. An outcome line that is always present is one nobody reads.
    ...(browsing.imported === null
      ? []
      : [el('p', { class: 'field-hint' }, [document.createTextNode(browsing.imported)])]),
  ])

  const conversations = el('section', { class: 'section' }, [
    el('h2', { class: 'section-title' }, [document.createTextNode(say(t.keptConversations))]),
    ...(browsing.opened === null
      ? listView(copy, deps, repaint, personaId, armed)
      : openView(copy, repaint, danger)),
  ])

  const notes = el('section', { class: 'section' }, [
    el('h2', { class: 'section-title' }, [document.createTextNode(say(t.keptNotes))]),
    el('p', { class: 'field-hint' }, [
      document.createTextNode(snapshot.memory === '' ? t.keptNotesNone : snapshot.memory),
    ]),
    // A SEPARATE action from deleting conversations, and that is the whole
    // point rather than a layout choice: clearing what she remembers must not
    // be a way to lose the history, nor the reverse.
    el('div', { class: 'kept-actions' }, [
      danger(
        'forget her notes',
        t.keptForgetNotes,
        t.keptForgetConfirm,
        () => window.mochiSettings.forgetMemory(),
        false,
      ),
    ]),
  ])

  const machine = el('section', { class: 'section' }, [
    el('h2', { class: 'section-title' }, [document.createTextNode(t.keptMachine)]),
    el('dl', { class: 'key-list kept-facts' }, [
      el('dt', { class: 'field-label' }, [document.createTextNode(t.keptWhere)]),
      el('dd', {}, [document.createTextNode(snapshot.kept.where)]),
      el('dt', { class: 'field-label' }, [document.createTextNode(t.keptSize)]),
      el('dd', {}, [document.createTextNode(sizeOf(snapshot.kept.bytes))]),
    ]),
    // Stated plainly rather than left to be discovered. Somebody deciding
    // whether to talk to her about something needs this before they do, not
    // after.
    el('p', { class: 'field-hint' }, [document.createTextNode(t.keptPlain)]),
    el('div', { class: 'kept-actions' }, [
      danger('forget everything', t.keptForgetAll, t.keptForgetAllConfirm, () =>
        window.mochiSettings.forgetEverything(),
      ),
    ]),
  ])

  return [hers, conversations, notes, machine]
}

/** The search box and the list of conversations, newest first. */
function listView(
  { t, say, locale }: Copy,
  deps: KeptDeps,
  repaint: () => void,
  personaId: string,
  armed: Arming,
): readonly HTMLElement[] {
  // `input`, the class every other typed-in control in this window uses.
  // Things you TYPE IN are boxed and things you DO are underlined -- see
  // `controls.css` -- and a hand-rolled class here would have been a third
  // kind of control nobody chose.
  //
  // No placeholder: `field` already labels it, and a placeholder repeating
  // the label is the same word twice with the second one disappearing the
  // moment somebody types.
  const box = el('input', { class: 'input', type: 'search', value: browsing.query })
  box.addEventListener('change', () => {
    browsing.query = box.value
    if (box.value.trim() === '') {
      browsing.hits = null
      repaint()
      return
    }
    deps.act('could not search her conversations', async () => {
      const hits = await window.mochiSettings.searchTranscripts(box.value)
      if (browsing.who !== personaId) return
      browsing.hits = hits
      repaint()
    })
  })

  const rows: HTMLElement[] = []
  if (browsing.hits !== null) {
    if (browsing.hits.length === 0) {
      rows.push(el('p', { class: 'field-hint' }, [document.createTextNode(t.keptSearchNothing)]))
    }
    for (const hit of browsing.hits) {
      rows.push(openRow(momentOf(hit.at, locale), hit.text, hit.token, repaint, armed.disarm))
    }
  } else {
    for (const one of browsing.sessions ?? []) {
      const when = momentOf(one.startedAt, locale)
      const count =
        one.endedAt === null
          ? t.keptStillOpen
          : t.keptTurnCount.replace('{count}', String(one.turns))
      rows.push(openRow(when, count, one.token, repaint, armed.disarm))
    }
    if ((browsing.sessions ?? []).length === 0) {
      rows.push(el('p', { class: 'field-hint' }, [document.createTextNode(t.keptNothing)]))
    }
  }

  return [
    // Through `say`, not `.she`. Hard-coded, the hint under a heading reading
    // "Conversations with him" said "Searches only her conversations" -- the
    // pronoun belongs to the persona and every other line in this window
    // already knows that.
    field('kept-search', t.keptSearch, box, say(t.keptSearchScope)),
    el('ul', { class: 'kept-list' }, rows),
  ]
}

/** One clickable line that opens a conversation. */
function openRow(
  title: string,
  detail: string,
  token: string,
  repaint: () => void,
  disarm: () => void,
): HTMLElement {
  const button = el('button', { class: 'kept-row', type: 'button' }, [
    el('span', { class: 'kept-row-when' }, [document.createTextNode(title)]),
    el('span', { class: 'kept-row-what' }, [document.createTextNode(detail)]),
  ])
  button.addEventListener('click', () => {
    // An armed "delete this conversation" was a question about the one on
    // screen. Opening a different one answers it with no -- otherwise the
    // second press lands on a conversation nobody armed.
    if (browsing.opened !== token) disarm()
    browsing.opened = token
    browsing.turns = null
    repaint()
  })
  return el('li', {}, [button])
}

/** One conversation, and the two things you can do while looking at it. */
function openView(
  { t, locale }: Copy,
  repaint: () => void,
  danger: (
    what: string,
    label: string,
    confirm: string,
    run: () => Promise<readonly SaveProblem[]>,
  ) => HTMLElement,
): readonly HTMLElement[] {
  const token = browsing.opened ?? ''
  const back = el('button', { class: 'button', type: 'button' }, [
    document.createTextNode(t.keptBack),
  ])
  back.addEventListener('click', () => {
    browsing.opened = null
    browsing.turns = null
    repaint()
  })

  const lines = (browsing.turns ?? []).map((turn) =>
    el('li', { class: `kept-turn kept-turn-${turn.who}` }, [
      // The time only, not the date: every line here is the same conversation,
      // so repeating the day on each one is noise that pushes the words right.
      el('span', { class: 'kept-turn-when' }, [
        document.createTextNode(
          new Date(turn.at).toLocaleTimeString(locale, { timeStyle: 'short' }),
        ),
      ]),
      el('span', { class: 'kept-turn-text' }, [document.createTextNode(turn.text)]),
    ]),
  )

  return [
    el('ul', { class: 'kept-turns' }, lines),
    el('div', { class: 'kept-actions' }, [
      back,
      danger('forget this conversation', t.keptForgetOne, t.keptForgetConfirm, async () => {
        const problems = await window.mochiSettings.forgetSession(token)
        if (problems.length === 0) {
          // Back to the list, and the list refetched: staying on a conversation
          // that no longer exists shows somebody the thing they just deleted.
          browsing.opened = null
          browsing.turns = null
          browsing.sessions = null
          repaint()
        }
        return problems
      }),
    ]),
  ]
}

function exportButton(label: string, deps: KeptDeps): HTMLElement {
  const button = el('button', { class: 'button', type: 'button' }, [document.createTextNode(label)])
  button.addEventListener('click', () => {
    deps.act('could not save her conversations', async () => {
      deps.showProblems(await window.mochiSettings.exportTranscripts())
    })
  })
  return button
}

function importButton(
  label: string,
  t: Copy['t'],
  deps: KeptDeps,
  repaint: () => void,
): HTMLElement {
  const button = el('button', { class: 'button', type: 'button' }, [document.createTextNode(label)])
  button.addEventListener('click', () => {
    deps.act('could not read those conversations', async () => {
      const outcome = await window.mochiSettings.importTranscripts()
      // Cancelling is not a failure and must not be reported as one. The user
      // closing a file dialog has said no, which is an answer.
      if (outcome.kind === 'cancelled') return
      if (outcome.kind === 'refused') {
        deps.showProblems(outcome.problems)
        return
      }
      browsing.sessions = null
      browsing.hits = null
      deps.showProblems([])
      // Said in the PANE, and kept there. It went to `console.info`, which
      // nobody has open, and the conflict count was flattened into a generic
      // "could not be saved" that the very next repaint erased -- so an import
      // that silently refused half a file looked exactly like one that worked.
      const counted =
        outcome.sessions === 0 && outcome.skipped === 0 && outcome.conflicts === 0
          ? t.keptImportNothing
          : t.keptImported
              .replace('{added}', String(outcome.sessions))
              .replace('{already}', String(outcome.skipped))
      browsing.imported =
        outcome.conflicts > 0
          ? `${counted} ${t.keptImportConflicts.replace('{conflicts}', String(outcome.conflicts))}`
          : counted
      repaint()
    })
  })
  return button
}

/** The listed duration closest to a hand-written one. */
function nearest(days: number): KeepChoice {
  const numbers = KEEP_DAYS.filter((value): value is Exclude<KeepChoice, 'forever'> => {
    return value !== 'forever'
  })
  return numbers.reduce((best, value) =>
    Math.abs(Number(value) - days) < Math.abs(Number(best) - days) ? value : best,
  )
}
