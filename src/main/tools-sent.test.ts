import { describe, expect, it } from 'vitest'
import type { WireTool } from '@shared/capability/registry'
import { renderTools } from './tools-sent'

const tool = (over: Partial<WireTool> = {}): WireTool => ({
  type: 'function',
  name: 'ask_workspace',
  description: 'Look something up.',
  parameters: {
    type: 'object',
    properties: { question: { type: 'string', description: 'What to find out.' } },
    required: ['question'],
  },
  ...over,
})

describe('showing what she is actually told', () => {
  it('renders the description, which is the part nobody could see', () => {
    // The whole point. These strings are the largest body of model-facing prose
    // in the app, every word compiled in, and until this existed the panel that
    // answers "what will she be told" drew only the persona half.
    expect(renderTools([tool()])).toContain('Look something up.')
    expect(renderTools([tool()])).toContain('ask_workspace')
  })

  it('names the arguments and which are required', () => {
    const out = renderTools([tool()])
    expect(out).toContain('question')
    expect(out).toContain('(required)')
    expect(out).toContain('What to find out.')
  })

  it('shows a narrowed enum, which is the most surprising thing on the screen', () => {
    /*
      `whatSheMayDo` narrows `set_expression`'s `face` enum to the worn
      character's faces before it goes on the wire — so a character with three
      faces is OFFERED three, and the other five are not reachable. That
      narrowing was previously invisible everywhere: the manifest says eight,
      the wire says three, and nothing showed the wire.
    */
    const narrowed = tool({
      name: 'set_expression',
      parameters: {
        type: 'object',
        properties: {
          face: { type: 'string', description: 'Which expression.', enum: ['happy', 'sad'] },
        },
        required: ['face'],
      },
    })
    expect(renderTools([narrowed])).toContain('[happy, sad]')
  })

  it('says something real when every capability is withheld', () => {
    // A reachable state — the grants panel produces it — and an empty box reads
    // as a broken readout rather than as an answer.
    const out = renderTools([])
    expect(out).not.toBe('')
    expect(out.toLowerCase()).toContain('switched off')
  })

  it('shows exactly what it was given, adding nothing', () => {
    /*
      The property that makes this trustworthy: it renders `whatSheMayDo`'s own
      already-filtered, already-narrowed list. A withheld capability is absent
      here because it is absent there — this must never reach for the registry
      and re-derive what "should" be on the wire.
    */
    const out = renderTools([tool({ name: 'only_this_one' })])
    expect(out).toContain('only_this_one')
    expect(out).not.toContain('remember_this')
    expect(out).not.toContain('recall_conversations')
  })

  it('keeps every tool when there are several', () => {
    const out = renderTools([tool({ name: 'first' }), tool({ name: 'second' })])
    expect(out).toContain('first')
    expect(out).toContain('second')
  })

  it('handles a tool that takes no arguments', () => {
    const bare = tool({
      parameters: { type: 'object', properties: {}, required: [] },
    })
    expect(() => renderTools([bare])).not.toThrow()
    expect(renderTools([bare])).toContain('Look something up.')
  })
})
