/**
 * What a capability IS, as one object.
 *
 * ## Why the manifest and the handler are the same value
 *
 * They were two things in two trees: `resources/capabilities/<name>/manifest.json`
 * read off disk, and an entry in a `Map` in the middle of main. Nothing joined
 * them until a call arrived, so a manifest with no handler was a state the
 * compiler could not see — and it shipped. `ask_workspace` was declared and
 * unimplemented from the rewrite until 2026-08-19, and `remember_this` still was
 * when this file was written: she was told she could look things up, tried, and
 * was told she could not.
 *
 * A value of this type cannot be in that state. There is no way to write a
 * manifest here without writing the handler beside it, so the defect above is a
 * missing property rather than a sentence she says out loud.
 *
 * ## Why `kind` is a union and not a boolean
 *
 * The two are answered differently on the wire, and that difference is the whole
 * of findings §1:
 *
 * - an `immediate` capability settles the call outright, and she has the answer
 *   before her next breath;
 * - a `deferred` one acknowledges now and DELIVERS later on the same `call_id`,
 *   so she says something like "let me look", carries on talking, and completes
 *   the sentence when the answer lands.
 *
 * §8 measured `codex exec` at a twenty-second floor. Answering that
 * synchronously would leave her silent for twenty seconds mid-conversation,
 * which reads as a crash. A discriminated union means the dispatch cannot send a
 * slow handler down the fast path; a boolean would let it.
 *
 * ## Why this file is here and not in `@shared`
 *
 * `CapabilityDeps` names things that only exist in main — the archive, the
 * userData path, where the Codex CLI was found. `src/shared` is typechecked by
 * the renderer project, which has no Node types, so a shared file reaching into
 * `src/main` would break that gate for everything under `src/shared`. The
 * manifest half of a capability is data and lives in `@shared/capability`; the
 * handler half is main's, and so is this.
 */

import type { CapabilityManifest } from '@shared/capability/manifest'
import type { WebSearchMode } from '@shared/delegation'
import type { Transcripts } from '../main/store/transcripts'

/**
 * Arguments arrive already read against the manifest that declared them, so a
 * handler never parses. Missing and wrong-typed both arrive as `''`.
 */
export type CapabilityArgs = Readonly<Record<string, string>>

/**
 * Everything main can answer, handed to every handler.
 *
 * FUNCTIONS, not values, and every one of them. The archive opens lazily, the
 * persona changes on every session and the workspace is a setting somebody can
 * edit while she is running — so a handler asking at call time gets the current
 * answer rather than whatever was true when this module was evaluated.
 *
 * ONE shape for all of them rather than one per capability, because this is what
 * the dispatch passes and a per-capability shape would make the collected map
 * untypable. Nothing is computed until a handler asks, so a capability paying
 * for a dependency it does not use is not a cost anybody bears.
 *
 * This is also the seam that keeps the import graph acyclic: a capability
 * receives what it needs and imports nothing from `src/main/index.ts`.
 */
export interface CapabilityDeps {
  /**
   * What a catalogued prompt currently says. See `@shared/prompts`.
   *
   * Every string a capability puts in front of a model goes through here: its
   * own description, its argument descriptions, and the guidance it hands back
   * when it cannot do the thing. All of them were literals in these files and
   * were therefore visible only by reading the source.
   *
   * Resolved by main at call time, not captured when the session opened: an
   * edit lands on the next call rather than the next wake.
   */
  readonly prompt: (key: string) => string
  /** Where this person's own state lives — `app.getPath('userData')`. */
  readonly userData: () => string
  /** Whose archive and whose note. Null before a persona has been put on. */
  readonly wearing: () => string | null
  /** The archive, or null when it could not be opened. */
  readonly transcripts: () => Transcripts | null
  /**
   * Every OTHER persona on this machine, never the one being worn.
   *
   * `entryProblem` refuses a note that names another character's storage, and
   * it has to be told which ids those are. Excluding the worn one is not a
   * detail: her own id is derived from her name, so including it refused
   * "they like mochi with red bean" in an app whose subject is a mochi.
   */
  readonly otherPersonaIds: () => ReadonlySet<string>
  /** Where the Codex CLI is, or null when it is genuinely not installed. */
  readonly codexPath: () => string | null
  /**
   * The directory a lookup is pointed at — `codex exec -C`.
   *
   * NOT a read boundary, and it was described as one here until 2026-08-19.
   * `-s read-only` stops Codex writing; it does not confine what it reads, and
   * `findings.md` §8 recorded whole-disk reads under exactly these flags. What
   * this string decides is where a lookup starts and which directory chain
   * `guardWorkspace` inspects — a real and much smaller claim. Confining the
   * reads needs an OS-enforced allowlist and is not built.
   */
  readonly workspace: () => string
  /** Inclusive top of the workspace guard's walk. See `workspace.ts`. */
  readonly guardStopAt: () => string
  /** Whether a lookup may search the web. */
  readonly webSearch: () => WebSearchMode
  /**
   * The Codex profile a lookup layers, or null for none.
   *
   * How somebody configures a lookup — their model, their reasoning effort —
   * without this project re-exposing Codex's flags one at a time. The name has
   * passed `isProfileName`; it becomes a filename inside `$CODEX_HOME`.
   */
  readonly codexProfile: () => string | null
  /** The clock, injected so a test does not depend on how fast it runs. */
  readonly now: () => number
}

/**
 * What a handler may answer with.
 *
 * JSON, spelled out, and not `unknown`. The answer is `JSON.stringify`d into a
 * `function_call_output` and logged on the way past, so a handler returning
 * `undefined`, a function or a promise produces `JSON.stringify(...) === undefined`
 * and the `.slice()` beside it throws — on the deferred path, inside a `.then`
 * with nothing to catch it, after the call has already been acknowledged.
 *
 * An OBJECT at the top level, because that is what the model is handed and what
 * every handler here returns. A bare string would be legal on the wire and is
 * deliberately not offered: the payloads carry a `status` the model branches on,
 * and one that did not would be the odd one out.
 */
export type CapabilityValue =
  | string
  | number
  | boolean
  | null
  | readonly CapabilityValue[]
  | { readonly [key: string]: CapabilityValue }

export type CapabilityOutput = { readonly [key: string]: CapabilityValue }

/**
 * Settles the call outright.
 *
 * Returning `CapabilityOutput` rather than `unknown` is what makes the
 * discriminator mean something. `unknown` subsumes `Promise<unknown>`, so an
 * `async` handler declared `immediate` typechecked — and would then be awaited
 * on the fast path, leaving her silent for however long it took instead of
 * saying she was going to look. A promise is not assignable to an object of
 * JSON values, so that is now a compile error at the capability rather than a
 * pause in a conversation.
 */
export type ImmediateHandler = (args: CapabilityArgs, deps: CapabilityDeps) => CapabilityOutput

/** Acknowledges now, delivers later on the same `call_id` (§1). */
export type DeferredHandler = (
  args: CapabilityArgs,
  deps: CapabilityDeps,
) => Promise<CapabilityOutput>

/**
 * One capability: what she is told she can do, and what happens when she does.
 *
 * A folder under `src/capabilities/` exports exactly one of these as
 * `capability`, and `index.ts` collects them at build time.
 */
export type Capability =
  | {
      readonly manifest: CapabilityManifest
      readonly kind: 'immediate'
      readonly handler: ImmediateHandler
    }
  | {
      readonly manifest: CapabilityManifest
      readonly kind: 'deferred'
      readonly handler: DeferredHandler
    }
