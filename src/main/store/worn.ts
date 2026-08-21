import { join } from 'node:path'
import { isPersonaId } from '@shared/persona'
import { isWebSearchMode, type WebSearchMode } from '@shared/delegation'
import { BUBBLE_SIDES, type BubbleSide } from '@shared/persona'
import { isHaloWhen, type HaloWhen } from '@shared/ipc'
import {
  DEFAULT_GRANTS,
  WITHHELD_GRANTS,
  isGrant,
  parseGrants,
  type Grant,
  type Grants,
} from '@shared/grants'
import { logBoundedRead, readBounded } from './read-bounded'
import { writeJsonAtomically } from './json-file'

/**
 * Which persona is being worn, remembered across restarts.
 *
 * ## One field, not a preferences store
 *
 * v1 kept this in `preferences.json` alongside window size, shortcuts, sound
 * settings, the delegation config and the model choice. That file's reader was
 * not migrated, because it pulls in five shared modules describing a settings
 * window that does not exist here yet — and none of that is needed to answer
 * "who is she today".
 *
 * So this reads **one key** out of that file, and now writes that one key back.
 * It was a read for as long as nothing in v2 could switch personas; the shelf
 * can, and the note left here said plainly that when a switcher existed it
 * should own this file rather than grow a second one beside it.
 *
 * Owning it means **read, change one key, write the whole object back**. v1's
 * file has window geometry, shortcuts and a model choice in it, and this
 * version understands none of those. Writing `{ activePersonaId }` alone would
 * silently discard somebody's settings for an application that may still be
 * installed — so unknown keys are carried through untouched, and a file that
 * cannot be read at all is replaced rather than merged into blindly.
 *
 * ## Why it matters more than it looks
 *
 * The archive is scoped per persona, which is a privacy property rather than an
 * accident: wearing A must not read B's conversations. So getting this wrong is
 * not cosmetic — the real installation on this machine has 21 conversations
 * under `loki`, and a v2 that defaults to the built-in `mochi` sees none of
 * them. That presents as "her memory does not work", and the cause is that she
 * is wearing the wrong face.
 */
const PREFERENCES = 'preferences.json'

export function readWornPersonaId(userData: string): string | null {
  const read = readBounded(join(userData, PREFERENCES))
  if (!read.ok) {
    // Absent is the ordinary answer on a fresh install — nobody has chosen, so
    // the caller falls back to the built-in. Anything else is worth a line.
    if (read.reason.kind !== 'absent') {
      console.warn(`[worn] ${logBoundedRead(read.reason)}`)
    }
    return null
  }

  let value: unknown
  try {
    value = JSON.parse(read.text)
  } catch (error: unknown) {
    console.warn('[worn] preferences.json is not valid JSON:', error)
    return null
  }

  const found = (value as { activePersonaId?: unknown } | null)?.activePersonaId
  // Validated rather than trusted. It becomes a lookup key and, downstream, a
  // path segment — the same reasoning `personas.ts` applies to a loose file's
  // stem, at the one line where a name turns into a location.
  if (!isPersonaId(found)) {
    if (found !== undefined) console.warn('[worn] activePersonaId is not a usable id')
    return null
  }
  return found
}

/**
 * Remember who is being worn, without discarding what else is in the file.
 *
 * Atomic, because this is read on every launch and a half-written
 * `preferences.json` presents as her forgetting who she is — and, since the
 * archive is scoped per persona, as her forgetting the person too.
 */
export function writeWornPersonaId(userData: string, id: string): void {
  if (!isPersonaId(id)) throw new Error(`refusing to remember an unusable persona id: ${id}`)
  writeMerged(userData, { activePersonaId: id })
}

/**
 * Change some keys and keep the rest.
 *
 * Read, change, write the whole object back — see the note at the top of this
 * file. Two callers now, which is why it is a function: a second one that
 * wrote only its own key would silently drop the first one's.
 */
