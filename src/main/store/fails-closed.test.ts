import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { DEFAULT_PERSONA } from '@shared/persona'
import type { Policy } from '@shared/policy'

import { createConversation } from './conversation'
import { LEGACY_FILE, loadPersonas, migrateLegacyPersona, personasRoot } from './personas'
import { keepsFor, policyRoot } from './policy'
import { createTranscripts } from './transcripts'

/**
 * A privacy choice that could not be written is still honoured.
 *
 * ## The failure
 *
 * `readPolicy` answers "keep" for a character with no policy file. So a
 * migration that could not write -- a full disk, a read-only directory, a
 * permissions change -- turned a `keeps: false` somebody actually chose into
 * recording. The one direction that must never be guessed, guessed the wrong
 * way, silently, with the user's opt-out sitting in a map nothing read.
 *
 * ## Why both producers are tested
 *
 * `carriedPolicies` is filled from two independent paths -- a v1 package
 * manifest, and the legacy root `persona.json`. Wiring one and testing one
 * leaves the other defaulting to recording, and the two look identical from
 * the outside. Codex raised this against the plan; it was right.
 */
let userData = ''

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'mochi-closed-'))
})

afterEach(() => {
  // Undo the read-only bit first, or the tree cannot be removed.
  try {
    chmodSync(policyRoot(userData), 0o755)
  } catch {
    /* never created */
  }
  rmSync(userData, { recursive: true, force: true })
})

/** A policy store the migration cannot write into. */
function sealPolicyStore(): void {
  mkdirSync(policyRoot(userData), { recursive: true })
  chmodSync(policyRoot(userData), 0o555)
}

function packageCarrying(id: string, keeps: boolean): void {
  const folder = join(personasRoot(userData), id)
  mkdirSync(folder, { recursive: true })
  // `version: 1` is what claims to predate the move, which is what makes the
  // one-time carry eligible to run at all.
  writeFileSync(
    join(folder, 'persona.json'),
    JSON.stringify({ ...DEFAULT_PERSONA, id, name: 'Ada', version: 1, keeps }),
  )
}

/** The OTHER producer: v1's single `persona.json` at the root. */
function legacyCarrying(keeps: boolean): Policy | null {
  writeFileSync(
    join(userData, LEGACY_FILE),
    JSON.stringify({ ...DEFAULT_PERSONA, id: 'tutor', name: 'Ada', version: 1, keeps }),
  )
  const result = migrateLegacyPersona(userData, loadPersonas(userData, {}, true))
  return result.kind === 'imported' ? result.carried : null
}

/** Whether anything at all reached the archive. */
function turnsStored(keeps: (id: string) => boolean, personaId: string): number {
  const transcripts = createTranscripts(userData)
  try {
    const talk = createConversation({ transcripts, keeps })
    talk.wear(personaId)
    talk.file('you', 'this should not be written down')
    talk.end()
    return transcripts.sessions(personaId).length
  } finally {
    transcripts.close()
  }
}

describe('a carry that could not reach disk still stops the recording', () => {
  it('from a package manifest', () => {
    packageCarrying('ada', false)
    sealPolicyStore()

    const catalog = loadPersonas(userData, {}, true)
    expect(
      catalog.carriedPolicies.get('ada'),
      'the migration should have parked it, since the store refused',
    ).toEqual({ keeps: false })

    expect(keepsFor(userData, 'ada', catalog.carriedPolicies)).toBe(false)
    expect(turnsStored((id) => keepsFor(userData, id, catalog.carriedPolicies), 'ada')).toBe(0)
  })

  it('and it is the map, not the store, that is answering', () => {
    // The bug, reproduced. This is what every caller did before: consult the
    // policy store alone and take its "keep" default for an answer.
    packageCarrying('ada', false)
    sealPolicyStore()
    const catalog = loadPersonas(userData, {}, true)

    expect(keepsFor(userData, 'ada', new Map())).toBe(true)
    expect(turnsStored((id) => keepsFor(userData, id, new Map()), 'ada')).toBe(1)
    expect(catalog.carriedPolicies.size).toBeGreaterThan(0)
  })

  it("from v1's single persona.json, the OTHER producer", () => {
    /*
      The one that made this worth testing twice. `migrateLegacyPersona` hands
      its carry back as a RETURN VALUE, not through `catalog.carriedPolicies`,
      and main read only `kind`. So the package path could be wired, tested and
      green while an imported v1 character -- whose owner had turned recording
      off -- recorded everything for the rest of the run.

      What saves it is the parked file: the choice is written into her package,
      so re-reading the catalogue finds it. That is what main now does.
    */
    sealPolicyStore()
    expect(legacyCarrying(false)).toEqual({ keeps: false })

    const after = loadPersonas(userData, {}, true).carriedPolicies
    expect(after.get('tutor'), 'a later load must re-discover the parked choice').toEqual({
      keeps: false,
    })
    expect(keepsFor(userData, 'tutor', after)).toBe(false)
    expect(turnsStored((id) => keepsFor(userData, id, after), 'tutor')).toBe(0)
  })

  it('still prefers a policy that DID land', () => {
    // A parked entry is a write that has not happened yet, not an override.
    // Once the store has an answer it is the authority, which is also what
    // makes a stale carry harmless.
    packageCarrying('ada', true)
    const catalog = loadPersonas(userData, {}, true)
    expect(keepsFor(userData, 'ada', new Map([['ada', { keeps: false }]]))).toBe(true)
    expect(catalog.problems.length).toBe(0)
  })
})

describe('main re-reads the catalogue after the v1 import', () => {
  it('so the carry it hands back is not dropped', () => {
    /*
      The fix in `keepsFor` is worthless here without this. `migrateLegacyPersona`
      returns the carry, main uses only `kind`, and the parked file is only
      picked up by a LOAD -- so without a load after the import, an imported
      character records for the whole run despite the choice.

      Asserted from source with comments stripped, because the property is an
      ordering in the startup sequence: the refresh must come after the import
      block, and no unit test of either piece can see that.
    */
    const main = readFileSync(join(process.cwd(), 'src', 'main', 'index.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[ \t]*\/\/.*$/gm, '')

    const importedAt = main.indexOf("v1's persona imported as")
    const refreshAt = main.indexOf("catalogue(app.getPath('userData'))", importedAt)
    expect(importedAt, 'the v1 import block moved').toBeGreaterThan(-1)
    expect(refreshAt, 'nothing re-reads the catalogue after the v1 import').toBeGreaterThan(
      importedAt,
    )
    // And before the app starts filing turns.
    expect(refreshAt).toBeLessThan(main.indexOf("app.on('before-quit'"))
  })
})
