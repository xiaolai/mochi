/**
 * Reading a persona off disk, where nothing on disk is trusted.
 *
 * Split from `persona.ts` because that module was answering three questions --
 * what a persona IS, how one is PARSED, and what she is TOLD -- and only the
 * type and its defaults are inherent to the first. Everything here exists
 * because the file was written by a person or by an older version of this app,
 * so every field is a guess until checked.
 *
 * The bubble-side table stayed behind: it is persona DATA that both surfaces
 * draw, not a parsing rule, and `readBubbleSide` reads it from there.
 */

import { EMOTIONS, type Emotion } from './avatar'
import type { SaveProblem } from './save-problem'
import { DEFAULT_POLICY, parsePolicy, type Policy } from './policy'
import { DEFAULT_PRONOUN, PRONOUNS, isPronoun, isRetiredPronoun, type Pronoun } from './pronoun'
import { looksEmpty } from './text'
import { DEFAULT_THEME, THEME_IDS, isTheme, type Theme } from './theme'
import {
  BUBBLE_SIDES,
  DEFAULT_PERSONA,
  PERSONA_FORMAT,
  PERSONA_LIMITS,
  VOICE_NAMES,
  type BubbleSide,
  type Persona,
  type SpokenMoment,
  type VoiceName,
} from './persona'

/**
 * When each retired field stopped being ours.
 *
 * ONE number per field, not one boolean for "older than current". Both retired
 * sets used to be gated on `version < PERSONA_FORMAT`, which is the same thing
 * only while there has been exactly one retirement -- and this is the second.
 * Under the shared gate, bumping the format to 3 would have quietly re-admitted
 * `keeps` from a v2 manifest: a field a v2 build never wrote, so anything
 * carrying one is a package author setting somebody's retention policy in a
 * field nobody reads before installing. The whole reason that gate exists is to
 * refuse exactly that.
 *
 * So each retirement carries the format it happened at, and a field is
 * tolerated only in a file written before it.
 */
const RETIRED_AT = {
  /** Retention moved to `@shared/policy`, filed beside her memory. */
  keeps: 2,
  keepDays: 2,
  /**
   * The declared expression and motion lists.
   *
   * Two validated, persisted, bounded fields with no production caller. What
   * is missing is the CALLER, not the machinery: `rig/motion.ts` has a clip
   * format, built-in motions, and `parseMotionClip` for a package that ships
   * one -- but nothing ever asks a persona which of them she claims, because
   * the tool that would play one does not exist. The `set_expression` tool
   * that would consult the other was never built at all.
   *
   * They were held open so a manifest written later would
   * not have to be retrofitted -- but nothing could be retrofitted INTO a
   * format that can name its own epochs, which is what this table is. Held
   * open, they cost a validator, two limits, a parser branch and a gate
   * function, all of which had to stay correct for a feature nobody could use.
   */
  expressions: 3,
  motions: 3,
} as const satisfies Record<string, number>

/**
 * Which of her faces this character uses. Absent means all of them.
 *
 * ## This is the retirement above, undone on its own terms
 *
 * `expressions` was retired at format 3, and the note there says exactly why:
 * "What is missing is the CALLER, not the machinery ... the `set_expression`
 * tool that would consult the other was never built at all." It is built now, so
 * the field has a reader and earns its validator back.
 *
 * ## And it is a NEW name, deliberately
 *
 * Re-using `expressions` would be worse than it looks. That key is tolerated in
 * any file written before format 3, so a v2 package carrying one would go from
 * "a list nothing reads" to "the allowlist deciding which faces she may wear" —
 * a meaning it never consented to, arriving in a field nobody reads before
 * installing. A new key cannot be carried by an older file at all: `faces` in a
 * v3 manifest is an unknown field and is refused, which is the correct answer.
 *
 * ## Absent is not empty
 *
 * Absent means all eight, because that is what every existing character means
 * and a migration that silently muted seven faces would be a redesign of
 * characters somebody else wrote. An explicit empty list is a different
 * statement — this character wears one face — and is allowed.
 */