function writeMerged(userData: string, changes: Record<string, unknown>): void {
  // Everything already there, kept. See the note above: this file is older than
  // this application and holds keys it does not understand.
  let existing: Record<string, unknown> = {}
  const read = readBounded(join(userData, PREFERENCES))
  if (read.ok) {
    try {
      const value: unknown = JSON.parse(read.text)
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        existing = value as Record<string, unknown>
      }
    } catch {
      // Unreadable JSON is REPLACED, not merged into. There is nothing to
      // preserve in a file nothing can parse, and refusing to write would
      // leave the switch silently ineffective.
      console.warn('[worn] preferences.json is not valid JSON; replacing it')
    }
  } else if (read.reason.kind !== 'absent') {
    console.warn(`[worn] ${logBoundedRead(read.reason)}; replacing it`)
  }

  writeJsonAtomically(join(userData, PREFERENCES), { ...existing, ...changes })
}

/**
 * Whether she is asleep, and whether she is hidden — two independent things.
 *
 * Asleep is about her ATTENTION: the microphone is off and she is not
 * listening. Hidden is about the SCREEN: she is not drawn, and she is still
 * listening. They are separate because the reasons are separate — somebody
 * walked in, versus you need that corner of the display — and collapsing them
 * would mean one of the two answers is always wrong.
 *
 * Both are remembered, like everything else in this file. "As you left her" is
 * the rule the worn persona and the bubble's side already follow, and a state
 * that quietly reset on relaunch would make quitting a way to change it.
 */
export interface Resting {
  readonly asleep: boolean
  readonly hidden: boolean
}

export function readResting(userData: string): Resting {
  const read = readBounded(join(userData, PREFERENCES))
  if (!read.ok) return { asleep: false, hidden: false }
  try {
    const value: unknown = JSON.parse(read.text)
    const found = value as { asleep?: unknown; hidden?: unknown } | null
    return {
      // Anything that is not literally `true` means awake and visible. That is
      // the direction a wrong guess should fail in: a companion that is present
      // and listening can be told to stop, and one that is neither cannot be
      // told anything.
      asleep: found?.asleep === true,
      hidden: found?.hidden === true,
    }
  } catch {
    return { asleep: false, hidden: false }
  }
}

export function writeResting(userData: string, changes: Partial<Resting>): void {
  writeMerged(userData, { ...changes })
}

/**
 * What she may do while nobody is watching — 5b's four standing grants.
 *
 * In `preferences.json` with everything else that is app-level rather than in a
 * file of its own, for the reason this module's header gives: a second writer
 * beside it would silently drop the first one's keys. `@shared/grants` owns
 * what a grant IS and what turning one off means; this owns where it lives.
 */
/**
 * What is stored, and whether it could be read at all.
 *
 * ONE reader for two questions, because the second decides what the first
 * means. `readGrants` needs it to answer safely; `writeGrant` needs it to
 * refuse — writing over a file it could not read would turn one transient
 * failure into four permanent refusals nobody made. Two separate checks would
 * be two chances to get "was this readable" subtly differently.
 */
