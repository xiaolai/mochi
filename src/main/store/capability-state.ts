/**
 * What a capability stored for one persona.
 *
 * ## Why this is its own module
 *
 * `personas.ts` has to forget this when she is deleted, and the drill reads
 * her package folder through `personasRoot` — so keeping both halves in one
 * file made an import cycle. The linter found it before I did.
 *
 * They were never one thing anyway. The word list belongs to the PACKAGE and
 * lives beside the manifest; progress belongs to this INSTALL and lives here.
 * That is the rule made concrete: an update replaces the package part and
 * leaves app-side state alone, so handing somebody your word list does not
 * hand them your place in it.
 *
 * ## Named after the category, not after the drill
 *
 * `deletePersona` should call ONE thing here, not one per feature. It has
 * already grown a line twice — memory was forgotten while transcripts were
 * not, and then the drill added a third store that was missed the same way.
 * A directory per persona means the next capability is covered without
 * anybody remembering to add a line.
 */

import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { NO_PROGRESS, type Progress } from '@shared/drill'
import { writeJsonAtomically } from './json-file'
import { readBounded } from './read-bounded'

const PROGRESS_DIR = 'drill'

function progressPath(userData: string, personaId: string): string {
  return join(userData, PROGRESS_DIR, `${personaId}.json`)
}

/** How far through she is. Anything unreadable starts over rather than throwing. */
export function readProgress(userData: string, personaId: string): Progress {
  // `readBounded`, like every other file this app reads from a directory the
  // user can write to. A bare `readFileSync` here had no size ceiling and
  // followed symlinks, so a large or redirected progress file could stall the
  // main process on the path that runs before every single item.
  const read = readBounded(progressPath(userData, personaId))
  if (!read.ok) {
    // Absent on the first run, and that is the ordinary case rather than a
    // fault. Anything else is worth a line: it means a file exists and this
    // app declined to read it, which otherwise looks exactly like starting over.
    if (read.reason.kind !== 'absent') {
      console.error(`[drill] could not read her progress: ${read.reason.kind}`)
    }
    return NO_PROGRESS
  }
  try {
    const parsed: unknown = JSON.parse(read.text)
    if (typeof parsed !== 'object' || parsed === null) return NO_PROGRESS
    const record = parsed as Record<string, unknown>
    const seen = Array.isArray(record['seen'])
      ? record['seen'].filter((one): one is string => typeof one === 'string')
      : []
    // A COUNT, not any number. `JSON.parse('1e999')` is `Infinity`, which
    // serialises back as `null` and poisons the file; negative and fractional
    // values are equally not counts. Anything else starts the count over,
    // which costs nothing -- it is a tally of completed passes.
    const raw = record['round']
    const round = typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0 ? raw : 0
    return { seen, round }
  } catch {
    // Starting over is the right answer to a corrupt file: the worst it costs
    // is repeating some words.
    return NO_PROGRESS
  }
}

/** Write it. Failures are logged, never thrown -- losing a place is not worth ending a session. */
export function writeProgress(userData: string, personaId: string, progress: Progress): void {
  try {
    mkdirSync(join(userData, PROGRESS_DIR), { recursive: true })
    // ATOMIC, like every other JSON this app owns. A direct write truncates
    // first, so a crash or a full disk between truncate and write leaves a
    // half-file -- and the recovery for an unparseable progress file is to
    // start the list over, which is the one outcome this store exists to
    // prevent. `writeJsonAtomically` also sets the restrictive mode the
    // hand-rolled write did not.
    writeJsonAtomically(progressPath(userData, personaId), progress)
  } catch (error: unknown) {
    console.error('[drill] could not remember the place:', error)
  }
}

/**
 * Throw away everything a capability stored for one persona.
 *
 * Called by `deletePersona`. See the header for why it is named after the
 * category rather than after the one capability that exists today.
 */
export function forgetCapabilityState(userData: string, personaId: string): void {
  // Not caught. `force: true` already makes an absent file a no-op, so
  // anything that throws here is a real failure to remove state filed under an
  // id that is about to be released -- and `deletePersona` removes her package
  // last precisely so that a failure at this point keeps the id reserved
  // rather than handing it on with her progress still attached.
  rmSync(progressPath(userData, personaId), { force: true })
}
