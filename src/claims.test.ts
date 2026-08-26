import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Comments that assert a MECHANISM, checked against the mechanism.
 *
 * ## Why this file exists
 *
 * This codebase's defining strength is that it writes down _why_. Over half of
 * it is comment, decisions are argued next to the code that implements them,
 * and that prose names the defect each choice prevents — often with a date and
 * a measurement.
 *
 * It was also the one artefact here with no gate. Types are checked by two
 * `tsc` projects, style by prettier, wiring by `store/wiring.test.ts`,
 * registration by `capabilities/index.test.ts`, prompts by
 * `shared/no-hardcoded-prompts.test.ts`. Comments were checked by nothing —
 * and an audit on 2026-08-26 found **twelve** asserting properties the code did
 * not have.
 *
 * Four of those were a reader's safety mechanism: a SIGKILL escalation that did
 * not exist, a guard that did not walk ancestors, a reconnect promised never to
 * be silently skipped that was, and two functions described as the things that
 * "would notice" a hang which nothing called. Somebody reading those files would
 * not add the missing mechanism, **because the comment says it is there.** That
 * is worse than no comment: it is a claim that survives review.
 *
 * ## What this checks, and what it deliberately does not
 *
 * Only claims about a mechanism that is visible in source text. Not prose, not
 * rationale, not measurements — those are unfalsifiable here and pinning them
 * would make this file a copy of the comments rather than a check on them.
 *
 * Each row is `{ where, claim, holds }`:
 *
 *   - `claim` is a phrase from the comment. If somebody rewrites the comment,
 *     this fails and they must decide whether the mechanism is still promised.
 *   - `holds` is the assertion the claim entitles a reader to make.
 *
 * **A row failing means one of two things, and they need opposite fixes:**
 * the mechanism was removed and must come back, or the claim was withdrawn and
 * the row goes with it. Never make it pass by editing the claim to match a
 * mechanism that is gone.
 */

function source(...parts: string[]): string {
  return readFileSync(join(process.cwd(), 'src', ...parts), 'utf8')
}

/** Comments stripped, so a claim cannot be satisfied by the prose making it. */
function code(...parts: string[]): string {
  return source(...parts)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
}

interface Claim {
  readonly what: string
  /** Where the MECHANISM lives, and where `holds` is checked. */
  readonly where: readonly string[]
  /**
   * Where the CLAIM is written, when that is a different file.
   *
   * It often is, and that is the most dangerous shape: `workspace.ts` argues
   * for walking ancestors and `worn.ts` decides how far. A reader of the first
   * is entitled to the behaviour of the second, and neither file alone shows
   * the gap.
   */
  readonly claimedIn?: readonly string[]
  /** A phrase from the comment making the claim. */
  readonly claim: string
  /** What the claim entitles a reader to assume, checked against code. */
  readonly holds: (code: string) => boolean
}

/**
 * Collapse runs of whitespace and comment furniture.
 *
 * Prettier reflows prose, so a claim written on one line today is two lines
 * after the next edit — and an exact substring check would then report the
 * mechanism as withdrawn when only the wrapping changed. Normalising is what
 * makes a row survive formatting without being loosened to the point of
 * matching anything.
 */
function flat(text: string): string {
  return text.replace(/^[ \t]*\*[ \t]?/gm, ' ').replace(/\s+/g, ' ')
}