export function readGrantsState(userData: string): {
  readonly readable: boolean
  readonly grants: Grants
} {
  const read = readBounded(join(userData, PREFERENCES))
  if (!read.ok) {
    // ABSENT is the only answer that means "nobody has chosen". A file that is
    // there but oversized, symlinked away, or unreadable for permissions is a
    // stored answer this process cannot see — and every other reader in this
    // file falls back permissively because none of them is a PERMISSION. These
    // are. `hasPolicy` draws the same line for retention, and for the same
    // reason: resolving an unreadable answer as "allowed" is the one direction
    // that lets her do something somebody may have said she may not.
    if (read.reason.kind === 'absent') return { readable: true, grants: DEFAULT_GRANTS }
    console.warn(`[grants] ${logBoundedRead(read.reason)}; withholding everything`)
    return { readable: false, grants: WITHHELD_GRANTS }
  }
  try {
    const value: unknown = JSON.parse(read.text)
    // The ROOT, checked as well as the key. `null`, `[]` and `"broken"` are all
    // valid JSON whose `.grants` reads as `undefined` — which `parseGrants`
    // rightly calls absent, and absent means allowed. So a preferences file
    // replaced by any of those re-enabled every permission, through the one
    // path that had been made to fail closed twice already.
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      console.warn('[grants] preferences.json does not hold an object; withholding everything')
      return { readable: false, grants: WITHHELD_GRANTS }
    }
    return { readable: true, grants: parseGrants((value as { grants?: unknown }).grants) }
  } catch {
    // A file that exists and cannot be PARSED is the same case: somebody's
    // answers are in there and nothing here can read them.
    console.warn('[grants] preferences.json is not valid JSON; withholding everything')
    return { readable: false, grants: WITHHELD_GRANTS }
  }
}

export function readGrants(userData: string): Grants {
  return readGrantsState(userData).grants
}

/**
 * Allow one, or take it away. One at a time, like every other control here.
 *
 * The WHOLE set is written back rather than the single key, so a file holding a
 * misspelt or half-written `grants` object is replaced by one that says exactly
 * what is in force.
 *
 * REFUSED outright when the file could not be read. `readGrants` answers "all
 * withheld" for one of those, and writing that back would put four refusals
 * nobody made on disk — permanently, over a failure that may have been a
 * moment's. The caller reports it and the file is left for somebody to look at,
 * which is `remember_this`'s rule for an unreadable note arriving here.
 */
export function writeGrant(userData: string, grant: Grant, allowed: boolean): void {
  if (!isGrant(grant)) throw new Error(`not a grant: ${JSON.stringify(grant)}`)
  const held = readGrantsState(userData)
  if (!held.readable) {
    throw new Error('refusing to rewrite permissions over a preferences file that cannot be read')
  }
  writeMerged(userData, { grants: { ...held.grants, [grant]: allowed } })
}

/**
 * The one directory she may read, and the boundary the guard walks up to.
 *
 * Default: a folder this application owns, inside its own data directory. It
 * exists to be dropped into — that is the whole interaction — and it is the
 * only default that is safe without asking, because nothing is in it that
 * somebody did not put there on purpose.
 *
 * Pointing her at a real project is a deliberate act and is allowed. The guard
 * then walks only that directory rather than up to the home folder: refusing to
 * work because somebody keeps an `AGENTS.md` two levels up in their own
 * checkout would be punishing them for a file that is none of our business, and
 * `guardWorkspace` throws if `stopAt` is not an ancestor.
 */
export const WORKSPACE_DIR = 'workspace'

export function readWorkspace(userData: string): string {
  const fallback = join(userData, WORKSPACE_DIR)
  const read = readBounded(join(userData, PREFERENCES))
  if (!read.ok) return fallback
  try {
    const value: unknown = JSON.parse(read.text)
    const found = (value as { workspace?: unknown } | null)?.workspace
    // Absolute only. A relative path would be resolved against whatever the
    // process happens to consider its working directory, which for a packaged
    // app is `/`.
    return typeof found === 'string' && found.startsWith('/') ? found : fallback
  } catch {
    return fallback
  }
}

export function writeWorkspace(userData: string, path: string): void {
  if (!path.startsWith('/')) throw new Error(`a workspace must be an absolute path: ${path}`)
  writeMerged(userData, { workspace: path })
}

/**
 * Where the guard stops walking up.
 *
 * Our own data directory when the workspace is inside it — that is the boundary
 * v1 chose and the reasoning holds: above it is somebody's home. For a
 * workspace anywhere else, the directory itself, because there is no ancestor
 * we have any business scanning.
 */
export function guardStopAt(userData: string, workspace: string): string {
  return workspace.startsWith(join(userData, WORKSPACE_DIR)) ? userData : workspace
}

