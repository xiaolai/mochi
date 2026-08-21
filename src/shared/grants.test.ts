import { describe, expect, it } from 'vitest'
import { PRONOUNS } from './pronoun'
import {
  allowsCapability,
  grantsNotice,
  isGrant,
  parseGrants,
  withheldGuidance,
  DEFAULT_GRANTS,
  WITHHELD_GRANTS,
  GRANTS,
  GRANT_SPECS,
} from './grants'

describe('the four', () => {
  it('is 5b’s three, plus the face she wears, and no more', () => {
    // The plugin sandbox and the grant broker are struck, so a grant is not a
    // fence around somebody else's code — it is what this machine lets her do.
    //
    // `microphone` was here and is not: macOS owns that permission and resting
    // already hands the device back, so the switch could only produce a state —
    // awake, connected, deaf — that nobody wants. It was deleted rather than
    // hidden; `grants.ts` carries the argument, and this list is the assertion
    // that it does not quietly come back.
    expect([...GRANTS]).toEqual([
      'speak_first',
      'ask_workspace',
      'remember_this',
      // The fourth. `set_expression` reaches the RENDERER rather than the disk
      // or the network, which is why it is a grant at all: the others are about
      // what she may read and say, and this is about what she may show.
      'set_expression',
    ])
  })

  it('describes every one of them exactly once', () => {
    expect(GRANT_SPECS.map((one) => one.id)).toEqual([...GRANTS])
  })

  it('names a real capability, or none at all', () => {
    // Null is what says the row has no "last used" to show. A name that is not
    // a capability would be a switch that governs nothing.
    const named = GRANT_SPECS.map((one) => one.capability).filter((one) => one !== null)
    expect(named).toEqual(['ask_workspace', 'remember_this', 'set_expression'])
  })

  it('gives every one a sentence she can say out loud', () => {
    for (const spec of GRANT_SPECS) {
      expect(spec.withheld.trim().length).toBeGreaterThan(0)
      expect(spec.label.trim().length).toBeGreaterThan(0)
      // Every form, not just one: a table with an empty `it` reads as covered
      // and ships a blank line to anybody who chose that pronoun.
      // Every form, not just one: a table with an empty `it` reads as covered
      // and ships a blank line to anybody who chose that pronoun.
      for (const pronoun of PRONOUNS) expect(spec.detail[pronoun].trim().length).toBeGreaterThan(0)
      // And three DIFFERENT sentences. Copying the row and forgetting to change
      // the pronoun is the way one of these goes wrong, and it is invisible
      // unless somebody reads all three side by side.
      expect(new Set(PRONOUNS.map((one) => spec.detail[one])).size).toBe(PRONOUNS.length)
    }
  })
})

describe('what an installation that has never been asked gets', () => {
  it('is everything, because a companion that arrives unable to greet you is broken', () => {
    // The switch exists so somebody can say no, not so the app can say it for
    // them.
    expect(DEFAULT_GRANTS).toEqual({
      speak_first: true,
      ask_workspace: true,
      remember_this: true,
      set_expression: true,
    })
  })
})

describe('reading what was stored', () => {
  it('takes a full set back', () => {
    expect(parseGrants({ ...DEFAULT_GRANTS, ask_workspace: false })).toEqual({
      ...DEFAULT_GRANTS,
      ask_workspace: false,
    })
  })

  it('honours a refusal even when the rest of the object is nonsense', () => {
    // Field by field rather than whole-or-nothing: refusing the object because
    // one key is misspelt would restore a capability somebody switched off,
    // which is the direction that must not happen silently.
    expect(parseGrants({ ask_workspace: false, wobble: 'yes' })).toEqual({
      ...DEFAULT_GRANTS,
      ask_workspace: false,
    })
  })

  it('withholds a value that is PRESENT and is not a boolean', () => {
    // This asserted the opposite until an audit pointed at it, and the old
    // behaviour was a real widening: `{ speak_first: null }` — corruption, a
    // half-written file, a hand edit — came back ALLOWED. A present value that
    // cannot be read as permission is not permission.
    expect(parseGrants({ speak_first: 'no' }).speak_first).toBe(false)
    expect(parseGrants({ speak_first: 0 }).speak_first).toBe(false)
    expect(parseGrants({ speak_first: null }).speak_first).toBe(false)
  })

  it('still allows a grant nobody has said anything about', () => {
    // The other half, and it has to stay: a key ABSENT is nobody saying no, and
    // an installation that has never opened the panel must still work.
    expect(parseGrants({ ask_workspace: false }).speak_first).toBe(true)
    expect(parseGrants({}).speak_first).toBe(true)
  })

  it('takes an explicit true', () => {
    expect(parseGrants({ speak_first: true }).speak_first).toBe(true)
  })

  it('falls back to everything only when the key is genuinely ABSENT', () => {
    // `undefined` is what a file with no `grants` key produces, and that is
    // nobody having said no.
    expect(parseGrants(undefined)).toEqual(DEFAULT_GRANTS)
  })

  it('withholds everything for a container that is present and unreadable', () => {
    // `{ "grants": null }` and `{ "grants": [] }` are somebody's answers, in a
    // shape nothing can read. Returning the defaults for one re-enabled every
    // permission — the same widening as the per-key case, one level up.
    for (const value of [null, 'grants', 42, ['ask_workspace']]) {
      expect(parseGrants(value)).toEqual(WITHHELD_GRANTS)
    }
  })

  it('answers for a grant name, and refuses anything else', () => {
    expect(isGrant('speak_first')).toBe(true)
    // The one that was removed. A stored `preferences.json` from an older build
    // still has the key, and it must read as "there is no such permission"
    // rather than as one nothing enforces.
    expect(isGrant('microphone')).toBe(false)
    expect(isGrant('recall_conversations')).toBe(false)
    expect(isGrant(7)).toBe(false)
  })
})

