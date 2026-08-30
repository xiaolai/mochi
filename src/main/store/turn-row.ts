/**
 * What one stored row IS, and how a row off SQLite becomes one.
 *
 * Below both the store and the archive, and importing neither. `toTurn` is
 * read by `turnsOf` and `matching` in the store AND by the archive parser, so
 * leaving it in either would have made the two import each other -- and two
 * files that must be read together are worse than the one they came from.
 *
 * The types travel with the decoder rather than staying behind, because a
 * decoder in one file and the shape it decodes to in another is the same
 * separation wearing a different hat.
 */
/** Who said it. Her audio, or yours. */
export type Speaker = 'her' | 'you'

export interface Turn {
  readonly at: number
  readonly who: Speaker
  readonly text: string
  /**
   * She was cut off before finishing this.
   *
   * An empty `text` with `cut` true is not a blank row: it is a turn she began
   * and was interrupted in, whose surviving text could not be recovered. It is
   * kept because losing it silently is worse than recording that it happened.
   */
  readonly cut: boolean
}

/**
 * The name a conversation answers to, for the process writing into it.
 *
 * The same token everything else uses, deliberately. It was the rowid, which
 * SQLite hands out again after a delete -- so a handle held across one could
 * come to name a DIFFERENT conversation, and the only thing standing between
 * that and a conversation appended to a stranger's was the holder remembering
 * to let go at six call sites. A random token cannot be reissued, so the
 * mistake is not available to make.
 */
export type LiveSession = SessionToken

/**
 * The name a conversation answers to outside this module.
 *
 * Opaque and random, so it is never reused and cannot be guessed or ordered.
 * Holding one authorises nothing: every lookup still takes the persona, and
 * the token of somebody else's conversation reads exactly like one that was
 * never there.
 */
export type SessionToken = string

export interface Session {
  /** What it answers to. See `SessionToken`. */
  readonly token: SessionToken
  /** When it began. For showing, never for identifying. */
  readonly startedAt: number
  /** Null while she is still awake. */
  readonly endedAt: number | null
  readonly turns: number
  /**
   * Which capabilities she reached for in it, and how many times each.
   *
   * EMPTY is the ordinary answer: most conversations call nothing. It is a
   * list rather than a map so the order is the query's — by name — and two
   * readers cannot disagree about it.
   *
   * The archive header drew `ask_workspace ×2` from the day it was designed
   * and nothing stored it, so the chips were left out rather than faked. This
   * is the thing they were waiting for.
   */
  readonly tools: readonly ToolUse[]
  /**
   * What it was about, in a few words, or null.
   *
   * NULL is ordinary. A conversation is titled after it ends by a model call
   * that may not have run yet, may have failed, or may have answered nothing
   * usable — and the archive drew rows without one for its whole life before
   * this existed. Null and empty are not two states: `subjectFrom` answers null
   * for both, so the column never holds a string that means nothing.
   */
  readonly subject: string | null
  /**
   * The first thing said in it, or null when nothing was.
   *
   * What the archive shows when there is no subject, which is most of the time.
   * It is not a title and is not drawn as one — A3 puts it in quotation marks
   * precisely so it reads as a quotation: the line is somebody's actual words,
   * and dressing them as a summary would be the invention this deliberately is
   * not making.
   *
   * Null for a conversation with no turns, which is a real state — she can be
   * woken and put back to sleep without a word.
   */
  readonly opening: string | null
}

/** One capability, and how many times it was called in one conversation. */
export interface ToolUse {
  readonly name: string
  readonly uses: number
}

export interface Hit {
  /** Which conversation it was in, so the window can open it. */
  readonly token: SessionToken
  readonly startedAt: number
  readonly at: number
  readonly who: Speaker
  readonly text: string
  /**
   * She was interrupted partway through saying this.
   *
   * On the type because the query already selects it: a consumer that quotes a
   * hit without knowing this presents a fragment as a finished sentence, which
   * is the failure the whole `cut` column exists to prevent.
   */
  readonly cut: boolean
}

/**
 * Who said it, from a stored value.
 *
 * Its own function because the rule was written twice -- once for a turn and
 * once for a search hit -- and two copies of a coercion drift the day either is
 * touched. Anything that is not `her` reads as `you`, which is the safe
 * direction: attributing her words to the user under-claims, and the reverse
 * would put words in her mouth.
 */
function decodeSpeaker(value: unknown): Speaker {
  return String(value) === 'her' ? 'her' : 'you'
}

/** Whether she was interrupted, from a stored value. See `decodeSpeaker`. */
function decodeCut(value: unknown): boolean {
  return Number(value ?? 0) === 1
}

export function toTurn(row: Record<string, unknown>): Turn {
  return {
    at: Number(row['at']),
    who: decodeSpeaker(row['who']),
    text: String(row['text']),
    cut: decodeCut(row['cut']),
  }
}
