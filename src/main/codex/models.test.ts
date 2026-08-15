import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadModelCatalog, readModelCatalog } from './models'

/**
 * A fixture cut from the real cache measured on 2026-08-15.
 *
 * Trimmed to the fields this module reads, but the VALUES are the measured
 * ones: luna genuinely stops at `xhigh` while sol reaches `ultra`, the two
 * hidden entries are the two that are really hidden, and spark is really the
 * one that is unavailable through the API. Invented values would make these
 * tests agree with an assumption rather than with the file.
 */
const CACHE = {
  fetched_at: '2026-08-14T17:07:48.975409Z',
  client_version: '0.147.0',
  models: [
    {
      slug: 'gpt-5.6-sol',
      display_name: 'GPT-5.6 Sol',
      visibility: 'list',
      supported_in_api: true,
      priority: 1,
      default_reasoning_level: 'low',
      supported_reasoning_levels: [
        { effort: 'low', description: 'Fast responses with lighter reasoning' },
        { effort: 'medium', description: 'Balances speed and reasoning depth' },
        { effort: 'high', description: 'Greater reasoning depth' },
        { effort: 'xhigh', description: 'Extra high reasoning depth' },
        { effort: 'max', description: 'Maximum reasoning depth' },
        { effort: 'ultra', description: 'Maximum reasoning with delegation' },
      ],
    },
    {
      slug: 'gpt-5.6-sol-wm',
      display_name: 'GPT-5.6 Sol WM',
      visibility: 'hide',
      supported_in_api: false,
      priority: 1,
      default_reasoning_level: 'low',
      supported_reasoning_levels: [{ effort: 'low', description: '' }],
    },
    {
      slug: 'gpt-5.6-luna',
      display_name: 'GPT-5.6 Luna',
      visibility: 'list',
      supported_in_api: true,
      priority: 3,
      default_reasoning_level: 'medium',
      supported_reasoning_levels: [
        { effort: 'low', description: '' },
        { effort: 'medium', description: '' },
        { effort: 'high', description: '' },
        { effort: 'xhigh', description: '' },
      ],
    },
    {
      slug: 'gpt-5.3-codex-spark',
      display_name: 'GPT-5.3 Codex Spark',
      visibility: 'list',
      supported_in_api: false,
      priority: 26,
      default_reasoning_level: 'high',
      supported_reasoning_levels: [{ effort: 'low', description: '' }],
    },
    {
      slug: 'codex-auto-review',
      display_name: 'Codex Auto Review',
      visibility: 'hide',
      supported_in_api: true,
      priority: 43,
      default_reasoning_level: 'medium',
      supported_reasoning_levels: [{ effort: 'medium', description: '' }],
    },
  ],
}

const bySlug = (catalog: { models: readonly { slug: string }[] }): string[] =>
  catalog.models.map((model) => model.slug)