function readFaces(problems: SaveProblem[], source: Record<string, unknown>): readonly Emotion[] {
  const given = source['faces']
  if (given === undefined) return EMOTIONS
  if (!Array.isArray(given)) {
    problems.push({ kind: 'field', field: 'faces', reason: 'malformed' })
    return EMOTIONS
  }
  const seen = new Set<Emotion>()
  for (const one of given) {
    if (typeof one !== 'string' || !(EMOTIONS as readonly string[]).includes(one)) {
      problems.push({ kind: 'unknown-value', field: 'faces', allowed: EMOTIONS.join(', ') })
      continue
    }
    seen.add(one as Emotion)
  }
  // In EMOTIONS order rather than the file's, so two manifests listing the same
  // faces differently produce the same character — and so the order she is
  // offered them in is the tuple's, which `avatar.ts` calls the contract.
  return EMOTIONS.filter((one) => seen.has(one))
}

/**
 * Length as a PERSON counts it, not as UTF-16 stores it.
 *
 * `'ab'.length` is 2 and so is `'🍡'.length` -- an emoji is a surrogate pair,
 * so a name of twelve emoji was rejected as twenty-four "characters" by a
 * message that then quoted a limit of twenty-four. Every one of these fields is
 * prose somebody types, and astral characters are ordinary in the languages
 * this app ships in.
 *
 * GRAPHEMES, not code points. Spreading the string would fix the surrogate
 * pair and still count a flag or a family emoji as several -- and `é` written
 * as `e` plus a combining accent as two. `Intl.Segmenter` is the only one of
 * the three that matches what a person sees, and both Node 24 and Chromium
 * have it.
 */
const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

function characters(value: string): number {
  let count = 0
  for (const _ of GRAPHEMES.segment(value)) count += 1
  return count
}

/**
 * How many code units one grapheme may reasonably take.
 *
 * A grapheme is what a person would call a character, which is the right unit
 * for a limit somebody has to understand -- but it is not a bound on SIZE.
 * `'a' + '\u0301'.repeat(200000)` is one grapheme and two hundred thousand
 * code units (measured), so every limit in this file admitted a field of any
 * length at all, and these strings are concatenated into a system prompt and
 * sent on every wake. That is the exact cost the limits exist to refuse.
 *
 * Sixteen is generous against anything typed on purpose: the longest ordinary
 * grapheme is an emoji family with skin tones, around eleven.
 */
const UNITS_PER_GRAPHEME = 16

/**
 * Whether a field is past its limit, counted BOTH ways.
 *
 * Graphemes for the limit a person reads, code units for the one the wire
 * pays for. A value that passes one and not the other is refused.
 */
export function tooLong(value: string, limit: number): boolean {
  return value.length > limit * UNITS_PER_GRAPHEME || characters(value) > limit
}

/**
 * What an `id` may be.
 *
 * One expression kills four separate hazards, which is why it is this strict
 * rather than "non-empty text":
 *
 *   `../avatars`   no dot and no separator, so nothing built from an id can
 *                  leave the directory it was meant to name
 *   control chars  not in the set, so an id cannot forge a log line
 *   `Mochi` / `mochi`  no uppercase, so there is no case-folding question and
 *                  no pair of ids that are "the same" to a person and not to a
 *                  Map
 *   `é` two ways   pure ASCII has no equivalent decomposition, so NFC and NFD
 *                  cannot produce two spellings of one id
 *
 * Because the grammar admits exactly one spelling of any given id, EQUALITY IS
 * STRING EQUALITY. There is no normalise-before-compare step, and therefore no
 * call site that can forget to do it.
 *
 * This is what an id is for -- a stable key for memory and for the file a
 * persona was loaded from. What a person reads is `name`, which is free text in
 * any language.
 */
