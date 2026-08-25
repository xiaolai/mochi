import { describe, expect, it } from 'vitest'

import { instructionsFor, PROMPT_SLOTS } from './instructions'
import { DEFAULT_PERSONA } from './persona'

/**
 * The index of what she has kept, as she is handed it.
 *
 * A store she cannot see is write-mostly: she keeps things and never reads them
 * back, because nothing tells her they are there and `look_up` against a name
 * she does not know is a guess. This is what makes the store change how she
 * behaves rather than merely accumulate.
 */
const held = [
  { collection: 'projects', entries: 3 },
  { collection: 'people', entries: 12 },
]

describe('the index she is handed', () => {
  it('is a slot, so a prompt document can place it', () => {
    expect([...PROMPT_SLOTS]).toContain('kept')
  })

  it('names each collection and how much is in it', () => {
    const said = instructionsFor(DEFAULT_PERSONA, '', '', '', undefined, held)
    expect(said).toContain('projects (3)')
    expect(said).toContain('people (12)')
  })

  it('carries the names only, never the contents', () => {
    // The whole reason it is an index. Contents would grow this prompt with
    // everything she has ever written, on every wake and every hourly
    // reconnect — the unbounded request `PERSONA_LIMITS` exists to prevent.
    const said = instructionsFor(DEFAULT_PERSONA, '', '', '', undefined, [
      { collection: 'secrets', entries: 1 },
    ])
    expect(said).toContain('secrets (1)')
    expect(said).not.toContain('the value itself')
  })

  it('says nothing at all when she has kept nothing', () => {
    // Empty means ABSENT. A heading with nothing under it invites the model to
    // invent something to put there — the same reason the notes block is
    // omitted rather than emptied.
    const said = instructionsFor(DEFAULT_PERSONA, '', '', '', undefined, [])
    expect(said).not.toContain('You have kept things under these names')
  })

  it('is downstream of the rules, with the notes and the brief', () => {
    // "Text derived from what somebody said must never occupy the strongest
    // instructional position in the prompt." Everything in the store was
    // written after a conversation, so it sits where that text sits.
    const said = instructionsFor(DEFAULT_PERSONA, 'a note about them', '', '', undefined, held)
    expect(said.indexOf('projects (3)')).toBeGreaterThan(said.indexOf('a note about them') - 1)
    expect(said.indexOf('projects (3)')).toBeGreaterThan(0)
  })
})

describe('a character who has kept a great many things', () => {
  const many = (n: number): { collection: string; entries: number }[] =>
    Array.from({ length: n }, (_, i) => ({ collection: `c${String(i)}`, entries: 1 }))

  it('does not put five hundred lines in front of the model', () => {
    // The path that was actually unbounded. The index grows with COLLECTIONS
    // and never with rows, so the row cap never held this back — and this is
    // the cost paid on every wake AND every hourly reconnect.
    const said = instructionsFor(DEFAULT_PERSONA, '', '', '', undefined, many(500))
    const listed = said.split('\n').filter((line) => line.startsWith('- c')).length
    expect(listed).toBe(20)
  })

  it('counts what it left out rather than implying there was nothing', () => {
    const said = instructionsFor(DEFAULT_PERSONA, '', '', '', undefined, many(500))
    expect(said).toContain('480 more')
  })

  it('says nothing about a remainder when there is none', () => {
    const said = instructionsFor(DEFAULT_PERSONA, '', '', '', undefined, many(3))
    expect(said).not.toContain('more, which look_up')
    expect(said.split('\n').filter((line) => line.startsWith('- c')).length).toBe(3)
  })

  it('grows with collections, not with rows', () => {
    // A thousand entries under one name is one line. This is why the row cap
    // was never the thing bounding her prompt.
    const one = instructionsFor(DEFAULT_PERSONA, '', '', '', undefined, [
      { collection: 'projects', entries: 1_000 },
    ])
    expect(one.split('\n').filter((line) => line.startsWith('- ')).length).toBe(1)
  })
})
