/**
 * What she may do while nobody is watching.
 *
 * ## A standing panel, not an install-time modal
 *
 * 1c's receipt asked for every permission at the moment of installing a
 * package, which is the worst moment to ask: nobody has used the thing yet, so
 * every answer is a guess, and the guess is then permanent. 5b replaces it with
 * four switches that are always there and always answerable — and each carries
 * **when it was last used**, which is what turns "should she be allowed to?"
 * into a decision somebody can actually make.
 *
 * There are four because there are four real ones. The plugin sandbox and the
 * grant broker are struck (`plan-capabilities.md` W-F): capabilities are
 * compiled in now, so a grant is not a fence around somebody else's code. It is
 * a statement about what this machine lets HER do.
 *
 * ## App-level, not per character
 *
 * `plan-shell.md`'s split settles it: a grant is true of this machine whoever is
 * worn. Filing one under a persona would make the switch and the "last used"
 * beside it mean different things the first time somebody changed character.
 *
 * ## Off means she is TOLD, not that she quietly fails
 *
 * This is the whole point, and it is the reason `notBuilt` was deleted from
 * this repository: a capability she cannot perform that presents as her
 * declining to help is indistinguishable from a companion who is simply
 * unhelpful. So revoking one does three things, and each covers a different
 * moment:
 *
 * 1. the tool is not offered on the wire, so she cannot call it;
 * 2. `grantsNotice` goes into her instructions, so she can say what changed;
 * 3. and if she calls it anyway — holding a tool list from before the change —
 *    the dispatch answers with a sentence rather than an error.
 */

/** The four. The order is the order they are drawn in. */
import type { ByPronoun } from './pronoun'

export const GRANTS = ['microphone', 'speak_first', 'ask_workspace', 'remember_this'] as const

export type Grant = (typeof GRANTS)[number]

export type Grants = Readonly<Record<Grant, boolean>>

export interface GrantSpec {
  readonly id: Grant
  /** What it is called on screen. */
  readonly label: string
  /**
   * What turning it off actually stops, in one sentence, one phrasing per
   * pronoun.
   *
   * The label above is NOT a table and should not become one: "Hear you" is
   * "Hear you" whoever is worn, and four identical strings is a choice that is
   * not one. This sentence is about her, so it has to vary -- `label()` in
   * `pronoun.ts` is what reads either kind.
   */
  readonly detail: ByPronoun
  /**
   * The capability this withdraws from the wire, or null when it governs
   * something that is not a tool call.
   *
   * Null is also what says the row has no "last used" to show: the ledger
   * records calls, and the microphone is not one. 5b's acceptance is that the
   * column is real or the row does not claim it, so this is what the window
   * branches on rather than on a time that happens to be missing.
   */
  readonly capability: string | null
  /** What she is told while it is off. One line, in the second person. */
  readonly withheld: string
}

export const GRANT_SPECS: readonly GrantSpec[] = [
  {
    id: 'microphone',
    label: 'Hear you',
    detail: {
      she: 'Open the microphone while she is awake.',
      he: 'Open the microphone while he is awake.',
      it: 'Open the microphone while it is awake.',
    },
    capability: null,
    withheld: 'Your microphone is off, so you cannot hear them at all right now.',
  },
  {
    id: 'speak_first',
    label: 'Speak first',
    detail: {
      she: 'Say hello when she wakes, without being spoken to.',
      he: 'Say hello when he wakes, without being spoken to.',
      it: 'Say hello when it wakes, without being spoken to.',
    },
    capability: null,
    withheld: 'You may not speak before you are spoken to. Wait to be addressed.',
  },
  {
    id: 'ask_workspace',
    label: 'Read your workspace',
    detail: {
      she: 'Look things up in the one folder she is pointed at.',
      he: 'Look things up in the one folder he is pointed at.',
      it: 'Look things up in the one folder it is pointed at.',
    },
    capability: 'ask_workspace',
    withheld: 'You can no longer look anything up in their workspace.',
  },
  {
    id: 'remember_this',
    label: 'Keep a note',
    detail: {
      she: 'Write a fact into her long-term notes when asked to.',
      he: 'Write a fact into his long-term notes when asked to.',
      it: 'Write a fact into its long-term notes when asked to.',
    },
    capability: 'remember_this',
    withheld: 'You can no longer write anything into your long-term notes.',
  },
]

/**
 * Everything allowed, which is what an installation that has never been asked
 * gets.
 *
 * Permissive by default and deliberately so: these are the capabilities this
 * build ships with, described in her tool list and in the settings window, and
 * a companion that arrives unable to hear you is not a safer companion — it is
 * a broken one. The switch exists so somebody can say no, not so the app can
 * say it for them.
 */
export const DEFAULT_GRANTS: Grants = {
  microphone: true,
  speak_first: true,
  ask_workspace: true,
  remember_this: true,
}