describe('readModelCatalog', () => {
  it('keeps only the listable models', () => {
    expect(bySlug(readModelCatalog(CACHE))).toEqual([
      'gpt-5.6-sol',
      'gpt-5.6-luna',
      'gpt-5.3-codex-spark',
    ])
  })

  it('drops anything whose visibility is not exactly list', () => {
    // Fails closed: a visibility state this version has never seen must not
    // leak an internal model into a user-facing picker.
    const odd = { models: [{ ...CACHE.models[0], visibility: 'some-future-state' }] }
    expect(readModelCatalog(odd).models).toEqual([])
  })

  /**
   * The measured difference, and the reason efforts are per-model. Offering
   * `ultra` while luna is selected is the familiar defect class: every
   * flag reports success and the mouth stops mid-word.
   */
  it('gives each model its own effort levels', () => {
    const { models } = readModelCatalog(CACHE)
    const sol = models.find((model) => model.slug === 'gpt-5.6-sol')
    const luna = models.find((model) => model.slug === 'gpt-5.6-luna')
    expect(sol?.efforts).toContain('ultra')
    expect(luna?.efforts).not.toContain('ultra')
    expect(luna?.efforts).toContain('xhigh')
  })

  it('gives each model its own default, which is not a constant', () => {
    const { models } = readModelCatalog(CACHE)
    expect(models.find((model) => model.slug === 'gpt-5.6-sol')?.defaultEffort).toBe('low')
    expect(models.find((model) => model.slug === 'gpt-5.6-luna')?.defaultEffort).toBe('medium')
  })

  /** Conjoins with `credentialSource`; the pane uses it to drop, not to grey out. */
  it('carries supported_in_api through', () => {
    const { models } = readModelCatalog(CACHE)
    expect(models.find((model) => model.slug === 'gpt-5.3-codex-spark')?.inApi).toBe(false)
    expect(models.find((model) => model.slug === 'gpt-5.6-sol')?.inApi).toBe(true)
  })

  it('treats a missing supported_in_api as not usable rather than as probably fine', () => {
    const noFlag = { models: [{ ...CACHE.models[0], supported_in_api: undefined }] }
    expect(readModelCatalog(noFlag).models[0]?.inApi).toBe(false)
  })

  it('orders by the file its own priority', () => {
    const shuffled = { models: [...CACHE.models].reverse() }
    expect(bySlug(readModelCatalog(shuffled))).toEqual([
      'gpt-5.6-sol',
      'gpt-5.6-luna',
      'gpt-5.3-codex-spark',
    ])
  })

  it('drops one malformed entry without losing its neighbours', () => {
    const withJunk = { models: [CACHE.models[0], 42, null, CACHE.models[2]] }
    expect(bySlug(readModelCatalog(withJunk))).toEqual(['gpt-5.6-sol', 'gpt-5.6-luna'])
  })

  it.each([[null], [42], ['a string'], [{}], [{ models: 'not a list' }]])(
    'reports malformed rather than throwing for %s',
    (input) => {
      expect(readModelCatalog(input)).toEqual({ models: [], problem: 'malformed' })
    },
  )

  it('reports no problem for a well-formed file that offers nothing', () => {
    expect(readModelCatalog({ models: [] })).toEqual({ models: [], problem: null })
  })
})

describe('loadModelCatalog', () => {
  it('reports absent when the cache has never been written', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mochi-models-'))
    try {
      // The ordinary state on a machine whose Codex has not run. Not a fault.
      expect(await loadModelCatalog(home)).toEqual({ models: [], problem: 'absent' })
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('reports malformed for a file that is not JSON, and does not throw', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mochi-models-'))
    try {
      writeFileSync(join(home, 'models_cache.json'), 'this is not json{{{')
      expect(await loadModelCatalog(home)).toEqual({ models: [], problem: 'malformed' })
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('reads a real file end to end', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mochi-models-'))
    try {
      writeFileSync(join(home, 'models_cache.json'), JSON.stringify(CACHE))
      const catalog = await loadModelCatalog(home)
      expect(catalog.problem).toBeNull()
      expect(bySlug(catalog)).toEqual(['gpt-5.6-sol', 'gpt-5.6-luna', 'gpt-5.3-codex-spark'])
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})

describe('audit regressions', () => {
  /**
   * The advertised default is only usable if the model lists it. Accepting it
   * blindly let the pane save a level the same catalog denies -- the mismatch
   * the per-model list exists to prevent, arriving through the safe-looking
   * field.
   */
  it('ignores a default_reasoning_level the model does not list', () => {
    const odd = {
      models: [
        {
          slug: 'gpt-x',
          display_name: 'X',
          visibility: 'list',
          supported_in_api: true,
          priority: 1,
          default_reasoning_level: 'ultra',
          supported_reasoning_levels: [{ effort: 'low' }, { effort: 'medium' }],
        },
      ],
    }
    const model = readModelCatalog(odd).models[0]
    expect(model?.efforts).not.toContain('ultra')
    expect(model?.defaultEffort).toBe('low')
  })
})
