/**
 * The on-disk export format, which has nothing to do with SQLite.
 *
 * Reading and writing a file somebody can carry to another machine is a
 * different job from keeping a database: the store's failures are disk and
 * schema, these are a stranger's JSON. Everything here treats its input as
 * hostile, because a person can hand this app any file at all.
 */
import { type Turn } from './turn-row'
/**
 * The one format read, and the one written. Not the newest of several.
 *
 * Format 1 was the pre-rewrite application's, and no build has ever handed one
 * to a person: the store could export from the day it was written, and the way
 * out of the application only arrived here. So the leniency the parser carried
 * for those files was for an archive nobody could hold -- paid for with a
 * second set of rules for `cut`, sitting in the one place where a fragment
 * turns into a finished sentence if the rules are applied to the wrong file.
 *
 * A LATER format is a different question. Reading one written before it is a
 * migration whose data actually exists, and this constant is where that starts:
 * bump it, and decide then which older numbers `parseArchive` accepts.
 */
export const ARCHIVE_FORMAT = 2

/** What an export contains. Versioned for the reason the persona format is. */
export interface Archive {
  /**
   * Always `ARCHIVE_FORMAT`. A parsed archive cannot say anything else --
   * every other number is refused rather than adapted to -- so nothing
   * downstream of the parser branches on it.
   */
  readonly version: typeof ARCHIVE_FORMAT
  /** Whose history this was. Informational — the IMPORTER chooses the target. */
  readonly personaId: string
  readonly exportedAt: number
  readonly sessions: ReadonlyArray<{
    readonly startedAt: number
    readonly endedAt: number | null
    readonly turns: readonly Turn[]
  }>
}

export interface Imported {
  readonly sessions: number
  readonly turns: number
  /** Sessions already present, byte for byte. Skipped rather than duplicated. */
  readonly skipped: number
  /**
   * Sessions that share an instant with one already here but say something
   * DIFFERENT, and were therefore not written.
   *
   * Its own count because collapsing it into `skipped` is how an import loses
   * a conversation while reporting success: two archives from two machines
   * can easily hold different conversations that began in the same
   * millisecond, and "already here" would be a lie about both.
   */
  readonly conflicts: number
}

export type ImportResult =
  ({ readonly ok: true } & Imported) | { readonly ok: false; readonly problems: readonly string[] }

/**
 * When an imported conversation is recorded as having ended.
 *
 * CLOSED, always. An archive may legitimately hold a conversation that was
 * still running when it was exported, but importing it as still running makes
 * it live on THIS machine: it would sit in the archive claiming to be
 * happening now, and the app would hold two open conversations at once.
 * Ended at the last thing said in it, or at its start when it holds nothing --
 * the same rule an unclean quit gets.
 *
 * No `-1` sentinel. It was `reduce(max, -1)` with `-1` meaning "no turns", in a
 * file that elsewhere goes out of its way to point out that `-1` is a
 * legitimate timestamp -- so a conversation beginning before the epoch with its
 * last turn at exactly `-1` was closed at its own start, leaving that turn
 * dated after the end of the conversation holding it. The parser refuses that
 * shape on the way back in, so the store would have produced an archive it
 * could not read.
 *
 * `at(-1)` rather than a maximum, because the parser has already refused any
 * session whose turns run backwards.
 */
export function endFor(session: Archive['sessions'][number]): number {
  return session.endedAt ?? session.turns.at(-1)?.at ?? session.startedAt
}

/**
 * Whether two conversations are the same one, said the same way.
 *
 * Compared by content because that is the only thing an archive carries that
 * can answer it: the format has no portable identifier for a session, so "the
 * same conversation" has to mean "the same words in the same order at the same
 * moments". A FUTURE format could carry one, and this can become an equality
 * rather than a comparison on the day it does.
 */
export function sameConversation(
  here: readonly Turn[],
  incoming: readonly Turn[],
  sameEnd: boolean,
): boolean {
  // An open conversation and a finished one holding the same words are not the
  // same conversation: importing the completed export of a session that was
  // still running would otherwise report "already here" and drop the ending.
  if (!sameEnd) return false
  // The incoming side is filtered the way `recordTurn` would have filtered it,
  // or a repeat import of an archive containing a blank turn never matches
  // what that archive originally produced.
  //
  // A blank CUT marker is kept, because `recordTurn` keeps it: filtering it
  // here made a second import of the same archive look different from the
  // first, so an archive containing an interrupted turn could be imported
  // twice over.
  const theirs = incoming.filter((one) => one.text.trim() !== '' || one.cut)
  if (here.length !== theirs.length) return false
  return here.every((one, index) => {
    const other = theirs[index]
    return (
      other !== undefined &&
      one.at === other.at &&
      one.who === other.who &&
      // Compared, because a cut turn and a whole turn carrying the same words
      // are not the same turn -- one of them is a fragment.
      one.cut === other.cut &&
      one.text === other.text.trim()
    )
  })
}

export type ArchiveParse =
  | { readonly ok: true; readonly archive: Archive }
  | { readonly ok: false; readonly problems: readonly string[] }

