import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readCodexDefaults } from './defaults'

/** Shaped like the real one: bare keys on top, tables below. */
const CONFIG = `approval_policy = "never"
model = "gpt-5.6-sol"
model_provider = "openai"
model_reasoning_effort = "ultra"
personality = "pragmatic"

[projects."/Users/someone"]
model = "gpt-5.4"
model_reasoning_effort = "low"
`

function withConfig(text: string): string {
  const home = mkdtempSync(join(tmpdir(), 'mochi-defaults-'))
  writeFileSync(join(home, 'config.toml'), text)
  return home
}

describe('readCodexDefaults', () => {
  /**
   * What "follow my Codex" resolves to. Treating it as unknown hid the reason a
   * delegation took over a minute on the development machine: `ultra`.
   */
  it('reads the model and the effort', async () => {
    const home = withConfig(CONFIG)
    try {
      expect(await readCodexDefaults(home)).toEqual({ model: 'gpt-5.6-sol', effort: 'ultra' })
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  /**
   * A key inside a table belongs to that table. Reading it as the global
   * default would report a setting the user never made -- and the real file has
   * seventy-one project tables, most of which could carry one.
   */
  it('stops at the first table header', async () => {
    const home = withConfig('[projects."/x"]\nmodel = "gpt-5.4"\n')
    try {
      expect(await readCodexDefaults(home)).toEqual({ model: null, effort: null })
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('reports null rather than failing when there is no config at all', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mochi-defaults-'))
    try {
      expect(await readCodexDefaults(home)).toEqual({ model: null, effort: null })
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it.each([
    ['an unquoted value', 'model = gpt-5.6-sol\n'],
    ['a value that is not a slug', 'model = "../../etc/passwd"\n'],
    ['no such key', 'personality = "pragmatic"\n'],
  ])('reports null for %s', async (_name, text) => {
    const home = withConfig(text)
    try {
      expect((await readCodexDefaults(home)).model).toBeNull()
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  /** `model_reasoning_effort` starts with `model`; prefix matching would confuse them. */
  it('does not mistake model_reasoning_effort for model', async () => {
    const home = withConfig('model_reasoning_effort = "low"\n')
    try {
      expect(await readCodexDefaults(home)).toEqual({ model: null, effort: 'low' })
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})
