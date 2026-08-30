import { describe, expect, it } from 'vitest'
import { wakeCount } from './wake-count'

/**
 * What the counter beside the wake tabs says.
 *
 * Three branches inside a 138-line `draw`, written out at three call sites, and
 * the one part of that panel with a rule in it rather than a wiring. The rule
 * is that the count names the PANE'S OWN quantity.
 */
describe('the count beside the wake tabs', () => {
  const sizes = { sent: 4000, tools: 900, draft: 12, limit: 20_000 }

  it('counts the draft against the ceiling it will be refused past', () => {
    // A8's shape. A bare "12 chars" is a number with nothing to compare it
    // against, so the limit was found by writing past it and being refused.
    expect(wakeCount('write', sizes)).toBe('12 / 20000 characters')
  })

  it('does not threaten the two panes nobody can shorten', () => {
    // Sent and Tools are assembled, not typed. A limit beside a number nobody
    // controls is a threat rather than a guide.
    expect(wakeCount('sent', sizes)).not.toContain('/')
    expect(wakeCount('tools', sizes)).not.toContain('/')
  })

  it('counts the tool block on the tools pane', () => {
    // "sent" beside a tool list would be counting the wrong thing.
    expect(wakeCount('tools', sizes)).toBe('900 chars')
  })

  it('says what was SENT on the sent pane, not a character count', () => {
    /*
      A character count beside the assembled prompt would be counting a thing
      nobody is editing. The word is the difference between "this is how big
      your draft is" and "this is what she was given".
    */
    expect(wakeCount('sent', sizes)).toBe('4000 sent')
  })

  it('never confuses two panes that happen to be the same size', () => {
    // The guard against a version that reads one number for all three.
    const same = { sent: 7, tools: 7, draft: 7, limit: 20_000 }
    expect(new Set([wakeCount('sent', same), wakeCount('tools', same)]).size).toBe(2)
  })
})
