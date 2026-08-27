import { describe, expect, it } from 'vitest'
import { DEFAULT_PERSONA } from '@shared/persona'
import { DEFAULT_GRANTS, WITHHELD_GRANTS } from '@shared/grants'
import type { WireTool } from '@shared/capability/registry'
import { SHIPPED_PROMPTS } from '@shared/instructions'
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
    const { tools } = whatSheMayDo(
      DEFAULT_PERSONA,
      NOTE,
      DEFAULT_GRANTS,
      TOOLS,
      '',
      '',
      SHIPPED_PROMPTS,
    )
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
      '',
      '',
      SHIPPED_PROMPTS,
    )
    expect(tools.map((one) => one.name)).toEqual(['remember_this', 'recall_conversations'])
  })

  it('leaves alone a capability that has no grant', () => {
    // `recall_conversations` reads her own archive and is not one of the four.
    // Withholding everything must not withdraw something nothing governs.
    const { tools } = whatSheMayDo(
      DEFAULT_PERSONA,
      NOTE,
      WITHHELD_GRANTS,
      TOOLS,
      '',
      '',
      SHIPPED_PROMPTS,
    )
    expect(tools.map((one) => one.name)).toEqual(['recall_conversations'])
  })

  it('hands the tool through unchanged, not a copy of its name', () => {
    // It goes straight into `session.update`, so the description and the
    // parameters have to survive the filter.
    const { tools } = whatSheMayDo(
      DEFAULT_PERSONA,
      NOTE,
      DEFAULT_GRANTS,
      TOOLS,
      '',
      '',
      SHIPPED_PROMPTS,
    )
    expect(tools[0]).toEqual(TOOLS[0])
  })
})

describe('what she is told', () => {
  it('carries her prompt and the note, as `instructionsFor` assembles them', () => {
    const { instructions } = whatSheMayDo(
      DEFAULT_PERSONA,
      NOTE,
      DEFAULT_GRANTS,
      TOOLS,
      '',
      '',
      SHIPPED_PROMPTS,
    )
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
      '',
      SHIPPED_PROMPTS,
    )
    expect(instructions).toContain('You are a lighthouse keeper.')
    expect(
      whatSheMayDo(DEFAULT_PERSONA, NOTE, DEFAULT_GRANTS, TOOLS, '', '', SHIPPED_PROMPTS)
        .instructions,
    ).not.toContain('lighthouse')
  })

  it('adds nothing at all while she may do everything', () => {
    // The ordinary session carries no extra prompt, so this costs nothing on
    // every wake for everybody who never opened the panel.
    const plain = whatSheMayDo(
      DEFAULT_PERSONA,
      NOTE,
      DEFAULT_GRANTS,
      TOOLS,
      '',
      '',
      SHIPPED_PROMPTS,
    )
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
      '',
      '',
      SHIPPED_PROMPTS,
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
      '',
      '',
      SHIPPED_PROMPTS,
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
      '',
      '',
      SHIPPED_PROMPTS,
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
    const hers = whatSheMayDo(
      DEFAULT_PERSONA,
      'her note',
      DEFAULT_GRANTS,
      TOOLS,
      '',
      '',
      SHIPPED_PROMPTS,
    )
    const theirs = whatSheMayDo(other, 'their note', DEFAULT_GRANTS, TOOLS, '', '', SHIPPED_PROMPTS)

    expect(hers.instructions).toContain('her note')
    expect(hers.instructions).not.toContain('their note')
    expect(theirs.instructions).toContain('their note')
    expect(theirs.instructions).not.toContain('her note')
  })
})

/**
 * The other half of `describedTools`' defect, in the other half of this return.
 *
 * `whatSheMayDo` called `grantsNotice(grants)` with no resolver and
 * `instructionsFor(..., undefined)` for a parameter that defaulted to the
 * shipped catalogue — so `notes.heading`, `notes.fence`, `grants.heading` and
 * `grants.notice` were drawn in the prompts pane, warned about, written to
 * `prompts.json`, reported saved, and thrown away here.
 *
 * `notes.fence` is why this is asserted rather than noted. It is the sentence
 * telling her the notes block is DATA rather than instructions — the boundary
 * against text a MODEL wrote into her memory — so the silent one was the string
 * whose entire job is to be load-bearing.
 */
describe('a rewritten prompt reaches what she is told', () => {
  const written = (key: string): string => `REWRITTEN(${key})`

  it('carries the rewritten notes heading and fence', () => {
    const { instructions } = whatSheMayDo(
      DEFAULT_PERSONA,
      'They are learning Rust.',
      DEFAULT_GRANTS,
      TOOLS,
      '',
      '',
      written,
    )
    expect(instructions).toContain('REWRITTEN(notes.heading)')
    expect(instructions).toContain('REWRITTEN(notes.fence)')
    // And the shipped wording is gone, rather than both being present.
    expect(instructions).not.toContain('Notes you have kept')
  })

  it('carries the rewritten withheld-capability notice', () => {
    const { instructions } = whatSheMayDo(
      DEFAULT_PERSONA,
      NOTE,
      { ...DEFAULT_GRANTS, ask_workspace: false },
      TOOLS,
      '',
      '',
      written,
    )
    expect(instructions).toContain('REWRITTEN(grants.heading)')
    expect(instructions).toContain('REWRITTEN(grants.notice)')
    expect(instructions).not.toContain('What you may not do')
  })

  it('ships the catalogue wording when that is what it is handed', () => {
    // The other direction, so the test above cannot pass by the resolver being
    // ignored in a different way.
    const { instructions } = whatSheMayDo(
      DEFAULT_PERSONA,
      'They are learning Rust.',
      { ...DEFAULT_GRANTS, ask_workspace: false },
      TOOLS,
      '',
      '',
      SHIPPED_PROMPTS,
    )
    expect(instructions).toContain('Notes you have kept')
    expect(instructions).toContain('What you may not do')
  })
})
