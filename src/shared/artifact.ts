/**
 * What a persona DOES, as data a package carries.
 *
 * ## Why an artifact rather than a filename
 *
 * The drill found its list by the package containing `words.json`. That works
 * for exactly one capability: the second one needs a second hardcoded
 * filename, and the app becomes a list of names it happens to know. It also
 * says nothing — a folder with a `words.json` in it does not declare anything,
 * it just happens to be recognised.
 *
 * An artifact declares. `kind` names the shape, the rest are that shape's
 * parameters, and the app dispatches on the name rather than on a filename it
 * was taught.
 *
 * ## It is still data
 *
 * The avatar format's structure, applied to behaviour instead of faces: the format
 * describes what the app can already do, and extending what is possible is a
 * code seam that ships with the app. A `kind` the build does not implement is
 * refused rather than approximated — the alternative is a persona that loads,
 * looks fine, and silently does nothing.
 */

/** Every shape this build can run. A `kind` outside it is refused. */
export const ARTIFACT_KINDS = ['walk-a-list'] as const
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number]

/**
 * Walk a list, one item per turn, remembering the place.
 *
 * Nothing here knows the items are words. It is a list, a phrase that advances
 * it, and a template — which is a phrasebook, a flashcard deck, scenario
 * prompts or interview questions just as readily.
 */
export interface WalkAListSpec {
  readonly kind: 'walk-a-list'
  /**
   * The items, inline or in a sibling file.
   *
   * A string names a file NEXT TO the manifest and nothing else: no slashes,
   * no `..`. A package that could name a path would be a package that can read
   * whatever the app can read, which is not what "data, never code" bought.
   */
  readonly items: readonly string[] | { readonly file: string }
  /** Utterances that mean "give me another". Matched against the tail. */
  readonly advanceOn: readonly string[]
  /** What she is told, with `{item}` standing for the chosen one. */
  readonly say: string
  /** Said once when the list wraps. Optional — silence is a fine answer. */
  readonly onRestart: string | null
}

export type Artifact = WalkAListSpec

/**
 * An artifact whose items are IN it, not named by it.
 *
 * What every consumer actually wants, and what `readArtifact` always returns --
 * resolving `{ file }` against the disk is the whole reason that function
 * exists. Saying so in the type removes the `as readonly string[]` that stood
 * where the guarantee used to be: a cast is a promise the compiler cannot
 * check, and this one sat directly on data a downloaded package supplies.
 */
export type ResolvedArtifact = Omit<WalkAListSpec, 'items'> & {
  readonly items: readonly string[]
}

export type ArtifactParse =
  | { readonly ok: true; readonly artifact: Artifact }
  | { readonly ok: false; readonly problems: readonly string[] }

/**
 * A filename that can only name a sibling.
 *
 * Checked rather than sanitised. Stripping `../` from a name produces a
 * different name that is then used, which is how a rejected input becomes an
 * accepted one nobody chose.
 */
export function isSiblingFile(name: unknown): name is string {
  return (
    typeof name === 'string' &&
    name.length > 0 &&
    name.length <= 64 &&
    !name.includes('/') &&
    !name.includes('\\') &&
    !name.includes('..') &&
    !name.startsWith('.')
  )
}

/**
 * Read an artifact somebody else wrote.
 *
 * Every problem at once, not the first — the rule, for its reason: a
 * hand-editing author wants the whole list, and reporting one turns a single
 * round of fixes into five. Unknown fields are refused for the same reason a
 * misspelled face field is: silently dropping `advanceOnn` shows its author an
 * edit that did nothing.
 */
