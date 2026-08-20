import { instructionsFor, type Persona } from '@shared/persona'
import { allowsCapability, grantsNotice, type Grants } from '@shared/grants'
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
 * `set_expression` is offered with THIS character's faces, not all eight.
 *
 * The same argument as the filter below, one level down. A face left out of the
 * enum is not on the wire at all, so she cannot reach for it — where describing
 * all eight and asking her to use three is a rule she can break, at the moment
 * she is least likely to be reading rules carefully.
 *
 * Every other tool passes through untouched. This is deliberately a narrowing of
 * one argument of one capability rather than a general "personas may edit
 * manifests" hook, which would let a downloaded character rewrite what any tool
 * claims to do.
 */
function narrowFaces(persona: Persona): (tool: WireTool) => WireTool | null {
  return (tool) => {
    if (tool.name !== 'set_expression') return tool
    /*
      NO FACES MEANS NO TOOL, and this is the same rule as the line below.

      Narrowing an empty `faces` produced `enum: []` — a schema that no argument
      can satisfy, offered to her anyway. She would see a tool in her list,
      have no legal value for its one required field, and either fail the call
      or have the session configuration refused outright.

      `whatSheMayDo` already says the principle in the comment under this one:
      not offered, rather than offered and refused. The narrowing had a case it
      did not apply the principle to.

      The capability's own empty-first branch stays. It is unreachable through
      the wire now and is the answer if a caller ever reaches the handler
      another way — see `set-expression/capability.ts`.
    */
    if (persona.faces.length === 0) return null
    const face = tool.parameters.properties['face']
    if (face === undefined) return tool
    return {
      ...tool,
      parameters: {
        ...tool.parameters,
        properties: { ...tool.parameters.properties, face: { ...face, enum: persona.faces } },
      },
    }
  }
}

export function whatSheMayDo(
  persona: Persona,
  note: string,
  grants: Grants,
  tools: readonly WireTool[],
): WhatSheMayDo {
  const notice = grantsNotice(grants)
  const instructions = instructionsFor(persona, note)
  return {
    instructions: notice === '' ? instructions : `${instructions}\n\n${notice}`,
    // NOT OFFERED, rather than offered and refused. A description she cannot
    // act on is worse than one she never had — `registry.ts`'s deleted
    // `execution-unavailable` reasoning, arriving in a form that is still true.
    tools: tools
      .filter((tool) => allowsCapability(grants, tool.name))
      .map(narrowFaces(persona))
      .filter((tool): tool is WireTool => tool !== null),
  }
}
