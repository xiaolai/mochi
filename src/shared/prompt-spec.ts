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
}
