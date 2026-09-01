/**
 * Is this thing a plain object, so its keys can be read?
 *
 * ONE of these, because there were three. `capability/manifest.ts`,
 * `realtime/frames.ts` and `main/store/worn.ts` each grew the same three
 * clauses independently, and every one of them guards the same kind of moment:
 * a value that has just come off a disk, a socket or somebody's file and has
 * not been checked yet.
 *
 * `!Array.isArray` is the clause worth naming. An array IS `typeof 'object'`
 * and IS non-null, so the two obvious clauses admit `[]` — and `[]['name']` is
 * `undefined` rather than a throw, so a manifest that arrived as a JSON array
 * would not fail here. It would fail several fields later, worded as a missing
 * name. Three copies of a rule is three chances for one of them to lose that
 * third clause and for nothing to notice.
 *
 * A PREDICATE rather than a boolean, so the caller narrows instead of casting.
 * `worn.ts` wrote `value as Record<string, unknown>` immediately after its own
 * copy of the check — a cast the compiler could have made for it.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
