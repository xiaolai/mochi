import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Every value this app writes down is declared, and says what kind of thing it
 * is.
 *
 * ## Why classes, and not "everything needs a control"
 *
 * That was the first predicate, and Codex falsified it three separate ways. A
 * migration marker must NOT have a control. Nor must a derived value, nor an
 * internal one, nor a field kept only so an old file can still be read. A guard
 * that demanded a control for all of them would cry wolf on four of the five
 * kinds, and a guard people learn to argue with is worse than none.
 *
 * So each persisted field declares its kind, and each kind carries its own
 * honest predicate. `user-choice` is the only one that has to be reachable --
 * and it is the only one that ever produced the defect this exists for.
 *
 * ## What it proves, and what it does not
 *
 * That a persisted field is DECLARED, and that a user-choice is named somewhere
 * a person could reach. It does not prove the control works, that it is
 * visible, or that the value it writes is honoured. It is a floor. The failure
 * message says so rather than implying otherwise.
 */
const SRC = join(process.cwd(), 'src')

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

/**
 * What kind of stored value this is, and therefore what has to be true of it.
 *
 * - `user-choice` — somebody decided it. MUST be reachable from a surface.
 * - `derived` — the app worked it out. A control would let the two disagree.
 * - `migration-marker` — records that a one-time pass happened. A control would
 *   let somebody re-run or skip a migration, which is not a preference.
 * - `compatibility` — read so an older file still loads, never written. A
 *   control would be offering to edit a format that is gone.
 * - `internal` — bookkeeping the user has no stake in.
 */
type Kind = 'user-choice' | 'derived' | 'migration-marker' | 'compatibility' | 'internal'

interface Declared {
  readonly kind: Kind
  /** Why it is that kind. An entry whose reason cannot be written is wrong. */
  readonly because: string
  /**
   * A string that must appear on a surface, for a `user-choice`.
   *
   * Declared rather than guessed from the field name, because the two are
   * routinely different: `activePersonaId` is what MAIN calls the worn
   * character, and the shelf reaches it through `shelf:wear`. A guard that
   * looked for the storage key would have reported a control that plainly
   * exists as missing -- and the fix would have been to weaken the guard.
   *
   * The declaration is the checkable handle: somebody writes down what proves
   * it, and the test checks that the proof is still there.
   */
  readonly provenBy?: string
}

/** Everything written to `preferences.json`, by the key it is written under. */
const PREFERENCES: Readonly<Record<string, Declared>> = {
  activePersonaId: {
    kind: 'user-choice',
    because: 'the character cards on the shelf',
    provenBy: 'mochiHistory.wear',
  },
  grants: { kind: 'user-choice', because: 'the "May do" pane', provenBy: 'grant' },
  haloWhen: { kind: 'user-choice', because: 'the "On screen" pane', provenBy: 'haloWhen' },
  shoulderChip: { kind: 'user-choice', because: 'the "On screen" pane', provenBy: 'shoulderChip' },
  sleepAfterMinutes: {
    kind: 'user-choice',
    because: 'the "On screen" pane',
    provenBy: 'sleepAfterMinutes',
  },
  transcriptionLanguages: {
    kind: 'user-choice',
    because: 'the "Hearing you" pane',
    // The heading is a ByPronoun table now — B2 heads it "Languages she listens
    // for" — so the string that proves the control exists is the table's key.
    provenBy: 'languagesHead',
  },
  webSearch: {
    kind: 'user-choice',
    because: 'the "Looking things up" pane',
    provenBy: 'webSearch',
  },
  workspace: {
    kind: 'user-choice',
    because: 'the "Looking things up" pane',
    provenBy: 'workspace',
  },
  x: {
    kind: 'derived',
    because:
      'where she was left sitting, observed rather than chosen. A control for a coordinate ' +
      'would be a text field for something the user already sets by dragging her.',
  },
  y: { kind: 'derived', because: 'the other half of where she was left sitting' },
  width: { kind: 'derived', because: 'her size on screen, measured from her own drawing' },
  height: { kind: 'derived', because: 'the other half of the size measured from her drawing' },
  codexProfile: {
    kind: 'derived',
    because: 'where the seeded Codex profile went; the app decides it, not the user',
  },
  bubbleSideMigrated: {
    kind: 'migration-marker',
    because:
      'records that the app-level bubble side was carried onto the characters. A control ' +
      'would let somebody re-run a one-time pass, which is not a preference — and re-running ' +
      'this one would overwrite a choice made since.',
  },
}

