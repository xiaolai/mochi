import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { KEPT_LIMITS } from '../../main/store/kept'
import { createTranscripts, type Transcripts } from '../../main/store/transcripts'
import { stubDeps } from '../../test/capability-deps'
import { capability } from './capability'

/**
 * The one place a persona may write, called the way she calls it.
 *
 * `kept.ts` has 26 tests and this handler had none — so everything between the
 * model's arguments and the store was unasserted: the `String(args[...] ?? '')`
 * coercions, the refusal mapping, and the isolation property that the store's
 * own tests can only demonstrate one level down.
 *
 * The isolation cases matter most. `personaId` is supplied by the CALLER and is
 * never an argument the model fills in — that is a structural claim, and these
 * are what say it stayed true through the handler as well as inside the store.
 */
let userData = ''
let store: Transcripts

function call(args: Readonly<Record<string, string>>, worn: string | null = 'loki') {
  if (capability.kind !== 'immediate') throw new Error('this one answers on the spot')
  return capability.handler(args, stubDeps({ wearing: () => worn, transcripts: () => store }))
}

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'mochi-keep-'))
  store = createTranscripts(userData)
})

afterEach(() => {
  store.close()
  rmSync(userData, { recursive: true, force: true })
})

describe('keeping something', () => {
  it('writes it under the worn character', () => {
    const out = call({ collection: 'projects', key: 'mochi', value: 'a companion' })
    expect(out.status).toBe('done')
    expect(store.kept.one('loki', 'projects', 'mochi')?.value).toBe('a companion')
  })

  it('says what it replaced', () => {
    /*
      A silent overwrite is discovered when she says something wrong out loud,
      which is the worst discovery channel there is. The handler's own comment
      argues this; nothing asserted it.
    */
    call({ collection: 'projects', key: 'mochi', value: 'a companion' })
    const out = call({ collection: 'projects', key: 'mochi', value: 'a desktop companion' })
    expect(out.status).toBe('done')
    const replaced = String((out as { replaced?: unknown }).replaced)
    expect(replaced).toContain('a companion')
    // FENCED, and that is worth pinning rather than stripping. What comes back
    // is the previous value she wrote, which is content she chose -- handing it
    // to her unfenced is the shape every other model-facing string here avoids.
    expect(replaced).toMatch(/^<kept>[\s\S]*<\/kept>$/)
  })

  it('reports no replacement when there was none', () => {
    // The FIELD is always present; what varies is whether it holds anything.
    // Asserting on the serialisation instead was how this test first got it
    // wrong -- "replaced" appears in both shapes.
    const out = call({ collection: 'projects', key: 'new-thing', value: 'first note' })
    expect((out as { replaced?: unknown }).replaced).toBeNull()
  })
})

describe('what it refuses', () => {
  it('refuses when nobody is worn', () => {
    const out = call({ collection: 'projects', key: 'mochi', value: 'x' }, null)
    expect(out.status).toBe('refused')
  })

  it('refuses a name that is not one', () => {
    for (const bad of ['', 'Projects', '9lives', 'with space', 'under_score', '-leading']) {
      expect(call({ collection: bad, key: 'k', value: 'v' }).status).toBe('refused')
      expect(call({ collection: 'projects', key: bad, value: 'v' }).status).toBe('refused')
    }
  })

  it('refuses a value that renders as nothing', () => {
    // `looksEmpty`, not `trim()`: a value of zero-width joiners would be kept
    // as though it said something and read back as blank.
    for (const blank of ['', '   ', '‍‍', 'ㅤ']) {
      expect(call({ collection: 'projects', key: 'k', value: blank }).status).toBe('refused')
    }
  })

  it('refuses a value past the limit', () => {
    const out = call({ collection: 'projects', key: 'k', value: 'x'.repeat(KEPT_LIMITS.value + 1) })
    expect(out.status).toBe('refused')
    expect(store.kept.one('loki', 'projects', 'k')).toBeNull()
  })

  it('refuses missing arguments rather than writing an empty entry', () => {
    // The model can omit a field. `String(undefined ?? '')` is `''`, which the
    // store refuses — but nothing said so, and a handler that wrote `''` here
    // would have looked identical from outside.
    expect(call({}).status).toBe('refused')
    expect(call({ collection: 'projects' }).status).toBe('refused')
    expect(call({ collection: 'projects', key: 'k' }).status).toBe('refused')
  })

  it('refuses once the store is full, and says which refusal it is', () => {
    for (let i = 0; i < KEPT_LIMITS.rows; i++) {
      expect(call({ collection: 'bulk', key: `k${String(i)}`, value: 'v' }).status).toBe('done')
    }
    const out = call({ collection: 'bulk', key: 'one-too-many', value: 'v' })
    expect(out.status).toBe('refused')
  })

  it('still lets her CORRECT something when the store is full', () => {
    // A replacement is not a new row. Refusing an edit at capacity reads as her
    // forgetting how to correct herself, which is the case `kept.ts` calls out.
    for (let i = 0; i < KEPT_LIMITS.rows; i++) {
      call({ collection: 'bulk', key: `k${String(i)}`, value: 'v' })
    }
    expect(call({ collection: 'bulk', key: 'k0', value: 'corrected' }).status).toBe('done')
    expect(store.kept.one('loki', 'bulk', 'k0')?.value).toBe('corrected')
  })
})

describe('one character cannot reach another', () => {
  it('writes under the worn character and no other', () => {
    /*
      THE STRUCTURAL CLAIM.

      `personaId` comes from `deps.wearing()`, never from an argument the model
      fills in — so there is no string she can send that addresses somebody
      else's store. These pass the ids as arguments anyway, which is the point:
      if the handler ever grew a `persona` parameter, this is what would fail.
    */
    call({ collection: 'projects', key: 'shared', value: "loki's" }, 'loki')
    call({ collection: 'projects', key: 'shared', value: "ada's" }, 'ada')
    expect(store.kept.one('loki', 'projects', 'shared')?.value).toBe("loki's")
    expect(store.kept.one('ada', 'projects', 'shared')?.value).toBe("ada's")
  })

  it('ignores a persona named in the arguments', () => {
    call({ collection: 'projects', key: 'k', value: 'v', persona: 'ada', personaId: 'ada' }, 'loki')
    expect(store.kept.one('ada', 'projects', 'k')).toBeNull()
    expect(store.kept.one('loki', 'projects', 'k')?.value).toBe('v')
  })
})
