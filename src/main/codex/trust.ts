/**
 * Adding the workspace to Codex's own trusted list, and taking it back out.
 *
 * ## This is the first Codex file mochi WRITES
 *
 * Everything before it has been read: `auth.json`, `models_cache.json`.
 * `config.toml` belongs to another program and to the user --
 * seventy-one `[projects.…]` entries on the development machine -- and breaking
 * it breaks their Codex, not ours. So nothing here rewrites the file. A single
 * table is appended, or a single table is removed, and every other byte is
 * carried through untouched.
 *
 * ## Our own runs do not need it
 *
 * Worth stating because the opposite is the natural assumption. `codex exec
 * -s read-only` runs with approval `never`, and a spike ran it to completion in
 * a directory that had never been trusted. This switch exists so the USER is
 * not asked when they open Codex in that folder themselves.
 *
 * ## It writes `trust_level` and nothing else
 *
 * Codex hooks live at `<project>/.codex/hooks.json` and their trust is
 * persisted separately, under `[hooks.state."…"]` keys in this same file.
 * Hooks RUN COMMANDS. Trusting a directory must never be allowed to imply
 * trusting hooks inside it, so this module has no code path that can write a
 * `hooks.state` key -- and a test asserts the bytes of those lines survive.
 *
 * The guard in `workspace-guard.ts` is the other half of that pair: it refuses
 * to run at all when a `.codex` directory is present in the workspace.
 */

import { chmod, copyFile, lstat, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describeReadFailure } from './auth'

export type TrustState =
  /**
   * The table is present.
   *
   * `ours` says whether WE wrote it. Without that the pane offered an off
   * switch for a table `untrustWorkspace` deliberately refuses to remove --
   * a control that reports success and changes nothing, which is the shape of
   * defect this project keeps finding.
   */
  | { readonly kind: 'trusted'; readonly ours: boolean }
  | { readonly kind: 'untrusted' }
  /** No config at all. Codex has never been configured here; nothing is wrong. */
  | { readonly kind: 'absent' }
  /** The reason stays in main: `TrustStateKind` is all the window is told. */
  | { readonly kind: 'unreadable'; readonly reason: string }

export type TrustChange =
  { readonly ok: true; readonly changed: boolean } | { readonly ok: false; readonly reason: string }

/** A ceiling, for the reason `auth.ts` has one: the path is user-writable. */
const MAX_CONFIG_BYTES = 4 * 1024 * 1024

function configPath(home: string): string {
  return join(home, 'config.toml')
}

/**
 * The exact header this module writes, and the only one it will remove.
 *
 * TOML quotes a bare-string key with `"`, and a Windows path contains `\`,
 * which TOML would read as an escape. So the path is written as a LITERAL
 * string in single quotes, where no escape processing happens at all.
 *
 * A path containing a single quote cannot be expressed this way and is refused
 * outright rather than escaped into something plausible -- see `tableFor`.
 */
function headerFor(workspace: string): string {
  return `[projects.'${workspace}']`
}

/**
 * The path a `[projects.…]` header names, whichever way it is written.
 *
 * Comparing raw text missed three real forms: a Windows path that Codex wrote
 * as a basic string with `\\` escapes, any path containing a quote, and a
 * header followed by a comment. Each one meant "no entry here", which meant
 * appending a duplicate logical table -- and a TOML file with the same key
 * twice does not parse, so the user's Codex stops working.
 *
 * Decoding the key and comparing THAT is the check; the text it was written as
 * is not the thing being compared.
 */
/**
 * A `[projects.…]` header this version cannot decode.
 *
 * Distinct from `null`, which means "not a project header at all". Treating the
 * two alike would let an unreadable header be read as absent, and absent is
 * what makes this module append a second table for a key that already exists.
 */
export const UNDECODABLE = Symbol('undecodable project header')
export type UNDECODABLE_T = typeof UNDECODABLE

