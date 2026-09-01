/**
 * What a workspace must NOT contain for her to be allowed to look at it.
 *
 * Carried across from v1 with the measurement that produced it. She looks
 * things up by running `codex exec -s read-only` over a directory — and to
 * Codex, some filenames in that directory are **instructions rather than
 * content**. v1 measured it: an `AGENTS.md` sitting in the workspace put its
 * own payload straight into the spoken answer on the first try, and no flag
 * turns that off.
 *
 * So the refusal is loud rather than a filter. Somebody told "this file gives
 * instructions to the assistant, so I will not run" learns the rule; a file
 * that is quietly skipped teaches nothing and hides the day this list falls
 * behind the CLI.
 */

const RESERVED_KINDS = ['agents-md', 'execpolicy', 'skills', 'subagents'] as const
export type ReservedKind = (typeof RESERVED_KINDS)[number]

/**
 * Lowercased, because the check runs on filesystems that do not care.
 *
 * macOS is case-insensitive by default, so `agents.md` and `Agents.MD` are the
 * same file to `open()` and therefore the same file to Codex — but not to a
 * naive `=== 'AGENTS.md'`. A case-sensitive check would pass cleanly on the
 * development machine while leaving the measured vector wide open, which is the
 * precise shape of a defect that ships.
 */
export const RESERVED_NAMES: Readonly<Record<string, ReservedKind>> = {
  'agents.md': 'agents-md',
  // Loaded by 0.147.0 exactly as `AGENTS.md` is, and missed by the first
  // version of this list — blocklist rot arriving immediately rather than in
  // some future release. The installed CLI is still 0.147.0.
  'agents.override.md': 'agents-md',
  '.rules': 'execpolicy',
  '.agents': 'skills',
  '.codex': 'subagents',
}

/** One reserved name, where it was found. */
export interface WorkspaceHazard {
  readonly kind: ReservedKind
  /** Absolute, so somebody can go and deal with the file. */
  readonly path: string
}

/**
 * Whether she may look at this workspace.
 *
 * `unreadable` is a refusal, not a shrug. A directory that cannot be listed is
 * a directory whose contents are unknown, and "unknown" has to mean "no" for a
 * guard — the alternative is a scan that silently passes because it never
 * happened, which looks identical to a scan that passed.
 */
export type WorkspaceVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly why: 'reserved'; readonly hazards: readonly WorkspaceHazard[] }
  | { readonly ok: false; readonly why: 'unreadable'; readonly path: string }

/**
 * What `web_search` in a Codex config actually accepts.
 *
 * Carried from v1 rather than reasoned about, and the difference is not
 * academic: a first attempt here invented `on`/`off`, which typechecked, passed
 * its tests — they only asserted the string reached the argv — and was rejected
 * by the CLI on the first real run with "unknown variant `off`, expected one of
 * `disabled`, `cached`, `indexed`, `live`". That is the shape of failure
 * `realtime/frames.ts` already has a rule about: a value reasoned from a page
 * rather than asked of the thing that consumes it.
 *
 * `follow` is not one of Codex's values — it is the ABSENCE of the flag, which
 * leaves whatever the user configured machine-wide in charge. That is a
 * first-class choice rather than a gap: overriding somebody's own setting
 * because we did not think to ask is a decision made out of not having looked.
 */
/**
 * How ready the local Codex is, as the settings window may hear it.
 *
 * The kinds of `main/codex/status.ts`'s `CodexStatus` and nothing else from it.
 * That type carries a `Date`, a resolved binary path and the list of
 * directories that were searched — a search path is a home directory, which is
 * a username — and none of that belongs on a wire the renderer reads.
 * `readinessOf` maps one to the other with an exhaustive switch, so a new
 * status that nobody decided how to show fails to compile rather than shipping
 * as a blank pane.
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

/**
 * What a person can DO about a credential fault.
 *
 * A KEY, not a sentence: the words are user-visible and belong beside the
 * control that shows them, which is in the renderer. `remedyFor` is exhaustive
 * over `CodexStatus`, so a new failure mode cannot ship without somebody
 * deciding what anybody does about it.
 *
 * There is no `store-key`. This build has exactly one credential source — the
 * Codex login, which is the subscription her voice already runs on — so every
 * answer here is about that one sign-in. See `voice/credential.ts`.
 */