export function parseArtifact(value: unknown): ArtifactParse {
  const problems: string[] = []
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, problems: ['the artifact is not an object'] }
  }
  const source = value as Record<string, unknown>

  const kind = source['kind']
  if (!(ARTIFACT_KINDS as readonly unknown[]).includes(kind)) {
    // Named, so the author learns what this build can run rather than being
    // told only that theirs is wrong.
    return {
      ok: false,
      problems: [
        `"${String(kind)}" is not something this build can do (${ARTIFACT_KINDS.join(', ')})`,
      ],
    }
  }

  const KNOWN = new Set(['kind', 'items', 'advanceOn', 'say', 'onRestart'])
  for (const key of Object.keys(source)) {
    if (!KNOWN.has(key)) problems.push(`"${key}" is not a field of ${kind}`)
  }

  const rawItems = source['items']
  let items: WalkAListSpec['items'] | null = null
  if (Array.isArray(rawItems)) {
    // Named individually, not filtered away. Dropping a bad element silently
    // REWRITES somebody's list: they wrote forty items, thirty-eight loaded,
    // and nothing said which two went missing or why. A blank string is the
    // same defect wearing an acceptable type -- it satisfies "is a string" and
    // can never be said aloud.
    const bad = rawItems
      .map((one, index) => ({ one, index }))
      .filter(({ one }) => typeof one !== 'string' || one.trim() === '')
    for (const { index } of bad) {
      problems.push(`"items[${String(index)}]" must be a non-empty string`)
    }
    if (rawItems.length === 0) problems.push('"items" is empty')
    if (bad.length === 0) items = rawItems as readonly string[]
  } else if (typeof rawItems === 'object' && rawItems !== null) {
    const nested = rawItems as Record<string, unknown>
    // The nested object gets the SAME unknown-field treatment as the top level.
    // It did not, so `{ "file": "words.json", "fiel": "typo" }` was accepted
    // while a misspelling one level up was refused -- the inconsistency being
    // worse than either rule, because it teaches that typos are caught.
    for (const key of Object.keys(nested)) {
      if (key !== 'file') problems.push(`"items.${key}" is not a field of items`)
    }
    const file = nested['file']
    if (!isSiblingFile(file)) {
      problems.push('"items.file" must name a file beside the manifest')
    } else if (Object.keys(nested).length === 1) {
      items = { file }
    }
  } else {
    problems.push('"items" must be a list, or { "file": "…" }')
  }

  const advanceOn = source['advanceOn']
  let phrases: readonly string[] | null = null
  if (!Array.isArray(advanceOn) || advanceOn.length === 0) {
    problems.push('"advanceOn" must be a non-empty list of phrases')
  } else {
    // Trimmed, then checked. `saidAdvance` compares a phrase against a tail
    // that has already been trimmed, so " next " could never match anything --
    // a persona that loads, looks right, and cannot be advanced. Trimming here
    // is the forgiving direction; a blank phrase has nothing left to forgive.
    const trimmed = advanceOn.map((one) => (typeof one === 'string' ? one.trim() : one))
    const bad = trimmed
      .map((one, index) => ({ one, index }))
      .filter(({ one }) => typeof one !== 'string' || one === '')
    for (const { index } of bad) {
      problems.push(`"advanceOn[${String(index)}]" must be a non-empty phrase`)
    }
    if (bad.length === 0) phrases = trimmed as readonly string[]
  }

  const say = source['say']
  if (typeof say !== 'string' || say.trim() === '') {
    problems.push('"say" must be what she is told, with {item} in it')
  } else if (!say.includes('{item}')) {
    // The one field whose mistake is invisible: a template with no slot reads
    // fine and produces the same sentence every turn, about nothing.
    problems.push('"say" never mentions {item}, so the item would not reach her')
  }

  const onRestart = source['onRestart']
  if (onRestart !== undefined && onRestart !== null && typeof onRestart !== 'string') {
    problems.push('"onRestart" must be a line to say, or absent')
  }

  // Narrowed together: `say` is checked above but TypeScript cannot carry that
  // across the accumulating branches, and asserting it would be the one place
  // a malformed template could get through.
  if (problems.length > 0 || items === null || phrases === null || typeof say !== 'string') {
    return { ok: false, problems }
  }
  return {
    ok: true,
    artifact: {
      kind: 'walk-a-list',
      items,
      advanceOn: phrases,
      say,
      onRestart: typeof onRestart === 'string' ? onRestart : null,
    },
  }
}

/** Fill the template. Deliberately one substitution, not an expression language. */
export function fill(template: string, item: string): string {
  return template.replaceAll('{item}', item)
}

/**
 * Whether what somebody said means "give me another one".
 *
 * Matched on the TAIL, and the phrases come from the artifact rather than from
 * this file. The first version required the whole utterance to be the request,
 * and the first person to use it said "Okay then, next", got nothing, and said
 * it again. Nobody speaks in bare tokens.
 *
 * The tail is what carries the request, while the cases worth refusing put it
 * mid-sentence and end elsewhere: "what does next mean" must not skip an item.
 */
export function saidAdvance(said: string, phrases: readonly string[]): boolean {
  const tail = said
    .toLowerCase()
    .split(/[,，、.。!！?？;；]+/u)
    .map((piece) => piece.trim())
    .filter((piece) => piece !== '')
    .at(-1)
  return tail !== undefined && phrases.some((phrase) => phrase.toLowerCase() === tail)
}