const ID = /^[a-z][a-z0-9-]{0,63}$/

/**
 * Names Windows refuses to give a file, whatever the extension.
 *
 * `con.json` is not a file on Windows -- it is the console device, and the
 * open succeeds while going somewhere else entirely. These pass the grammar
 * above perfectly well, so without this list a persona called `Aux` migrates
 * to `aux.json`, becomes unsavable on one platform out of two, and takes its
 * memory and avatar lookups down with it. This app ships on macOS and Windows.
 *
 * Listed rather than pattern-matched: the set is closed, Microsoft documents
 * it, and a regex for it reads as a puzzle.
 */
const DEVICE_NAMES: ReadonlySet<string> = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  ...Array.from({ length: 9 }, (_, n) => `com${String(n + 1)}`),
  ...Array.from({ length: 9 }, (_, n) => `lpt${String(n + 1)}`),
])

export function isPersonaId(value: unknown): value is string {
  return typeof value === 'string' && ID.test(value) && !DEVICE_NAMES.has(value)
}

// Reserving `mochi` for the built-in is decided, and is NOT
// enforced here, deliberately. This parser validates the built-in too --
// `parsePersona(DEFAULT_PERSONA)` is asserted to pass -- so a check that
// refused her own id would refuse her. Reservation belongs to the catalog
// loader, which is the only place that can tell a stored file from the
// constant, and it lands with that loader rather than sitting here unused.

/**
 * Every key a persona file may carry.
 *
 * Derived from the built-in rather than listed again -- she is a complete
 * `Persona`, so a field added to the type appears here without anybody
 * remembering to, and a hand-kept list would be the copy that goes stale.
 */
const PERSONA_FIELDS: ReadonlySet<string> = new Set(Object.keys(DEFAULT_PERSONA))

/**
 * Was this field still ours when the file was written?
 *
 * Fields that USED to live in a manifest are tolerated so old files still load.
 * Unknown fields are refused here on purpose -- so without this, every persona
 * the app itself wrote before a retirement would stop loading, which is the one
 * migration failure that presents as "the app ate my characters".
 *
 * Retention is not silently dropped either: `parsePersona` hands `keeps` and
 * `keepDays` back as `legacy` so the catalog loader can seed the policy store
 * from them once, and only for a persona who has no setting of her own yet. The
 * avatar lists are dropped, because nothing ever read them.
 */
function retired(key: string, version: number): boolean {
  const at = (RETIRED_AT as Record<string, number | undefined>)[key]
  return at !== undefined && version < at
}

export type PersonaParse =
  | {
      readonly ok: true
      readonly persona: Persona
      /**
       * A retention setting found in the manifest, for one-time migration.
       *
       * `null` for every file written since the move. Present only so the
       * loader can carry somebody's existing choice across rather than
       * resetting it to the default, which for the people who had turned
       * storage OFF would mean quietly turning it back on.
       */
      readonly legacy: Policy | null
    }
  | { readonly ok: false; readonly problems: readonly SaveProblem[] }

/**
 * Why a persona on disk did not become one in the catalog.
 *
 * STRUCTURED, for the usual reason: main does not write sentences. A
 * load failure has to reach a window somebody can open or it is only a console
 * line nobody has -- and `AvatarProblem.reason` shows what the alternative
 * looks like, an English string assembled in main that the window can only
 * display verbatim, in one language, outside the table that makes a missing
 * translation a compile error.
 *
 * `source` and `id` are IDENTIFIERS and travel verbatim. Only the sentence
 * around them is chosen by the window.
 */