/**
 * One turn of an archive, or the problems with it.
 *
 * Extracted because `parseArchive` had grown past a hundred lines with session
 * parsing, turn parsing, validation and normalisation nested inside each other
 * -- and the `cut` rule is exactly the kind of thing that gets lost in there.
 */
function parseTurn(raw: unknown, where: string): Turn | readonly string[] {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return [`${where} must be an object`]
  }
  const turn = raw as Record<string, unknown>
  const who = turn['who']
  if (who !== 'her' && who !== 'you') return [`${where}.who must be "her" or "you"`]
  if (typeof turn['text'] !== 'string') return [`${where}.text must be text`]
  if (typeof turn['at'] !== 'number' || !Number.isFinite(turn['at'])) {
    return [`${where}.at must be a timestamp`]
  }
  // REQUIRED, and a boolean. Coercing `cut: "true"` or a missing field to
  // `false` turns an interrupted fragment into an apparently complete
  // statement, which is the one thing the whole column exists to keep
  // straight. There is no longer a format that promises less about this field,
  // and that is most of why there is no longer a second format.
  const cut = turn['cut']
  if (typeof cut !== 'boolean') return [`${where}.cut must be true or false`]
  return { at: turn['at'], who, text: turn['text'], cut }
}

/** One conversation of an archive, or the problems with it. */
function parseSession(
  raw: unknown,
  where: string,
): Archive['sessions'][number] | readonly string[] {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return [`${where} must be an object`]
  }
  const session = raw as Record<string, unknown>
  const startedAt = session['startedAt']
  if (typeof startedAt !== 'number' || !Number.isFinite(startedAt)) {
    return [`${where}.startedAt must be a timestamp`]
  }
  const endedAt = session['endedAt']
  if (endedAt !== null && (typeof endedAt !== 'number' || !Number.isFinite(endedAt))) {
    return [`${where}.endedAt must be a timestamp or null`]
  }
  const rawTurns = session['turns']
  if (!Array.isArray(rawTurns)) return [`${where}.turns must be a list`]

  const problems: string[] = []
  const turns: Turn[] = []
  for (const [index, rawTurn] of rawTurns.entries()) {
    const parsed = parseTurn(rawTurn, `${where}.turns[${String(index)}]`)
    if (Array.isArray(parsed)) problems.push(...parsed)
    else turns.push(parsed as Turn)
  }
  if (problems.length > 0) return problems

  // A conversation that disagrees with itself is refused rather than stored
  // and shown. None of these are hypothetical for a file somebody can write
  // by hand or generate, and each produces a transcript the reader cannot
  // make sense of: an end before its beginning, a line spoken outside the
  // conversation it is in, or lines that jump backwards.
  const ends = endedAt ?? null
  if (ends !== null && ends < startedAt) return [`${where}.endedAt is before it began`]
  if (turns.some((one) => one.at < startedAt || (ends !== null && one.at > ends))) {
    return [`${where} holds something said outside the conversation`]
  }
  if (turns.some((one, index) => index > 0 && one.at < (turns[index - 1]?.at ?? 0))) {
    return [`${where} is not in the order it was said`]
  }
  return { startedAt, endedAt: ends, turns }
}

/**
 * Turn a file somebody chose into an archive, or say what is wrong with it.
 *
 * A boundary, and treated like every other one here: every problem at once
 * rather than the first, and the version settled before a single session is
 * read, so nothing is ever half-read on the wrong format's terms.
 */
export function parseArchive(value: unknown): ArchiveParse {
  const problems: string[] = []
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, problems: ['a transcript archive must be a JSON object'] }
  }
  const source = value as Record<string, unknown>

  const version = source['version']
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1) {
    problems.push('version must be a whole number')
  } else if (version > ARCHIVE_FORMAT) {
    problems.push(`this archive was written by a newer mochi (format ${String(version)})`)
  } else if (version < ARCHIVE_FORMAT) {
    problems.push(`this archive was written by an older mochi (format ${String(version)})`)
  }
  // The WRONG FORMAT is refused before anything else is read, and refused
  // alone. Everything below judges the file by this format's rules, so
  // reporting what those rules make of another format's file describes a
  // document nobody wrote: an archive missing a field that did not exist when
  // it was written is not malformed, it is simply not this. One accurate
  // problem beats that list.
  if (problems.length > 0) return { ok: false, problems }

  const rawSessions = source['sessions']
  if (!Array.isArray(rawSessions)) {
    problems.push('sessions must be a list')
    return { ok: false, problems }
  }

  const sessions: Archive['sessions'][number][] = []
  for (const [index, raw] of rawSessions.entries()) {
    const parsed = parseSession(raw, `sessions[${String(index)}]`)
    if (Array.isArray(parsed)) problems.push(...parsed)
    else sessions.push(parsed as Archive['sessions'][number])
  }

  if (problems.length > 0) return { ok: false, problems }
  return {
    ok: true,
    archive: {
      version: ARCHIVE_FORMAT,
      personaId: typeof source['personaId'] === 'string' ? source['personaId'] : '',
      exportedAt: typeof source['exportedAt'] === 'number' ? source['exportedAt'] : 0,
      sessions,
    },
  }
}
