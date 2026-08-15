/**
 * The vocabulary for refusing to run a delegation.
 *
 * In `shared/` from the start rather than in `main/codex/`, for the reason
 * `Remedy` already had to move: both processes name these. Main
 * decides, the settings window explains, and `shared` importing from `main`
 * drags the node types into the renderer build.
 *
 * Values, never sentences. A path is a value; "there is an AGENTS.md
 * in your workspace" is a sentence and belongs in `i18n/`.
 */

/**
 * The file and directory names Codex treats as INSTRUCTIONS rather than as data.
 *
 * Measured, not guessed: an `AGENTS.md` dropped into the
 * delegation workspace put its payload straight into the field she reads aloud,
 * on the first attempt, while the same demand written into an ordinary data file
 * did not propagate. The difference was the filename. `AGENTS.md` is loaded
 * automatically from the working root upward, and **nothing suppresses it** --
 * `--ignore-user-config` covers `config.toml`, `--ignore-rules` covers
 * execpolicy, neither touches it.
 *
 * The other three come from Codex's instruction layering -- the published list
 * of places it reads instructions from.
 *
 * ## Why names and not contents
 *
 * This refuses on the NAME EXISTING, and does not look inside. Reading the file
 * to decide whether it looks hostile is a classifier, and a classifier that is
 * wrong once is worse than useless here -- it would have to be wrong in the
 * direction of "this looks fine" exactly when it matters. There is no legitimate
 * reason for any of these to appear in a directory the application owns, so
 * presence alone is the answer.
 *
 * ## This is a blocklist, and blocklists rot
 *
 * It is pinned to Codex 0.147.0. A future version that reads instructions from a
 * fifth place will walk straight past this, silently. That is a real limitation
 * and the reason the refusal is loud rather than a filter: a user who is told
 * "this file gives instructions to the assistant, so I will not run" learns the
 * rule, whereas a file that is quietly skipped teaches nothing and hides the day
 * the list falls behind.
 */
import type { Remedy } from './auth'

export const RESERVED_KINDS = ['agents-md', 'execpolicy', 'skills', 'subagents'] as const
export type ReservedKind = (typeof RESERVED_KINDS)[number]

/**
 * Lowercased, because the check runs on filesystems that do not care.
 *
 * macOS is case-insensitive by default, so `agents.md` and `Agents.MD` are the
 * same file to `open()` and therefore the same file to Codex -- but not to a
 * naive `=== 'AGENTS.md'`. A case-sensitive check here would pass cleanly on the
 * development machine while leaving the measured vector wide open, which is the
 * precise shape of a defect that ships.
 */
export const RESERVED_NAMES: Readonly<Record<string, ReservedKind>> = {
  'agents.md': 'agents-md',
  // Loaded by 0.147.0 exactly as `AGENTS.md` is, and missed by the first
  // version of this list -- which is the blocklist rot the header warns about,
  // arriving immediately rather than in some future release.
  'agents.override.md': 'agents-md',
  '.rules': 'execpolicy',
  '.agents': 'skills',
  '.codex': 'subagents',
}

/** One reserved name, where it was found. */
export interface WorkspaceHazard {
  readonly kind: ReservedKind
  /** Absolute, so the user can go and deal with the file. */
  readonly path: string
}

/**
 * Whether a delegation may run.
 *
 * `unreadable` is a refusal, not a shrug. A directory that cannot be listed is a
 * directory whose contents are unknown, and "unknown" has to mean "no" for a
 * guard -- the alternative is a scan that silently passes because it never
 * happened, which looks identical to a scan that passed.
 */
export type WorkspaceVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly why: 'reserved'; readonly hazards: readonly WorkspaceHazard[] }
  | { readonly ok: false; readonly why: 'unreadable'; readonly path: string }

/**
 * One model the local Codex says it can use.
 *
 * Read from `~/.codex/models_cache.json`, which the CLI maintains itself, so
 * discovery costs no network call and no process. That matters:
 * populating the cache means a real `codex exec`, and §8 measured that at
 * twenty seconds minimum on this network -- far too slow to sit on a startup
 * path.
 */