export type PersonaLoadProblem =
  /** The folder itself could not be listed. Everything falls back. */
  | { readonly kind: 'folder-unreadable' }
  /** One file could not be read at all. */
  | { readonly kind: 'unreadable'; readonly source: string }
  /** One file is not JSON. */
  | { readonly kind: 'malformed'; readonly source: string }
  /** One file is JSON and is not a persona. Carries the field-level reasons. */
  | {
      readonly kind: 'invalid'
      readonly source: string
      readonly problems: readonly SaveProblem[]
    }
  /**
   * Two or more files claim one id.
   *
   * EVERY member is refused and every source is named. Taking the first would
   * depend on `readdir` order, which is filesystem-dependent -- so two machines
   * holding identical folders could run different characters. Refusing the
   * whole catalog instead would turn one person's copy-paste into "all my
   * personas vanished".
   */
  | { readonly kind: 'duplicate-id'; readonly id: string; readonly sources: readonly string[] }
  /**
   * A package carries its own `face.json` AND names a shared avatar.
   *
   * Refused rather than resolved by precedence. A precedence rule is one
   * somebody has to remember and one this format would have to defend
   * forever; two mutually exclusive ways to say the same thing is a mistake
   * the loader can simply name.
   */
  | { readonly kind: 'two-faces'; readonly source: string }
  /** A file tried to claim the built-in's id. See `BUILT_IN_ID`. */
  | { readonly kind: 'reserved-id'; readonly id: string; readonly source: string }
  /** The remembered active persona is not in the catalog. */
  | { readonly kind: 'active-missing'; readonly id: string }
  /** More persona files than this app will read. Named so it is not a mystery. */
  | { readonly kind: 'too-many'; readonly found: number; readonly limit: number }
  /** The old single persona.json exists and could not be read. */
  | { readonly kind: 'legacy-unreadable' }
  /** It exists and is not JSON. */
  | { readonly kind: 'legacy-malformed' }
  /** It exists, is JSON, and is not a persona. */
  | { readonly kind: 'legacy-invalid'; readonly problems: readonly SaveProblem[] }
  /** It could be moved, and the name it would take is already occupied. */
  | { readonly kind: 'legacy-blocked'; readonly source: string }

/**
 * The id no stored persona may claim.
 *
 * The built-in is a constant and never a file: the fallback for a
 * broken persona IS her, so she cannot be the thing that broke. Letting a file
 * take this id would make "which mochi am I looking at" a question with no
 * answer visible anywhere -- the shape refused for credentials.
 */
export const BUILT_IN_ID = DEFAULT_PERSONA.id

/**
 * An id derived from a name, avoiding everything already taken.
 *
 * Used in the two places a persona needs an id nobody typed: migrating the
 * legacy single persona, and forking the built-in the first time somebody edits
 * her. Derived from the NAME rather than counted, so `Ada` becomes `ada` and
 * the id remains something a person can recognise in a log.
 *
 * Latin letters survive; everything else does not. A persona named 老师 yields
 * no usable characters at all, which is why there is a fallback rather than an
 * error -- the id is a key, and the name is what anybody actually reads.
 */
export function deriveId(name: string, taken: ReadonlySet<string>): string {
  const slug = name
    .normalize('NFD')
    // Strip combining marks, so `José` becomes `jose` rather than losing the e.
    // Escaped rather than literal: a combining mark written into source is
    // invisible to whoever reads this next.
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, PERSONA_LIMITS.id)
  const base = isPersonaId(slug) ? slug : 'persona'
  if (!taken.has(base) && base !== BUILT_IN_ID) return base
  // `-2` first, because `-1` implies there is a `name-0` somewhere.
  for (let n = 2; ; n += 1) {
    // The SUFFIX decides how much base survives. Reserving a fixed four
    // characters was right up to `-999` and wrong at `-1000`, where a
    // 60-character base produced a 65-character id -- one this file's own
    // parser rejects, returned by the function whose job is to produce a
    // usable one.
    const suffix = `-${String(n)}`
    const candidate = `${base.slice(0, PERSONA_LIMITS.id - suffix.length)}${suffix}`
    if (!taken.has(candidate) && isPersonaId(candidate)) return candidate
  }
}

