import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { KEPT_LIMITS } from './kept'
import { createTranscripts } from './transcripts'
import type { Transcripts } from './transcripts'

/**
 * The one place a persona may write.
 *
 * The isolation assertions matter more than the bounds ones: `personaId` is
 * supplied by the caller and never by an argument the model fills in, and these
 * are what say that stayed true.
 */
let userData = ''
let store: Transcripts

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'mochi-kept-'))
  store = createTranscripts(userData)
})

afterEach(() => {
  store.close()
  rmSync(userData, { recursive: true, force: true })
})

describe('keeping something', () => {
  it('reads back what was written', () => {
    expect(store.kept.put('ada', 'projects', 'mochi', 'a companion').refused).toBeNull()
    expect(store.kept.one('ada', 'projects', 'mochi')?.value).toBe('a companion')
  })

  it('hands back what it replaced, so an overwrite is reviewable', () => {
    store.kept.put('ada', 'projects', 'mochi', 'first')
    const wrote = store.kept.put('ada', 'projects', 'mochi', 'second')
    expect(wrote.refused).toBeNull()
    // The whole reason `previous` exists: a silent replace is the failure
    // `memory.ts` keeps one step back to avoid.
    expect(wrote.previous).toBe('first')
    expect(store.kept.one('ada', 'projects', 'mochi')?.value).toBe('second')
  })

  it('answers null for something never kept', () => {
    expect(store.kept.one('ada', 'projects', 'nothing')).toBeNull()
  })
})

describe('what a name may be', () => {
  it.each([
    ['Projects', 'a capital'],
    ['9lives', 'a leading digit'],
    ['my projects', 'a space'],
    ['', 'nothing at all'],
    ['../escape', 'a path'],
  ])('refuses %j — %s', (bad) => {
    expect(store.kept.put('ada', bad, 'k', 'v').refused).toBe('bad-collection')
    expect(store.kept.put('ada', 'projects', bad, 'v').refused).toBe('bad-key')
  })

  it('accepts the shape a persona id uses', () => {
    expect(store.kept.put('ada', 'a-b-c', 'x-1', 'v').refused).toBeNull()
  })
})

describe('bounds', () => {
  it('refuses an empty document rather than storing whitespace', () => {
    expect(store.kept.put('ada', 'c', 'k', '   ').refused).toBe('empty-value')
  })

  it('measures the value in graphemes, not code units', () => {
    // The `PERSONA_LIMITS` lesson: a name of twelve emoji was once rejected as
    // twenty-four characters, by a message quoting a limit of twenty-four.
    const emoji = '🍡'.repeat(KEPT_LIMITS.value)
    expect(emoji.length).toBeGreaterThan(KEPT_LIMITS.value)
    expect(store.kept.put('ada', 'c', 'k', emoji).refused).toBeNull()
  })

  it('refuses one grapheme past the limit', () => {
    expect(store.kept.put('ada', 'c', 'k', 'x'.repeat(KEPT_LIMITS.value)).refused).toBeNull()
    expect(store.kept.put('ada', 'c', 'k2', 'x'.repeat(KEPT_LIMITS.value + 1)).refused).toBe(
      'value-too-long',
    )
  })

  it('stops at the row cap', () => {
    for (let i = 0; i < KEPT_LIMITS.rows; i++) {
      expect(store.kept.put('ada', 'c', `k${String(i)}`, 'v').refused).toBeNull()
    }
    expect(store.kept.put('ada', 'c', 'one-more', 'v').refused).toBe('full')
  })

  it('still lets her correct something she already holds when full', () => {
    // A full store that refuses edits reads as her forgetting how to correct
    // herself. A replacement is not a new row.
    for (let i = 0; i < KEPT_LIMITS.rows; i++) store.kept.put('ada', 'c', `k${String(i)}`, 'v')
    expect(store.kept.put('ada', 'c', 'k0', 'corrected').refused).toBeNull()
    expect(store.kept.one('ada', 'c', 'k0')?.value).toBe('corrected')
  })
})