export interface CodexModel {
  readonly slug: string
  /**
   * As OpenAI spells it, never translated.
   *
   * A model name is a proper noun, like the language names in `i18n/` that are
   * always written in their own language. Translating `gpt-5.6-sol` would make
   * it impossible to match what the user sees here against what `codex` prints.
   */
  readonly displayName: string
  /**
   * The reasoning levels THIS model supports, not a global list.
   *
   * Per-model because they genuinely differ -- measured: `gpt-5.6-luna` stops at
   * `xhigh` while `gpt-5.6-sol` reaches `ultra`. Offering a level the selected
   * model does not have is the familiar defect class: every flag reports
   * success and the thing quietly does not do what was asked.
   */
  readonly efforts: readonly string[]
  /** This model's own default, which also differs per model (sol: low, terra: medium). */
  readonly defaultEffort: string
  /**
   * `supported_in_api`. Conjoins with `credentialSource`, it does not stand alone.
   *
   * `gpt-5.3-codex-spark` is false here: usable through a Codex login, not
   * through a pasted API key. A picker that ignores this offers a model that
   * fails at run time; the credential half of this pair is handled separately.
   */
  readonly inApi: boolean
}

/**
 * Why there is nothing to choose from. A tag, never a sentence.
 *
 * `absent` is the ordinary case on a machine whose Codex has not run yet, and
 * is emphatically not an error -- the cache is written at session start. It is
 * separated from `unreadable` because only one of the two is worth telling
 * somebody to do something about.
 */
export type CatalogProblem = 'absent' | 'unreadable' | 'malformed'

/**
 * Always a list, plus the reason when it is empty.
 *
 * Not a `{ok: false}` union: every caller wants to render a list, and a shape
 * that forces a branch before reaching an empty array makes "no models" and
 * "models failed to load" two code paths where the interface only ever shows
 * one difference -- whether a sentence appears beneath the control.
 */
export interface ModelCatalog {
  readonly models: readonly CodexModel[]
  readonly problem: CatalogProblem | null
}

/**
 * Whether the delegation may search, overriding the user's own Codex setting.
 *
 * `follow` passes no flag at all, so `~/.codex/config.toml` decides -- the same
 * first-class "follow my Codex" the model and effort use. The other four are
 * what Codex accepts, taken from its own error message rather than guessed:
 * `unknown variant, expected one of disabled, cached, indexed, live`.
 *
 * It is exposed because `-c` overrides any config key, so tying this to the
 * machine-wide setting would have been a choice we made for the user out of
 * nothing but not having looked.
 */
export const WEB_SEARCH_MODES = ['follow', 'disabled', 'cached', 'indexed', 'live'] as const
export type WebSearchMode = (typeof WEB_SEARCH_MODES)[number]

export function isWebSearchMode(value: unknown): value is WebSearchMode {
  return typeof value === 'string' && (WEB_SEARCH_MODES as readonly string[]).includes(value)
}

/**
 * The instructions sent with every delegated question, as a DEFAULT.
 *
 * Editable, and that is the point. This text was hard-coded, and hard-coding it
 * meant shipping one opinion about what an answer should be -- "say which one
 * the answer came from", "do not fall back on what you happen to remember" --
 * to everybody, including people whose workspace and habits make a different
 * opinion correct. A prompt is configuration.
 *
 * `{question}` is replaced. If an edited template does not contain it, the
 * question is appended instead: losing the question entirely because somebody
 * deleted a placeholder they did not know was load-bearing would be a delegation
 * that runs and asks nothing.
 */
export const DEFAULT_DELEGATION_PROMPT = [
  'Answer from the files in your working directory and, when the question needs current information, from a web search.',
  'Say which one the answer came from.',
  'If you cannot find it in either, say exactly that. Do not fall back on what you happen to remember.',
  'Never guess, never estimate, and never present anything as fact that you did not read in a file or find in a search.',
  '',
  'The question is: {question}',
].join('\n')

/** The longest prompt or rule block that may be stored. */
export const PROMPT_LIMIT = 8_000

/** How a delegation gets permission to run. */
export const DELEGATION_TRIGGERS = ['hotkey', 'anytime'] as const
export type DelegationTrigger = (typeof DELEGATION_TRIGGERS)[number]

/**
 * How long a press -- or the window an answer renews -- stays good for.
 *
 * In `shared/` rather than beside the logic in `main/codex/authorisation.ts`,
 * for the reason `Remedy` had to move: the SETTINGS PANE states this number,
 * and `authorisation.ts` imports `node:perf_hooks`, so the renderer cannot
 * reach it. The pane consequently wrote "a minute" as prose -- which meant
 * changing a security boundary in one file left the interface describing the
 * old one, confidently and in two languages.
 *
 * Generous rather than tight: the utterance has to be spoken and transcribed
 * before it is spent, and being slightly too long costs one extra authorised
 * read, while being too short costs a key that appears not to work.
 */
