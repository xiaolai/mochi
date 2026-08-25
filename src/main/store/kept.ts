import type { prepareAll } from './statements'
import { tooLong } from '@shared/parse-persona'
import { looksEmpty } from '@shared/text'

/**
 * What a persona was asked to keep, and the only place she may write.
 *
 * ## Why a fixed schema and not a table of her own
 *
 * Letting a model make tables means letting it supply a table NAME, which is
 * the one thing a prepared statement cannot parameterise -- and a schema this
 * repo did not write is a schema `applySchema` cannot migrate. She supplies
 * keys and documents against a shape defined here instead, which is the same
 * versatility without the DDL.
 *
 * ## Isolation is structural, not a check
 *
 * `personaId` is supplied by the caller and never by an argument the model
 * fills in. This is the `memoryPath` rule -- that function refuses to build a
 * path from an id it did not validate -- one level up: she cannot reach another
 * character's rows because she is never asked which rows to reach for.
 */

/** Bounds. An unbounded store is an unbounded prompt; see `PERSONA_LIMITS`. */
export const KEPT_LIMITS = {
  /** A collection or key name, in graphemes. */
  name: 64,
  /** One document, in graphemes. Same as `style`, because it is prompt-adjacent. */
  value: 4000,
  /** Rows one persona may hold, so a runaway loop is visible rather than costly. */
  rows: 500,
} as const

/**
 * What a name may be.
 *
 * The same shape as a persona id, deliberately: these end up in a prompt beside
 * each other, and two naming rules where one would do is a thing to get wrong.
 */
const NAME = /^[a-z][a-z0-9-]{0,63}$/

/** Why a write was refused, or null when it may proceed. */
export type KeptRefusal = 'bad-collection' | 'bad-key' | 'empty-value' | 'value-too-long' | 'full'

export interface KeptEntry {
  readonly key: string
  readonly value: string
  readonly updatedAt: number
}

export interface KeptCollection {
  readonly collection: string
  readonly entries: number
  readonly newest: number
}

/** What a write replaced, so an overwrite is reviewable rather than silent. */
export interface KeptWrite {
  readonly refused: KeptRefusal | null
  readonly previous: string | null
}

export interface Kept {
  put(personaId: string, collection: string, key: string, value: string): KeptWrite
  one(personaId: string, collection: string, key: string): KeptEntry | null
  inCollection(personaId: string, collection: string, most?: number): readonly KeptEntry[]
  collections(personaId: string): readonly KeptCollection[]
  forgetOne(personaId: string, collection: string, key: string): boolean
  forgetCollection(personaId: string, collection: string): number
  forgetAll(personaId: string): number
}

export function createKept(
  stmt: ReturnType<typeof prepareAll>,
  now: () => number = Date.now,
): Kept {
  const rows = (personaId: string): number =>
    Number((stmt.keptCount.get(personaId) as { rows?: unknown } | undefined)?.rows ?? 0)

  return {
    put(personaId, collection, key, value) {
      if (!NAME.test(collection)) return { refused: 'bad-collection', previous: null }
      if (!NAME.test(key)) return { refused: 'bad-key', previous: null }
      // `looksEmpty`, not `trim() === ''`: a document of nothing but zero-width
      // joiners renders as nothing and would be kept as if it said something.
      // The same predicate `remember_this` uses, for the same reason.
      if (looksEmpty(value)) return { refused: 'empty-value', previous: null }
      if (tooLong(value, KEPT_LIMITS.value)) return { refused: 'value-too-long', previous: null }

      // The row cap counts what is already there, and a REPLACEMENT of an
      // existing key is not a new row. Counting before the upsert without this
      // check would refuse an edit to something she already holds the moment
      // the store was full, which reads as her forgetting how to correct
      // herself.
      const held = this.one(personaId, collection, key)
      if (held === null && rows(personaId) >= KEPT_LIMITS.rows) {
        return { refused: 'full', previous: null }
      }

      stmt.keepPut.run(personaId, collection, key, value, now())
      return { refused: null, previous: held?.value ?? null }
    },

    one(personaId, collection, key) {
      // The same grammar `put` enforces. A read is not a write, but binding an
      // unbounded model-supplied string into SQLite on every lookup is work
      // somebody else chose the size of.
      if (!NAME.test(collection) || !NAME.test(key)) return null
      const row = stmt.keptOne.get(personaId, collection, key) as
        { value: unknown; updated_at: unknown } | undefined
      if (row === undefined) return null
      return { key, value: String(row.value), updatedAt: Number(row.updated_at) }
    },

    inCollection(personaId, collection, most = KEPT_LIMITS.rows) {
      if (!NAME.test(collection)) return []
      // Bounded in SQL rather than after the fact: materialising 500 rows of
      // 4,000 graphemes to then keep 25 of them is work nobody asked for, and
      // the caller's cap cannot undo the allocation.
      return (
        stmt.keptIn.all(personaId, collection, most) as readonly Record<string, unknown>[]
      ).map((row) => ({
        key: String(row['key']),
        value: String(row['value']),
        updatedAt: Number(row['updated_at']),
      }))
    },

    collections(personaId) {
      return (stmt.keptCollections.all(personaId) as readonly Record<string, unknown>[]).map(
        (row) => ({
          collection: String(row['collection']),
          entries: Number(row['entries']),
          newest: Number(row['newest']),
        }),
      )
    },

    forgetOne(personaId, collection, key) {
      if (!NAME.test(collection) || !NAME.test(key)) return false
      return Number(stmt.keptForgetOne.run(personaId, collection, key).changes) > 0
    },

    forgetCollection(personaId, collection) {
      if (!NAME.test(collection)) return 0
      return Number(stmt.keptForgetCollection.run(personaId, collection).changes)
    },

    forgetAll(personaId) {
      return Number(stmt.keptForgetAll.run(personaId).changes)
    },
  }
}