describe('which capabilities may run', () => {
  it('withdraws exactly the one whose grant is off', () => {
    const grants = { ...DEFAULT_GRANTS, ask_workspace: false }
    expect(allowsCapability(grants, 'ask_workspace')).toBe(false)
    expect(allowsCapability(grants, 'remember_this')).toBe(true)
  })

  it('leaves a capability with no grant alone', () => {
    // `recall_conversations` reads her own archive and is not one of the four.
    // Governed by nothing here is a different answer from switched off.
    const nothing = {
      microphone: false,
      speak_first: false,
      ask_workspace: false,
      remember_this: false,
      set_expression: false,
    }
    expect(allowsCapability(nothing, 'recall_conversations')).toBe(true)
  })
})

describe('what she is told', () => {
  it('says nothing at all while she may do everything', () => {
    // The ordinary session carries no extra prompt.
    expect(grantsNotice(DEFAULT_GRANTS)).toBe('')
  })

  it('names every grant that is off', () => {
    const notice = grantsNotice({ ...DEFAULT_GRANTS, ask_workspace: false, remember_this: false })
    expect(notice).toContain('look anything up')
    expect(notice).toContain('long-term notes')
    // And not the ones that are on.
    expect(notice).not.toContain('microphone')
  })

  it('tells her to SAY SO rather than to decline', () => {
    // The failure `notBuilt` was deleted for: a capability she cannot perform
    // that presents as her choosing not to help.
    const notice = grantsNotice({ ...DEFAULT_GRANTS, ask_workspace: false })
    expect(notice).toContain('say plainly')
    expect(notice).toContain('switched it off')
  })

  it('gives a callable-but-withheld capability its own sentence', () => {
    // Reached when she holds a tool list from before the switch moved.
    const guidance = withheldGuidance('ask_workspace')
    expect(guidance).toContain('look anything up')
    expect(guidance).toContain('turned it off')
    expect(guidance).toContain('do not guess')
  })

  it('still says something usable for a name it does not know', () => {
    expect(withheldGuidance('something_else').trim().length).toBeGreaterThan(0)
  })
})

describe('what applies when a stored answer cannot be read', () => {
  it('withholds everything, which is the opposite of the default', () => {
    // `@shared/policy` draws the same line for retention. Absent means nobody
    // said no; unreadable means somebody's answer is there and unavailable, and
    // resolving THAT as allowed is the one direction that lets her do something
    // they may have said she may not.
    expect(WITHHELD_GRANTS).toEqual({
      speak_first: false,
      ask_workspace: false,
      remember_this: false,
      set_expression: false,
    })
  })

  it('is not the same object as the default, which is the whole point', () => {
    expect(WITHHELD_GRANTS).not.toEqual(DEFAULT_GRANTS)
  })

  it('withdraws every capability that has a grant', () => {
    expect(allowsCapability(WITHHELD_GRANTS, 'ask_workspace')).toBe(false)
    expect(allowsCapability(WITHHELD_GRANTS, 'remember_this')).toBe(false)
    // And still leaves alone the one that has none.
    expect(allowsCapability(WITHHELD_GRANTS, 'recall_conversations')).toBe(true)
  })
})
