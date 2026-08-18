import { describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SUPERSEDED, quarantineFolder, setAsideV1 } from './inherited'

const fresh = (): string => mkdtempSync(join(tmpdir(), 'inherited-'))
const nothing = (): void => {}

describe('getting v1 out of the way', () => {
  it('moves what v1 left and nothing else', () => {
    const root = fresh()
    writeFileSync(join(root, 'delegation-answer.json'), 'v1')
    writeFileSync(join(root, 'transcripts.db'), 'ours')
    mkdirSync(join(root, 'personas'))
    // Chromium's, and the reason this works from a list rather than a sweep.
    mkdirSync(join(root, 'Local Storage'))

    const moved = setAsideV1(root, 'x', nothing)

    expect(moved.map((one) => one.name)).toEqual(['delegation-answer.json'])
    expect(existsSync(join(root, 'transcripts.db'))).toBe(true)
    expect(existsSync(join(root, 'personas'))).toBe(true)
    expect(existsSync(join(root, 'Local Storage'))).toBe(true)
  })

  it('moves rather than deletes', () => {
    // Nothing here is confident enough to destroy somebody's data.
    const root = fresh()
    writeFileSync(join(root, 'summary-schema.json'), 'the original bytes')

    setAsideV1(root, 'x', nothing)

    expect(existsSync(join(root, 'summary-schema.json'))).toBe(false)
    expect(readFileSync(join(root, quarantineFolder('x'), 'summary-schema.json'), 'utf8')).toBe(
      'the original bytes',
    )
  })

  it('leaves no folder behind when there was nothing to move', () => {
    // An empty quarantine folder suggests something happened. Nothing did.
    const root = fresh()
    writeFileSync(join(root, 'transcripts.db'), 'ours')

    expect(setAsideV1(root, 'x', nothing)).toEqual([])
    expect(existsSync(join(root, quarantineFolder('x')))).toBe(false)
  })

  it('never touches preferences.json', () => {
    // `store/worn.ts` still reads one field out of it, and that is what stops a
    // fresh launch wearing the wrong character over somebody's archive.
    expect(SUPERSEDED).not.toContain('preferences.json')
    const root = fresh()
    writeFileSync(join(root, 'preferences.json'), 'still needed')
    setAsideV1(root, 'x', nothing)
    expect(existsSync(join(root, 'preferences.json'))).toBe(true)
  })

  it('is idempotent — a second run finds nothing', () => {
    const root = fresh()
    writeFileSync(join(root, 'drill'), 'v1')
    expect(setAsideV1(root, 'a', nothing)).toHaveLength(1)
    expect(setAsideV1(root, 'b', nothing)).toEqual([])
  })

  it('reports a file it could not move and carries on with the rest', () => {
    // One stubborn file is a reason to continue, not to refuse to launch.
    const root = fresh()
    writeFileSync(join(root, 'drill'), 'v1')
    writeFileSync(join(root, 'summary-schema.json'), 'v1')
    // Make the destination for one of them impossible by putting a FILE where
    // its target name must go.
    mkdirSync(join(root, quarantineFolder('x')))
    mkdirSync(join(root, quarantineFolder('x'), 'drill'))
    writeFileSync(join(root, quarantineFolder('x'), 'drill', 'blocker'), 'in the way')

    const problems: string[] = []
    const moved = setAsideV1(root, 'x', (name) => problems.push(name))

    expect(problems).toEqual(['drill'])
    expect(moved.map((one) => one.name)).toEqual(['summary-schema.json'])
  })
})