/**
 * Whether she may search the web when a question needs current information.
 *
 * The values are Codex's own — see `WEB_SEARCH_MODES`. The default is `follow`,
 * which sends nothing and leaves whatever the user configured machine-wide in
 * charge. Overriding somebody's own setting because we did not think to ask is
 * a decision made out of not having looked.
 */
export function readWebSearch(userData: string): WebSearchMode {
  const read = readBounded(join(userData, PREFERENCES))
  if (!read.ok) return 'follow'
  try {
    const value: unknown = JSON.parse(read.text)
    const found = (value as { webSearch?: unknown } | null)?.webSearch
    return isWebSearchMode(found) ? found : 'follow'
  } catch {
    return 'follow'
  }
}

export function writeWebSearch(userData: string, mode: WebSearchMode): void {
  if (!isWebSearchMode(mode)) throw new Error(`not a web search mode: ${String(mode)}`)
  writeMerged(userData, { webSearch: mode })
}

/**
 * The Codex profile a lookup runs under, or null for none.
 *
 * `codex exec -p <name>` layers `$CODEX_HOME/<name>.config.toml` on top of the
 * user's base config, which is how somebody configures a lookup without us
 * re-exposing Codex's flags one at a time. The file is theirs to edit; see
 * `ask-workspace/profile.ts` for the one we seed.
 *
 * ## The name becomes a FILENAME, so it is checked like one
 *
 * Codex resolves it inside `$CODEX_HOME`, and a name with a slash or a `..` in
 * it would reach out of that directory — the same reason `memoryPath` refuses
 * an id that has not passed the persona grammar. The character set here is the
 * intersection of "what makes a sensible profile name" and "what cannot be
 * confused with a path".
 */
const PROFILE = /^[a-z][a-z0-9-]{0,63}$/

export function isProfileName(value: unknown): value is string {
  return typeof value === 'string' && PROFILE.test(value)
}

export function readProfile(userData: string): string | null {
  const read = readBounded(join(userData, PREFERENCES))
  if (!read.ok) return null
  try {
    const value: unknown = JSON.parse(read.text)
    const found = (value as { codexProfile?: unknown } | null)?.codexProfile
    // Checked on the way OUT as well as in. This file is hand-editable, and a
    // name that failed the grammar would otherwise become an argument.
    return isProfileName(found) ? found : null
  } catch {
    return null
  }
}

export function writeProfile(userData: string, name: string | null): void {
  if (name !== null && !isProfileName(name)) {
    throw new Error(`not a usable profile name: ${JSON.stringify(name)}`)
  }
  writeMerged(userData, { codexProfile: name })
}

/**
 * How long she stays connected with nothing said, in minutes. `0` is never.
 *
 * ## Why this exists at all
 *
 * A session used to be opened on launch and kept for the life of the process:
 * `asleep` muted the microphone track and left the peer, the data channel and
 * the hourly reconnect (§53) running. So a machine left on overnight opened a
 * session an hour, every hour, into an empty room — and greeted it each time.
 *
 * The remedy is that resting means no session, and this is what decides when
 * resting happens on its own.
 *
 * ## Minutes, and a ceiling
 *
 * Minutes because that is the unit somebody thinks in for this, and a ceiling
 * because a session cannot outlive its own hour anyway — a value above 60 would
 * be a number that describes nothing, since the reconnect would have fired
 * first. `0` is the opt-out and is the one value that is not a duration, which
 * is why it is checked separately rather than clamped into the range.
 */
export const SLEEP_AFTER_MAX = 60
export const DEFAULT_SLEEP_AFTER_MINUTES = 15

export function isSleepAfterMinutes(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= SLEEP_AFTER_MAX
  )
}

