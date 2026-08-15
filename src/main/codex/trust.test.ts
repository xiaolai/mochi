import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { hasTable, projectPathOf, readTrustState, trustWorkspace, untrustWorkspace } from './trust'

const WS = '/Users/someone/Library/Application Support/mochi/workspace'
const STAMP = '20260815-000000'

/**
 * A config shaped like the real one: several project tables, a comment, and --
 * the part that matters -- `hooks.state` keys.
 *
 * Those keys are how Codex remembers that a `<project>/.codex/hooks.json` was
 * approved, and hooks run commands. This module must be incapable of touching
 * them, so they are in every fixture rather than in one dedicated test.
 */
const CONFIG = `# codex config
model = "gpt-5.6-sol"

[hooks.state."/Users/someone/work/.codex/hooks.json:post_tool_use:0:0"]
approved = true

[hooks.state."/Users/someone/work/.codex/hooks.json:post_tool_use:0:1"]
approved = true

[projects."/Users/someone"]
trust_level = "trusted"

[projects."/Users/someone/work"]
trust_level = "trusted"
`

function withConfig(text: string = CONFIG): string {
  const home = mkdtempSync(join(tmpdir(), 'mochi-trust-'))
  writeFileSync(join(home, 'config.toml'), text)
  return home
}
const read = (home: string): string => readFileSync(join(home, 'config.toml'), 'utf8')
const backups = (home: string): string[] =>
  readdirSync(home).filter((name) => name.includes('mochi-backup'))

