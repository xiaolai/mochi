/**
 * What may be WRITTEN to a character, as opposed to what is listed for a view.
 *
 * Split from `settings.ts` on the seam the LOC config already names: deciding
 * whether a change is allowed is a different question from assembling the panes
 * that show it, and only one of the two is reached by a model-adjacent path.
 */
import { EMOTIONS, type Emotion } from '@shared/avatar'
import { type PersonaChange } from '@shared/ipc'
import {
  BUBBLE_SIDES,
  type BubbleSide,
  PERSONA_LIMITS,
  type Persona,
  VOICE_NAMES,
  type VoiceName,
} from '@shared/persona'
import { isPronoun } from '@shared/pronoun'
import { isThemeId } from '@shared/theme'
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
/** The band a person may choose from, matching what the face format refuses. */
const SIZE_BAND = { min: 50, max: 200 } as const

export function applyChange(
  persona: Persona,
  change: PersonaChange,
  knownAvatars: readonly string[],
): { readonly ok: true; readonly persona: Persona } | { readonly ok: false; readonly why: string } {
  let next = persona

  if (change.name !== undefined) {
    // Checked before it is trimmed, for the reason `applyLookup` gives: this is
    // whatever a page sent, and `.trim()` on an object throws out of an IPC
    // handler instead of answering.
    if (typeof change.name !== 'string') return { ok: false, why: 'That is not a name.' }
    const name = change.name.trim()
    // A blank name is not a name, and it would leave the shelf with an entry
    // nobody can point at.
    if (name.length === 0) return { ok: false, why: 'A name cannot be empty.' }
    // `PERSONA_LIMITS.name`, not a literal. This said 64 while the parser says
    // 60, so a name of 61 to 64 characters SAVED and then failed to load — the
    // character was accepted, written, and gone on the next launch. One number,
    // in the file that owns the format.
    if (name.length > PERSONA_LIMITS.name) return { ok: false, why: 'That name is too long.' }
    next = { ...next, name }
  }

  if (change.size !== undefined) {
    /*
      Null puts her back to the size her face declares.

      Refused rather than clamped when it is outside the band, for the reason
      `readSize` gives: a number somebody got wrong should be said, not quietly
      turned into a different number they did not choose.
    */
    if (change.size === null) {
      next = { ...next, size: null }
    } else if (
      typeof change.size !== 'number' ||
      !Number.isFinite(change.size) ||
      change.size < SIZE_BAND.min ||
      change.size > SIZE_BAND.max
    ) {
      return {
        ok: false,
        why: `Her size has to be between ${String(SIZE_BAND.min)} and ${String(SIZE_BAND.max)}.`,
      }
    } else {
      next = { ...next, size: change.size }
    }
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

  if (change.pronoun !== undefined) {
    // `isPronoun` rather than a list here: one answer to "which pronouns exist",
    // and it already refuses the retired `they` while `parsePersona` maps a
    // stored one forward. A window may not write what a file may still carry.
    if (!isPronoun(change.pronoun)) {
      return { ok: false, why: `There is no pronoun called ${String(change.pronoun)}.` }
    }
    next = { ...next, pronoun: change.pronoun }
  }

  if (change.addressUser !== undefined) {
    if (typeof change.addressUser !== 'string') return { ok: false, why: 'That is not a name.' }
    const called = change.addressUser.trim()
    // EMPTY IS ALLOWED, and is the default. "Nobody has said" is a real answer —
    // `addressLine` omits the instruction entirely rather than telling her to
    // address somebody as "you", which is a sentence that says nothing.
    if (called.length > PERSONA_LIMITS.addressUser) {
      return { ok: false, why: 'That name is too long.' }
    }
    next = { ...next, addressUser: called }
  }

  if (change.theme !== undefined) {
    if (!isThemeId(change.theme)) {
      return { ok: false, why: `There is no theme called ${String(change.theme)}.` }
    }
    // The named eight only. A custom hue is a `CustomTheme` object, and a window
    // that could post one would be a window that can set any colour on the
    // interface — `contrastFailures` refuses an unreadable one at load, but the
    // control offered here is the swatches, so this accepts what they can send.
    next = { ...next, theme: change.theme }
  }

  if (change.style !== undefined) {
    if (typeof change.style !== 'string') return { ok: false, why: 'That is not a prompt.' }
    // Empty is allowed since 2026-08-17: `CORE_PROMPT` says who she is, so an
    // empty box is somebody asking for the floor and nothing else.
    if (change.style.length > PERSONA_LIMITS.style) {
      return { ok: false, why: 'That prompt is too long.' }
    }
    next = { ...next, style: change.style }
  }

  for (const moment of ['greeting', 'farewell'] as const) {
    const said = change[moment]
    if (said === undefined) continue
    if (typeof said !== 'string') return { ok: false, why: 'That is not an instruction.' }
    const line = said.trim()
    // NOT empty: `parsePersona` refuses an empty instruction, so saving one here
    // would write a manifest this build cannot load — the failure that presents
    // as "the app ate my character" one launch later.
    if (line.length === 0) return { ok: false, why: 'That cannot be empty.' }
    /*
      `instruction`, not `name * 4`.

      240 against the format's own 300, arrived at by multiplying an unrelated
      limit by four. A 250-character instruction is valid in a manifest, loads
      fine, and could not be typed here — the control was stricter than the
      thing it writes to, which is the same class of mistake as being looser.
    */
    if (line.length > PERSONA_LIMITS.instruction) return { ok: false, why: 'That is too long.' }
    // `verbatim` is left alone. It is the other half of a `SpokenMoment` and no
    // control offers it; overwriting it from a field that cannot express it
    // would silently discard something a manifest author wrote.
    next = { ...next, [moment]: { ...next[moment], instruction: line } }
  }

  if (change.bubbleSide !== undefined) {
    /*
      Against the OFFERED list, and stored as given.

      There is no "unset" to protect here any more. `auto` is one of the five
      answers rather than the absence of one — see `Persona.bubbleSide` for why
      an invisible third state was worse than the app-level default it was
      guarding.
    */
    if (!(BUBBLE_SIDES as readonly string[]).includes(change.bubbleSide)) {
      return { ok: false, why: `The bubble cannot sit ${String(change.bubbleSide)}.` }
    }
    next = { ...next, bubbleSide: change.bubbleSide as BubbleSide }
  }

  if (change.faces !== undefined) {
    if (!Array.isArray(change.faces)) return { ok: false, why: 'That is not a list of faces.' }
    for (const one of change.faces) {
      if (typeof one !== 'string' || !(EMOTIONS as readonly string[]).includes(one)) {
        return { ok: false, why: `There is no expression called ${String(one)}.` }
      }
    }
    // In EMOTIONS order, for the reason `readFaces` gives: the tuple is the
    // contract the rig draws from, so two ways of saying the same set must
    // produce the same character.
    const chosen = new Set(change.faces as readonly Emotion[])
    next = { ...next, faces: EMOTIONS.filter((one) => chosen.has(one)) }
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
