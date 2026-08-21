import { describe, expect, it } from 'vitest'
import { EMOTIONS } from '@shared/avatar'
import { DEFAULT_PERSONA, type Persona } from '@shared/persona'
import { DEFAULT_GRANTS, WITHHELD_GRANTS } from '@shared/grants'
import type { WireTool } from '@shared/capability/registry'
import { whatSheMayDo } from './what-she-may-do'

/**
 * W-S4's two central invariants, as assertions rather than as claims.
 *
 * `plan-shell.md` states them plainly: *"A revoked capability is not offered on
 * the wire"* and *"She is told, and says so"*. Both lived inside
 * `main/index.ts` until an audit pointed out that nothing there can be tested —
 * it imports Electron — so the composition moved to its own file and this is
 * what it moved for.
 */

function tool(name: string): WireTool {
  return {
    type: 'function',
    name,
    description: `The ${name} capability.`,
    parameters: {
      type: 'object',
      properties: { question: { type: 'string', description: 'What to find out.' } },
      required: ['question'],
    },
  }
}

const TOOLS: readonly WireTool[] = [
  tool('ask_workspace'),
  tool('remember_this'),
  tool('recall_conversations'),
]

const NOTE = 'They take their tea without milk.'

describe('what goes on the wire', () => {
  it('offers everything while she may do everything', () => {
    const { tools } = whatSheMayDo(DEFAULT_PERSONA, NOTE, DEFAULT_GRANTS, TOOLS)
    expect(tools.map((one) => one.name)).toEqual([
      'ask_workspace',
      'remember_this',
      'recall_conversations',
    ])
  })

  it('does not OFFER a capability whose grant is off', () => {
    // Not offered rather than offered and refused: a description she cannot act
    // on is worse than one she never had.
    const { tools } = whatSheMayDo(
      DEFAULT_PERSONA,
      NOTE,
      { ...DEFAULT_GRANTS, ask_workspace: false },
      TOOLS,
    )
    expect(tools.map((one) => one.name)).toEqual(['remember_this', 'recall_conversations'])
  })

  it('leaves alone a capability that has no grant', () => {
    // `recall_conversations` reads her own archive and is not one of the four.
    // Withholding everything must not withdraw something nothing governs.
    const { tools } = whatSheMayDo(DEFAULT_PERSONA, NOTE, WITHHELD_GRANTS, TOOLS)
    expect(tools.map((one) => one.name)).toEqual(['recall_conversations'])
  })

  it('hands the tool through unchanged, not a copy of its name', () => {
    // It goes straight into `session.update`, so the description and the
    // parameters have to survive the filter.
    const { tools } = whatSheMayDo(DEFAULT_PERSONA, NOTE, DEFAULT_GRANTS, TOOLS)
    expect(tools[0]).toEqual(TOOLS[0])
  })
})

describe('what she is told', () => {
  it('carries her prompt and the note, as `instructionsFor` assembles them', () => {
    const { instructions } = whatSheMayDo(DEFAULT_PERSONA, NOTE, DEFAULT_GRANTS, TOOLS)
    expect(instructions).toContain(NOTE)
    // Her STYLE, not her name. Nothing is compiled in that names her since the
    // system prompt became a document, so a name only appears where a `{name}`
    // slot asks for one — see `PROMPT_SLOTS`.
    expect(instructions).toContain(DEFAULT_PERSONA.style)
  })

  it('carries the system prompt document, which is the whole reason it takes one', () => {
    // Defaulted to empty here and read from disk by main. Without this the
    // parameter could be dropped from every call site and every test would
    // still pass, which is the shape of an argument that quietly stops being
    // passed.
    const { instructions } = whatSheMayDo(
      DEFAULT_PERSONA,
      NOTE,
      DEFAULT_GRANTS,
      TOOLS,
      'You are a lighthouse keeper.',
    )
    expect(instructions).toContain('You are a lighthouse keeper.')
    expect(whatSheMayDo(DEFAULT_PERSONA, NOTE, DEFAULT_GRANTS, TOOLS).instructions).not.toContain(
      'lighthouse',
    )
  })

  it('adds nothing at all while she may do everything', () => {
    // The ordinary session carries no extra prompt, so this costs nothing on
    // every wake for everybody who never opened the panel.
    const plain = whatSheMayDo(DEFAULT_PERSONA, NOTE, DEFAULT_GRANTS, TOOLS)
    expect(plain.instructions).not.toContain('may not do')
  })

  it('TELLS HER when something has been taken away', () => {
    // The failure `notBuilt` was deleted from this repository for: a capability
    // she cannot perform that presents as her declining to help.
    const { instructions } = whatSheMayDo(
      DEFAULT_PERSONA,
      NOTE,
      { ...DEFAULT_GRANTS, ask_workspace: false },
      TOOLS,
    )
    expect(instructions).toContain('look anything up')
    expect(instructions).toContain('say plainly')
  })

  it('puts the notice LAST, after everything the persona assembles', () => {
    // The strongest instructional position, and downstream of the note — which
    // is the half a model wrote. Safe only because every word of it is ours.
    const { instructions } = whatSheMayDo(
      DEFAULT_PERSONA,
      NOTE,
      { ...DEFAULT_GRANTS, ask_workspace: false },
      TOOLS,
    )
    expect(instructions.indexOf(NOTE)).toBeLessThan(instructions.indexOf('# What you may not do'))
    expect(instructions.trimEnd().endsWith('workspace.')).toBe(true)
  })

  it('names every grant that is off, and none that is on', () => {
    const { instructions } = whatSheMayDo(
      DEFAULT_PERSONA,
      NOTE,
      { ...DEFAULT_GRANTS, remember_this: false },
      TOOLS,
    )
    expect(instructions).toContain('long-term notes')
    expect(instructions).not.toContain('look anything up')
  })
})