export function readSleepAfterMinutes(userData: string): number {
  const read = readBounded(join(userData, PREFERENCES))
  if (!read.ok) return DEFAULT_SLEEP_AFTER_MINUTES
  try {
    const value: unknown = JSON.parse(read.text)
    const found = (value as { sleepAfterMinutes?: unknown } | null)?.sleepAfterMinutes
    return isSleepAfterMinutes(found) ? found : DEFAULT_SLEEP_AFTER_MINUTES
  } catch {
    return DEFAULT_SLEEP_AFTER_MINUTES
  }
}

export function writeSleepAfterMinutes(userData: string, minutes: number): void {
  if (!isSleepAfterMinutes(minutes)) {
    throw new Error(`not a usable idle timeout: ${JSON.stringify(minutes)}`)
  }
  writeMerged(userData, { sleepAfterMinutes: minutes })
}

/**
 * When the halo over her head is drawn — three answers, where there were two.
 *
 * ## Why `never` is offerable now, and was not before
 *
 * `halo.ts` exists because an open microphone with nothing on screen saying so
 * is the worst thing this application can do. While the halo was the only
 * surface carrying that fact, a switch that could turn it off was a switch that
 * handed somebody a way to make the worst thing happen — so the old preference
 * was deliberately narrower than "show the halo" and governed the resting
 * hairline alone.
 *
 * What changed is that the promise moved somewhere it cannot be switched off.
 * The tray item marks itself while the microphone is live: it exists whenever
 * the app runs, it is the only way to quit, and it cannot be hidden or dragged
 * off a screen. So the halo is a statement about HER APPEARANCE now rather than
 * the app's one honest surface, and all three answers are ordinary preferences.
 *
 * That was not merely a missing feature. `setHidden` hides her window without
 * touching the session, and its own header says hidden and asleep are
 * deliberately different things — so *hidden while awake* was already a live
 * microphone with nothing on screen saying so, reachable from the menu bar in
 * one click. The tray mark closes that too, and it is why it had to be the tray
 * rather than a second thing drawn on her.
 *
 * ## The three
 *
 * - `always` — the open ring and the resting hairline, which is the default.
 * - `listening` — the open ring only. The hairline is the one people find
 *   noisy, and it is the one that promises nothing.
 * - `never` — nothing on her at all.
 *
 * A preference rather than a persona field: it is a fact about this screen and
 * this desk, not about who is being worn. The bubble's side once made the same
 * argument from here and lost it — that one turned out to be about her, and
 * moved to `Persona.bubbleSide`.
 */
export function readHaloWhen(userData: string): HaloWhen {
  const read = readBounded(join(userData, PREFERENCES))
  if (!read.ok) return 'always'
  try {
    const value: unknown = JSON.parse(read.text)
    const found = (value as { haloWhen?: unknown } | null)?.haloWhen
    if (isHaloWhen(found)) return found
    /*
      The OLD key, honoured rather than ignored.

      This was `haloAtRest: boolean`, and `false` meant exactly what
      `'listening'` means now. A reader that only knew the new key would answer
      `always` for every install that had switched the hairline off — a
      preference somebody set, silently reverting on the launch after an update,
      which is the failure `readResting`'s header names for rest and hiding.

      Read-only: nothing writes `haloAtRest` any more, so the old key is
      migrated on the next write of the new one and the file converges without a
      migration step that has to run exactly once.
    */
    const old = (value as { haloAtRest?: unknown } | null)?.haloAtRest
    if (old === false) return 'listening'
    return 'always'
  } catch {
    // A file that cannot be read fails toward the indicator existing.
    return 'always'
  }
}

export function writeHaloWhen(userData: string, when: HaloWhen): void {
  if (!isHaloWhen(when)) throw new Error(`not a time the halo can be drawn: ${when}`)
  writeMerged(userData, { haloWhen: when })
}

/**
 * The side her words used to sit on, app-level, kept only to be MIGRATED.
 *
 * This was the setting. It is a persona field now — `Persona.bubbleSide` says
 * why — and nothing writes this key any more. It is read once, by
 * `migrateBubbleSide`, so that a choice somebody made before the move is
 * carried onto their characters rather than silently reset.
 */