/** Everything in a stored `policy.json`. */
const POLICY: Readonly<Record<string, Declared>> = {
  keeps: {
    kind: 'user-choice',
    because: 'the "Save new conversations" switch on her sheet',
    provenBy: 'Save new conversations',
  },
  keepDays: {
    kind: 'compatibility',
    because:
      'time-based retention is gone. A stored value is IGNORED rather than refused, because ' +
      'refusing resolves the file to UNREADABLE_POLICY, which records nothing — turning an ' +
      'obsolete field into silent data loss.',
  },
}

/** Where a control for a user-choice could plausibly live. */
const SURFACES = [
  join(SRC, 'renderer'),
  join(SRC, 'main', 'settings.ts'),
  join(SRC, 'main', 'tray.ts'),
]

function reachable(field: string): boolean {
  const files = SURFACES.flatMap((where) => (where.endsWith('.ts') ? [where] : tsFilesUnder(where)))
  return files.some((path) => new RegExp(`\\b${field}\\b`).test(stripped(path)))
}

describe('every stored preference is declared', () => {
  it('and nothing is written that nobody has classified', () => {
    const written = new Set<string>()
    for (const path of tsFilesUnder(join(SRC, 'main'))) {
      for (const call of stripped(path).matchAll(/writeMerged\([^,]+,\s*\{([^}]*)\}/g)) {
        for (const key of (call[1] ?? '').matchAll(/(?:^|[\s,])([A-Za-z][A-Za-z0-9]*)\s*:/g)) {
          written.add(key[1] ?? '')
        }
      }
    }

    expect(written.size, 'nothing was found — the matcher has drifted').toBeGreaterThan(4)
    expect(
      [...written].filter((key) => !(key in PREFERENCES)).sort(),
      [
        'A value is being written to preferences.json that nothing has classified.',
        '',
        'Add it to PREFERENCES with a kind and a reason. If it is a `user-choice`,',
        'it also needs a surface — that is the whole point.',
      ].join('\n'),
    ).toEqual([])
  })
})

describe('a user-choice is reachable, and nothing else has to be', () => {
  it.each([...Object.entries(PREFERENCES), ...Object.entries(POLICY)])(
    '%s',
    (field, declared: Declared) => {
      if (declared.kind !== 'user-choice') {
        // The half that stops this crying wolf. A marker, a derived value or a
        // compatibility field having no control is CORRECT, and a guard that
        // called those failures would be turned off within a week.
        expect(declared.because.length, `${field} has a kind and no reason`).toBeGreaterThan(20)
        // And it must NOT claim a control, or the class is being used to
        // smuggle one past the check above.
        expect(declared.provenBy, `${field} is not a user-choice but claims a surface`).toBe(
          undefined,
        )
        return
      }
      const proof = declared.provenBy ?? field
      expect(
        reachable(proof),
        [
          `\`${field}\` is a user-choice, and nothing on any surface shows \`${proof}\`.`,
          '',
          'This proves the name APPEARS where a control could be — not that the',
          'control works, is visible, or is honoured. It is a floor, and every',
          'defect it was written for cleared it only after somebody built the',
          'control.',
        ].join('\n'),
      ).toBe(true)
    },
  )
})

describe('the guard itself', () => {
  it('reads code, never comments', () => {
    // Three findings in one session were comment matches read as code —
    // including one in the audit that produced this plan.
    const self = stripped(join(SRC, 'main', 'store', 'registry.test.ts'))
    expect(self).toContain('replace(/\\/\\*[\\s\\S]*?\\*\\//g')
  })
})