/**
 * Turn something that crossed the IPC boundary into a Persona, or say what is
 * wrong with it.
 *
 * The settings renderer is not trusted to send a well-formed object. It is a
 * web page: an extension, a devtools console, or a mistake of mine can send
 * anything down that channel, and the result of accepting it is a malformed
 * system prompt on the next wake -- or a `voice` the service rejects, which
 * surfaces as a session that will not open with nothing local to point at.
 *
 * Reports EVERY problem, like `parseFaceSpec`, and for the same reason: the
 * window shows them all at once instead of one per save.
 */
export function parsePersona(value: unknown): PersonaParse {
  const problems: SaveProblem[] = []
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, problems: [{ kind: 'field', field: 'persona', reason: 'not-object' }] }
  }
  const source = value as Record<string, unknown>

  // The VERSION first, because everything below reads the file on its terms.
  //
  // Absent is the ordinary upgrade case -- every persona written before this
  // field existed -- and means the first format. A value that is not a whole
  // number is a file nobody wrote on purpose.
  const rawVersion = source['version']
  const version = rawVersion === undefined ? 1 : rawVersion
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1) {
    problems.push({ kind: 'field', field: 'version', reason: 'not-a-version' })
    // RETURNED, not collected. Everything below reads the file on the version's
    // terms -- which legacy fields may be carried, which keys count as unknown
    // -- and there is no honest answer to any of that for a version this build
    // does not have.
    return { ok: false, problems }
  }
  if (version > PERSONA_FORMAT) {
    // REFUSED, not read, and refused HERE rather than reported and read
    // anyway. Reading it would drop whatever the newer build added and then
    // write the loss back on the next save -- and, worse, every field the
    // newer format introduced comes back as `unknown-field` and every field it
    // reshaped as malformed, so the window buries the one problem that matters
    // ("update mochi") under a list of complaints about a file that is
    // perfectly well formed.
    return { ok: false, problems: [{ kind: 'from-the-future', field: 'version', found: version }] }
  }

  const id = readId(problems, source)
  const name = readText(problems, source, 'name', false)
  const addressUser = readText(problems, source, 'addressUser', true)
  // ALLOWED EMPTY since 2026-08-17. It was required because it was the only
  // thing telling the model who it was; `CORE_PROMPT` does that now, so an
  // empty box is somebody asking for the floor and nothing else -- which is a
  // real thing to want, and the closest this app comes to an unshaped session.
  const style = readText(problems, source, 'style', true)
  const avatarId = readAvatarId(problems, source)
  const bubbleSide = readBubbleSide(problems, source)
  const pronoun = readPronoun(problems, source)
  const theme = readTheme(problems, source)
  const voice = readVoice(problems, source)
  const bubble = readBubble(problems, source)
  const faces = readFaces(problems, source)

  const greeting = readMoment(problems, source, 'greeting')
  const farewell = readMoment(problems, source, 'farewell')

  // Retention as it was written in older manifests. Carried out rather than
  // validated: this parser no longer OWNS these fields, and refusing a file
  // because a setting that has since moved is malformed would strand a
  // persona over a value nothing reads any more. Anything that is not a
  // policy simply migrates nothing, and she takes the default.
  //
  // ABSENT and MALFORMED are told apart deliberately. `?? DEFAULT` treats them
  // the same, and that is worse than it sounds here: an explicit `keeps: null`
  // became `true` and then migrated, WRITING a policy file that says keep for
  // somebody who never chose one. A value nobody can read must migrate
  // nothing at all, not a guess -- and `readPolicy` then reports "nobody has
  // chosen", which is the truth.
  //
  // Only from a manifest OLDER than this format, which is what makes the
  // claim in `@shared/policy` true rather than aspirational. Any manifest at
  // all could supply these, so a freshly downloaded package could seed a
  // retention policy for the person installing it -- deciding, in a field
  // nobody reads beforehand, whether their conversations are written to disk.
  // A v1 manifest predates the move and is migrated; a current one carrying
  // them is an author setting policy, and falls through to the unknown-field
  // check below like any other field that is not ours.
  const rawKeeps = retired('keeps', version) ? source['keeps'] : undefined
  /*
    `keepDays` is still READ here, and no longer carried.

    A v1 manifest can hold one, and it stays retired so the unknown-field check
    below does not report it — but the policy it seeds has no such field any
    more, so the number is dropped. Nothing was enforcing it: see the note in
    `@shared/policy` for why a correct, tested, uncalled implementation of
    time-based retention was removed rather than finished.

    Its PRESENCE still counts, immediately below, because a manifest that set
    only `keepDays` was still a manifest whose author said something about
    retention — and `keeps` defaults to true, which is what they got.
  */
  const rawKeepDays = retired('keepDays', version) ? source['keepDays'] : undefined
  const legacy =
    rawKeeps === undefined && rawKeepDays === undefined
      ? null
      : parsePolicy({ keeps: rawKeeps === undefined ? DEFAULT_POLICY.keeps : rawKeeps })

  // Unknown keys are REPORTED, not dropped. Same rule as `parseFaceSpec`, and
  // the same reason: a persona file is hand-editable, and `styel` silently
  // discarded shows its author an edit that did nothing. The retention fields
  // are exempt because they were ours until recently -- see `retired`, which
  // exempts each one only in a file written before IT was retired.
  for (const key of Object.keys(source)) {
    if (!PERSONA_FIELDS.has(key) && !retired(key, version)) {
      problems.push({ kind: 'unknown-field', field: key })
    }
  }

  if (problems.length > 0) return { ok: false, problems }
  return {
    ok: true,
    // Only when the file actually said something. A manifest with neither
    // field yields the default here, and seeding the store from that would
    // write a policy file for every persona who never chose one -- turning
    // "nobody has said" into "somebody said keep", which is the distinction
    // `readPolicy` exists to preserve.
    legacy: source['keeps'] === undefined && source['keepDays'] === undefined ? null : legacy,
    persona: {
      id,
      name,
      addressUser,
      pronoun,
      theme,
      version,
      voice,
      bubble,
      style,
      avatarId,
      bubbleSide,
      faces,
      greeting,
      farewell,
    },
  }
}

