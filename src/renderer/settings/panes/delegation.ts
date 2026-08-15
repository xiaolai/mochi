/**
 * What this computer does when she is asked to look something up.
 *
 * ## Status first, and it is not decoration
 *
 * The common failure here is not "you did not press the key" -- it is Codex
 * missing, logged out, or holding a token only Codex can refresh. Those are
 * FAULTS and each one has a command that fixes it, so they are said at the top
 * with that command attached. A missing keypress is the result of a choice the
 * user made two controls further down; showing an empty model list and letting
 * somebody work out why is the version of this pane that generates support
 * threads.
 *
 * ## The effort control is offered always; its VALUES are gated
 *
 * Reasoning levels are a property of the model, not a global list: measured,
 * `gpt-5.6-luna` stops at `xhigh` while `gpt-5.6-sol` reaches `ultra`, and the
 * defaults differ too. Offering a level the selected model does not have is the
 * familiar defect class -- every flag reports success and the thing quietly
 * does not do what was asked.
 *
 * That constrains which values appear, not whether the control does. Hiding it
 * until a model was chosen left the default configuration -- following Codex --
 * with no way to ask for a faster answer at all. A model change that strands the current level moves it to
 * that model's own default, which the control then shows.
 *
 * The notice beneath it is for the OTHER way this happens: Codex updating and a
 * model losing a level under a setting that was saved months ago. Nothing ran a
 * handler in that case, so without the notice the control would quietly show
 * something different from what is stored.
 *
 * ## Following Codex is a choice, not a blank
 *
 * `null` model and `null` effort mean "whatever `~/.codex/config.toml` says",
 * offered as the first option rather than as what you get by not choosing.
 * The precedence version of this was refused for credentials, because
 * "whichever is set wins" produces the one question a support thread cannot
 * answer: which is it actually using?
 */

import { format, messagesFor } from '@shared/i18n'
import type { SaveProblem, SettingsSnapshot } from '@shared/ipc'
import {
  AUTHORISATION_WINDOW_MS,
  DEFAULT_DELEGATION_PROMPT,
  DELEGATION_TRIGGERS,
  WEB_SEARCH_MODES,
  type CodexReadiness,
  type DelegationSettings,
  type DelegationTrigger,
  type DelegationView,
} from '@shared/delegation'
import { button, el, field, select, textArea } from '../form'
import type { Copy } from '../copy'

export interface DelegationDeps {
  readonly act: (
    what: string,
    run: () => Promise<readonly SaveProblem[] | void>,
    after?: () => void,
  ) => void
  readonly showProblems: (problems: readonly SaveProblem[]) => void
}

/**
 * The sentinel for "follow my Codex".
 *
 * A `<select>` option carries a string, and the value being expressed is
 * `null`. Anything that could also be a real slug would collide the day OpenAI
 * ships a model with that name, so it is a token no slug can be: the measured
 * slugs are lowercase words, digits, dots and hyphens, and never a bracket.
 *
 * It was briefly a leading space, which reached disk as a NUL byte -- git then
 * classified this source file as binary and every test still passed. Hence a
 * sentinel that is visible in a diff.
 */
const FOLLOW = '(follow-codex)'

/** Which models this credential can actually reach. */
function offerable(view: DelegationView, source: SettingsSnapshot['auth']['source']) {
  // Dropped, not greyed out. A disabled row invites somebody to work out how to
  // enable it, and the answer is "change your credential", which belongs in the
  // section above rather than encoded in a tooltip here.
  return source === 'apikey'
    ? view.catalog.models.filter((model) => model.inApi)
    : view.catalog.models
}