export const AUTHORISATION_WINDOW_MS = 60_000

export function isDelegationTrigger(value: unknown): value is DelegationTrigger {
  return typeof value === 'string' && (DELEGATION_TRIGGERS as readonly string[]).includes(value)
}

/**
 * How ready the local Codex is, as the settings window may hear it.
 *
 * The kinds of `main/codex/status.ts`'s `CodexStatus` and nothing else from it.
 * That type carries a `Date` and the list of directories that were searched --
 * a search path is a home directory, which is a username -- and none of that
 * belongs on a wire the renderer reads. `readinessOf` maps one to the other
 * with an exhaustive switch, so a new status that nobody decided how to show
 * fails to compile rather than shipping as a blank pane.
 */
export const CODEX_READINESS = [
  'ready',
  'not-installed',
  'unusable',
  'timed-out',
  'logged-out',
  'stale',
  'unreadable',
] as const
export type CodexReadiness = (typeof CODEX_READINESS)[number]

/** Whether Codex's own configuration lists the workspace as trusted. */
export const TRUST_STATES = ['trusted', 'untrusted', 'absent', 'unreadable'] as const
export type TrustStateKind = (typeof TRUST_STATES)[number]

/**
 * Everything the delegation section renders, resolved by main.
 *
 * A NAMED interface rather than an object literal inside `SettingsSnapshot`,
 * because `main/voice/key-store.test.ts` reads that interface off the source
 * tree with a regex terminated by a `}` in the first column. Nesting would
 * still pass today; there is no reason to test that boundary next to a check
 * whose job is keeping credentials off this wire.
 */
export interface DelegationView {
  readonly settings: DelegationSettings
  readonly catalog: ModelCatalog
  /** Status FIRST: an unusable Codex is the common failure, and it is a fault. */
  readonly readiness: CodexReadiness
  /** What to do about it, keyed for `i18n`. Null when nothing is wrong. */
  readonly remedy: Remedy | null
  readonly trust: TrustStateKind
  /**
   * Whether WE wrote the trust entry, when there is one.
   *
   * Carried because removal deliberately touches only our own tables -- so
   * without it the pane offered an off switch for a table somebody else wrote,
   * and turning it off returned success and changed nothing. Tracking ownership
   * and then discarding it defeated the reason for tracking it.
   */
  readonly trustIsOurs: boolean
  /**
   * What "follow my Codex" resolves to, read from `config.toml`.
   *
   * Not opaque, and treating it as opaque hid two things worth seeing: which
   * model actually runs, and at what depth. On the development machine that is
   * `ultra`, which is most of why a delegation took over a minute.
   *
   * Either field may be `null` when the file does not say.
   */
  readonly codexDefault: { readonly model: string | null; readonly effort: string | null }
}

/**
 * How this MACHINE runs Codex. Not a property of any persona.
 *
 * Same judgement `credentialSource` is stored under, in the same file, for the
 * same stated reason: it is about what this computer has been set up with, and
 * wearing a different character must not change which model runs or how it is
 * authorised. A persona called "teacher" holds no opinion about sol versus
 * terra.
 */
export interface DelegationSettings {
  /**
   * `null` is a CHOICE, not an absence: follow whatever `~/.codex/config.toml`
   * says.
   *
   * Deliberately not "use ours if set, else Codex's". That shape was refused
   * for credentials because it produces the one question a support
   * thread cannot answer -- which one is it actually using? A first-class
   * "follow my Codex" beats a precedence rule nobody can see the result of.
   */
  readonly model: string | null
  /** `null` for the same reason, and additionally because the valid set depends on `model`. */
  readonly effort: string | null
  readonly trigger: DelegationTrigger
  /**
   * Whether to add this workspace to Codex's own trusted list.
   *
   * Off by default because it writes to a file that belongs to another program.
   * Note it is NOT needed for our own runs -- `codex exec -s read-only` runs
   * with approval `never` in an untrusted directory, verified in a spike. It
   * exists so the USER is not asked when they open Codex there themselves.
   */
  readonly trustWorkspace: boolean
  /**
   * What to tell Codex alongside the question. `null` uses the built-in text.
   *
   * `null` rather than a copy of the default, so somebody who never touches it
   * keeps getting a default that improves -- and so "I have not changed this"
   * and "I have changed it back to today's wording" stay different states.
   */
  readonly prompt: string | null
  readonly webSearch: WebSearchMode
}