/**
 * The id, checked against a GRAMMAR rather than just a length.
 *
 * It becomes a Map key, the key memory is filed under, and a token in log
 * lines -- see `ID`.
 */
function readId(problems: SaveProblem[], source: Record<string, unknown>): string {
  const raw = source['id']
  if (typeof raw !== 'string') {
    problems.push({ kind: 'field', field: 'id', reason: 'not-text' })
    return ''
  }
  if (!isPersonaId(raw)) problems.push({ kind: 'field', field: 'id', reason: 'malformed' })
  return raw
}

/**
 * Which avatar she wears, or the built-in.
 *
 * Absent is the ordinary upgrade case -- a persona written before avatars
 * could be chosen -- and means the built-in. `null` says the same thing
 * explicitly, which is what the shelf sends when somebody clears the choice.
 */
function readAvatarId(problems: SaveProblem[], source: Record<string, unknown>): string | null {
  const raw = source['avatarId']
  if (raw === undefined || raw === null) return null
  if (!isPersonaId(raw)) {
    problems.push({
      kind: 'field',
      field: 'avatarId',
      reason: typeof raw === 'string' ? 'malformed' : 'not-text',
    })
    return null
  }
  return raw
}

/**
 * How she is referred to.
 *
 * A RETIRED pronoun is mapped forward, not refused. `they` was an option and is
 * not one now. Somebody's persona file still says it, and this parser's
 * refusals are total -- a rejected file is a character missing from the shelf,
 * not a field reset. Losing a persona because the app narrowed an enum under
 * her is the wrong side of that trade, so she keeps everything else and takes
 * the default here.
 *
 * Mapped to the DEFAULT rather than to `it`: `they` meant somebody whose gender
 * was not stated, and `it` does not mean that -- it means a thing. Neither
 * answer is the one that was written, and the one that keeps her a someone is
 * the smaller change.
 */
