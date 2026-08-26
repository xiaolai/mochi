import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createTranscripts, type Transcripts } from '../../main/store/transcripts'
import { stubDeps } from '../../test/capability-deps'
import { capability } from './capability'

/**
 * The only capability that DELETES, and it had no test at all.
 *
 * `keep` writing under the wrong character would be a leak somebody could
 * eventually see. This one removing under the wrong character destroys
 * something instead, and there is nothing left to notice it by — so the
 * isolation cases below are the ones worth having.
 */
let userData = ''
let store: Transcripts

function call(args: Readonly<Record<string, string>>, worn: string | null = 'loki') {
  if (capability.kind !== 'immediate') throw new Error('this one answers on the spot')
  return capability.handler(args, stubDeps({ wearing: () => worn, transcripts: () => store }))
}

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'mochi-forget-kept-'))
  store = createTranscripts(userData)
})

afterEach(() => {
  store.close()
  rmSync(userData, { recursive: true, force: true })
})

describe('forgetting something she kept', () => {
  it('removes it', () => {
    store.kept.put('loki', 'projects', 'mochi', 'a companion')
    const out = call({ collection: 'projects', key: 'mochi' })
    expect(out.status).toBe('done')
    expect(store.kept.one('loki', 'projects', 'mochi')).toBeNull()
  })

  it('leaves everything else in the collection alone', () => {
    store.kept.put('loki', 'projects', 'mochi', 'a companion')
    store.kept.put('loki', 'projects', 'other', 'something else')
    call({ collection: 'projects', key: 'mochi' })
    expect(store.kept.one('loki', 'projects', 'other')?.value).toBe('something else')
  })

  it('refuses a name it does not hold rather than reporting success', () => {
    // "Done" for a key that was never there teaches her the store forgot
    // something it never had, and she will say so.
    expect(call({ collection: 'projects', key: 'never-existed' }).status).toBe('refused')
  })

  it('refuses when nobody is worn', () => {
    store.kept.put('loki', 'projects', 'mochi', 'a companion')
    expect(call({ collection: 'projects', key: 'mochi' }, null).status).toBe('refused')
    // And nothing was removed on the way to refusing.
    expect(store.kept.one('loki', 'projects', 'mochi')?.value).toBe('a companion')
  })

  it('refuses missing arguments without touching anything', () => {
    store.kept.put('loki', 'projects', 'mochi', 'a companion')
    expect(call({}).status).toBe('refused')
    expect(call({ collection: 'projects' }).status).toBe('refused')
    expect(store.kept.one('loki', 'projects', 'mochi')?.value).toBe('a companion')
  })

  it('refuses a name that is not one', () => {
    store.kept.put('loki', 'projects', 'mochi', 'a companion')
    for (const bad of ['Projects', 'with space', '../escape', '9lives']) {
      expect(call({ collection: bad, key: 'mochi' }).status).toBe('refused')
      expect(call({ collection: 'projects', key: bad }).status).toBe('refused')
    }
    expect(store.kept.one('loki', 'projects', 'mochi')?.value).toBe('a companion')
  })
})

describe('one character cannot delete another', () => {
  it('removes only from the worn character', () => {
    /*
      THE CASE THIS FILE EXISTS FOR.

      Both hold the same collection and key. If `personaId` ever came from an
      argument rather than from `deps.wearing()`, one of these survives and the
      other does not — and nothing else in the app would ever report it, because
      a deleted entry leaves no trace to compare against.
    */
    store.kept.put('loki', 'projects', 'shared', "loki's")
    store.kept.put('ada', 'projects', 'shared', "ada's")

    expect(call({ collection: 'projects', key: 'shared' }, 'loki').status).toBe('done')
    expect(store.kept.one('loki', 'projects', 'shared')).toBeNull()
    expect(store.kept.one('ada', 'projects', 'shared')?.value).toBe("ada's")
  })

  it('ignores a persona named in the arguments', () => {
    store.kept.put('ada', 'projects', 'target', "ada's")
    const out = call({ collection: 'projects', key: 'target', persona: 'ada' }, 'loki')
    // Refused, because LOKI holds nothing under that name — and ada still does.
    expect(out.status).toBe('refused')
    expect(store.kept.one('ada', 'projects', 'target')?.value).toBe("ada's")
  })
})