describe('whose prompt it builds', () => {
  it('uses the persona it is HANDED, never a second reading of one', () => {
    // The line this exists to make checkable. `tellTheSession` passes the
    // persona the LIVE SESSION was configured as, not whoever is worn — they
    // differ the moment somebody switches character on the shelf, and building
    // from the worn one installed the new character's private note into the old
    // character's session.
    const other = { ...DEFAULT_PERSONA, id: 'loki', name: 'Loki', style: 'Terse.' }
    const hers = whatSheMayDo(DEFAULT_PERSONA, 'her note', DEFAULT_GRANTS, TOOLS)
    const theirs = whatSheMayDo(other, 'their note', DEFAULT_GRANTS, TOOLS)

    expect(hers.instructions).toContain('her note')
    expect(hers.instructions).not.toContain('their note')
    expect(theirs.instructions).toContain('their note')
    expect(theirs.instructions).not.toContain('her note')
  })
})

describe('which faces she is offered', () => {
  /** A tool list carrying `set_expression` as the registry declares it. */
  function withFaces(): readonly WireTool[] {
    return [
      {
        type: 'function',
        name: 'set_expression',
        description: 'Wear one of your expressions.',
        parameters: {
          type: 'object',
          properties: { face: { type: 'string', description: 'Which.', enum: [...EMOTIONS] } },
          required: ['face'],
        },
      },
    ]
  }

  function facesOffered(persona: Persona): readonly string[] | undefined {
    const may = whatSheMayDo(persona, '', DEFAULT_GRANTS, withFaces())
    return may.tools[0]?.parameters.properties['face']?.enum
  }

  it('is all eight for a character that does not narrow them', () => {
    expect(facesOffered(DEFAULT_PERSONA)).toEqual(EMOTIONS)
  })

  it('is only the ones this character uses', () => {
    /*
      NOT OFFERED rather than offered and discouraged, which is the same argument
      as the grant filter one level up. A face left out of the enum is not on the
      wire, so she cannot reach for it — where describing all eight and asking
      her to use three is a rule she can break, at the moment she is least likely
      to be reading rules carefully.
    */
    const three: Persona = { ...DEFAULT_PERSONA, faces: ['neutral', 'happy', 'thinking'] }
    expect(facesOffered(three)).toEqual(['neutral', 'happy', 'thinking'])
  })

  it('does not offer the TOOL at all when a character wears one face', () => {
    /*
      It used to offer it with `enum: []`, which this test asserted and which
      was wrong: a required field whose enum is empty is a schema no argument
      can satisfy. She would see the tool, have no legal value for it, and
      either fail the call or have the whole session configuration refused.

      Not offered, rather than offered and unusable — the same rule the grant
      filter one level up already follows.
    */
    const still: Persona = { ...DEFAULT_PERSONA, faces: [] }
    const may = whatSheMayDo(still, '', DEFAULT_GRANTS, withFaces())
    expect(may.tools.map((one) => one.name)).toEqual([])
    expect(facesOffered(still)).toBeUndefined()
  })

  it('leaves every other tool alone', () => {
    // A narrowing of one argument of one capability, not a hook that lets a
    // downloaded character rewrite what any tool claims to do.
    const other: readonly WireTool[] = [
      {
        type: 'function',
        name: 'remember_this',
        description: 'Keep a fact.',
        parameters: {
          type: 'object',
          properties: { note: { type: 'string', description: 'The fact.' } },
          required: ['note'],
        },
      },
    ]
    const narrow: Persona = { ...DEFAULT_PERSONA, faces: ['neutral'] }
    expect(whatSheMayDo(narrow, '', DEFAULT_GRANTS, other).tools).toEqual(other)
  })
})