export function delegationSection(
  copy: Copy,
  snapshot: SettingsSnapshot,
  deps: DelegationDeps,
): HTMLElement {
  const { t, say } = copy
  const view = snapshot.delegation
  const settings = view.settings
  const models = offerable(view, snapshot.auth.source)
  /**
   * A model this credential can reach, by slug.
   *
   * One lookup, named once. The same `find` was written out four times with
   * two different sources -- `models` here and `view.catalog.models` for the
   * reachability check -- and which of the two a given line used is exactly
   * the distinction that decides whether an unreachable model is offered. Two
   * spellings of one question is how they came to disagree.
   */
  const offered = new Map(models.map((model) => [model.slug, model]))
  const rows: HTMLElement[] = []

  // The LIVE value, not the one this render was built from.
  //
  // Every control derived its payload from `settings`, which is a snapshot taken
  // when the pane was drawn -- so two changes made before the repaint landed
  // each sent the other's field at its old value, and whichever arrived second
  // won. Merging into a local that updates synchronously makes the second save
  // carry the first.
  let pending: DelegationSettings = settings
  const save = (change: Partial<DelegationSettings>, after?: () => void): void => {
    pending = { ...pending, ...change }
    const next = pending
    deps.act(
      'could not change the delegation settings',
      async () => {
        deps.showProblems(await window.mochiSettings.saveDelegation(next))
      },
      after,
    )
  }

  rows.push(el('p', { class: 'hint' }, [document.createTextNode(say(t.delegationAbout))]))

  // ── Status ────────────────────────────────────────────────────────────────
  // Rendered from `messages.codex`, which already carries a line per verdict
  // and a command per remedy. A second vocabulary for the same seven states
  // would be two tables to keep in step, and they drift on the first edit.
  if (view.readiness !== 'ready') {
    const codex = messagesFor(copy.locale).codex
    // A RECORD, so a new `CodexReadiness` member is a compile error here.
    //
    // The nested ternary ended in `codex.unreadable`, which meant a member
    // added upstream fell through to "Codex's sign-in could not be read" --
    // a sentence about a different fault, with a different remedy, shown
    // confidently. `satisfies` is what makes the exhaustiveness checkable
    // rather than merely intended.
    const reasons = {
      'not-installed': say(codex.notInstalled),
      unusable: codex.unusable,
      'timed-out': codex.timedOut,
      'logged-out': codex.loggedOut,
      stale: codex.stale,
      unreadable: codex.unreadable,
    } satisfies Record<Exclude<CodexReadiness, 'ready'>, string>
    const reason = reasons[view.readiness]
    rows.push(el('p', { class: 'problem' }, [document.createTextNode(reason)]))
    // The command, not "something went wrong". The discipline: every bad state
    // carries something the user can actually type.
    if (view.remedy !== null)
      rows.push(el('p', { class: 'hint' }, [document.createTextNode(codex.remedy[view.remedy])]))
  }

  // ── Model ─────────────────────────────────────────────────────────────────
  const modelValues = [FOLLOW, ...models.map((model) => model.slug)]
  // A slug that is stored but no longer offered still appears, so a Codex that
  // is merely offline does not silently discard a choice the user made.
  //
  // But NOT one the catalog explicitly rules out. A model the current
  // credential cannot reach was filtered out a line above; adding it back here
  // put it in the list anyway and sent it to Codex -- undoing the gate in the
  // name of preserving a choice that cannot work.
  const knownUnreachable = view.catalog.models.some(
    (model) => model.slug === settings.model && !model.inApi && snapshot.auth.source === 'apikey',
  )
  if (settings.model !== null && !modelValues.includes(settings.model) && !knownUnreachable) {
    modelValues.push(settings.model)
  }
  // Naming what following RESOLVES to, rather than leaving it opaque.
  //
  // Both values are top-level keys in `config.toml`, so this was never unknown
  // -- and hiding it hid the thing worth acting on: a machine configured at
  // `ultra` is most of why a delegation takes over a minute.
  const followed = view.codexDefault.model
  const followedModel = followed === null ? undefined : offered.get(followed)
  const followLabel =
    followed === null
      ? t.delegationFollowCodex
      : `${t.delegationFollowCodex} — ${followedModel?.displayName ?? followed}${
          view.codexDefault.effort === null ? '' : `, ${view.codexDefault.effort}`
        }`
  const labelForModel = (value: string): string =>
    value === FOLLOW ? followLabel : (offered.get(value)?.displayName ?? value)

  rows.push(
    field(
      'delegation-model',
      t.delegationModel,
      select(modelValues, labelForModel, settings.model ?? FOLLOW, (value) => {
        const nextModel = value === FOLLOW ? null : value
        const chosen = nextModel === null ? undefined : offered.get(nextModel)
        // Going back to following Codex takes the effort with it. Which model
        // will run is unknown then, so any depth kept here would be one sent on
        // behalf of a model nobody has identified -- and the control that would
        // show it is hidden, so nothing on screen would say it was still set.
        //
        // Moving to a model that cannot do the current depth resets the depth to
        // that model's own default rather than sending a level it will refuse.
        // `pending`, not `settings`: an effort chosen a moment ago has not
        // reached this render yet, and reading the snapshot would write it back
        // to its previous value.
        const current = pending.effort
        const stranded =
          current !== null && chosen !== undefined && !chosen.efforts.includes(current)
        // Following Codex KEEPS a level that is still valid.
        //
        // This cleared the effort whenever the model went back to `follow`, on
        // the belief -- stated in a comment that was wrong -- that the effort
        // control is hidden while following. It is not: `safeEverywhere` is
        // offered, so somebody could choose a level, switch the model to
        // follow, and watch their choice disappear for no reason they could
        // see. It is dropped only when nothing can vouch for it.
        const keeps =
          current !== null &&
          (nextModel === null ? safeEverywhere : (chosen?.efforts ?? [])).includes(current)
        save({
          model: nextModel,
          effort: keeps
            ? current
            : nextModel === null
              ? null
              : stranded
                ? chosen.defaultEffort
                : null,
        })
      }),
    ),
  )

  if (view.catalog.problem !== null) {
    rows.push(
      el('p', { class: 'hint' }, [
        document.createTextNode(t.delegationNoModels[view.catalog.problem]),
      ]),
    )
  }

  // ── Effort ────────────────────────────────────────────────────────────────
  // Only once a model is chosen. While the model follows Codex, which model
  // will run is unknown here, so the set of valid levels is unknown too --
  // offering a guess would be offering a level that may not exist.
  /**
   * The effort control is offered while FOLLOWING Codex, and that was the fix
   * to the original mistake.
   *
   * `-c model_reasoning_effort=…` is an independent flag: it does not require
   * knowing which model runs. Hiding the control until a model was chosen
   * treated a value constraint as an existence constraint, so the default
   * configuration -- following Codex, which is what everyone starts with --
   * showed no way to ask for a faster answer at all.
   *
   * What IS per-model is which values are valid: luna genuinely stops at
   * `xhigh` while sol reaches `ultra`. So the list narrows to the chosen
   * model's own levels; while following, it is the intersection across
   * everything on offer, which is valid whichever one Codex picks. An explicit
   * model this catalog cannot resolve gets nothing, because there is no honest
   * list to show for it.
   */
  // `followedModel` applies ONLY while following. An explicit model the catalog
  // does not know is not the followed one, and showing the followed one's
  // levels for it would offer depths that may not exist on the model that
  // actually runs -- the same mismatch the per-model list exists to prevent,
  // reached by a different route.
  const chosen = settings.model === null ? followedModel : offered.get(settings.model)
  const safeEverywhere = models
    .map((model) => model.efforts)
    .reduce<readonly string[]>(
      (common, levels) => common.filter((level) => levels.includes(level)),
      models[0]?.efforts ?? [],
    )
  // An explicit model the catalog cannot resolve gets NO override offered.
  //
  // Falling back to the intersection looked safe and was not: those levels are
  // safe for the models we can see, and the one that will actually run is not
  // among them. Offering nothing leaves `follow my Codex`, which is valid for
  // any model -- the honest answer when we cannot say what the model supports.
  // The intersection is offered ONLY when the followed model is genuinely
  // unspecified -- Codex naming none, so any of them could run.
  //
  // When it names one the catalog cannot resolve, the intersection is the same
  // mistake the explicit case below already refuses: those levels are safe for
  // the models we can see, and the one that will actually run is not among
  // them. An API credential filtering it out is the ordinary way to get here.
  const followedIsUnknown = settings.model === null && view.codexDefault.model !== null
  const efforts =
    chosen !== undefined
      ? chosen.efforts
      : settings.model === null && !followedIsUnknown
        ? safeEverywhere
        : []
  if (efforts.length > 0) {
    const effortValues = [FOLLOW, ...efforts]
    const current =
      settings.effort !== null && efforts.includes(settings.effort) ? settings.effort : FOLLOW
    rows.push(
      field(
        'delegation-effort',
        t.delegationEffort,
        select(
          effortValues,
          (value) => (value === FOLLOW ? t.delegationFollowCodex : value),
          current,
          (value) => {
            save({ effort: value === FOLLOW ? null : value })
          },
        ),
      ),
    )
    // Reachable when the CATALOG changed, not when the user did: a level saved
    // months ago that this model no longer advertises. Said rather than silently
    // shown as something else.
    if (settings.effort !== null && !efforts.includes(settings.effort)) {
      rows.push(el('p', { class: 'hint' }, [document.createTextNode(t.delegationEffortMoved)]))
    }
  }

  // ── When to look ──────────────────────────────────────────────────────────
  rows.push(
    field(
      'delegation-trigger',
      t.delegationTrigger,
      select(
        DELEGATION_TRIGGERS,
        (value: DelegationTrigger) =>
          value === 'hotkey' ? t.delegationTriggerHotkey : t.delegationTriggerAnytime,
        settings.trigger,
        (value) => {
          save({ trigger: value })
        },
      ),
    ),
  )
  // The cost of the loose setting is shown while it is chosen, not hidden
  // behind it. State the price, then let them decide.
  if (settings.trigger === 'anytime') {
    rows.push(
      el('p', { class: 'hint' }, [document.createTextNode(say(t.delegationTriggerAnytimeCost))]),
    )
  } else {
    // The follow-up window, said out loud. "Only after the shortcut" stopped
    // being the whole truth when an answer began renewing the press, and a
    // label that quietly understates what a setting permits is worse than one
    // that overstates it -- the user cannot notice the difference.
    //
    // The DURATION is interpolated from the constant the gate actually uses.
    // Writing "a minute" as prose meant the security boundary and the sentence
    // describing it could drift apart silently, in every locale at once.
    rows.push(
      el('p', { class: 'hint' }, [
        document.createTextNode(
          format(say(t.delegationTriggerHotkeyFollowUp), {
            seconds: String(AUTHORISATION_WINDOW_MS / 1000),
          }),
        ),
      ]),
    )
  }

  // ── Searching the web ───────────────────────────────────────────────────
  // Its own control because `-c` overrides the machine-wide setting, so this
  // was never something the user's global config had to decide for them.
  rows.push(
    field(
      'delegation-search',
      t.delegationSearch,
      select(
        WEB_SEARCH_MODES,
        (value) => t.delegationSearchMode[value],
        settings.webSearch,
        (value) => {
          save({ webSearch: value })
        },
      ),
      t.delegationSearchHint,
    ),
  )

  // ── What to tell Codex ──────────────────────────────────────────────────
  // Shown, and editable. It was a constant in `delegate.ts`, which meant one
  // opinion about what an answer should be -- name your source, do not fall
  // back on memory -- shipped to everybody, including people for whom a
  // different opinion is correct. A prompt is configuration.
  rows.push(
    field(
      'delegation-prompt',
      t.delegationPrompt,
      textArea(
        'delegation-prompt',
        // Stored only. The default is the placeholder, so it can be read
        // without becoming an edit the moment somebody clicks in the box.
        settings.prompt ?? '',
        DEFAULT_DELEGATION_PROMPT,
        (next) => {
          save({ prompt: next.trim() === '' ? null : next })
        },
      ),
      t.delegationPromptHint,
    ),
  )
  if (settings.prompt !== null) {
    // In an `.actions` row, which is where every other button in this window
    // sits. A bare button as a direct child of the section misses the flex
    // alignment and the spacing the rest of the sheet is built on.
    rows.push(
      el('div', { class: 'actions' }, [
        button(t.useDefault, () => {
          save({ prompt: null })
        }),
      ]),
    )
  }

  // ── Trust ─────────────────────────────────────────────────────────────────
  if (view.trust === 'absent') {
    rows.push(el('p', { class: 'hint' }, [document.createTextNode(t.delegationTrustNoConfig)]))
  } else if (view.trust === 'trusted' && !view.trustIsOurs) {
    // Somebody else's entry. `untrustWorkspace` refuses to remove it on
    // purpose, so a switch here would report success and change nothing --
    // the shape of control this project keeps finding and removing.
    rows.push(el('p', { class: 'hint' }, [document.createTextNode(t.delegationTrustTheirs)]))
  } else {
    rows.push(
      field(
        'delegation-trust',
        t.delegationTrust,
        select(
          ['off', 'on'] as const,
          (value) => (value === 'on' ? t.keptOn : t.keptOff),
          view.trust === 'trusted' ? 'on' : 'off',
          (value) => {
            deps.act('could not change what Codex trusts', async () => {
              const problems = await window.mochiSettings.setWorkspaceTrust(value === 'on')
              deps.showProblems(problems)
              if (problems.length > 0) return
              // MERGED into the live copy, synchronously.
              //
              // `pending` is what every other control in this pane sends, and
              // trust travels on its OWN channel -- so between this reply and
              // the facts refresh that repaints, any other control calling
              // `save()` carried the stale `trustWorkspace` and overwrote the
              // preference this call had just written. The same staleness
              // `pending` exists to prevent, arriving through the one field
              // that does not go through it.
              pending = { ...pending, trustWorkspace: value === 'on' }
            })
          },
        ),
        t.delegationTrustAbout,
      ),
    )
    if (view.trust === 'unreadable') {
      rows.push(el('p', { class: 'problem' }, [document.createTextNode(t.delegationTrustFailed)]))
    } else if (settings.trustWorkspace && view.trust !== 'trusted') {
      // The stored answer is what the user ASKED for; `view.trust` is what
      // Codex's own file says now. They disagree when something outside this
      // app removed the entry -- and a switch that silently reads "off" after
      // you turned it on is indistinguishable from one that never worked.
      rows.push(el('p', { class: 'problem' }, [document.createTextNode(t.delegationTrustLost)]))
    }
  }

  return el('section', { class: 'section' }, rows)
}