/**
 * The Codex version this build's workspace confinement was measured against.
 *
 * Not a minimum and not a preference — a PROVENANCE. `ask.ts` passes
 * `-c project_doc_fallback_filenames=[]` on every lookup, and the whole safety
 * of also handing somebody a `-p <profile>` rests on `-c` replacing a profile's
 * value rather than merging with it. That is a BEHAVIOUR of the CLI rather than
 * a documented contract, so it was measured rather than assumed:
 * `scripts/verify-codex-precedence.sh` records 2026-08-19, codex-cli 0.148.0.
 *
 * An older CLI still runs and she can still look things up with it. What is not
 * established on it is the confinement, because the measurement was taken on
 * this version — which is why the card that reports it offers an update rather
 * than drawing a working tool as broken.
 *
 * It lives here rather than in the script because two things now need it: the
 * gate that re-measures after an upgrade, and the pane that tells somebody their
 * CLI predates the measurement. Two copies of a number whose whole job is to be
 * the date of an experiment would be two experiments.
 */
export const CONFINEMENT_MEASURED_AGAINST = '0.148.0'

const REMEDIES = ['install', 'reinstall', 'login', 'retry'] as const
export type Remedy = (typeof REMEDIES)[number]

/**
 * What each state MEANS, in one line, in the one place both processes read.
 *
 * Shared rather than written in the pane, for `GRANT_SPECS`' reason: main
 * writes the same sentence into the problems strip that the settings window
 * draws, and two tables would let those two disagree about the same machine.
 * Records rather than a switch in each, so a state nobody wrote a sentence for
 * fails to compile.
 *
 * No pronoun anywhere in here. Every one of these is about THIS MACHINE — a
 * binary, a sign-in, a token — and the consequence for her is a separate
 * sentence the pane adds, which is where the pronoun belongs.
 */
export const CODEX_SAYS: Readonly<Record<CodexReadiness, string>> = {
  ready: 'The Codex CLI is installed and signed in.',
  'not-installed': 'The Codex CLI could not be found on this machine.',
  unusable: 'The Codex CLI is here and would not run.',
  // Not "it is broken". A ten-second deadline is generous for `codex
  // --version` and still reachable on a machine that is thrashing, and telling
  // somebody to reinstall a working tool because their laptop was busy is
  // advice that costs an afternoon.
  'timed-out': 'The Codex CLI did not answer in time. This machine may simply have been busy.',
  'logged-out': 'The Codex CLI is installed, and nobody is signed in.',
  /*
    The state this whole check exists for.

    Codex reports itself signed in while holding an expired access token,
    because it owns a refresh token and renews on its next run. This app cannot
    renew — the JWT's `client_id` is Codex's — so a token Codex is content with
    is unusable here, and the failure otherwise arrives as a bare 401 at the
    moment somebody speaks to her.
  */
  stale: 'The Codex sign-in has expired. Only Codex can refresh it, and it refreshes when it runs.',
  unreadable: 'The Codex credential is here and could not be read.',
}

/** What a person does about it. One line, an instruction, never a diagnosis. */
export const REMEDY_SAYS: Readonly<Record<Remedy, string>> = {
  install: 'Install it with `npm i -g @openai/codex`.',
  reinstall: 'Reinstall it with `npm i -g @openai/codex`.',
  // Deliberately not "wait for Codex to refresh it". Codex refreshes when Codex
  // runs, and somebody who has not opened it in a fortnight has nothing
  // scheduled that would fix this on its own.
  login: 'Run `codex` once in a terminal to sign in.',
  retry: 'Nothing needs fixing — ask again.',
}

export const WEB_SEARCH_MODES = ['follow', 'disabled', 'cached', 'indexed', 'live'] as const
export type WebSearchMode = (typeof WEB_SEARCH_MODES)[number]

export function isWebSearchMode(value: unknown): value is WebSearchMode {
  return typeof value === 'string' && (WEB_SEARCH_MODES as readonly string[]).includes(value)
}
