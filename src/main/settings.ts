/**
 * What the settings window is allowed to change, decided here.
 *
 * The window draws; main decides. Every function below takes the values a page
 * sent and treats them as untrusted text — an id that becomes a path segment,
 * a voice that goes on the wire, a folder somebody wants opened. The renderer
 * never names a location, never picks which file a change lands in, and never
 * learns where anything lives beyond a string to display.
 *
 * ## Why this window exists at all
 *
 * Until now the only way to change who she is or what she looks like was to
 * hand-edit JSON under `Application Support`. The store has had a full write
 * path the whole time — `savePersonaTo`, carried over from v1 and tested —
 * with nothing reaching it. Its own comment says as much: *"it was unreachable
 * through the settings window"*. This is the window.
 */

import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { VOICE_NAMES, isPersonaId, type Persona, type VoiceName } from '@shared/persona'
import type {
  PersonaChange,
  Revealable,
  SettingsAvatar,
  SettingsCapability,
  SettingsPersona,
  SettingsWrite,
} from '@shared/ipc'
import type { Registry } from '@shared/capability/registry'
import { PERSONAS_DIR, type PersonaCatalog } from './store/personas'
import { AVATARS_DIR } from './store/avatars'

/**
 * Every avatar somebody could wear: the shipped one, plus every `.json` beside
 * it.
 *
 * Listed by NAME rather than by path, because the name is what a persona
 * stores and what `resolveAvatarById` turns back into a location. The renderer
 * receiving a path would be the renderer able to ask for one.
 *
 * Files are not opened here. A listing that parsed every avatar to check it
 * would make opening this window cost as much as loading them all, and a broken
 * one already reports itself through `problems` when it is actually worn.
 */
export function listAvatars(avatarsFolder: string): readonly SettingsAvatar[] {
  let names: string[] = []
  try {
    names = readdirSync(avatarsFolder, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => entry.name.slice(0, -'.json'.length))
      .filter((name) => isPersonaId(name))
      .sort()
  } catch {
    // A missing folder is ordinary on a fresh install: the built-in is the
    // answer, and `seedAvatars` will make the folder the next time it runs.
    names = []
  }
  // The built-in first, and as `null`: that is literally what a persona stores
  // for "the shipped face", so there is nothing to translate on the way back.
  return [{ id: null, builtIn: true }, ...names.map((id) => ({ id, builtIn: false }))]
}

/** The personas on the shelf, in a shape a page can draw and nothing more. */
export function listPersonas(catalog: PersonaCatalog): readonly SettingsPersona[] {
  return [...catalog.personas.values()]
    .map((persona) => ({
      id: persona.id,
      name: persona.name,
      voice: persona.voice,
      bubble: persona.bubble,
      avatarId: persona.avatarId,
      source: catalog.sources.get(persona.id) ?? null,
    }))
    .sort((a, b) => (a.name < b.name ? -1 : 1))
}

/**
 * What she can do.
 *
 * One list now, and every entry on it is on the wire. This used to have a
 * second half — capabilities found in the user's folder, listed with their
 * descriptions and marked refused, because the settings window was the one
 * place that attacker-controlled text was safe to show. Nothing loads from that
 * folder any more: a capability is a folder in the source that whoever built
 * this compiled, so every description here came from the same place the code
 * did.
 */
export function listCapabilities(registry: Registry): readonly SettingsCapability[] {
  return registry.tools.map((tool) => ({ name: tool.name, description: tool.description }))
}

function isVoice(value: unknown): value is VoiceName {
  return typeof value === 'string' && (VOICE_NAMES as readonly string[]).includes(value)
}

/**
 * Fold a page's request into the persona it names — field by field, refusing
 * anything unrecognised.
 *
 * Spreading the change over the persona would have been one line and would
 * have let a page set `id`, `version`, `instructions` or anything else the type
 * happens to allow today. `id` in particular keys her memory and her
 * transcripts: a change to it is not an edit, it is a new persona plus an
 * orphaned history.
 */
export function applyChange(
  persona: Persona,
  change: PersonaChange,
  knownAvatars: readonly string[],
): { readonly ok: true; readonly persona: Persona } | { readonly ok: false; readonly why: string } {
  let next = persona

  if (change.name !== undefined) {
    const name = change.name.trim()
    // A blank name is not a name, and it would leave the shelf with an entry
    // nobody can point at.
    if (name.length === 0) return { ok: false, why: 'A name cannot be empty.' }
    if (name.length > 64) return { ok: false, why: 'That name is too long.' }
    next = { ...next, name }
  }

  if (change.voice !== undefined) {
    if (!isVoice(change.voice))
      return { ok: false, why: `There is no voice called ${change.voice}.` }
    next = { ...next, voice: change.voice }
  }

  if (change.bubble !== undefined) {
    if (typeof change.bubble !== 'boolean') return { ok: false, why: 'That is not a yes or a no.' }
    next = { ...next, bubble: change.bubble }
  }

  if (change.avatarId !== undefined) {
    // Checked against what is actually on disk, not merely against the
    // character set. A persona naming an avatar that is not there falls back to
    // the built-in silently, which is the exact "the app ignored my file"
    // failure the avatar store exists to avoid.
    if (change.avatarId !== null && !knownAvatars.includes(change.avatarId)) {
      return { ok: false, why: `There is no avatar called ${change.avatarId}.` }
    }
    next = { ...next, avatarId: change.avatarId }
  }

  return { ok: true, persona: next }
}

/** Turn a named folder into a location. The ONLY place that mapping is made. */
export function folderFor(userData: string, what: Revealable): string {
  return what === 'avatars' ? join(userData, AVATARS_DIR) : join(userData, PERSONAS_DIR)
}

/** A refusal shaped like every other answer, so callers have one path. */
export function refuse(why: string): SettingsWrite {
  return { ok: false, why }
}