export function projectPathOf(line: string): string | UNDECODABLE_T | null {
  // A trailing comment is legal after a table header. Only outside the quotes,
  // which is why this walks rather than splitting on `#`.
  const trimmed = line.trim()
  // TOML allows whitespace around the dotted-key separator, so `[projects . "x"]`
  // names the same table as `[projects."x"]`. Missing that spelling means
  // reading "no entry here" and appending a duplicate logical key, which is the
  // failure that stops the user's Codex parsing its own config.
  const opener = /^\[\s*projects\s*\.\s*/.exec(trimmed)
  if (opener === null) return null
  const body = trimmed.slice(opener[0].length)
  const quote = body[0]
  if (quote !== '"' && quote !== "'") return null

  let out = ''
  let index = 1
  while (index < body.length) {
    const character = body[index]!
    if (character === quote) break
    // Escapes exist in BASIC strings only; a literal string has none, which is
    // why we write that form and only have to decode this one.
    if (quote === '"' && character === '\\') {
      const next = body[index + 1]
      if (next === undefined) return null
      // The full set, not the two that came to mind first. A path decoded
      // wrongly reads as a DIFFERENT path, which means "no entry here", which
      // means appending a duplicate logical key -- the failure that stops the
      // user's Codex parsing its own configuration.
      if (next === 'u' || next === 'U') {
        const width = next === 'u' ? 4 : 8
        const digits = body.slice(index + 2, index + 2 + width)
        if (!new RegExp(`^[0-9a-fA-F]{${String(width)}}$`).test(digits)) return UNDECODABLE
        out += String.fromCodePoint(Number.parseInt(digits, 16))
        index += 2 + width
        continue
      }
      const simple: Record<string, string> = {
        n: '\n',
        t: '\t',
        r: '\r',
        b: '\b',
        f: '\f',
        '"': '"',
        '\\': '\\',
      }
      const decoded = simple[next]
      // An escape this version does not know is not a mismatch -- it is a path
      // we cannot read, and guessing would be the duplicate-table bug again.
      if (decoded === undefined) return UNDECODABLE
      out += decoded
      index += 2
      continue
    }
    out += character
    index += 1
  }
  if (body[index] !== quote) return null
  const rest = body.slice(index + 1).trim()
  // What follows the closing quote must be `]`, optionally then a comment.
  if (!rest.startsWith(']')) return null
  const after = rest.slice(1).trim()
  return after === '' || after.startsWith('#') ? out : null
}

/**
 * Written above our table so removal can tell it apart from the user's.
 *
 * Without it `untrustWorkspace` deleted any table for this path, including one
 * somebody had written themselves -- while the doc comment claimed it removed
 * only what it had added.
 */
const MARKER = '# added by mochi'

/**
 * The table to append, or null when the path cannot be written safely.
 *
 * Refusing beats escaping. A workspace path is one we compute from
 * `app.getPath('userData')`, so a quote in it is already an unusual machine;
 * producing a subtly wrong table in that case would corrupt a file we promised
 * not to corrupt, and the failure would land in the user's Codex rather than in
 * ours.
 */
function tableFor(workspace: string): string | null {
  if (workspace.includes("'") || workspace.includes('\n')) return null
  return `\n${MARKER}\n${headerFor(workspace)}\ntrust_level = "trusted"\n`
}

type ConfigRead =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly missing: true }
  | { readonly ok: false; readonly missing: false; readonly reason: string }

async function readConfig(home: string): Promise<ConfigRead> {
  try {
    // Size checked BEFORE the read, not after. Checking afterwards means the
    // whole user-writable file is already in main's heap by the time the limit
    // has an opinion, which makes the limit a report rather than a bound.
    const stats = await stat(configPath(home))
    if (stats.size > MAX_CONFIG_BYTES) {
      return { ok: false, missing: false, reason: 'it is far larger than a configuration file' }
    }
    const text = await readFile(configPath(home), 'utf8')
    return { ok: true, text }
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ok: false, missing: true }
    return { ok: false, missing: false, reason: describeReadFailure(error) }
  }
}

/**
 * Is this workspace already trusted?
 *
 * Reads the VALUE, not merely the header. Reporting `trusted` for any table at
 * this path meant the pane showed an on switch for a directory Codex refuses to
 * trust, and the switch then appeared to do nothing.
 *
 * `ours` says whether we wrote it, which is what keeps mutation honest: removal
 * still touches only tables carrying our marker, so a table somebody else wrote
 * is reported accurately and left alone.
 */
export async function readTrustState(home: string, workspace: string): Promise<TrustState> {
  const read = await readConfig(home)
  if (!read.ok) {
    return read.missing ? { kind: 'absent' } : { kind: 'unreadable', reason: read.reason }
  }
  const lines = read.text.split('\n')
  const at = lines.findIndex((line) => projectPathOf(line) === workspace)
  if (at === -1) return { kind: 'untrusted' }
  // The VALUE, not merely the header. A table saying `trust_level = "untrusted"`
  // was reported as trusted, so the pane showed an on switch for a directory
  // Codex does not trust -- and the switch would then appear to do nothing.
  let level: string | null = null
  for (let index = at + 1; index < lines.length; index += 1) {
    const line = lines[index]!.trim()
    if (line.startsWith('[')) break
    const match = /^trust_level\s*=\s*["']([^"']*)["']/.exec(line)
    if (match !== null) {
      level = match[1] ?? null
      break
    }
  }
  if (level !== 'trusted') return { kind: 'untrusted' }
  return { kind: 'trusted', ours: lines[at - 1]?.trim() === MARKER }
}

