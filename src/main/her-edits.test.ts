import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { loadPersonas } from './store/personas'
import { personasRoot } from './store/persona-files'
import { readEdits } from './store/her-edits'

/**
 * Her own edits are loaded, and there is one place that loads them.
 *
 * ## What was wrong
 *
 * `readEdits` had no caller. Sixteen calls to `loadPersonas` in `main/index.ts`
 * each passed `{}` for the edits, so renaming the built-in Mochi or re-theming
 * her wrote `edits.json` and discarded it on the next load. Written, stored,
 * never read.
 *
 * ## Why the call-site count is asserted
 *
 * Sixteen call sites passing the same literal is not a coincidence, it is the
 * mechanism: with no single place where "load the characters" means "load the
 * characters", the seventeenth will pass `{}` too and nothing will notice. The
 * count is the fix; a round-trip test alone would pass again the moment
 * somebody adds one.
 */
let userData = ''

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'mochi-edits-'))
})

afterEach(() => {
  rmSync(userData, { recursive: true, force: true })
})

function seedEdits(edits: Record<string, unknown>): void {
  const folder = join(personasRoot(userData), 'mochi')
  mkdirSync(folder, { recursive: true })
  writeFileSync(join(folder, 'edits.json'), JSON.stringify(edits))
}

describe('the built-in character keeps what was changed about her', () => {
  it('survives a reload', () => {
    seedEdits({ name: 'Momo', theme: 'moss' })
    const { edits, problem } = readEdits(userData)
    expect(problem).toBeNull()

    const her = loadPersonas(userData, edits, true).personas.get('mochi')
    expect(her?.name).toBe('Momo')
    expect(her?.theme).toBe('moss')
  })

  it('is discarded when the edits are dropped on the floor', () => {
    // The bug, reproduced: this is what all sixteen call sites did.
    seedEdits({ name: 'Momo' })
    expect(loadPersonas(userData, {}, true).personas.get('mochi')?.name).not.toBe('Momo')
  })

  it('starts anyway when her edits cannot be read', () => {
    // Her defaults are a working character. Refusing to launch because a rename
    // is unreadable is a worse failure than launching un-renamed.
    mkdirSync(join(personasRoot(userData), 'mochi'), { recursive: true })
    writeFileSync(join(personasRoot(userData), 'mochi', 'edits.json'), '{ not json')
    const { edits, problem } = readEdits(userData)
    expect(problem).not.toBeNull()
    expect(loadPersonas(userData, edits, true).personas.get('mochi')).toBeDefined()
  })
})

describe('exactly one place loads the characters', () => {
  it('and every other caller goes through it', async () => {
    const { readFileSync } = await import('node:fs')
    const main = readFileSync(join(process.cwd(), 'src', 'main', 'index.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[ \t]*\/\/.*$/gm, '')

    const calls = [...main.matchAll(/\bloadPersonas\s*\(/g)]
    expect(calls, 'a second caller of `loadPersonas` is how the edits got lost').toHaveLength(1)

    const helper = main.slice(main.indexOf('function catalogue'))
    expect(helper.slice(0, helper.indexOf('\n}'))).toContain('readEdits(userData)')
  })

  it('never passes an empty edit set', () => {
    const { readFileSync } = require('node:fs') as typeof import('node:fs')
    const main = readFileSync(join(process.cwd(), 'src', 'main', 'index.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[ \t]*\/\/.*$/gm, '')
    expect(main).not.toContain('loadPersonas(userData, {}')
  })
})
