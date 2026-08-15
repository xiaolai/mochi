/**
 * Preferences about the APP, as opposed to about her.
 *
 * The split is deliberate and worth stating, because "how big is she" reads
 * like a property of the avatar and is not one. Her proportions live in the
 * face (`bodyW x bodyH`, and every avatar declares its own); how many pixels
 * one of those units is worth on THIS screen is a property of this screen.
 * Switching persona should not resize her, and moving to a 4K display should.
 *
 * One small JSON file, atomically written, same shape as `store/persona.ts` and
 * for the same reasons. It will move into SQLite with everything else.
 */

import { linkSync, renameSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { clampSizePercent, SIZE_PERCENT } from '@shared/avatar-layout'
import {
  DEFAULT_SHORTCUTS,
  SHORTCUT_IDS,
  collides,
  readShortcuts,
  type Shortcuts,
} from '@shared/shortcuts'
import { DEFAULT_CREDENTIAL_SOURCE, isCredentialSource, type CredentialSource } from '@shared/auth'
import { isPersonaId } from '@shared/persona'
import { DEFAULT_SOUND, readSound, type Sound } from '@shared/sound'
import { DEFAULT_SETTINGS, isIdleChoice, type IdleChoice } from '@shared/companion'
import {
  PROMPT_LIMIT,
  DEFAULT_DELEGATION,
  isDelegationTrigger,
  readDelegation,
  type DelegationSettings,
} from '@shared/delegation'
import { readJsonFile, writeJsonAtomically } from './json-file'

export const PREFERENCES_FILE = 'preferences.json'

export interface Preferences {
  /** Her size, as a percentage of the base scale. */
  readonly sizePercent: number
  /**
   * Which keys reach her.
   *
   * A preference about the MACHINE, not about her: the same character on a
   * different desktop wants a different key, and switching persona must not
   * rebind anything. That is the same split `sizePercent` is here for.
   */
  readonly shortcuts: Shortcuts
  /**
   * Which credential she uses.
   *
   * A machine preference, not a persona one: it is about what this computer
   * has been set up with, and switching character must not change who you are
   * authenticating as.
   */
  readonly credentialSource: CredentialSource
  /**
   * Which persona is being worn.
   *
   * A MACHINE preference, and the placement is the whole point: "which one is
   * active" is not a property of any persona. Putting it inside one would mean
   * two personas could each believe they were current, and the file that
   * happened to load last would win.
   *
   * `null` means the built-in. Stored as an id rather than resolved here --
   * this module knows nothing about the catalog, and an id that no longer
   * resolves is `activePersona`'s problem to report, not this one's to hide.
   */
  readonly activePersonaId: string | null
  /** What this computer does with the microphone and the speaker. */
  readonly sound: Sound
  /**
   * How long she waits, with nobody talking, before saying goodbye.
   *
   * A MACHINE preference by the usual test, though not obviously: it looks like
   * a habit rather than a property of the computer. What settles it is the
   * cost. The expensive answer -- never -- is expensive because THIS machine's
   * microphone stays open and this account's session keeps billing, and neither
   * of those changes when a different character is worn. A per-persona copy
   * would mean switching character silently changed what the meter was doing.
   */
  readonly idleMs: IdleChoice
  /**
   * How this computer runs Codex when she is asked to look something up.
   *
   * A MACHINE preference for the reason `credentialSource` above is one: which
   * model runs, and what authorises the run, describe this installation rather
   * than the character being worn.
   */
  readonly delegation: DelegationSettings
  /**
   * The spoken-output rules every persona is given. `null` uses the built-in.
   *
   * MACHINE level, and that follows from why they exist: `persona.ts` holds
   * them apart from `style` precisely because they must reach every persona.
   * Storing them per-persona would recreate the bug that split them out -- the
   * second character silently losing them.
   */
  readonly spokenRules: string | null
}

export const DEFAULT_PREFERENCES: Preferences = {
  sizePercent: SIZE_PERCENT.fallback,
  shortcuts: DEFAULT_SHORTCUTS,
  credentialSource: DEFAULT_CREDENTIAL_SOURCE,
  activePersonaId: null,
  sound: DEFAULT_SOUND,
  idleMs: DEFAULT_SETTINGS.idleMs,
  delegation: DEFAULT_DELEGATION,
  spokenRules: null,
}

export interface LoadedPreferences {
  readonly preferences: Preferences
  /** Why the stored file was not used, if it existed and was not. */
  readonly problem: string | null
  /**
   * The file existed and NOTHING in it could be used.
   *
   * Distinct from `problem`, which is also set when one field fell back — a
   * bad shortcut or an unrecognised trigger still leaves the rest of the file
   * intact and the next write loses nothing. This flag marks the other case:
   * unreadable, unparseable, or valid JSON that is not an object, where the
   * defaults returned above share a filename with somebody's real settings.
   *
   * It exists because the next automatic write destroys them. The app saves on
   * quit unconditionally, so a transient permissions problem on `userData` used
   * to cost the user every preference they had ever set — silently, on the
   * launch that failed to read them. See `quarantinePreferences`.
   */
  readonly unusableFile: boolean
  /**
   * Whether this installation has run before.
   *
   * False only on a machine where no preferences file exists at all, which is
   * the one launch where there is nothing of the user's to migrate FROM --
   * and therefore the one launch where running a migration can only serve
   * something that was placed here from outside. See `loadPersonas`.
   */
  readonly ranBefore: boolean
}

/**
 * A stored optional text block, or null.
 *
 * Empty means "use the built-in", the same way an empty delegation prompt does:
 * clearing a box is how somebody asks for the original back. `readDelegation`
 * applies the identical rule to `prompt`, and the two were written out
 * separately -- so a limit changed in one place quietly left the other
 * accepting what this one refuses.
 */
function boundedText(value: unknown, limit: number): string | null {
  return typeof value === 'string' && value.trim() !== '' && value.length <= limit ? value : null
}

function preferencesPath(userData: string): string {
  return join(userData, PREFERENCES_FILE)
}

/**
 * Read them, or fall back — and say which.
 *
 * Clamped rather than rejected, unlike a persona. A size is one number with an
 * obvious nearest-valid answer, and refusing to start because somebody hand
 * edited it to 5000 would be worse than drawing her at the maximum — whereas a
 * half-valid persona really is a character nobody designed.
 *
 * A missing file is still silent, and everything else is now REPORTED. The
 * blanket catch treated "you have not customised anything" and "this file
 * cannot be read" identically, so a permissions problem on userData presented
 * as her size resetting itself on every launch, with nothing anywhere to
 * explain it — and the next save would write straight over the file nobody
 * could read. Failing to start is still not on the table; being quiet about it
 * is what changes.
 */
export function loadPreferences(userData: string): LoadedPreferences {
  const read = readJsonFile(preferencesPath(userData))
  if (!read.ok) {
    const problem =
      read.problem.kind === 'absent'
        ? null
        : read.problem.kind === 'malformed'
          ? `is not valid JSON: ${read.problem.detail}`
          : `could not be read: ${read.problem.detail}`
    return {
      preferences: DEFAULT_PREFERENCES,
      problem,
      ranBefore: read.problem.kind !== 'absent',
      // Absent is not unusable. There is nothing on disk to protect, and
      // treating a first launch as a corrupt file would quarantine a file that
      // does not exist on every fresh install.
      unusableFile: read.problem.kind !== 'absent',
    }
  }
  // A file that parses but is not an OBJECT is reported, not silently ignored.
  // `null`, `[]` and `42` are all valid JSON, and each fell through to `{}` --
  // so every preference reset itself on launch with nothing anywhere to say
  // why, which is the exact failure the `problem` field was added for.
  const usable = typeof read.value === 'object' && read.value !== null && !Array.isArray(read.value)
  const record = (usable ? read.value : {}) as Record<string, unknown>
  const keys = readShortcuts(record['shortcuts'])
  // This string is a LOG line, not a message for the window, so it is written
  // here in English like every other log in the app. `readShortcuts` reports
  // ids precisely so each caller can say it in its own register.
  const problems = keys.problems.map((id) => `${id} is not a usable key combination`)
  if (!usable) problems.push('is valid JSON but not an object')

  // The SAME check the save path runs, on the way in as well as on the way out.
  // `savePreferences` never writes a colliding pair, but a file written by an
  // older build or edited by hand can hold one -- and two actions on one chord
  // is the conflict the OS will not report. `globalShortcut.register()` accepts
  // the duplicate and the second handler simply never runs.
  let shortcuts = keys.shortcuts
  // UNTIL IT IS CLEAN, not once. Resetting the colliding action to its default
  // can collide again -- the default may be the very chord it clashed with, or
  // may clash with a third action -- and one pass left an action bound to a
  // key whose handler never runs, which is the failure this check exists for.
  //
  // Bounded by the number of actions, because each pass either fixes one or
  // finds nothing; the fallback below is what makes termination unconditional
  // rather than an argument.
  for (let pass = 0; pass < SHORTCUT_IDS.length; pass += 1) {
    const clash = collides(shortcuts)
    if (clash === null) break
    shortcuts = { ...shortcuts, [clash]: DEFAULT_SHORTCUTS[clash] }
    problems.push(`${clash} was set to a key another action already uses, and was reset`)
  }
  if (collides(shortcuts) !== null) {
    // No per-action repair reaches a clean set. The defaults are known unique,
    // so the whole block goes back rather than leaving one action unreachable.
    shortcuts = DEFAULT_SHORTCUTS
    problems.push('the shortcuts could not be made unique, so all of them were reset')
  }

  // An unrecognised source is REPORTED, not silently swapped. Falling back is
  // right -- it is one field with an obvious safe answer -- but doing it in
  // silence means somebody who typed `openai` into the file sees the pane
  // showing Codex and has nothing to read that explains it.
  const storedSource = record['credentialSource']
  if (storedSource !== undefined && !isCredentialSource(storedSource)) {
    // The fallback NAMED from the constant, not written out. "Codex" and
    // "shortcut" were typed here beside the values they describe, so changing
    // either default made this log line quietly false.
    problems.push(
      `the credential source was not recognised, so ${DEFAULT_CREDENTIAL_SOURCE} is being used`,
    )
  }

  // Absent is the ordinary upgrade case -- a file written before personas were
  // plural -- and means the built-in, quietly. A value of the wrong SHAPE is
  // reported, because it means something wrote this field and got it wrong;
  // an id that is merely unknown is not detectable here and is reported by
  // `activePersona`, which is the only thing holding the catalog.
  const storedActive = record['activePersonaId']
  const activeUsable =
    storedActive === undefined || storedActive === null || isPersonaId(storedActive)
  if (!activeUsable) {
    problems.push('the remembered persona was not a usable id, so the built-in is being used')
  }

  // Reported for the reason the credential source above is: coercing to the
  // safe value is right, doing it in silence is not. `anytime` is the looser of
  // the two, so a file that asked for it and quietly got `hotkey` would look
  // like the setting simply does not work.
  const storedDelegation = record['delegation']
  const storedTrigger =
    typeof storedDelegation === 'object' && storedDelegation !== null
      ? (storedDelegation as Record<string, unknown>)['trigger']
      : undefined
  if (storedTrigger !== undefined && !isDelegationTrigger(storedTrigger)) {
    problems.push(
      `the delegation trigger was not recognised, so ${DEFAULT_DELEGATION.trigger} is being used`,
    )
  }
  // Same shape as the trigger check above: present but unusable is reported,
  // absent is not. Without this, a hand-edited or corrupted duration silently
  // became ninety seconds and the user only learned about it by watching her
  // leave early.
  if (record['idleMs'] !== undefined && !isIdleChoice(record['idleMs'])) {
    problems.push(
      'the sleep-after setting was not one of the offered values, so it is back to its default',
    )
  }

  return {
    preferences: {
      sizePercent: clampSizePercent(record['sizePercent']),
      shortcuts,
      credentialSource: isCredentialSource(storedSource) ? storedSource : DEFAULT_CREDENTIAL_SOURCE,
      activePersonaId: isPersonaId(storedActive) ? storedActive : null,
      sound: readSound(record['sound']),
      // `null` is a REAL value here -- it is "never" -- so absence and never
      // are not the same thing and `?? DEFAULT` would have collapsed them.
      // `isIdleChoice` accepts `null` and rejects `undefined`, which is what
      // makes a file written before this existed fall back to ninety seconds
      // while a file that asked for never keeps it.
      //
      // A PRESENT-BUT-INVALID value is reported, like the delegation trigger
      // above and for the same reason: absence is the ordinary upgrade case and
      // deserves silence, while `idleMs: 120000` in the file is somebody's
      // intent that this build cannot honour. Silently substituting ninety
      // seconds makes corruption look identical to an upgrade and changes when
      // she leaves with nothing said about it.
      idleMs: isIdleChoice(record['idleMs']) ? record['idleMs'] : DEFAULT_PREFERENCES.idleMs,
      // Absent is the ordinary upgrade case -- a file written before M10 --
      // and yields the defaults without disturbing anything else in it.
      delegation: readDelegation(storedDelegation),
      // Empty means "use the built-in", the same way an empty delegation prompt
      // does: clearing a box is how somebody asks for the original back.
      spokenRules: boundedText(record['spokenRules'], PROMPT_LIMIT),
    },
    // A binding that no longer parses falls back to the default for that
    // action alone, and says so. Silent would mean the key simply changed one
    // morning with no explanation available anywhere.
    problem: problems.length === 0 ? null : problems.join('; '),
    // The file was read, so this installation has run before.
    ranBefore: true,
    // Only the whole-file failure counts. Everything reported above kept the
    // rest of the file, so overwriting it loses one already-invalid field --
    // which is what the fallback decided to do. `!usable` is the exception: the
    // JSON parsed and held nothing addressable, so every value below is a
    // default standing in for something nobody has read.
    unusableFile: !usable,
  }
}

/**
 * Move a file we could not use out of the way, so the next write cannot eat it.
 *
 * Called only when `unusableFile` says nothing in it survived. The alternative
 * -- refusing to write until somebody intervenes -- trades one silent data loss
 * for a mode where settings stop sticking and nothing on screen says why, which
 * is the worse of the two failures because it keeps happening.
 *
 * A RENAME, not a delete: the bytes are the user's, and "unreadable to this
 * build" is not the same as "worthless". A permissions problem on `userData`
 * looks identical from here to genuine corruption, and under that reading the
 * file is perfectly good and simply needs its mode fixed.
 *
 * Returns where it went, or null when it could not be moved -- which is
 * itself informative, because the most likely reason is the same permissions
 * problem that made it unreadable, and in that case nothing is going to
 * overwrite it either.
 */
export function quarantinePreferences(userData: string, now: Date = new Date()): string | null {
  // Colons are legal on this filesystem and hostile on others, and this name is
  // something a person has to type to recover the file.
  const stamp = now.toISOString().replace(/[:.]/g, '-')
  // A FREE name, not just a timestamped one. `rename` replaces its destination
  // silently, so two rescues that land on the same second -- a clock moved
  // backwards, a restart inside one second, a name that already exists -- would
  // have the second one destroy the first, which is the exact loss this
  // function exists to prevent, committed by the rescue itself.
  // LINK then UNLINK, not rename. `rename` replaces its destination silently,
  // and checking `existsSync` first is a check-then-act race rather than a
  // guarantee: anything creating that path in between -- a sync client, a
  // second instance, a backup tool -- is overwritten by the rescue.
  //
  // `link` fails with EEXIST if the destination is taken, atomically, which is
  // the property actually wanted. The source is unlinked only once the second
  // name is durable, so a failure between the two leaves the file under BOTH
  // names rather than neither.
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const suffix = attempt === 0 ? '' : `-${String(attempt)}`
    const aside = join(userData, `${PREFERENCES_FILE}.unusable-${stamp}${suffix}`)
    try {
      linkSync(preferencesPath(userData), aside)
    } catch (error: unknown) {
      // Taken: try the next name. Anything else -- no such source, no
      // permission, a filesystem without hard links -- is not retryable.
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue
      return renameFallback(userData, aside)
    }
    try {
      unlinkSync(preferencesPath(userData))
    } catch {
      // The copy is safe under its new name; the original could not be
      // removed. Reported as success because the bytes are preserved, which is
      // the whole job -- and the caller seals writing only when nothing was.
    }
    return aside
  }
  return null
}

/**
 * For filesystems that refuse `link` at all.
 *
 * Loses the atomic no-clobber guarantee, which is why it is the fallback and
 * not the first choice. Still better than not moving the file.
 */
function renameFallback(userData: string, aside: string): string | null {
  try {
    renameSync(preferencesPath(userData), aside)
    return aside
  } catch {
    return null
  }
}

/**
 * Write them atomically — see `json-file.ts` for why the rename matters.
 *
 * REFUSES a colliding pair rather than trusting callers not to build one.
 * `Preferences` cannot express "these three chords are distinct" in the type,
 * and the loader repairs a colliding file on the way in precisely because one
 * can exist -- so the only thing keeping this side honest was every caller
 * remembering. `globalShortcut.register()` accepts a duplicate happily and the
 * second handler simply never runs, which is a bug with no error attached.
 */
export function savePreferences(userData: string, preferences: Preferences): void {
  const clash = collides(preferences.shortcuts)
  if (clash !== null) {
    throw new Error(`refusing to write preferences: ${clash} shares a key with another action`)
  }
  writeJsonAtomically(preferencesPath(userData), preferences)
}