/** Header at the start of a line, so a path mentioned inside a comment is not a match. */
export function hasTable(text: string, workspace: string): boolean {
  return text.split('\n').some((line) => projectPathOf(line) === workspace)
}

/** Any `[projects.…]` header this version could not read. Appending past one is unsafe. */
export function hasUndecodableTable(text: string): boolean {
  return text.split('\n').some((line) => projectPathOf(line) === UNDECODABLE)
}

/**
 * The lines belonging to our table: the header, and everything up to the next one.
 *
 * Returns null when the table is not there. Used by both the append path (to
 * stay idempotent) and the removal path (to take out exactly what was put in).
 */
function tableRange(
  lines: readonly string[],
  workspace: string,
): { from: number; to: number } | null {
  // OURS only: the header must be immediately preceded by our marker. A table
  // somebody else wrote for the same path is left exactly where it is.
  const from = lines.findIndex(
    (line, index) => projectPathOf(line) === workspace && lines[index - 1]?.trim() === MARKER,
  )
  if (from === -1) return null
  let to = from + 1
  // A TOML table ends where the next one begins. `[` at the start of a trimmed
  // line is the only thing that can open one, including `[[array]]` tables.
  while (to < lines.length && !lines[to]!.trimStart().startsWith('[')) to += 1
  // Give back any blank lines at the tail of that run.
  //
  // `split('\n')` turns a file's final newline into a trailing empty element,
  // and when our table is last, the scan above swallows it -- so removal took
  // the file's own terminating newline with it and "trust on then off" came
  // back one byte short. The bytes after our table were never ours to remove.
  while (to > from + 1 && lines[to - 1] === '') to -= 1
  return { from, to }
}

async function backUp(home: string, stamp: string): Promise<void> {
  await copyFile(configPath(home), `${configPath(home)}.mochi-backup-${stamp}`)
}

/**
 * Write through a temporary file in the same directory, then rename.
 *
 * `writeFile` truncates first, so a crash or a full disk between truncate and
 * the last byte leaves the user's Codex configuration half-written. A rename
 * within one filesystem is atomic: the file is either the old one or the new
 * one, never a prefix of either. `store/json-file.ts` writes our own
 * preferences the same way, and another program's configuration deserves at
 * least that.
 */
/**
 * One trust change at a time, and never over an edit made since we read.
 *
 * Two rapid toggles could apply the older intent last, and a Codex writing its
 * own configuration between our read and our rename lost that write entirely.
 * Distinct temporary names stopped the two commits colliding; they did nothing
 * about a stale read, which is the half that destroys somebody else's work.
 */
let queue: Promise<unknown> = Promise.resolve()

function serialised<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work, work)
  // Kept alive whatever the outcome, so one failure does not wedge the chain.
  queue = next.catch(() => undefined)
  return next
}

async function commit(home: string, text: string, seen: string): Promise<void> {
  const target = configPath(home)
  // REFUSED rather than followed or clobbered. A rename replaces the link
  // itself, turning a dotfile-managed symlink into a regular file and leaving
  // the real config untouched -- so the user's own tooling and this app would
  // disagree about which file is theirs. Following it instead would mean
  // writing somewhere they did not point us at.
  const link = await lstat(target).catch(() => null)
  if (link !== null && link.isSymbolicLink()) {
    throw new Error('the Codex configuration is a symlink, so it was left alone')
  }
  // Compared immediately before the rename. Between our read and here, Codex or
  // the user may have written; replacing the file would silently drop that.
  const now = await readFile(target, 'utf8').catch(() => null)
  if (now !== seen) {
    throw new Error('the Codex configuration changed while this was being written')
  }
  // A distinct name per call. One shared temporary file means two toggles in
  // flight write over each other's half-written content and then both rename.
  const temporary = `${target}.mochi-tmp-${String(process.pid)}-${String(nextTemp())}`
  // The ORIGINAL mode, carried across. A config the user restricted to 0600
  // would otherwise come back as whatever the default mask allows, and this
  // module would have quietly widened access to another program's credentials
  // file while claiming to make one small edit.
  let mode: number | undefined
  try {
    mode = (await stat(target)).mode & 0o777
  } catch {
    mode = undefined
  }
  await writeFile(temporary, text, mode === undefined ? 'utf8' : { encoding: 'utf8', mode })
  if (mode !== undefined) await chmod(temporary, mode)
  await rename(temporary, target)
}

