import type { DatabaseSync } from 'node:sqlite'
import type { SessionToken } from './turn-row'
import type { prepareAll } from './statements'

/**
 * Everything that removes rows from the archive.
 *
 * ## One rule, stated once
 *
 * All three of these delete the SEARCH INDEX first, and until this module
 * existed that rule was written out three times in three comments beside three
 * near-identical bodies. It is one rule and it has one reason:
 *
 * `turn_fts` has no foreign key, so it is not carried by `ON DELETE CASCADE`
 * the way `turn` is. Delete a session first and its indexed rows stay — and an
 * index row whose turn is gone is a search hit that cannot be opened, which
 * reads as her remembering something she was told to forget. The reverse order
 * would leave turns nothing can find, which is merely useless rather than
 * alarming; the order chosen is the one whose failure is quiet.
 *
 * The ordering is belt to the transaction's braces. Neither half is reachable
 * from outside `atomically`, so a crash between the two statements rolls back
 * rather than leaving either state. The order matters for the case a
 * transaction cannot help with: a future reader adding a fourth deletion by
 * copying a third.
 *
 * ## Why a module rather than three methods
 *
 * They needed five things between them — the database, the statements, the
 * transaction wrapper, the scrubber and the bound — which is a small enough
 * context to pass and a coherent enough one to name. `buildTranscripts` is a
 * seven-hundred-line factory, and the part of it that DESTROYS things is worth
 * being able to read on its own.
 */

/**
 * The most conversations one `forgetSessions` call may name.
 *
 * A payload this large is not a request anybody made by hand, and the bound is
 * what stops a compromised renderer turning one message into a hundred-thousand
 * row transaction.
 *
 * **It TRIMS rather than refuses, and that is deliberate** — `transcripts.test.ts`
 * asserts it: a genuine token sitting among a flood still goes. A draft of this
 * change made it a refusal instead and was reverted, because declining the whole
 * request would discard the real deletion somebody actually asked for in order
 * to punish the noise around it.
 */
export const MOST_AT_ONCE = 1000

/**
 * The tokens a `forgetSessions` call will actually act on.
 *
 * Exported because **two** places need the same answer, and until now only one
 * of them had it. `forgetSessions` collapses duplicates and trims an absurd
 * payload — deliberate, and asserted: a flood from a compromised renderer must
 * not become a hundred-thousand-row transaction, while a real token sitting
 * among it still goes.
 *
 * The caller in `main/index.ts` then decides whether the LIVE conversation was
 * among those deleted, and it was reading the caller's own unbounded list. So a
 * request naming more than a thousand released the live token while its rows
 * were still on disk — recording restarted into a fresh conversation and the
 * old one stayed, which is the opposite of what "forget these" was asked to do.
 *
 * One function, so "what was deleted" cannot be answered two ways.
 */
export function boundedForgetSet(tokens: readonly SessionToken[]): readonly SessionToken[] {
  return [...new Set(tokens)].slice(0, MOST_AT_ONCE)
}

/** What removing rows needs from the archive that owns them. */
export interface Forgetting {
  readonly db: DatabaseSync
  readonly stmt: ReturnType<typeof prepareAll>
  readonly atomically: <T>(run: () => T) => T
  /** Overwrite the freed pages now. `secure_delete` frees them; this reuses them. */
  readonly scrubNow: () => void
}

/**
 * Drop named conversations, and report how many actually went.
 *
 * The set is collapsed and BOUNDED before the transaction opens, through the
 * same function the caller uses. The bound was always here; what was not was
 * any way for `main/index.ts` to know which tokens it covered. That caller
 * decides whether the live conversation was among the deleted, and it read its
 * own unbounded list — so a request naming more than `MOST_AT_ONCE` released
 * the live token while its rows were still on disk. The count returned is
 * honest about how many went; it was never the count that was wrong.
 */
export function forgetSessions(
  at: Forgetting,
  personaId: string,
  tokens: readonly SessionToken[],
): number {
  const wanted = boundedForgetSet(tokens)
  if (wanted.length === 0) return 0
  const gone = at.atomically(() => {
    let removed = 0
    for (const token of wanted) {
      // The index rows while the turns they name still exist: the cascade takes
      // those with the session, and after that the subquery selecting them
      // finds nothing and the rows orphan.
      at.stmt.dropIndexFor.run(token, personaId)
      removed += Number(at.stmt.dropSession.run(token, personaId).changes)
    }
    return removed
  })
  at.scrubNow()
  return gone
}

/** Everything one character was ever told. */
export function forgetPersona(at: Forgetting, personaId: string): void {
  at.atomically(() => {
    at.stmt.forgetIndex.run(personaId)
    at.stmt.forget.run(personaId)
  })
  at.scrubNow()
}

/**
 * Every conversation in the archive, for every character.
 *
 * `db.exec` rather than a prepared statement because there is nothing to bind:
 * the whole table goes.
 */
export function forgetEverything(at: Forgetting): void {
  at.atomically(() => {
    at.db.exec('DELETE FROM turn_fts')
    at.db.exec('DELETE FROM session')
  })
  at.scrubNow()
}
