/**
 * The table that connects a box to the field it writes.
 *
 * With no Save button a refusal has to be shown beside the control
 * that caused it, and the only thing joining the two is `PERSONA_CONTROLS`: its
 * key is the path `parsePersona` reports against, its value is the id in the
 * document. Both halves can drift silently.
 *
 * A key the parser does not use means the refusal is looked for under a name
 * nothing reports, so the box refuses to save and says nothing. That is the
 * exact failure shape this project keeps finding -- a control wired to a name
 * nobody emits, green in every test that does not render.
 */

import { describe, expect, it } from 'vitest'
import { DEFAULT_PERSONA, PERSONA_LIMITS, type Persona } from '@shared/persona'
import { refusalFor } from '../hold'
import { PERSONA_CONTROLS, PERSONA_PATHS, holdKey, holdsFor, type PersonaPath } from './voice'

const her: Persona = { ...DEFAULT_PERSONA, id: 'ada' }

/**
 * One way to make each field illegal.
 *
 * A RECORD over `PersonaPath`, so a control added to the pane with no entry
 * here stops compiling. A list would simply never cover it -- which is how a
 * pane comes to have a field whose refusal has never been seen by anything.
 */
const BREAK: Readonly<Record<PersonaPath, (person: Persona) => Persona>> = {
  name: (p) => ({ ...p, name: '' }),
  // Allowed to be empty, so the only way to refuse it is by length.
  addressUser: (p) => ({ ...p, addressUser: 'x'.repeat(PERSONA_LIMITS.addressUser + 1) }),
  pronoun: (p) => ({ ...p, pronoun: 'nonexistent' as Persona['pronoun'] }),
  style: (p) => ({ ...p, style: '' }),
  voice: (p) => ({ ...p, voice: 'nonexistent' as Persona['voice'] }),
  'greeting.instruction': (p) => ({ ...p, greeting: { ...p.greeting, instruction: '' } }),
  'greeting.verbatim': (p) => ({
    ...p,
    greeting: { ...p.greeting, verbatim: 'x'.repeat(PERSONA_LIMITS.verbatim + 1) },
  }),
  'farewell.instruction': (p) => ({ ...p, farewell: { ...p.farewell, instruction: '' } }),
  'farewell.verbatim': (p) => ({
    ...p,
    farewell: { ...p.farewell, verbatim: 'x'.repeat(PERSONA_LIMITS.verbatim + 1) },
  }),
}

describe('every control this pane builds writes a field the parser knows', () => {
  it.each(PERSONA_PATHS)('%s is reported under its own name', (path) => {
    const refusal = refusalFor(BREAK[path](her), path)
    expect(refusal, `nothing refuses ${path}`).not.toBeNull()
    // The refusal has to arrive under the SAME string the table is keyed by, or
    // the window looks for it somewhere it will never be.
    expect(refusal === null ? null : 'field' in refusal ? refusal.field : null).toBe(path)
  })

  it('leaves the persona legal when nothing is broken', () => {
    // The other half of the check above: these fixtures are only evidence if
    // the persona they start from would otherwise commit.
    for (const path of PERSONA_PATHS) expect(refusalFor(her, path), path).toBeNull()
  })

  it('gives each field a control of its own', () => {
    // Two paths on one id would show one field's refusal under another's box,
    // and clear it from the wrong one.
    const ids = PERSONA_PATHS.map((path) => PERSONA_CONTROLS[path])
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('where uncommitted text is filed', () => {
  it('is scoped by character, not by control', () => {
    // The tray can switch persona with this window open.
    expect(holdKey('ada', 'name')).not.toBe(holdKey('coach', 'name'))
  })

  it('separates the fields of one character', () => {
    expect(holdKey('ada', 'greeting.verbatim')).not.toBe(holdKey('ada', 'farewell.verbatim'))
  })

  it('covers every field, so "discard my changes" leaves nothing behind', () => {
    // `forgetDraft` clears exactly this list. A path missing from it is a box
    // that keeps its text through a restore -- and then commits it.
    expect([...holdsFor('ada')].sort()).toEqual(
      PERSONA_PATHS.map((path) => holdKey('ada', path)).sort(),
    )
    expect(holdsFor('ada')).toHaveLength(PERSONA_PATHS.length)
  })
})
