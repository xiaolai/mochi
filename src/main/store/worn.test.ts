import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readWornPersonaId } from './worn'

let userData = ''
beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'mochi-worn-'))
})
afterEach(() => {
  rmSync(userData, { recursive: true, force: true })
})

function writePreferences(value: unknown): void {
  writeFileSync(join(userData, 'preferences.json'), JSON.stringify(value))
}

describe('remembering who she is', () => {
  it('reads the one field it needs out of a file full of other things', () => {
    // The shape a real v1 installation has. Everything except the one key is
    // about a settings window that does not exist here yet.
    writePreferences({
      sizePercent: 100,
      shortcuts: {},
      credentialSource: 'codex',
      activePersonaId: 'loki',
      sound: {},
      idleMs: 180_000,
      realtimeModel: 'gpt-realtime-2.1',
    })
    expect(readWornPersonaId(userData)).toBe('loki')
  })

  it('answers null on a fresh install, which is not a fault', () => {
    // Nobody has chosen. The caller falls back to the built-in, and saying so
    // loudly would train people to ignore the log.
    expect(readWornPersonaId(userData)).toBeNull()
  })

  it('answers null rather than throwing on a file it cannot parse', () => {
    writeFileSync(join(userData, 'preferences.json'), '{ not json')
    expect(readWornPersonaId(userData)).toBeNull()
  })

  it('refuses an id that would become a path segment', () => {
    // It is used as a lookup key and, downstream, as a directory name — the same
    // line `personas.ts` guards for a loose file's stem, where a name turns into
    // a location.
    for (const activePersonaId of ['../escape', 'a/b', '.', '', 'CAPITALS', 42, null]) {
      writePreferences({ activePersonaId })
      expect(readWornPersonaId(userData), String(activePersonaId)).toBeNull()
    }
  })

  it('answers null when the key is simply absent', () => {
    writePreferences({ sizePercent: 100 })
    expect(readWornPersonaId(userData)).toBeNull()
  })
})
