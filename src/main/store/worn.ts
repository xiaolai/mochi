import { join } from 'node:path'
import { isPersonaId } from '@shared/persona'
import { isWebSearchMode, type WebSearchMode } from '@shared/delegation'
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
 * It was a read for as long as nothing in v2 could switch personas; the
 * settings window can, and the note left here said plainly that when a switcher
 * existed it should own this file rather than grow a second one beside it.
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
 * Which side of her the bubble is asked to sit on.
 *
 * In `preferences.json` beside the worn persona rather than in the persona
 * itself: it is a fact about this screen and this desk, not about who she is.
 * Wearing somebody else should not move her speech to the other side.
 */
export type BubbleSide = 'auto' | 'above' | 'below' | 'left' | 'right'

const SIDES: readonly string[] = ['auto', 'above', 'below', 'left', 'right']

export function readBubbleSide(userData: string): BubbleSide {
  const read = readBounded(join(userData, PREFERENCES))
  if (!read.ok) return 'auto'
  try {
    const value: unknown = JSON.parse(read.text)
    const found = (value as { bubbleSide?: unknown } | null)?.bubbleSide
    return typeof found === 'string' && SIDES.includes(found) ? (found as BubbleSide) : 'auto'
  } catch {
    // The reader for the persona id already says so on this file; a second
    // warning for the same broken JSON is noise.
    return 'auto'
  }
}

export function writeBubbleSide(userData: string, side: BubbleSide): void {
  if (!SIDES.includes(side)) throw new Error(`not a side the bubble can sit on: ${side}`)
  writeMerged(userData, { bubbleSide: side })
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
