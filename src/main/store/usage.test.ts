import { chmodSync, mkdtempSync, rmSync, writeFileSync, symlinkSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { noteUsed, readUsage, usagePath } from './usage'

const made: string[] = []

function userData(): string {
  const path = mkdtempSync(join(tmpdir(), 'mochi-usage-'))
  made.push(path)
  return path
}

afterEach(() => {
  while (made.length > 0) rmSync(made.pop() as string, { recursive: true, force: true })
})

/** The map, insisting the record was actually readable. */
function used(home: string): ReadonlyMap<string, number> {
  const read = readUsage(home)
  if (!read.ok) throw new Error(`expected a readable record: ${read.why}`)
  return read.used
}

/** Readable and empty, which is NOT the same answer as unreadable. */
function available(read: ReturnType<typeof readUsage>): readonly [string, number][] {
  if (!read.ok) throw new Error(`expected a readable record: ${read.why}`)
  return [...read.used]
}

function unreadable(read: ReturnType<typeof readUsage>): boolean {
  return !read.ok
}

describe('before anything has been called', () => {
  it('answers empty rather than failing', () => {
    expect(available(readUsage(userData()))).toEqual([])
  })
})

describe('recording a use', () => {
  it('reads back what was written', () => {
    const home = userData()
    noteUsed(home, 'ask_workspace', 1_700_000_000_000)
    expect(used(home).get('ask_workspace')).toBe(1_700_000_000_000)
  })

  it('keeps every other capability when one is written', () => {
    // Read, change one key, write the whole object back. A writer that knew
    // only its own key would drop everybody else's — the same failure
    // `worn.ts` guards `preferences.json` against.
    const home = userData()
    noteUsed(home, 'ask_workspace', 1_000)
    noteUsed(home, 'remember_this', 2_000)
    expect(used(home).get('ask_workspace')).toBe(1_000)
    expect(used(home).get('remember_this')).toBe(2_000)
  })

  it('moves forward and never back', () => {
    // A clock that jumped backwards — an NTP correction, a machine resuming
    // from sleep — would otherwise make a capability look less recently used
    // than it is, which is the one way this column can lie without looking
    // wrong.
    const home = userData()
    noteUsed(home, 'ask_workspace', 5_000)
    noteUsed(home, 'ask_workspace', 4_000)
    expect(used(home).get('ask_workspace')).toBe(5_000)
  })

  it('refuses a name that is not a capability name', () => {
    // It becomes a key in a file this app reads back and a label in a window.
    const home = userData()
    expect(() => noteUsed(home, '../escape', 1_000)).toThrow()
    expect(() => noteUsed(home, 'Ask_Workspace', 1_000)).toThrow()
  })

  it('refuses a time that is not one', () => {
    const home = userData()
    expect(() => noteUsed(home, 'ask_workspace', Number.NaN)).toThrow()
    expect(() => noteUsed(home, 'ask_workspace', 0)).toThrow()
  })
})

describe('a file somebody has edited', () => {
  it('drops keys that are not capability names', () => {
    // The file is hand-editable and sits in the user's own directory, so a key
    // that reached the panel unchecked would be text somebody else wrote drawn
    // as a capability.
    const home = userData()
    writeFileSync(
      usagePath(home),
      JSON.stringify({ ask_workspace: 1_000, '../../etc/passwd': 2_000, 'Not A Name': 3_000 }),
    )
    expect([...used(home).keys()]).toEqual(['ask_workspace'])
  })

  it('drops times that would render as Invalid Date', () => {
    const home = userData()
    writeFileSync(
      usagePath(home),
      JSON.stringify({ ask_workspace: 'yesterday', remember_this: -1, recall_conversations: 7 }),
    )
    expect([...used(home).keys()]).toEqual(['recall_conversations'])
  })

  it('answers empty for JSON that is not an object', () => {
    const home = userData()
    writeFileSync(usagePath(home), JSON.stringify(['ask_workspace']))
    expect(unreadable(readUsage(home))).toBe(true)
  })

  it('answers empty rather than throwing on a file that is not JSON', () => {
    // The settings window opening is worth more than this column.
    const home = userData()
    writeFileSync(usagePath(home), 'not json at all')
    expect(unreadable(readUsage(home))).toBe(true)
  })

  it('refuses a symlink, like every other read in this store', () => {
    const home = userData()
    const elsewhere = join(home, 'elsewhere.json')
    writeFileSync(elsewhere, JSON.stringify({ ask_workspace: 1_000 }))
    symlinkSync(elsewhere, usagePath(home))
    expect(unreadable(readUsage(home))).toBe(true)
  })

  it('answers empty when the path is a directory', () => {
    const home = userData()
    mkdirSync(usagePath(home))
    expect(unreadable(readUsage(home))).toBe(true)
  })
})

describe('a write that cannot land', () => {
  it('throws when the WRITE cannot land, not merely when the read cannot', () => {
    // Two failures, and the first version of this test only reached one. A
    // directory at `usage.json` fails the READ, so `noteUsed` threw on the
    // refusal to overwrite an unreadable record and the write path stayed
    // untested — an audit caught the test, not the code.
    //
    // A read-only directory separates them: the file is genuinely ABSENT, so
    // the read succeeds and answers empty, and only the write fails.
    const home = userData()
    expect(readUsage(home).ok).toBe(true)
    chmodSync(home, 0o500)
    try {
      expect(() => noteUsed(home, 'ask_workspace', 1_000)).toThrow()
    } finally {
      // Restored whatever happened, or the temp directory cannot be removed.
      chmodSync(home, 0o700)
    }
  })

  it('refuses to write over a record that exists and cannot be read', () => {
    // The other failure, kept: everything already in the file would be lost,
    // and "she used it at some point" is worth more than one fresh row.
    const home = userData()
    mkdirSync(usagePath(home))
    expect(() => noteUsed(home, 'ask_workspace', 1_000)).toThrow()
  })

  it('refuses a finite time that Date cannot represent', () => {
    // `Number.isFinite` alone accepts it, and it renders as the literal string
    // "Invalid Date" in the panel — a worse answer than saying nothing.
    const home = userData()
    expect(() => noteUsed(home, 'ask_workspace', 8_640_000_000_000_001)).toThrow()
  })

  it('drops one that is already on disk rather than showing Invalid Date', () => {
    const home = userData()
    writeFileSync(usagePath(home), JSON.stringify({ ask_workspace: 8_640_000_000_000_001 }))
    expect([...used(home).keys()]).toEqual([])
  })
})