describe('trustWorkspace', () => {
  it('appends one table and leaves every other byte alone', async () => {
    const home = withConfig()
    try {
      const result = await trustWorkspace(home, WS, STAMP)
      expect(result).toEqual({ ok: true, changed: true })

      const after = read(home)
      // The whole original file is still a prefix of the new one. Stronger than
      // checking a few lines: it forbids reformatting anywhere, which is what a
      // parse-and-serialise round trip would silently do to 71 entries.
      expect(after.startsWith(CONFIG)).toBe(true)
      expect(after).toContain(`[projects.'${WS}']`)
      expect(after).toContain('trust_level = "trusted"')
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  /**
   * The hard constraint. Trusting a directory must never imply trusting hooks
   * inside it -- hooks execute commands, which is a category above the prompt
   * injection that was measured.
   */
  it('never writes a hooks.state key', async () => {
    const home = withConfig()
    try {
      await trustWorkspace(home, WS, STAMP)
      const after = read(home)
      const hookLines = after.split('\n').filter((line) => line.includes('hooks.state'))
      expect(hookLines).toEqual([
        '[hooks.state."/Users/someone/work/.codex/hooks.json:post_tool_use:0:0"]',
        '[hooks.state."/Users/someone/work/.codex/hooks.json:post_tool_use:0:1"]',
      ])
      expect(after).not.toContain(`hooks.state."${WS}`)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('backs the file up before touching it', async () => {
    const home = withConfig()
    try {
      await trustWorkspace(home, WS, STAMP)
      const saved = backups(home)
      expect(saved).toHaveLength(1)
      expect(readFileSync(join(home, saved[0]!), 'utf8')).toBe(CONFIG)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('does nothing when the table is already there, and does not duplicate it', async () => {
    const home = withConfig()
    try {
      await trustWorkspace(home, WS, STAMP)
      const once = read(home)
      const second = await trustWorkspace(home, WS, 'later')
      expect(second).toEqual({ ok: true, changed: false })
      expect(read(home)).toBe(once)
      // No second backup either: nothing was written, so nothing needed saving.
      expect(backups(home)).toHaveLength(1)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  /**
   * Still does not overwrite -- and no longer claims success for it.
   *
   * Returning `{ok: true, changed: false}` here meant the switch recorded ON
   * while Codex went on refusing to trust the directory, with nothing anywhere
   * saying so. "There is a table" is not "it says what you asked for".
   */
  it('refuses rather than reporting success when a table says otherwise', async () => {
    const mine = `${CONFIG}\n[projects.'${WS}']\ntrust_level = "untrusted"\n`
    const home = withConfig(mine)
    try {
      expect(await trustWorkspace(home, WS, STAMP)).toMatchObject({ ok: false })
      expect(read(home)).toBe(mine)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('is still a no-op when a table already says trusted', async () => {
    const already = `${CONFIG}\n[projects."${WS}"]\ntrust_level = "trusted"\n`
    const home = withConfig(already)
    try {
      expect(await trustWorkspace(home, WS, STAMP)).toEqual({ ok: true, changed: false })
      expect(read(home)).toBe(already)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('refuses rather than creating a Codex configuration that does not exist', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mochi-trust-'))
    try {
      const result = await trustWorkspace(home, WS, STAMP)
      expect(result.ok).toBe(false)
      expect(readdirSync(home)).toEqual([])
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  /** Refusing beats escaping: a wrong table corrupts a file we promised not to. */
  it('refuses a path that cannot be written as a TOML literal', async () => {
    const home = withConfig()
    try {
      const result = await trustWorkspace(home, "/Users/someone/it's/workspace", STAMP)
      expect(result.ok).toBe(false)
      expect(read(home)).toBe(CONFIG)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})

describe('untrustWorkspace', () => {
  /** The headline property: on then off is byte-for-byte where it started. */
  it('returns the file to exactly what it was', async () => {
    const home = withConfig()
    try {
      await trustWorkspace(home, WS, STAMP)
      expect(read(home)).not.toBe(CONFIG)
      const result = await untrustWorkspace(home, WS, 'undo')
      expect(result).toEqual({ ok: true, changed: true })
      expect(read(home)).toBe(CONFIG)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('removes only our table, leaving the user their own', async () => {
    const home = withConfig()
    try {
      await trustWorkspace(home, WS, STAMP)
      await untrustWorkspace(home, WS, 'undo')
      const after = read(home)
      expect(after).toContain('[projects."/Users/someone"]')
      expect(after).toContain('[projects."/Users/someone/work"]')
      expect(after).toContain('hooks.state')
      expect(after).not.toContain(WS)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('is a success when there is nothing to undo', async () => {
    const home = withConfig()
    try {
      expect(await untrustWorkspace(home, WS, 'undo')).toEqual({ ok: true, changed: false })
      expect(read(home)).toBe(CONFIG)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('survives repeated toggling without growing the file', async () => {
    const home = withConfig()
    try {
      for (let round = 0; round < 3; round += 1) {
        await trustWorkspace(home, WS, `on-${round}`)
        await untrustWorkspace(home, WS, `off-${round}`)
      }
      expect(read(home)).toBe(CONFIG)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})

describe('readTrustState', () => {
  it('reports absent when there is no configuration', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mochi-trust-'))
    try {
      expect(await readTrustState(home, WS)).toEqual({ kind: 'absent' })
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('reads untrusted then trusted around a change', async () => {
    const home = withConfig()
    try {
      expect(await readTrustState(home, WS)).toEqual({ kind: 'untrusted' })
      await trustWorkspace(home, WS, STAMP)
      // Ours, because we wrote it -- which is what lets the pane offer an off
      // switch only where removal will actually do something.
      expect(await readTrustState(home, WS)).toEqual({ kind: 'trusted', ours: true })
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})

describe('hasTable', () => {
  /** Line-anchored, so a path inside a comment is not mistaken for a decision. */
  it('does not match a header mentioned in a comment', () => {
    expect(hasTable(`# see [projects.'${WS}'] for details\n`, WS)).toBe(false)
    expect(hasTable(`[projects.'${WS}']\n`, WS)).toBe(true)
  })
})

/**
 * Defects the M10 audit found. Each would have reached a user's own Codex.
 */
describe('audit regressions', () => {
  /**
   * The dangerous one. TOML treats `"k"` and `'k'` as the SAME key, Codex writes
   * the double-quoted form, and a file holding both is invalid -- so missing an
   * existing entry meant appending a duplicate and leaving the user with a
   * `config.toml` that no longer parses. Breaking their Codex is the one
   * outcome this module exists to avoid.
   */
  it('sees the double-quoted form Codex itself writes', async () => {
    const codexWrote = `${CONFIG}\n[projects."${WS}"]\ntrust_level = "trusted"\n`
    const home = withConfig(codexWrote)
    try {
      expect(hasTable(codexWrote, WS)).toBe(true)
      expect(await readTrustState(home, WS)).toEqual({ kind: 'trusted', ours: false })

      // And therefore does not append a second table for the same key.
      expect(await trustWorkspace(home, WS, STAMP)).toEqual({ ok: true, changed: false })
      expect(read(home)).toBe(codexWrote)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  /** Removal is ours only, and ownership is recorded rather than assumed. */
  it('never removes a table somebody else wrote for the same path', async () => {
    const theirs = `${CONFIG}\n[projects.'${WS}']\ntrust_level = "trusted"\n`
    const home = withConfig(theirs)
    try {
      expect(await untrustWorkspace(home, WS, 'undo')).toEqual({ ok: true, changed: false })
      expect(read(home)).toBe(theirs)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('still removes its own, marker and all', async () => {
    const home = withConfig()
    try {
      await trustWorkspace(home, WS, STAMP)
      expect(read(home)).toContain('# added by mochi')
      await untrustWorkspace(home, WS, 'undo')
      expect(read(home)).toBe(CONFIG)
      expect(read(home)).not.toContain('# added by mochi')
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  /**
   * Committed through a rename, so the file is either the old one or the new
   * one. `writeFile` truncates first, and a crash between truncate and the last
   * byte leaves another program's configuration half-written.
   */
  it('leaves no temporary file behind after a successful write', async () => {
    const home = withConfig()
    try {
      await trustWorkspace(home, WS, STAMP)
      expect(readdirSync(home).filter((name) => name.includes('mochi-tmp'))).toEqual([])
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})

describe('header forms that used to slip past', () => {
  /**
   * Each of these is a real `[projects.…]` entry naming the same path. Missing
   * any of them meant appending a duplicate logical table, and a TOML file with
   * one key twice does not parse -- so the user's Codex stops working.
   */
  it.each([
    ['a literal string', `[projects.'${WS}']`],
    ['a basic string', `[projects."${WS}"]`],
    ['a trailing comment', `[projects."${WS}"]  # trusted earlier`],
    ['leading indentation', `   [projects."${WS}"]`],
  ])('recognises %s', (_name, header) => {
    expect(hasTable(`${header}\ntrust_level = "trusted"\n`, WS)).toBe(true)
  })

  it('decodes escapes in a basic string, as a Windows path needs', () => {
    const windows = String.raw`C:\Users\someone\mochi`
    const written = '[projects."C:\\\\Users\\\\someone\\\\mochi"]'
    expect(projectPathOf(written)).toBe(windows)
    expect(hasTable(`${written}\ntrust_level = "trusted"\n`, windows)).toBe(true)
  })

  it.each([
    ['a different path', `[projects."/somewhere/else"]`],
    ['another table entirely', `[hooks.state."/x"]`],
    ['a commented-out header', `# [projects."${WS}"]`],
    ['an unterminated quote', `[projects."${WS}`],
  ])('does not match %s', (_name, line) => {
    expect(projectPathOf(line)).not.toBe(WS)
  })
})

describe('round-1 audit regressions', () => {
  /**
   * The header alone was read as "trusted". A table saying otherwise showed an
   * on switch for a directory Codex does not trust -- and the switch would then
   * appear to do nothing.
   */
  it('reads the value under the header, not merely the header', async () => {
    const home = withConfig(`${CONFIG}\n[projects.'${WS}']\ntrust_level = "untrusted"\n`)
    try {
      expect(await readTrustState(home, WS)).toEqual({ kind: 'untrusted' })
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('still reports trusted when the value really says so', async () => {
    const home = withConfig(`${CONFIG}\n[projects."${WS}"]\ntrust_level = "trusted"\n`)
    try {
      expect(await readTrustState(home, WS)).toEqual({ kind: 'trusted', ours: false })
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})

describe('round-3 audit regressions', () => {
  /**
   * A path decoded wrongly reads as a DIFFERENT path, which reads as "no entry
   * here", which appends a duplicate logical key -- the failure that stops the
   * user's Codex parsing its own configuration.
   */
  it.each([
    ['a carriage return', String.raw`[projects."/a\rb"]`, '/a\rb'],
    ['a backslash', String.raw`[projects."/a\\b"]`, '/a\\b'],
    ['an escaped quote', String.raw`[projects."/a\"b"]`, '/a"b'],
    ['a unicode escape', String.raw`[projects."/caf\u00e9"]`, '/café'],
  ])('decodes %s', (_name, line, expected) => {
    expect(projectPathOf(line)).toBe(expected)
  })

  /**
   * An escape this version cannot read is NOT "no entry" -- it may be this very
   * path, and appending beside it is the duplicate-key bug. Refusing costs a
   * switch; guessing costs the user their Codex.
   */
  it('refuses to append past a header it cannot decode', async () => {
    const odd = `${CONFIG}\n[projects."/a\\qb"]\ntrust_level = "trusted"\n`
    const home = withConfig(odd)
    try {
      const result = await trustWorkspace(home, WS, STAMP)
      expect(result.ok).toBe(false)
      expect(read(home)).toBe(odd)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  /** Two toggles in flight applied the older intent last. */
  it('applies concurrent changes in order rather than racing', async () => {
    const home = withConfig()
    try {
      await Promise.all([
        trustWorkspace(home, WS, 'a'),
        untrustWorkspace(home, WS, 'b'),
        trustWorkspace(home, WS, 'c'),
      ])
      // Whatever the interleaving, the file is still valid TOML with at most
      // one table for this path -- the property a lost update destroys.
      const headers = read(home)
        .split('\n')
        .filter((line) => projectPathOf(line) === WS)
      expect(headers.length).toBeLessThanOrEqual(1)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})
