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

export const RESERVED_KINDS = ['agents-md', 'execpolicy', 'skills', 'subagents'] as const
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
export const WEB_SEARCH_MODES = ['follow', 'disabled', 'cached', 'indexed', 'live'] as const
export type WebSearchMode = (typeof WEB_SEARCH_MODES)[number]

export function isWebSearchMode(value: unknown): value is WebSearchMode {
  return typeof value === 'string' && (WEB_SEARCH_MODES as readonly string[]).includes(value)
}