function readPronoun(problems: SaveProblem[], source: Record<string, unknown>): Pronoun {
  const stored = source['pronoun']
  const pronoun = isRetiredPronoun(stored) ? DEFAULT_PRONOUN : stored
  if (isPronoun(pronoun)) return pronoun
  problems.push({ kind: 'unknown-value', field: 'pronoun', allowed: PRONOUNS.join(', ') })
  return DEFAULT_PRONOUN
}

/**
 * A NAMED theme or a hue the package chose.
 *
 * Absent is the ordinary upgrade case -- a persona written before themes
 * existed -- and takes the default quietly. A value that is not a theme is a
 * problem, because it means somebody chose something this build cannot draw.
 */
function readTheme(problems: SaveProblem[], source: Record<string, unknown>): Theme {
  const theme = source['theme']
  if (theme === undefined) return DEFAULT_THEME
  if (isTheme(theme)) return theme
  problems.push({
    kind: 'unknown-value',
    field: 'theme',
    allowed: `${THEME_IDS.join(', ')}, or { hue: 0-359 }`,
  })
  return DEFAULT_THEME
}

/**
 * Whether she shows her words.
 *
 * Absent is the ordinary upgrade case — every persona written before the bubble
 * existed — and takes the default quietly. A value that is not a boolean is a
 * problem, because somebody wrote something there meaning to switch it.
 */
function readBubble(problems: SaveProblem[], source: Record<string, unknown>): boolean {
  const raw = source['bubble']
  if (raw === undefined) return DEFAULT_PERSONA.bubble
  if (typeof raw === 'boolean') return raw
  problems.push({ kind: 'unknown-value', field: 'bubble', allowed: 'true, false' })
  return DEFAULT_PERSONA.bubble
}

/**
 * Which side her words sit on. Absent means `auto`, like every other field here.
 *
 * No "unset" state. A persona written before this field existed gets the same
 * answer as one written today and never touched, because those are the same
 * thing to whoever is looking at the control — see the field for why an
 * invisible third state was worse than losing an app-level default.
 */
function readBubbleSide(problems: SaveProblem[], source: Record<string, unknown>): BubbleSide {
  const raw = source['bubbleSide']
  if (raw === undefined) return DEFAULT_PERSONA.bubbleSide
  if (typeof raw === 'string' && (BUBBLE_SIDES as readonly string[]).includes(raw)) {
    return raw as BubbleSide
  }
  problems.push({ kind: 'unknown-value', field: 'bubbleSide', allowed: BUBBLE_SIDES.join(', ') })
  return DEFAULT_PERSONA.bubbleSide
}

/** Which voice the service is asked for. A closed set the service owns. */
function readVoice(problems: SaveProblem[], source: Record<string, unknown>): VoiceName {
  const voice = source['voice']
  if (typeof voice === 'string' && (VOICE_NAMES as readonly string[]).includes(voice)) {
    return voice as VoiceName
  }
  problems.push({ kind: 'unknown-value', field: 'voice', allowed: VOICE_NAMES.join(', ') })
  return DEFAULT_PERSONA.voice
}

/**
 * One text field, checked against its limit and collected if it is wrong.
 *
 * Lifted out of `parsePersona`, which was ninety-five lines with two nested
 * validators inside it -- so a schema change meant reading a closure that
 * captured the collector, the source object and the limits table at once, and
 * the top-level checks that followed were forty lines below the thing they
 * depended on.
 */
