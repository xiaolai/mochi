/**
 * Turning a refusal into a sentence, in the user's language.
 *
 * The ONLY place a `SaveProblem` becomes prose. Main sends a value: it used to
 * send English it had written itself, which the window printed unchanged — one
 * language, chosen in the wrong process, outside the table that makes a missing
 * translation a compile error.
 *
 * Its own module because it is pure and was unreachable by a test inside
 * `settings/main.ts`, which touches `document` at load. Every branch here is a
 * sentence somebody reads at the moment something they tried did not work.
 */

import { format } from '@shared/i18n'
import type { SaveProblem } from '@shared/ipc'
import type { PersonaLoadProblem } from '@shared/persona'
import type { Copy } from './copy'

/**
 * Turn a refusal into a sentence, in the user's language.
 *
 * This is the ONLY place a save problem becomes prose. Main sends a value:
 * previously it sent English it had written itself, which the window printed
 * unchanged — one language, chosen in the wrong process, outside the table
 * that makes a missing translation a compile error.
 *
 * The braces are filled with identifiers — a field name, a list of accepted
 * literals, a number. Those are names, not prose, and are not translated.
 */
export function describeProblem(problem: SaveProblem, { t, say }: Copy): string {
  const p = t.problem
  switch (problem.kind) {
    case 'not-permitted':
      return p.notPermitted
    case 'save-failed':
      return t.saveFailed
    case 'unknown-value':
      return format(p.unknownValue, { field: problem.field, allowed: problem.allowed })
    case 'field':
      // A LOOKUP, not a ternary chain. The third reason already needed nesting
      // two deep and read as "whatever is left over"; a fourth would have
      // buried it further, and this shape makes a new `FieldProblem` a missing
      // key rather than a silently wrong sentence.
      return format(
        {
          'not-text': p.fieldNotText,
          empty: p.fieldEmpty,
          'not-object': p.fieldNotObject,
          'not-list': p.fieldNotList,
          malformed: p.fieldMalformed,
          'not-a-version': p.fieldNotAVersion,
        }[problem.reason],
        { field: problem.field },
      )
    case 'field-length':
      return format(p.fieldTooLong, { field: problem.field, limit: String(problem.limit) })
    case 'unknown-field':
      return format(p.unknownField, { field: problem.field })
    case 'from-the-future':
      return format(p.fromTheFuture, { found: String(problem.found) })
    case 'key-shape':
      return {
        empty: p.keyEmpty,
        whitespace: p.keyWhitespace,
        prefix: p.keyPrefix,
        short: p.keyShort,
        long: p.keyLong,
      }[problem.reason]
    case 'key-store':
      return problem.reason === 'no-keychain' ? p.keyNoKeychain : p.keyWriteFailed
    case 'shortcut-unusable':
      // Named the way the pane names it three rows above, not by its id.
      return format(p.shortcutUnusable, {
        action: say(problem.id === 'toggleVisible' ? t.keyToggleVisible : t.keyToggleAwake),
      })
    case 'shortcut-clash':
      return p.shortcutClash
  }
}

/**
 * One persona-load problem, in the reader's language.
 *
 * The counterpart to `describeProblem` for the way IN. Main reports these as
 * structured values precisely so this function exists: a load
 * failure assembled as English in main would be one language, written outside
 * the table that makes a missing translation a compile error.
 *
 * Identifiers -- filenames, ids -- are carried verbatim. Only the sentence
 * around them is chosen here.
 */
export function describeLoadProblem(problem: PersonaLoadProblem, copy: Copy): string {
  const p = copy.t.problem
  switch (problem.kind) {
    case 'folder-unreadable':
      return p.personaFolderUnreadable
    case 'unreadable':
      return format(p.personaUnreadable, { source: problem.source })
    case 'malformed':
      return format(p.personaMalformed, { source: problem.source })
    case 'invalid':
      return format(p.personaInvalid, {
        source: problem.source,
        // The field-level reasons, each localised by the function beside this
        // one. Reporting only "not a usable persona" would leave the author of
        // the file with nothing to act on -- which is the whole failure mode
        // this pathway exists to avoid.
        // The WHOLE copy is handed on, not a fragment of it. `describeProblem`
        // reaches for `say` when a shortcut is named, and a cast that hid that
        // would fail at runtime in one branch and nowhere else.
        problems: problem.problems.map((one) => describeProblem(one, copy)).join('; '),
      })
    case 'duplicate-id':
      return format(p.personaDuplicateId, {
        id: problem.id,
        sources: problem.sources.join(', '),
      })
    case 'two-faces':
      return format(p.personaTwoFaces, { source: problem.source })
    case 'reserved-id':
      return format(p.personaReservedId, { id: problem.id, source: problem.source })
    case 'active-missing':
      return format(p.personaActiveMissing, { id: problem.id })
    case 'too-many':
      return format(p.personaTooMany, {
        found: String(problem.found),
        limit: String(problem.limit),
      })
    case 'legacy-unreadable':
      return p.personaLegacyUnreadable
    case 'legacy-malformed':
      return p.personaLegacyMalformed
    case 'legacy-blocked':
      return format(p.personaLegacyBlocked, { source: problem.source })
    case 'legacy-invalid':
      return format(p.personaLegacyInvalid, {
        problems: problem.problems.map((one) => describeProblem(one, copy)).join('; '),
      })
  }
}
