import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Every stored surface has somebody who uses it.
 *
 * ## The defect this exists for
 *
 * Twelve times in this repository, something existed at every level except the
 * one that consumes it. `Transcripts.pruneBefore` was implemented,
 * transactional, secure-scrubbed and covered by six tests, and no line of
 * production code ever called it. `readJsonFile`, `Policy.keepDays`,
 * `readEdits`, `carriedPolicies` and `Transcripts.close` are the same shape.
 * Each was found by hand, months apart, and each was invisible to the whole
 * test suite -- because a test that calls a function proves the function works,
 * and says nothing at all about whether the app ever calls it.
 *
 * So the suite was the blind spot rather than the safety net, and this closes
 * exactly that gap: a surface with no production caller fails here.
 *
 * ## What it does NOT prove
 *
 * That the caller runs, that a user can reach it, or that the wiring is
 * correct. It proves a call site exists in shipped source. That is a floor, and
 * the failure message says so rather than implying more -- a guard that
 * overstates itself is one people learn to argue with.
 */

const STORE = join(process.cwd(), 'src', 'main', 'store')
const SRC = join(process.cwd(), 'src')

/**
 * Source with every comment removed, which is not a detail.
 *
 * Three findings in one session were comment matches read as code, including
 * one in the audit that produced this test: a grep reported `keepDays` as live
 * when it was matching the comment that documented its removal. A guard whose
 * evidence can be a sentence somebody wrote about the code is not a guard.
 */
function stripped(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
}

function tsFilesUnder(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...tsFilesUnder(path))
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) found.push(path)
  }
  return found
}

interface Surface {
  readonly name: string
  readonly module: string
  readonly kind: 'function' | 'method'
  /** The interface a method belongs to; its own module, for a function. */
  readonly owner: string
}

/**
 * What the store offers the rest of the app.
 *
 * Exported functions, plus the methods of any exported interface that HAS
 * methods. That last test is what separates a store surface -- `Transcripts`,
 * `Conversation` -- from a data shape like `Policy` or `PersonaCatalog`, whose
 * fields are read rather than called. Nothing is listed by hand, so a new
 * surface is covered the moment it is written.
 */
function surfaces(): Surface[] {
  const found: Surface[] = []
  for (const path of tsFilesUnder(STORE)) {
    const text = stripped(path)
    const module = path.slice(STORE.length + 1)

    for (const match of text.matchAll(/^export function ([A-Za-z][A-Za-z0-9]*)/gm)) {
      found.push({ name: match[1] ?? '', module, kind: 'function', owner: module })
    }

    for (const block of text.matchAll(/^export interface ([A-Za-z]+) \{([\s\S]*?)^\}/gm)) {
      const owner = block[1] ?? ''
      for (const method of (block[2] ?? '').matchAll(/^ {2}([a-z][A-Za-z0-9]*)\(/gm)) {
        found.push({ name: method[1] ?? '', module, kind: 'method', owner })
      }
    }
  }
  return found
}

/**
 * Surfaces with no caller, and the reason each is allowed to have none.
 *
 * A reason, not a name: an entry whose justification cannot be written is an
 * entry that should not be here. Every line is a claim somebody can check.
 */
const WIRED_ELSEWHERE: Readonly<Record<string, string>> = {
  // Test seams and shapes the app builds rather than calls.
  editsFrom: 'the inverse of `builtInPersona`, used to write edits back out',
}

/**
 * Surfaces with no caller today, and the work item that gives them one.
 *
 * Every line is a debt with a name against it. Deleting a line is how a work
 * item proves it landed, so this list is the plan's progress bar and its
 * regression guard at once.
 */
const KNOWN_DEBT: readonly string[] = [
  // No caller and no work item. `Conversation` tracks whether one is open and
  // nothing asks -- which is why deleting the live conversation was able to
  // become defect A-4 unnoticed.
  'conversation.ts: isLive',
  // WI-7.
  'transcripts.ts: forgetEverything',
  // WI-5 and WI-6.
  'transcripts.ts: forgetSession',
  // No caller and no work item. The archive can be exported and cannot be
  // imported back: the reader exists, is transactional, is tested, and no
  // surface offers it. Recorded here rather than fixed, because an import
  // feature is a product decision, not a wiring gap.
  'transcripts.ts: importInto',
]

/**
 * Receivers annotated with a given surface type, so `.close()` on a WebRTC peer
 * is not mistaken for `Transcripts.close`.
 *
 * The first draft of this file matched method calls by name alone, and
 * `Transcripts.close` passed because `peer.close()` exists in the renderer --
 * the guard certifying the exact defect it was written to catch.
 */
function receiversOf(surfaceType: string): Set<string> {
  const names = new Set<string>()
  const annotated = new RegExp(
    `([A-Za-z][A-Za-z0-9_$]*)\\s*(?:\\([^)]*\\))?\\s*:\\s*(?:Pick<)?${surfaceType}\\b`,
    'g',
  )
  for (const path of tsFilesUnder(SRC)) {
    for (const match of stripped(path).matchAll(annotated)) names.add(match[1] ?? '')
  }
  return names
}

/**
 * Whether shipped source calls this surface.
 *
 * A function must be called WITHOUT a dot and not be its own declaration. A
 * method must be called WITH one, on a receiver the type system says holds that
 * surface. Both halves were wrong in the first draft; see A-1 in
 * `dev-docs/plan-conversations.md`.
 */
function isCalled(surface: Surface): boolean {
  const pattern =
    surface.kind === 'function'
      ? new RegExp(`(?<!function )(?<![A-Za-z0-9_$.])${surface.name}\\s*\\(`)
      : new RegExp(`([A-Za-z][A-Za-z0-9_$]*)(?:\\(\\))?\\??\\s*\\.\\s*${surface.name}\\s*\\(`)
  const receivers = surface.kind === 'method' ? receiversOf(surface.owner) : null
  for (const path of tsFilesUnder(SRC)) {
    const text = stripped(path)
    if (surface.kind === 'function') {
      if (pattern.test(text)) return true
      continue
    }
    for (const match of text.matchAll(new RegExp(pattern, 'g'))) {
      if (receivers?.has(match[1] ?? '') === true) return true
    }
  }
  return false
}

describe('every store surface has a caller', () => {
  it('has exactly the known debt, and no more', () => {
    const orphans = surfaces()
      .filter((surface) => !(surface.name in WIRED_ELSEWHERE))
      .filter((surface) => !isCalled(surface))
      .map((surface) => `${surface.module}: ${surface.name}`)
      .sort()

    /*
      Compared against a manifest rather than against nothing, so this lands
      GREEN. `pnpm verify` runs the whole suite: a test that is red on purpose
      cannot be committed, and every later change would inherit a red gate.

      New orphans fail. Wiring one fails too, until its line is deleted -- which
      is the point. The manifest shrinks to `[]` as the plan completes, and
      then this reads as the guard it was always described as.
    */
    expect(
      orphans,
      [
        'The set of unwired store surfaces changed.',
        '',
        'Wired one? Delete its line from KNOWN_DEBT.',
        'Added one? Give it a caller, or a WIRED_ELSEWHERE reason.',
        '',
        'This proves a call site EXISTS -- not that it runs, not that a user',
        'can reach it. It is a floor, not the promise.',
      ].join('\n'),
    ).toEqual(KNOWN_DEBT)
  })
})