export const DEFAULT_DELEGATION: DelegationSettings = {
  model: null,
  effort: null,
  prompt: null,
  // Follow the user's own Codex, like the model and the effort above.
  webSearch: 'follow',
  // The keypress stays the default. `anytime` is one click
  // away and says what it costs, which is the difference between refusing
  // somebody and letting them decide.
  trigger: 'hotkey',
  trustWorkspace: false,
}

/**
 * Coerce whatever is on disk, never throw.
 *
 * Shaped like `readSound`: an absent key is the ordinary upgrade case and
 * yields the defaults, so a preferences file written before this milestone
 * loads without losing anything else in it.
 *
 * `model` and `effort` are NOT validated against a catalog here. This module
 * cannot see `~/.codex`, and a slug that has stopped existing is a thing to
 * report where the list is known rather than to silently erase from the file --
 * the user chose it, and a Codex that is merely offline should not cost them
 * that choice.
 */
/** What a model slug or a reasoning level may look like. See `readDelegation`. */
const SLUG = /^[a-z0-9][a-z0-9.-]{0,63}$/

/**
 * Shared with the catalog parser on purpose.
 *
 * Two grammars -- one deciding what may be OFFERED and one deciding what may be
 * SAVED -- disagree the moment either moves, and the symptom is a picker whose
 * selection silently does not stick.
 */
export function isDelegationSlug(value: unknown): value is string {
  return typeof value === 'string' && SLUG.test(value)
}

/**
 * Apply a PARTIAL update from an untrusted message onto what is stored.
 *
 * The same split `mergeSound` documents: `readDelegation` reads a file, where
 * absent means "use the default", and an IPC message carries only what changed,
 * where absent means "leave it". Reading a message the file way let a partial
 * payload clear the model, the prompt, the effort, the search mode or the
 * trigger -- and report that it had saved.
 */
export function mergeDelegation(stored: DelegationSettings, message: unknown): DelegationSettings {
  const fields =
    typeof message === 'object' && message !== null && !Array.isArray(message)
      ? (message as Record<string, unknown>)
      : {}
  return readDelegation({ ...stored, ...fields })
}

export function readDelegation(value: unknown): DelegationSettings {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return DEFAULT_DELEGATION
  }
  const record = value as Record<string, unknown>
  const slug = (key: 'model' | 'effort'): string | null => {
    const stored = record[key]
    // These two become `codex exec` ARGV, and the effort additionally becomes
    // part of a TOML expression (`model_reasoning_effort="…"`). So the shape
    // is enforced here rather than assumed: a quote would end that expression
    // early, a NUL makes `spawn` throw, and an unbounded value is an `E2BIG`
    // this app would have handed to itself. Real slugs and levels are lowercase
    // words, digits, dots and hyphens -- anything else is not a value this
    // version can have written, so it is dropped rather than repaired.
    return isDelegationSlug(stored) ? stored : null
  }
  const model = slug('model')
  const stored = record['prompt']
  return {
    model,
    // Bounded, and empty means "use the default" rather than "send nothing":
    // clearing a box is how somebody asks for the original back, not how they
    // ask for a delegation with no instructions at all.
    prompt:
      typeof stored === 'string' && stored.trim() !== '' && stored.length <= PROMPT_LIMIT
        ? stored
        : null,
    webSearch: isWebSearchMode(record['webSearch']) ? record['webSearch'] : 'follow',
    // Kept INDEPENDENTLY of the model, and the rule that used to stand here was
    // a bug of exactly the kind this file keeps producing.
    //
    // `-c model_reasoning_effort=…` is its own flag; it does not need a model.
    // Clearing it whenever the model was `null` meant the effort control -- the
    // one added specifically so somebody following Codex could still ask for a
    // faster answer -- saved nothing and snapped back on the next repaint. The
    // pane offered it, this line threw it away, and the pane's own test used a
    // stub save so it never crossed here.
    effort: slug('effort'),
    trigger: isDelegationTrigger(record['trigger'])
      ? record['trigger']
      : DEFAULT_DELEGATION.trigger,
    trustWorkspace:
      typeof record['trustWorkspace'] === 'boolean'
        ? record['trustWorkspace']
        : DEFAULT_DELEGATION.trustWorkspace,
  }
}