function readText(
  problems: SaveProblem[],
  source: Record<string, unknown>,
  key: keyof typeof PERSONA_LIMITS,
  allowEmpty: boolean,
): string {
  // A THIN WRAPPER, not a second copy. The comment at `checkedText` says these
  // rules have one implementation; they had two, and the two had already
  // diverged once in check ORDER. The only difference left is what a top-level
  // key needs and a nested path does not: the field name comes from the key,
  // and `null` is not a value a persona field may hold.
  return (
    checkedText(problems, source[key], {
      field: key,
      limit: PERSONA_LIMITS[key],
      allowEmpty,
      allowNull: false,
    }) ?? ''
  )
}
/** One spoken moment: its instruction, its optional verbatim line. */
function readMoment(
  problems: SaveProblem[],
  source: Record<string, unknown>,
  key: 'greeting' | 'farewell',
): SpokenMoment {
  const raw = source[key]
  // ARRAYS too. `typeof [] === 'object'` and an array is not null, so
  // `['x']` with `instruction` and `verbatim` hung off it as properties
  // reached the field checks below and could pass every one of them -- and a
  // moment that is an array is a persona file nobody wrote on purpose. The
  // top-level check a few lines above already excludes arrays; this one did
  // not, which is the kind of asymmetry that only shows up when read side by
  // side.
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    problems.push({ kind: 'field', field: key, reason: 'not-object' })
    return { instruction: '', verbatim: null }
  }
  const record = raw as Record<string, unknown>
  // Unknown keys REPORTED here too, the way the top level reports them. They
  // were accepted and then dropped when the moment was rebuilt below, so
  // `{ instruction, verbtaim }` silently lost the line somebody wrote -- which
  // is the exact outcome the top-level rule exists to prevent, one nesting
  // level down from where it was enforced.
  for (const field of Object.keys(record)) {
    if (field !== 'instruction' && field !== 'verbatim') {
      problems.push({ kind: 'unknown-field', field: `${key}.${field}` })
    }
  }
  // The instruction is REQUIRED, exactly like `name` and `style`, and for a
  // sharper reason: it is the fallback for when there is no verbatim line, so
  // an empty one is not a mild omission -- it is the only text in `Greet them
  // in one short sentence, .`
  const instruction = checkedText(problems, record['instruction'], {
    field: `${key}.instruction`,
    limit: PERSONA_LIMITS.instruction,
    allowEmpty: false,
    allowNull: false,
  })
  // `null` and a string are the only shapes. `undefined` is rejected rather
  // than coerced: this project compiles with exactOptionalPropertyTypes, and
  // an absent key reaching here means the sender built the wrong object.
  const verbatim = checkedText(problems, record['verbatim'], {
    field: `${key}.verbatim`,
    limit: PERSONA_LIMITS.verbatim,
    allowEmpty: true,
    allowNull: true,
  })
  return { instruction: instruction ?? '', verbatim }
}

/**
 * One text value, checked and reported against a named path.
 *
 * `readText` above does the same three checks against a top-level KEY, and
 * this does them against a nested one. They were written out separately and
 * had already diverged in check ORDER -- `readText` reports emptiness and
 * length independently, while the moment version made them a chain, so a
 * cleared instruction that was also too long reported only one of the two.
 * Same rules, one place, both paths.
 */
function checkedText(
  problems: SaveProblem[],
  raw: unknown,
  spec: { field: string; limit: number; allowEmpty: boolean; allowNull: boolean },
): string | null {
  if (raw === null && spec.allowNull) return null
  if (typeof raw !== 'string') {
    problems.push({ kind: 'field', field: spec.field, reason: 'not-text' })
    return null
  }
  // Emptiness AFTER control characters are removed, for the reason `readText`
  // gives: `trim()` only takes whitespace, so a field of zero-width joiners
  // passed as filled and reached the prompt as nothing.
  if (!spec.allowEmpty && looksEmpty(raw)) {
    problems.push({ kind: 'field', field: spec.field, reason: 'empty' })
  }
  if (tooLong(raw, spec.limit)) {
    problems.push({ kind: 'field-length', field: spec.field, limit: spec.limit })
  }
  return raw
}
