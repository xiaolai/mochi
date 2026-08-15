import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_DELEGATION } from '@shared/delegation'
import { gatherDelegationFacts, unknownDelegation } from './facts'
import type { CodexStatus } from './status'

const READY: CodexStatus = { kind: 'ready', version: '0.147.0', mode: 'chatgpt' }
const WS = '/data/mochi/workspace'

describe('unknownDelegation', () => {
  /**
   * The placeholder must not be cheerful.
   *
   * It is what the pane renders between launch and the first read, and an
   * optimistic default would claim a working Codex the app has not looked at.
   * A wrong green is worse than a brief grey.
   */
  it('reports not-ready rather than assuming everything works', () => {
    const view = unknownDelegation(DEFAULT_DELEGATION)
    expect(view.readiness).not.toBe('ready')
    expect(view.remedy).not.toBeNull()
    expect(view.catalog.models).toEqual([])
    expect(view.trust).not.toBe('trusted')
  })

  it('carries the settings through, so a saved choice shows immediately', () => {
    const chosen = { ...DEFAULT_DELEGATION, model: 'gpt-5.6-luna', trigger: 'anytime' as const }
    expect(unknownDelegation(chosen).settings).toEqual(chosen)
  })
})

describe('gatherDelegationFacts', () => {
  it('reduces a status to a kind and a remedy, and carries nothing else from it', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mochi-facts-'))
    try {
      const view = await gatherDelegationFacts({
        home,
        workspace: WS,
        settings: DEFAULT_DELEGATION,
        status: { kind: 'logged-out', version: '0.147.0' },
      })
      expect(view.readiness).toBe('logged-out')
      expect(view.remedy).toBe('login')
      // Nothing that could name a person or a path may cross to the renderer.
      expect(JSON.stringify(view)).not.toContain('0.147.0')
      expect(JSON.stringify(view)).not.toContain(home)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('reports an absent cache and an absent config without failing', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mochi-facts-'))
    try {
      const view = await gatherDelegationFacts({
        home,
        workspace: WS,
        settings: DEFAULT_DELEGATION,
        status: READY,
      })
      expect(view.readiness).toBe('ready')
      expect(view.remedy).toBeNull()
      expect(view.catalog).toEqual({ models: [], problem: 'absent' })
      expect(view.trust).toBe('absent')
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('reads both files when they are there', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mochi-facts-'))
    try {
      writeFileSync(
        join(home, 'models_cache.json'),
        JSON.stringify({
          models: [
            {
              slug: 'gpt-5.6-sol',
              display_name: 'Sol',
              visibility: 'list',
              supported_in_api: true,
              priority: 1,
              default_reasoning_level: 'low',
              supported_reasoning_levels: [{ effort: 'low' }],
            },
          ],
        }),
      )
      writeFileSync(join(home, 'config.toml'), `[projects.'${WS}']\ntrust_level = "trusted"\n`)

      const view = await gatherDelegationFacts({
        home,
        workspace: WS,
        settings: DEFAULT_DELEGATION,
        status: READY,
      })
      expect(view.catalog.models.map((model) => model.slug)).toEqual(['gpt-5.6-sol'])
      expect(view.trust).toBe('trusted')
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('does not probe when the caller already has an answer', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mochi-facts-'))
    try {
      // A passed status means no process is started. If this ever regressed to
      // probing anyway, the whole point of injecting it -- `checkCodex` costs a
      // spawn and up to three deadlines -- would be lost silently.
      const before = Date.now()
      await gatherDelegationFacts({
        home,
        workspace: WS,
        settings: DEFAULT_DELEGATION,
        status: READY,
      })
      expect(Date.now() - before).toBeLessThan(1_000)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})