const CLAIMS: readonly Claim[] = [
  {
    what: 'the child is killed, not merely asked to stop',
    where: ['capabilities', 'ask-workspace', 'ask.ts'],
    claim: 'SIGTERM is a REQUEST',
    holds: (body) => body.includes("kill('SIGKILL')"),
  },
  {
    what: 'the guard looks above the workspace, not only at it',
    where: ['main', 'store', 'worn.ts'],
    claimedIn: ['capabilities', 'ask-workspace', 'workspace.ts'],
    claim: 'Codex reads `AGENTS.md` from the working root UPWARD',
    holds: (body) => body.includes('homedir') && body.includes('dirname'),
  },
  {
    what: 'an unusable expiry still schedules something',
    where: ['main', 'voice', 'next-session.ts'],
    claim: 'never silently treated as never',
    holds: (body) => /unusable[\s\S]{0,400}arm\(FLOOR_MS\)/.test(body),
  },
  {
    what: 'a session with no announced deadline still reconnects',
    where: ['main', 'voice', 'next-session.ts'],
    claim: 'arms a FLOOR the moment a session is minted',
    holds: (body) => body.includes('opened()') && body.includes('FLOOR_MS'),
  },
  {
    what: 'the outstanding calls are actually read by something',
    where: ['main', 'index.ts'],
    claim: 'The records stay, so `undelivered()` still names',
    holds: (body) => body.includes('ledger.undelivered()') && body.includes('ledger.unanswered()'),
  },
  {
    what: 'a late verdict cannot resurrect a filed turn',
    where: ['renderer', 'companion', 'audio', 'pending.ts'],
    claim: 'cannot tell "never seen" from "already settled"',
    holds: (body) => body.includes('filed.has(itemId)') && body.includes('remember(itemId)'),
  },
  {
    what: 'the auth-file read is described by errno, not by a string',
    where: ['main', 'voice', 'credential.ts'],
    claim: 'BY ERRNO',
    /*
      Scoped to `readBearer`, not the whole file.

      A first draft forbade `String(error)` anywhere here and failed — because
      the two network paths use it legitimately: an unreachable host has no
      errno to report, and "TypeError: fetch failed" is the whole of what is
      known. The claim is about the FILE READ, so the check is too. A predicate
      wider than its claim reports a mechanism as broken when a different,
      correct one sits nearby.
    */
    holds: (body) => {
      const from = body.indexOf('export function readBearer')
      if (from === -1) return false
      // `export async function` too. A first attempt stopped only at `export
      // function`, so the slice ran straight past `readBearer` into the
      // network helpers below it and reported their legitimate `String(error)`
      // as this function's.
      const rest = body.slice(from + 1)
      const next = rest.search(/\bexport (?:async )?function\b/)
      const fn = next === -1 ? rest : rest.slice(0, next)
      return fn.includes('ErrnoException') && !fn.includes('String(error)')
    },
  },
  {
    what: 'every turn instant is bounded before it reaches SQLite',
    where: ['main', 'store', 'transcripts.ts'],
    claim: 'Checked FIRST, before the row exists',
    holds: (body) => (body.match(/readableInstant\(/g) ?? []).length >= 3,
  },
  {
    what: 'the session is torn down when the hour is up',
    where: ['renderer', 'companion', 'audio', 'session.ts'],
    claim: 'STILL a teardown',
    holds: (body) => /case 'session-expired':[\s\S]{0,200}shutdown\(\)/.test(body),
  },
  {
    what: 'a dropped frame is reported rather than assumed delivered',
    where: ['renderer', 'companion', 'audio', 'session.ts'],
    claim: 'A DROP IS REPORTED',
    holds: (body) => /if \(!put\(frame\)\)/.test(body),
  },
  {
    what: 'a superseded negotiation cannot use the replacement credential',
    where: ['main', 'voice', 'mint-slot.ts'],
    claim: 'refuses one that is not the current one',
    holds: (body) => body.includes("why: 'this negotiation was superseded'"),
  },
  {
    what: 'the rollback cannot replace the error it is recovering from',
    where: ['main', 'store', 'transcripts.ts'],
    claim: 'THE ROLLBACK IS GUARDED',
    holds: (body) => /try \{\s*db\.exec\('ROLLBACK'\)\s*\} catch/.test(body),
  },
  {
    what: 'the pragmas are read back rather than assumed',
    where: ['main', 'store', 'schema.ts'],
    claim: 'setting a pragma is not the same as it taking effect',
    holds: (body) =>
      body.includes("db.prepare('PRAGMA journal_mode')") &&
      body.includes("db.prepare('PRAGMA secure_delete')"),
  },
  {
    what: 'the file is flushed before the rename that publishes it',
    where: ['main', 'store', 'json-file.ts'],
    claim: 'FLUSHED BEFORE THE RENAME',
    holds: (body) => /fsyncSync\([\s\S]{0,80}renameSync/.test(body),
  },
  {
    what: 'the store root is resolved, so the chain above it is seen',
    where: ['main', 'store', 'store-root.ts'],
    claim: 'THE CHAIN ABOVE IT, not only the leaf',
    holds: (body) => body.includes('realpathSync') && body.includes('canonicalRoot'),
  },
]

describe('comments that promise a mechanism', () => {
  for (const one of CLAIMS) {
    it(`${one.where.join('/')} — ${one.what}`, () => {
      const whole = flat(source(...(one.claimedIn ?? one.where)))
      /*
        THE CLAIM FIRST.

        If the phrase is gone the comment was rewritten, and this test can no
        longer say what it is guarding. That is a decision for whoever rewrote
        it -- restore the claim, or remove this row -- and it must not be
        settled by a test quietly passing.
      */
      expect(
        whole.includes(flat(one.claim)),
        `the comment no longer says "${one.claim}" — restore it, or delete this row`,
      ).toBe(true)

      expect(
        one.holds(code(...one.where)),
        `the comment promises ${one.what}, and the code no longer does it`,
      ).toBe(true)
    })
  }

  it('checks a claim in every file that carries a load-bearing one', () => {
    // A reminder rather than a rule: the audit found these across eight files,
    // and a row silently disappearing is how this file stops being a gate.
    const files = new Set(CLAIMS.map((one) => one.where.join('/')))
    expect(files.size).toBeGreaterThanOrEqual(8)
  })
})
