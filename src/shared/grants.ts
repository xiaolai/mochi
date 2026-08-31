/**
 * What she may do while nobody is watching.
 *
 * ## A standing panel, not an install-time modal
 *
 * 1c's receipt asked for every permission at the moment of installing a
 * package, which is the worst moment to ask: nobody has used the thing yet, so
 * every answer is a guess, and the guess is then permanent. 5b replaces it with
 * switches that are always there and always answerable — and each carries
 * **when it was last used**, which is what turns "should she be allowed to?"
 * into a decision somebody can actually make.
 *
 * The plugin sandbox and the grant broker are struck (`plan-capabilities.md`
 * W-F): capabilities are compiled in now, so a grant is not a fence around
 * somebody else's code. It is a statement about what this machine lets HER do.
 *
 * ## There were five, then three. `microphone` was the first to go
 *
 * "Hear you" opened and closed the audio track, and every state it could reach
 * was reachable twice over. macOS owns microphone permission for this
 * application and revokes it from System Settings, where somebody looking for
 * that answer actually goes; resting closes the session and hands the device
 * back, from the key, the tray and a click on her. What the switch alone could
 * produce was *awake, connected, and deaf* — a state in which she can still
 * greet you and cannot hear a word of the reply, which is not a permission
 * anybody wants and reads as the app being broken.
 *
 * Deleted rather than hidden. A grant with no control is a line in
 * `preferences.json` that only a file editor can reach, which is the defect
 * `LOOKING`'s header names — and it took `SessionConfig.microphone`, the
 * renderer's `mayHear`, `closeMicrophone`, the reconnect-on-regrant path and
 * the shelf's third microphone state with it.
 *
 * `keep_things` and `set_expression` went the same way and for a stronger
 * reason: `usage.json` on the real installation records a last-called time for
 * every tool that has ever run, and neither of those four tools appears in it
 * at all. A switch governing something nothing has ever done is a decision
 * nobody can make.
 *
 * ## Per character, and this paragraph used to say the opposite
 *
 * It said "app-level, not per character", citing `plan-shell.md`. That stopped
 * being true in 2026-08: `store/grants.ts` files permissions under a persona id
 * and explains at length why — a grant has to survive a character's package
 * being updated, and it has to die with her, because ids are derived from names
 * and handed back out once free.
 *
 * The stale sentence mattered more once `recall_codex` arrived, because that
 * one authorises reading another application's archive: a reader who believed
 * the header would have expected one answer per machine and found one per
 * character. The switch a person sees belongs to the character they are
 * looking at.
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

/** The order is the order they are drawn in. */
import type { ByPronoun } from './pronoun'

import { promptsFor, type PromptSpec } from './prompts'

/** What `grantsNotice` reads a catalogued prompt with. See `@shared/prompts`. */
export type Prompts = (key: string) => string

const CATALOGUE: readonly PromptSpec[] = promptsFor([])
/**
 * The wording this build ships. See `instructions.ts` for why it is named
 * rather than being a default a caller reaches by omission.
 */
export const SHIPPED_GRANT_PROMPTS: Prompts = (key) =>
  CATALOGUE.find((spec) => spec.key === key)?.text ?? ''

export const GRANTS = ['speak_first', 'ask_workspace', 'remember_this', 'recall_codex'] as const

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
   * "Hear you" whoever is worn, and five identical strings is a choice that is
   * not one. This sentence is about her, so it has to vary -- `label()` in
   * `pronoun.ts` is what reads either kind.
   */
  readonly detail: ByPronoun
  /**
   * The capabilities this withdraws from the wire, or empty when it governs
   * something that is not a tool call.
   *
   * Null is also what says the row has no "last used" to show: the ledger
   * records calls, and speaking first is not one. 5b's acceptance is that the
   * column is real or the row does not claim it, so this is what the window
   * branches on rather than on a time that happens to be missing.
   */
  readonly capabilities: readonly string[]
  /** What she is told while it is off. One line, in the second person. */
  readonly withheld: string
}

export const GRANT_SPECS: readonly GrantSpec[] = [
  {
    id: 'speak_first',
    label: 'Speak first',
    detail: {
      she: 'Say hello when she wakes, without being spoken to.',
      he: 'Say hello when he wakes, without being spoken to.',
      it: 'Say hello when it wakes, without being spoken to.',
    },
    capabilities: [],
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
    capabilities: ['ask_workspace'],
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
    capabilities: ['remember_this'],
    withheld: 'You can no longer write anything into your long-term notes.',
  },
  {
    id: 'recall_codex',
    label: 'Read your Codex history',
    /*
      WHOSE data, that it is READ-ONLY, and THAT RESULTS LEAVE THE MACHINE.

      The other three describe something Mochi does with its own state, so
      "your workspace" is enough. This one is about a second application's
      archive, and somebody deciding on it needs the facts before they decide
      rather than after.

      "Never writes to it" was the first wording and it promised more than the
      code keeps: `present.ts` documents that opening a live WAL database
      read-only may create a `-shm` beside it. The switch now says what is
      actually true — read-only, never changed, and a scratch file may appear.

      The transmission clause was missing entirely, and it is the one that
      matters most. "Reads
      it and never writes to it" is true and reads as *local*, which the feature
      is not: a recall result is a `function_call_output` and goes to OpenAI's
      Realtime service with the rest of the conversation. A disclosure that
      lives only in the README is not consent at the switch — this is the
      moment somebody is actually deciding, and it is the sentence they read.
    */
    detail: {
      she: 'Let her search your own Codex history on this machine. She opens it read-only and never changes it, though SQLite may leave a scratch file beside it. What she finds is sent to OpenAI as part of the conversation, and the check for keys and tokens is best-effort.',
      he: 'Let him search your own Codex history on this machine. He opens it read-only and never changes it, though SQLite may leave a scratch file beside it. What he finds is sent to OpenAI as part of the conversation, and the check for keys and tokens is best-effort.',
      it: 'Let it search your own Codex history on this machine. It opens it read-only and never changes it, though SQLite may leave a scratch file beside it. What it finds is sent to OpenAI as part of the conversation, and the check for keys and tokens is best-effort.',
    },
    capabilities: ['recall_codex'],
    withheld: 'You can no longer look at anything they said to Codex.',
  },
]

