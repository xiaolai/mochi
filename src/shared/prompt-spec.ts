/**
 * What one editable prompt IS.
 *
 * A leaf module, holding nothing but the shape.
 *
 * ## Why it is not in `prompts.ts`, where it was
 *
 * `prompts.ts` used to import a second catalogue from `prompts-kept.ts`, and
 * that file imported this type back out of `prompts.ts` — a cycle, and the only
 * real one in the codebase. Both went with the `kept` tools on 2026-08-26; the
 * split stays, because every caller names the type through `prompts.ts` and
 * moving it back would be a change of address for no reason.
 *
 * `.claude/loc-guardian.local.md` states the rule this follows, and it was
 * written from two earlier instances of the same shape: *"A cycle means the
 * layer is missing, not that the split was wrong."* Both of those were fixed
 * with a third module below the two, never by re-merging, and both are named
 * there — `store/persona-files.ts` and `store/turn-row.ts`. This is the third.
 *
 * It imports nothing, which is what makes it a floor rather than another step.
 */

export interface PromptSpec {
  /** Stable across renames and releases: it is the key on disk. */
  readonly key: string
  /** For the pane. */
  readonly title: string
  /** What it does, and what changing it changes. Shown above the editor. */
  readonly purpose: string
  /** What ships. Never what is necessarily sent — see `store/prompts.ts`. */
  readonly text: string
  /** Phrases whose absence is worth reporting. Never enforced. */
  readonly requires: readonly string[]
  /**
   * The longest an override may be, or absent when nothing bounds it.
   *
   * ENFORCED, unlike `requires`, and the difference is the failure each one
   * describes. A dropped phrase breaks something downstream that a person may
   * have meant to break; an over-long description breaks nothing and is simply
   * paid for, on every session, for as long as the session lasts. There is no
   * version of it somebody meant.
   *
   * Only the tool entries carry one today. Their bound is `manifest.ts`'s own —
   * the same number a manifest is checked against at load — because an override
   * lands in the same field on the same wire, and a limit that applied only to
   * the shipped text would be a limit with a door beside it.
   */
  readonly limit?: number
}