let temporaryCounter = 0
const nextTemp = (): number => (temporaryCounter += 1)

/**
 * Append the table, or do nothing if it is already there.
 *
 * `stamp` is passed in rather than read from the clock so the backup name is
 * the caller's to decide and the whole thing stays testable without freezing
 * time.
 *
 * Refuses when there is no `config.toml`. Creating one would mean this app
 * bringing another program's configuration into existence, which is a larger
 * claim than "add a line to the file you already have" -- and a Codex that has
 * never been configured is one the user has not logged into either, so the
 * delegation pane has something more useful to say first.
 */
export async function trustWorkspace(
  home: string,
  workspace: string,
  stamp: string,
): Promise<TrustChange> {
  return await serialised(async () => await trustNow(home, workspace, stamp))
}

async function trustNow(home: string, workspace: string, stamp: string): Promise<TrustChange> {
  const table = tableFor(workspace)
  if (table === null) return { ok: false, reason: 'the workspace path cannot be written as TOML' }

  const read = await readConfig(home)
  if (!read.ok) {
    return {
      ok: false,
      reason: read.missing ? 'there is no Codex configuration to add it to' : read.reason,
    }
  }
  // FAIL CLOSED. A header we cannot decode may already be this very path, and
  // appending beside it would produce the duplicate key that stops Codex
  // parsing its own configuration. Refusing costs the user a switch; guessing
  // costs them their Codex.
  if (hasUndecodableTable(read.text)) {
    return { ok: false, reason: 'the Codex configuration has an entry this version cannot read' }
  }
  // Idempotent, and it does not overwrite a value the user set themselves --
  // but "there is a table here" is not the same as "it says what you asked
  // for". A table reading `trust_level = "untrusted"` used to come back as a
  // successful no-op, so the switch recorded ON while Codex went on refusing to
  // trust the directory, and nothing anywhere said so.
  if (hasTable(read.text, workspace)) {
    const state = await readTrustState(home, workspace)
    return state.kind === 'trusted'
      ? { ok: true, changed: false }
      : { ok: false, reason: 'a table for this path already says otherwise' }
  }

  try {
    await backUp(home, stamp)
    // APPEND. Not a parse-and-serialise round trip: re-emitting the file would
    // reformat seventy-one entries the user never asked us to touch, and any
    // comment in it would be gone.
    const separator = read.text.endsWith('\n') || read.text === '' ? '' : '\n'
    await commit(home, `${read.text}${separator}${table}`, read.text)
    return { ok: true, changed: true }
  } catch (error: unknown) {
    return { ok: false, reason: describeReadFailure(error) }
  }
}

/**
 * Remove the table this module added, and only that one.
 *
 * The inverse has to exist, or the switch is a one-way door: something that
 * writes to another program's configuration and cannot take it back is not a
 * setting, it is a side effect.
 */
export async function untrustWorkspace(
  home: string,
  workspace: string,
  stamp: string,
): Promise<TrustChange> {
  return await serialised(async () => await untrustNow(home, workspace, stamp))
}

async function untrustNow(home: string, workspace: string, stamp: string): Promise<TrustChange> {
  const read = await readConfig(home)
  if (!read.ok) {
    // Nothing to undo is a success. The user's end state is what they asked for.
    return read.missing ? { ok: true, changed: false } : { ok: false, reason: read.reason }
  }

  const lines = read.text.split('\n')
  const range = tableRange(lines, workspace)
  if (range === null) return { ok: true, changed: false }

  try {
    await backUp(home, stamp)
    // `from - 1` is our marker, which goes with it.
    const kept = [...lines.slice(0, range.from - 1), ...lines.slice(range.to)]
    // Drop the blank line the append left in front of the header, so trust on
    // then off is byte-for-byte what it started as rather than slowly growing a
    // gap each time somebody toggles it.
    if (range.from > 1 && kept[range.from - 2] === '') kept.splice(range.from - 2, 1)
    await commit(home, kept.join('\n'), read.text)
    return { ok: true, changed: true }
  } catch (error: unknown) {
    return { ok: false, reason: describeReadFailure(error) }
  }
}