describe('one character cannot reach another', () => {
  it('does not read across personas', () => {
    store.kept.put('ada', 'projects', 'mochi', 'hers')
    expect(store.kept.one('bob', 'projects', 'mochi')).toBeNull()
    expect(store.kept.inCollection('bob', 'projects')).toHaveLength(0)
    expect(store.kept.collections('bob')).toHaveLength(0)
  })

  it('does not delete across personas', () => {
    store.kept.put('ada', 'projects', 'mochi', 'hers')
    expect(store.kept.forgetOne('bob', 'projects', 'mochi')).toBe(false)
    expect(store.kept.forgetAll('bob')).toBe(0)
    expect(store.kept.one('ada', 'projects', 'mochi')?.value).toBe('hers')
  })

  it('counts the row cap per persona, not for everyone at once', () => {
    for (let i = 0; i < KEPT_LIMITS.rows; i++) store.kept.put('ada', 'c', `k${String(i)}`, 'v')
    expect(store.kept.put('bob', 'c', 'k', 'v').refused).toBeNull()
  })
})

describe('listing', () => {
  it('reports each collection with its size', () => {
    store.kept.put('ada', 'projects', 'a', '1')
    store.kept.put('ada', 'projects', 'b', '2')
    store.kept.put('ada', 'people', 'c', '3')
    expect(store.kept.collections('ada').map((one) => [one.collection, one.entries])).toEqual([
      ['people', 1],
      ['projects', 2],
    ])
  })

  it('forgets a whole collection and leaves the others', () => {
    store.kept.put('ada', 'projects', 'a', '1')
    store.kept.put('ada', 'people', 'c', '3')
    expect(store.kept.forgetCollection('ada', 'projects')).toBe(1)
    expect(store.kept.collections('ada').map((one) => one.collection)).toEqual(['people'])
  })
})

/**
 * Her store dies with her, and the ordering is the whole guarantee.
 *
 * Persona ids are derived name slugs handed out again once free. A store that
 * outlives its owner is handed to the next character of the same name — which
 * `plan-storage.md` calls the same class of fault as inheriting their notes,
 * and which this store makes sharper, because it is the one a model writes to
 * unprompted.
 */
describe('deleting a character', () => {
  it('takes her store with her, so a new one of the same name starts empty', async () => {
    const { copyPersonaTo, loadPersonas } = await import('./personas')
    const { deletePersona } = await import('./delete-persona')
    const { DEFAULT_PERSONA } = await import('@shared/persona')

    const first = copyPersonaTo(userData, loadPersonas(userData, {}, true), DEFAULT_PERSONA, 'Ada')
    store.kept.put(first.id, 'projects', 'secret', 'something private')
    expect(store.kept.one(first.id, 'projects', 'secret')?.value).toBe('something private')

    deletePersona(userData, loadPersonas(userData, {}, true), first.id, store)

    // The id is free again and will be handed back out. Nothing of hers may
    // come with it.
    const second = copyPersonaTo(userData, loadPersonas(userData, {}, true), DEFAULT_PERSONA, 'Ada')
    expect(second.id).toBe(first.id)
    expect(store.kept.one(second.id, 'projects', 'secret')).toBeNull()
    expect(store.kept.collections(second.id)).toHaveLength(0)
  })
})

describe('what the second audit found', () => {
  it('binds a name on every path, not only on write', () => {
    // Reads and deletes used to pass unbounded model-supplied strings straight
    // into SQLite while `put` was checked.
    store.kept.put('ada', 'c', 'k', 'v')
    expect(store.kept.one('ada', '../etc', 'k')).toBeNull()
    expect(store.kept.inCollection('ada', 'NOT A NAME')).toHaveLength(0)
    expect(store.kept.forgetOne('ada', 'c', 'BAD KEY')).toBe(false)
    expect(store.kept.forgetCollection('ada', '../..')).toBe(0)
    // and the real entry is untouched by any of it
    expect(store.kept.one('ada', 'c', 'k')?.value).toBe('v')
  })

  it('bounds the listing in SQL rather than after materialising it', () => {
    for (let i = 0; i < 30; i++) store.kept.put('ada', 'c', `k${String(i)}`, 'v')
    expect(store.kept.inCollection('ada', 'c', 5)).toHaveLength(5)
    expect(store.kept.inCollection('ada', 'c')).toHaveLength(30)
  })
})