/**
 * What an installation that has never been asked gets.
 *
 * Permissive by default for everything Mochi itself does, and deliberately so:
 * these are the capabilities this build ships with, described in her tool list
 * and in the settings window, and a companion that arrives unable to greet you
 * or remember anything is not a safer companion — it is a broken one. The switch
 * exists so somebody can say no, not so the app can say it for them.
 *
 * ## `recall_codex` is FALSE, and it is the exception that proves the argument
 *
 * The paragraph above holds because the other three govern things this app does
 * with its own state. This one governs reading **another application's** archive
 * of everything you have worked on — nine thousand conversations that nobody
 * wrote for her and that she cannot edit or delete through this app. Default-on
 * would mean an update silently handed her all of it, and the panel's whole
 * argument is that a permission is a decision somebody made.
 *
 * It has to be false HERE and not merely present in `WITHHELD_GRANTS`, which is
 * where the first version of this was wrong: `parseGrants(undefined)` returns
 * these defaults, and `parseGrants` falls back to `DEFAULT_GRANTS[id]` for every
 * key a stored file does not carry — so a grant that was only listed as
 * withheld-on-failure would be ON for everybody whose preferences predate it.
 * `grants.test.ts` asserts the default rather than the intention.
 */
export const DEFAULT_GRANTS: Grants = {
  speak_first: true,
  ask_workspace: true,
  remember_this: true,
  recall_codex: false,
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
 * It fails loud rather than quiet: with these in force she cannot greet, cannot
 * look anything up, cannot write a note and has one face, which is a state
 * somebody notices in about four seconds. A permission that silently stayed on
 * is a state nobody notices at all.
 */
export const WITHHELD_GRANTS: Grants = {
  speak_first: false,
  ask_workspace: false,
  remember_this: false,
  recall_codex: false,
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

/**
 * The grants that apply ON THE WIRE, which is not always what is stored.
 *
 * A capability can be permitted and still not performable — `recall_codex` is
 * granted the moment somebody flips the switch, and its index takes seconds to
 * build. Offering a tool in that window would let her call something that
 * answers "I could not look" for no reason a person could act on.
 *
 * So readiness is applied HERE, over the stored answer, and it is deliberately
 * NOT written back: consent is what somebody chose, and an app that rewrote it
 * to represent a machine state would have made the switch mean two things. The
 * settings panel reads the stored grants; the wire reads these.
 *
 * ## What this is NOT for, and the sentence that made the difference
 *
 * It governs what is OFFERED. It must not govern what is REFUSED at the moment
 * of a call, and it did: the dispatch asked this before running a handler, so a
 * capability that was permitted and merely still building was answered with
 * `withheldGuidance` — *"They turned it off in settings"*. They had not. She
 * would have said something false about a decision the person never made, which
 * is worse than any of the states this was trying to tidy.
 *
 * The dispatch reads the STORED grants now, and a permitted-but-unready
 * capability reaches its handler and answers `unavailable` — "I could not
 * look", which is true, is one of the three statuses that already exist, and is
 * the sentence that fits. So the collapse holds where it belongs, at the wire,
 * and nowhere else.
 */
export function offeredGrants(stored: Grants, unready: ReadonlySet<Grant>): Grants {
  if (unready.size === 0) return stored
  const offered: Record<Grant, boolean> = { ...stored }
  for (const id of unready) offered[id] = false
  return offered
}

/** Whether a capability may be offered and may run. Unknown names are allowed. */
export function allowsCapability(grants: Grants, name: string): boolean {
  const spec = GRANT_SPECS.find((one) => one.capabilities.includes(name))
  // Not every capability has a grant — `recall_conversations` reads her own
  // archive and is not one of the three. A capability with no switch is governed
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
  const spec = GRANT_SPECS.find((one) => one.capabilities.includes(name))
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
 *
 * `prompts` is REQUIRED, and was defaulted. `whatSheMayDo` called this with one
 * argument, so the two prompts below read the shipped text however they had been
 * rewritten — the same silent discard `instructionsFor`'s own parameter
 * describes at length.
 */
export function grantsNotice(grants: Grants, prompts: Prompts): string {
  const off = GRANT_SPECS.filter((spec) => !grants[spec.id])
  if (off.length === 0) return ''
  return [
    prompts('grants.heading'),
    prompts('grants.notice'),
    ...off.map((spec) => `- ${spec.withheld}`),
  ]
    .filter((line) => line !== '')
    .join('\n')
}
