import { PERSONA_LIMITS } from '@shared/persona'
import type { Turn } from '../store/turn-row'

/**
 * Which parts of an awake day are worth thinking about, and how much of it fits.
 *
 * ## Why a presence is not one conversation
 *
 * §53 measured a Realtime session lasting exactly an hour, and `session-config`
 * ends the previous conversation on every session config — so an awake day is
 * not one transcript, it is one per hour. Summarising only the conversation
 * that happened to be live when somebody pressed rest means she remembers the
 * evening and not the morning.
 *
 * ## Why most of those hours hold nothing
 *
 * And this is the part that decides whether covering the whole day helps or
 * just burns calls. She can greet on waking (`speak_first`), and a reconnect is
 * a NEW session, so a machine left running in an empty room produces one
 * segment per hour containing her greeting and nothing else. Handing those to
 * the summariser would spend a subprocess to think about silence — and worse,
 * it would ask a model to find something worth remembering in a transcript
 * where nobody said anything, which is an invitation to invent one.
 *
 * ## The rule, and what it deliberately does not do
 *
 * A segment counts when **the person said something in it**: at least one turn
 * from `you` with text left after trimming. That drops exactly three shapes,
 * and each is certainly empty rather than probably empty:
 *
 *   - no turns at all;
 *   - only her turns — a greeting, or a greeting and a farewell, into a room
 *     with nobody in it;
 *   - user turns that are all empty. An interrupted turn is stored with `cut`
 *     and no surviving text on purpose, and a cough transcribed to nothing
 *     lands the same way.
 *
 * It does NOT drop a short reply. "yes" is something a person said, and
 * deciding it is not would mean choosing a threshold nobody measured. The two
 * mistakes are not equal: a wasted call costs a subprocess, and a wrongly
 * dropped conversation costs a memory that never comes back.
 */

/**
 * The most transcript to hand over, in characters, newest first.
 *
 * `PERSONA_LIMITS.memory` is 20,000 — the ceiling on the document this rewrites.
 * Three times its own ceiling is already more context than the job needs, and
 * the bound has to exist somewhere: a day is unbounded, and this is the one
 * input to `codex exec` that grows with use rather than with configuration.
 *
 * TRIMMED FROM THE FRONT, so what survives is the most recent conversation
 * rather than whatever happened to come first. A day that overflows keeps its
 * end, which is the half a note is most likely to want.
 */
export const MOST_TRANSCRIPT_CHARS = PERSONA_LIMITS.memory * 3

/** What one turn costs the prompt, close enough to bound it. See `transcriptOf`. */
function costOf(turn: Turn): number {
  return turn.text.length + turn.who.length + 2
}

/** Whether the person said anything in this segment. See the header. */
export function somebodySpoke(turns: readonly Turn[]): boolean {
  return turns.some((turn) => turn.who === 'you' && turn.text.trim() !== '')
}

/**
 * The same answer, without reading the conversations it does not need.
 *
 * ## What it replaced
 *
 * An eager pair — flatten every qualifying conversation, sort the lot, then
 * keep the last sixty thousand characters. That bounded the PROMPT and left the
 * work unbounded: a day of talking is one transcript per hour (§53), and each
 * one is a SQLite read that was made and then thrown away.
 *
 * `sessions()` already answers newest-first, so the segments arrive in exactly
 * the order that lets this stop early: pull, fill, and stop pulling. A caller
 * that hands over a generator never opens the conversations beyond the budget.
 *
 * ## Ordering, both ways round
 *
 * Segments come in newest-first and the result goes out oldest-first, because
 * that is the order a transcript is read in. Within the kept set the turns are
 * sorted by `at` rather than by arrival: turns settle out of order by design —
 * an interrupted turn is written when its truncation verdict lands, which is
 * after the turn that interrupted it (§58).
 */
export function fittingNewestFirst(
  segments: Iterable<readonly Turn[]>,
  mostChars: number = MOST_TRANSCRIPT_CHARS,
): readonly Turn[] {
  const kept: Turn[] = []
  let total = 0
  for (const segment of segments) {
    // The hours nobody spoke in, dropped before they cost anything further.
    if (!somebodySpoke(segment)) continue
    let full = false
    // Within a segment, newest turn first — same reason as `fitting`.
    for (let i = segment.length - 1; i >= 0; i--) {
      const turn = segment[i]
      if (turn === undefined) continue
      const cost = costOf(turn)
      if (total + cost > mostChars) {
        full = true
        break
      }
      total += cost
      kept.push(turn)
    }
    // STOP PULLING, which is the whole point: the next segment is a conversation
    // this would read and then throw away.
    if (full) break
  }
  return kept.sort((a, b) => a.at - b.at)
}