export function readLegacyBubbleSide(userData: string): BubbleSide {
  const read = readBounded(join(userData, PREFERENCES))
  if (!read.ok) return 'auto'
  try {
    const value: unknown = JSON.parse(read.text)
    const found = (value as { bubbleSide?: unknown } | null)?.bubbleSide
    return typeof found === 'string' && (BUBBLE_SIDES as readonly string[]).includes(found)
      ? (found as BubbleSide)
      : 'auto'
  } catch {
    return 'auto'
  }
}

/**
 * Whether that carry-over has already happened. Marked BEFORE it is done.
 *
 * ## Why the order is the opposite of `retentionMigrated`'s
 *
 * That marker may fail to write, and says so: its pass "only seeds where there
 * is no setting already", so running twice is harmless and losing the marker
 * costs nothing. This pass has no such luxury. `bubbleSide` defaults to `auto`,
 * and "nobody was ever asked" is deliberately indistinguishable from "somebody
 * chose auto" — that ambiguity is the whole reason the field has no null.
 *
 * So a re-run cannot tell a fresh persona from one whose owner has since
 * chosen. Marking first makes the failure mode *the migration is skipped*,
 * which costs one trip to a dropdown and is visible. Marking last would make it
 * *a choice is silently reverted*, which is neither.
 */
export function bubbleSideMigrated(userData: string): boolean {
  const read = readBounded(join(userData, PREFERENCES))
  if (!read.ok) return false
  try {
    const value: unknown = JSON.parse(read.text)
    return (value as { bubbleSideMigrated?: unknown } | null)?.bubbleSideMigrated === true
  } catch {
    // Unreadable is not "not yet". A pass that cannot be gated must not run.
    return true
  }
}

export function markBubbleSideMigrated(userData: string): void {
  writeMerged(userData, { bubbleSideMigrated: true })
}

/**
 * Whether the little speech-bubble control appears at her shoulder on hover.
 *
 * ## What turning it off actually costs
 *
 * Nothing that is only reachable through it. Her conversations are also one
 * click away inside the bubble whenever she has said something, and the tray
 * menu opens the same window from the menu bar — so this is a control with two
 * other doors, which is what makes it safe to offer as a preference at all. The
 * halo switch next to it is deliberately narrower for the opposite reason.
 *
 * What it does cost is the unread-problems badge on ITS copy of the control:
 * with the chip off, a persona file that was rejected is announced by the
 * bubble's own badge instead, and if the bubble is off as well the problems
 * strip in the shelf is what is left. Said here rather than discovered.
 *
 * A preference rather than a persona field, for `readHaloAtRest`'s reason: it
 * is a fact about this screen and this desk, not about who is being worn.
 */
export function readShoulderChip(userData: string): boolean {
  const read = readBounded(join(userData, PREFERENCES))
  if (!read.ok) return true
  try {
    const value: unknown = JSON.parse(read.text)
    const found = (value as { shoulderChip?: unknown } | null)?.shoulderChip
    // Shown unless somebody has said otherwise, and a file that cannot be read
    // fails toward the control existing — the same direction as the halo, and
    // for the plainer reason that a missing button looks like a broken app.
    return found !== false
  } catch {
    return true
  }
}

export function writeShoulderChip(userData: string, shown: boolean): void {
  writeMerged(userData, { shoulderChip: shown })
}