/**
 * What applies when a stored answer EXISTS and cannot be read.
 *
 * Not the default, and the distinction is the whole point — `@shared/policy`
 * draws the same line for retention and the argument is the same one. Absent
 * means nobody has said no, so everything is allowed. Unreadable means somebody
 * has an answer stored and it is unavailable, and resolving that as "allowed"
 * would settle an unreadable permission in the one direction that lets her do
 * something they may have said she may not.
 *
 * It fails loud rather than quiet: with these in force she cannot hear, cannot
 * greet, cannot look anything up and cannot write a note, which is a state
 * somebody notices in about four seconds. A permission that silently stayed on
 * is a state nobody notices at all.
 */
export const WITHHELD_GRANTS: Grants = {
  microphone: false,
  speak_first: false,
  ask_workspace: false,
  remember_this: false,
}

export function isGrant(value: unknown): value is Grant {
  return typeof value === 'string' && (GRANTS as readonly string[]).includes(value)
}

/**
 * Read a stored object as grants, field by field.
 *
 * FIELD BY FIELD rather than whole-or-nothing, unlike `parsePolicy`. Refusing
 * the whole object because one key is misspelt would restore every capability
 * somebody switched off, which is the direction that must not happen silently.
 *
 * ## Absent, `true`, `false` — and anything else
 *
 * Three states, not two, and the fourth is where the first version of this was
 * wrong. It read `held[id] !== false`, so a key present with a value of `null`,
 * `0` or `"no"` came back ALLOWED: corruption widened permission. A value that
 * is present and is not a boolean is not a refusal and it is not a grant
 * either — it is an answer nobody can read, and the safe reading of one of
 * those is not to allow. So:
 *
 *   - absent   — nobody has said no. Allowed.
 *   - `true`   — allowed.
 *   - `false`  — withheld.
 *   - anything else — withheld, because it cannot be read as permission.
 *
 * A value that is not an object at all is a different question — the whole
 * `grants` key is absent or nonsense, which is the absent case — so that keeps
 * the defaults. `readGrants` is what decides whether the FILE was unreadable.
 */
export function parseGrants(value: unknown): Grants {
  // ABSENT is `undefined` and nothing else. `{ "grants": null }` and
  // `{ "grants": [] }` are a container somebody wrote that this cannot read —
  // and returning the defaults for one re-enabled every permission, which is
  // the same widening as the per-key case one level up.
  if (value === undefined) return DEFAULT_GRANTS
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return WITHHELD_GRANTS
  const held = value as Record<string, unknown>
  const grants: Record<Grant, boolean> = { ...DEFAULT_GRANTS }
  for (const id of GRANTS) {
    // `Object.hasOwn`, not `=== undefined`. The rule above says ABSENT is what
    // means "nobody has said no", and a key that is present carrying `undefined`
    // is not absent — it is an answer nothing can read, which withholds. JSON
    // cannot express that, so this is exactness rather than a live hazard; the
    // point is that the check matches the sentence it is written under.
    grants[id] = Object.hasOwn(held, id) ? held[id] === true : DEFAULT_GRANTS[id]
  }
  return grants
}

/** Whether a capability may be offered and may run. Unknown names are allowed. */
export function allowsCapability(grants: Grants, name: string): boolean {
  const spec = GRANT_SPECS.find((one) => one.capability === name)
  // Not every capability has a grant — `recall_conversations` reads her own
  // archive and is not one of the four. A capability with no switch is governed
  // by nothing here, which is a different answer from being switched off.
  return spec === undefined || grants[spec.id]
}

/**
 * What she should say when she is asked to do something she may not.
 *
 * Reached from the dispatch, when a call arrives for a capability whose grant
 * has since been taken away. Named as a sentence rather than a status because a
 * model handed a bare failure picks a wording at random, and the one wording
 * that must not happen is her declining as though it were her own choice.
 */
export function withheldGuidance(name: string): string {
  const spec = GRANT_SPECS.find((one) => one.capability === name)
  const what = spec === undefined ? 'That' : spec.withheld
  return (
    `${what} They turned it off in settings. Say so plainly — that you cannot do it any ` +
    'more and that they switched it off — rather than declining as though it were your ' +
    'own choice, and do not guess at a result you did not get.'
  )
}

/**
 * The section of her prompt that says what has been taken away.
 *
 * Empty when she may do everything, so the ordinary session carries nothing
 * extra. Appended AFTER everything `instructionsFor` assembles, which is the
 * strongest instructional position — safe here in a way it would not be for
 * anything derived from what somebody said, because every word of it is ours.
 */
export function grantsNotice(grants: Grants): string {
  const off = GRANT_SPECS.filter((spec) => !grants[spec.id])
  if (off.length === 0) return ''
  return [
    '# What you may not do right now',
    'The person has turned these off. If one of them comes up, say plainly that you can no longer do it and that they switched it off. Do not try anyway, and do not report a result you did not get.',
    ...off.map((spec) => `- ${spec.withheld}`),
  ].join('\n')
}
