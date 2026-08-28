import { type Persona } from '@shared/persona'
import { instructionsFor } from '@shared/instructions'
import { allowsCapability, grantsNotice, type Grants, type Prompts } from '@shared/grants'
import type { WireTool } from '@shared/capability/registry'

/**
 * What she is told, and what she is offered — ONE implementation.
 *
 * Two things ask. A session being configured asks on every wake and every
 * reconnect; a grant changed while one is already up asks again, so the live
 * session can be re-told without waiting for the next wake. A second derivation
 * of "which tools" would be a second answer to what she may do, and the two
 * would disagree exactly when somebody had just changed their mind about it.
 *
 * ## Its own file, because it is the only part of that path worth testing
 *
 * It lived in `main/index.ts`, which imports Electron and is therefore not
 * testable at all — so W-S4's two central invariants were claims rather than
 * assertions: that a revoked capability is not offered on the wire, and that
 * she is TOLD rather than left to fail quietly. Nothing here touches Electron,
 * a filesystem or a clock; the caller reads the persona, the note and the
 * grants and hands them over.
 *
 * ## The notice goes LAST
 *
 * After everything `instructionsFor` assembles, which is the strongest
 * instructional position in the prompt. Safe here in a way it would not be for
 * anything derived from what somebody said — every word of it is ours — and it
 * has to be downstream of the note, because the note is the half a model wrote.
 */
export interface WhatSheMayDo {
  readonly instructions: string
  readonly tools: readonly WireTool[]
}

/**
 * Everything this needs, NAMED.
 *
 * ## Why an object and not seven positions
 *
 * Three of the seven were `string` — `note`, `template` and `brief` — and two
 * of those were optional and adjacent. Any pair of them could be swapped and
 * the call would still typecheck.
 *
 * That is not hypothetical here, because `instructionsFor` takes the same three
 * IN A DIFFERENT ORDER: `(persona, memory, prompts, brief, template)` against
 * `(persona, note, grants, tools, template, brief, prompts)`. Somebody reading
 * one signature and writing the other swaps the system-prompt document with the
 * wake brief — and both are prose that reaches a model, so the result is a
 * plausible prompt built out of the wrong pieces, with nothing to fail.
 *
 * Named arguments cannot be transposed. That is the whole of the change.
 */
export interface MayDoInput {
  readonly persona: Persona
  /** What she remembers about the person. See `store/memory.ts`. */
  readonly note: string
  readonly grants: Grants
  readonly tools: readonly WireTool[]
  /** What each catalogued prompt currently says. See `@shared/prompts`. */
  readonly prompts: Prompts
  /**
   * The system prompt document, as the user wrote it. See `store/prompt.ts`.
   *
   * OPTIONAL, so the tests here — which are about tools and grants — say
   * nothing about it. The two callers that matter read it from disk; the third
   * is the shelf, which draws the same string back.
   */
  readonly template?: string
  /**
   * What happened last time, or what is still happening. See `memory/brief.ts`.
   *
   * OPTIONAL, for the reason `template` is. `session-config` is the caller that
   * builds one, and it chooses between the two kinds: a wake gets `briefFor`
   * and a reconnect gets `resumeFor`, which carry opposite instructions about
   * whether to pick the conversation back up.
   */
  readonly brief?: string
}

export function whatSheMayDo(input: MayDoInput): WhatSheMayDo {
  const { persona, note, grants, tools, prompts, template = '', brief = '' } = input
  const notice = grantsNotice(grants, prompts)
  const instructions = instructionsFor(persona, note, prompts, brief, template)
  return {
    instructions: notice === '' ? instructions : `${instructions}\n\n${notice}`,
    // NOT OFFERED, rather than offered and refused. A description she cannot
    // act on is worse than one she never had — `registry.ts`'s deleted
    // `execution-unavailable` reasoning, arriving in a form that is still true.
    tools: tools.filter((tool) => allowsCapability(grants, tool.name)),
  }
}