/**
 * Where she was left standing, and how big the shelf was left.
 *
 * ## Why a position is stored at all
 *
 * `createCompanionWindow` put her in the bottom right on every launch and
 * nothing remembered otherwise, so dragging her somewhere was undone by
 * quitting. That is the same failure `readResting`'s header names for rest and
 * hiding: a state that quietly resets on relaunch makes quitting a way to
 * change it.
 *
 * ## Stored raw, VALIDATED ON READ
 *
 * Not clamped on the way in. The display it was written against may not exist
 * the next time this runs — an external monitor is unplugged, a resolution
 * changes — so a value that was correct when written can be off every screen
 * when read. Clamping at write time would bake in an answer computed against a
 * layout that is gone; the caller clamps against the displays that exist now,
 * with `containToWorkArea`, which already picks the display nearest HER rather
 * than nearest her window.
 *
 * ## Her SIZE travels with her position, and it has to
 *
 * What is stored for her is where her BODY is on screen, not where her window
 * is — her window is resized on every bubble and `originHolding` exists so that
 * those resizes do not move her, which makes the window's origin a number that
 * means something different depending on whether she was speaking when it was
 * written.
 *
 * Turning a body position back into a window origin needs the body's SIZE,
 * because the pad above her is `FEET_FROM_TOP - height`. Restoring against a
 * nominal 94×73 would land a 200% character 73px out — not a drift, a constant
 * offset, and exactly the kind of "nobody will notice" that somebody notices on
 * the one setup where it is large. So the size is written down beside the
 * position, and a file without one falls back to the nominal.
 */
export interface Place {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

function readPlaceKey(userData: string, key: 'herPlace' | 'shelfPlace'): Place | null {
  const read = readBounded(join(userData, PREFERENCES))
  if (!read.ok) return null
  try {
    const value: unknown = JSON.parse(read.text)
    const found = (value as Record<string, unknown> | null)?.[key]
    if (typeof found !== 'object' || found === null) return null
    const { x, y, width, height } = found as Record<string, unknown>
    // Finite integers only. `setPosition` throws on a fractional value, and a
    // NaN out of a hand-edited file would put her at an origin no display has.
    if (!Number.isInteger(x) || !Number.isInteger(y)) return null
    // A zero or negative size is not a small window, it is an unusable one —
    // and as a BODY it would make the pad arithmetic above her meaningless.
    if (!Number.isInteger(width) || !Number.isInteger(height)) return null
    if ((width as number) < 1 || (height as number) < 1) return null
    return {
      x: x as number,
      y: y as number,
      width: width as number,
      height: height as number,
    }
  } catch {
    return null
  }
}

function writePlaceKey(userData: string, key: 'herPlace' | 'shelfPlace', place: Place): void {
  /*
    Refused rather than rounded, and THROWN rather than returned.

    A fractional or absent value here is a caller bug, and silently storing a
    repaired version of it would leave the next launch restoring a position
    nothing ever measured. But this refused by returning, which is the same
    failure one level up: "she does not remember where she was put" is exactly
    what a write that quietly did nothing looks like, and there was nothing
    anywhere to distinguish it from a write that never ran.

    Both callers already treat a throw as reportable — `companion:drop` logs it
    and `remember` in `window.ts` does the same — so this turns a silent no-op
    into a line somebody can find.
  */
  if (!Number.isInteger(place.x) || !Number.isInteger(place.y)) {
    throw new Error(`refusing a ${key} that is not whole pixels: ${JSON.stringify(place)}`)
  }
  if (!Number.isInteger(place.width) || !Number.isInteger(place.height)) {
    throw new Error(`refusing a ${key} with an unusable size: ${JSON.stringify(place)}`)
  }
  if (place.width < 1 || place.height < 1) {
    throw new Error(`refusing a ${key} with a zero or negative size: ${JSON.stringify(place)}`)
  }
  writeMerged(userData, {
    [key]: { x: place.x, y: place.y, width: place.width, height: place.height },
  })
}

export function readHerPlace(userData: string): Place | null {
  return readPlaceKey(userData, 'herPlace')
}

export function writeHerPlace(userData: string, place: Place): void {
  writePlaceKey(userData, 'herPlace', place)
}

/** The shelf's last bounds — a window position, since it has no body inside it. */
export function readShelfPlace(userData: string): Place | null {
  return readPlaceKey(userData, 'shelfPlace')
}

export function writeShelfPlace(userData: string, place: Place): void {
  writePlaceKey(userData, 'shelfPlace', place)
}
