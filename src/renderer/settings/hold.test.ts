/**
 * Whether a field commits, now that leaving it IS the save.
 *
 * These used to be one question asked once, when Save was pressed, about a
 * whole sheet. It is a question per box, and the tempting answer --
 * restate the rules here, `name` must not be empty, an instruction is at most
 * 300 -- is a second copy of `parsePersona` living in the process that is
 * explicitly not trusted to hold one. So the real parser decides, and this file
 * is what keeps that true.
 */

import { describe, expect, it } from 'vitest'
import { DEFAULT_PERSONA, PERSONA_LIMITS, type Persona } from '@shared/persona'
import { refusalFor } from './hold'

const her: Persona = { ...DEFAULT_PERSONA, id: 'ada', name: 'Ada' }

describe('refusalFor', () => {
  it('says nothing about an edit that is fine', () => {
    expect(refusalFor({ ...her, name: 'Coach' }, 'name')).toBeNull()
  })

  it('refuses a required field that has been emptied', () => {
    // The case the whole design turns on: clearing a box and retyping it passes
    // through empty, so "commit on every keystroke" would write a persona the
    // loader refuses. Holding the field is what buys the retype.
    expect(refusalFor({ ...her, name: '' }, 'name')).toEqual({
      kind: 'field',
      field: 'name',
      reason: 'empty',
    })
  })

  it('refuses a field that only LOOKS filled', () => {
    // A box holding nothing but a zero-width joiner renders as empty and is not
    // caught by `trim`. `parsePersona` knows that; a hand-written check here
    // would not, which is the argument for not having one.
    expect(refusalFor({ ...her, name: '‍' }, 'name')).toMatchObject({ reason: 'empty' })
  })

  it('refuses a field that has outgrown its limit', () => {
    expect(refusalFor({ ...her, name: 'x'.repeat(PERSONA_LIMITS.name + 1) }, 'name')).toEqual({
      kind: 'field-length',
      field: 'name',
      limit: PERSONA_LIMITS.name,
    })
  })

  it('allows the fields that are allowed to be empty', () => {
    expect(refusalFor({ ...her, addressUser: '' }, 'addressUser')).toBeNull()
    expect(
      refusalFor({ ...her, greeting: { ...her.greeting, verbatim: null } }, 'greeting.verbatim'),
    ).toBeNull()
  })

  it('names a nested field the way the parser names it', () => {
    // `greeting.instruction`, not `instruction`. The path is what the window
    // uses to put the sentence under the right box, so a mismatch here shows
    // the refusal beside the wrong control -- or beside none at all.
    const emptied = { ...her, greeting: { ...her.greeting, instruction: '' } }
    expect(refusalFor(emptied, 'greeting.instruction')).toEqual({
      kind: 'field',
      field: 'greeting.instruction',
      reason: 'empty',
    })
  })

  it('reports a refusal that belongs to another field rather than none', () => {
    // The candidate is built from a persona main already accepted plus ONE
    // change, so this should not happen. When it does -- an older build wrote
    // her, or something here is wrong -- returning null would send main a
    // persona it is about to refuse and report nothing when it does.
    const broken = { ...her, voice: 'nonexistent' } as unknown as Persona
    expect(refusalFor(broken, 'name')).not.toBeNull()
  })

  it('is not fooled by a field name that merely looks like the path', () => {
    const emptied = { ...her, greeting: { ...her.greeting, instruction: '' } }
    // Asked about the OTHER moment: the answer is still a refusal, because
    // nothing may be stored, but it is not silently attributed to `farewell`.
    expect(refusalFor(emptied, 'farewell.instruction')).toMatchObject({
      field: 'greeting.instruction',
    })
  })
})
