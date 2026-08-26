import { greetingFor } from '@shared/instructions'
import { GRANT_SPECS, WITHHELD_GRANTS } from '@shared/grants'
import { TRANSCRIPTION_MODEL } from '@shared/transcription'
import type { SessionConfig } from '@shared/ipc'
import { activePersona, packageFolder } from '../store/personas'
import type { PersonaCatalog } from '../store/personas'
import { avatarsRoot, resolveFaceFor, seedAvatars } from '../store/avatars'
import { readGrants } from '../store/grants'
import { recall } from '../store/memory'
import { readPrompt } from '../store/prompt'
import { legacyGrants, readTranscriptionLanguages, readWornPersonaId } from '../store/worn'
import type { Transcripts } from '../store/transcripts'
import type { Conversation } from '../store/conversation'
import type { Registry } from '@shared/capability/registry'
import { whatSheMayDo } from '../what-she-may-do'

/**
 * Everything one session needs to know about who she is, assembled once.
 *
 * ## Why it is read fresh on every open, not cached
 *
 * A session is opened on every wake and again on every reconnect (§53), so
 * this is the natural moment to pick up a persona edit or a changed note — and
 * a cache here would mean her character updated only on restart. The files
 * under `Application Support` are the truth, and somebody may have edited one
 * by hand between two sessions.
 *
 * ## Why it left `index.ts`
 *
 * It is 103 lines and it is not wiring: it reads eight files, resolves a
 * persona, an avatar, a note and a permission set, and makes two decisions
 * that are genuinely main's — whether she may speak first, and which character
 * this session belongs to. The grill report named it as the extraction after
 * the three state clusters, and it was deliberately not taken by a mechanical
 * rewrite: that attempt mangled the multi-line `problems.note(...)` calls, and
 * a regex refactor that silently breaks a call is worse than leaving it.
 *
 * ## The two writes, named rather than hidden
 *
 * This is the one config read that CHANGES something. It sets which persona
 * the session belongs to, and it consumes the "this open is replacing a
 * session" flag. Both are passed in as functions rather than reached for, so
 * the write set is the interface rather than something to go looking for.
 */

export interface SessionConfigDeps {
  readonly userData: () => string
  /** The persona catalogue, memoised by the caller. */
  readonly catalogue: (userData: string) => PersonaCatalog
  /** The live conversation, opened if it is not already. */
  readonly conversation: () => Conversation
  /** WRITE: this session belongs to her now. */
  readonly nowWearing: (personaId: string) => void
  /**
   * WRITE: is this open replacing a session, rather than starting one?
   *
   * Consumed — it describes exactly one open. A greeting is for a wake and a
   * reconnect is not one; the renderer cannot tell them apart, because from
   * inside a session an open is an open.
   */
  readonly replacingASession: () => boolean
  /** Whether she is resting. */
  readonly resting: () => { readonly asleep: boolean }
  readonly registry: Registry
  /** The archive, or null when it is not open. */
  readonly transcripts: () => Transcripts | null
  readonly problemCount: () => number
  readonly note: (what: string, id: string | null, detail: string) => void
  readonly log: (line: string) => void
  readonly warn: (line: string) => void
}

export function sessionConfig(deps: SessionConfigDeps): SessionConfig {
  // CONSUMED here, whatever else this read goes on to decide. See
  // `reconnecting`: the flag describes exactly one open.
  const replacing = deps.replacingASession()
  const userData = deps.userData()
  // Whether this installation has run before decides whether a one-time
  // retention migration may run at all — a permissive default there would let a
  // hand-placed package choose somebody's retention on a first launch.
  const catalog = deps.catalogue(userData)
  for (const problem of catalog.problems) {
    deps.warn(`[persona] ${problem.kind}`)
    deps.note('persona', null, problem.kind)
  }
  // Which persona was last worn, remembered across restarts. Getting this wrong
  // is not cosmetic: the archive is scoped per persona, so defaulting to the
  // built-in on an installation whose history is under another name shows her
  // an empty memory and presents as "recall does not work".
  const resolved = activePersona(catalog, readWornPersonaId(userData))
  if (resolved.problem !== null) {
    deps.warn(`[persona] ${resolved.problem.kind}`)
    deps.note('persona', resolved.persona.id, resolved.problem.kind)
  }

  // A new session is a new conversation. Ending the previous one here rather
  // than on teardown covers the reconnect path too, which is the common case:
  // §53 measured a session lasting exactly an hour, so this happens hourly.
  deps.conversation().wear(resolved.persona.id)
  deps.nowWearing(resolved.persona.id)

  /**
   * Her face, from the folder the user can actually edit.
   *
   * `store/avatars.ts` and `parseFaceSpec` have existed and been tested since
   * before this session; nothing had ever called them, so every mochi rendered
   * from the built-in constant and "user-authored appearance" was a directory
   * with no reader. `seedAvatars` writes the folder, an example and a README on
   * first run, because a plugin format nobody can see the shape of is not one.
   */
  const avatars = avatarsRoot(userData)
  seedAvatars(avatars)
  const avatar = resolveFaceFor(
    avatars,
    packageFolder(resolved.persona.id, catalog.sources),
    resolved.persona.avatarId,
    resolved.persona.theme,
    resolved.persona.size,
  )
  // LOUD, and per file. An avatar that silently did not load presents as "the
  // app ignored my file", which the store's own comment calls the least
  // debuggable outcome this feature can have.
  for (const problem of avatar.problems) {
    deps.warn(`[avatar] ${problem.file}: ${problem.reason}`)
    deps.note('avatar', problem.file, problem.reason)
  }
  deps.log(`[avatar] ${avatar.source ?? 'built-in'}`)

  const note = recall(userData, resolved.persona.id)
  /**
   * What she may do — and whether that answer could be read at all.
   *
   * An unreadable `preferences.json` withholds everything, which is the right
   * direction for a permission and the wrong thing to do in silence: she would
   * simply stop hearing, and nothing on screen would say why. This is the one
   * place with a `problems` sink to hand, and it runs on every wake.
   */
  /*
    HER file, not the one global setting.

    This read was left on `readGrantsState` when permissions became per
    character, so the session she actually runs with carried whatever the old
    global blob said — a character whose `speak_first` had been withheld would
    still greet, and the tools offered reflected the wrong policy entirely. The
    per-character reader withholds on its own when a file cannot be read, so
    the fail-closed direction is the same; what changes is whose answer it is.
  */
  const grants = readGrants(userData, resolved.persona.id, legacyGrants(userData))
  if (grants === WITHHELD_GRANTS) {
    deps.warn(`[grants] ${resolved.persona.id}'s permissions could not be read; withholding`)
    deps.note(
      'settings',
      null,
      'her permissions file could not be read, so every permission is withheld until it can be ' +
        '— she cannot greet you, look anything up, or keep a note',
    )
  }
  const mayDo = whatSheMayDo(
    resolved.persona,
    note,
    grants,
    deps.registry.tools,
    readPrompt(userData),
    deps.transcripts()?.kept.collections(resolved.persona.id) ?? [],
  )
  deps.log(
    `[persona] ${resolved.persona.name} (${resolved.persona.id}), voice ${resolved.persona.voice}, note ${note.length} chars, bubble ${resolved.persona.bubble ? 'on' : 'off'}`,
  )
  const off = GRANT_SPECS.filter((spec) => !grants[spec.id]).map((spec) => spec.id)
  deps.log(`[grants] withheld: ${off.length === 0 ? 'none' : off.join(', ')}`)
  return {
    instructions: mayDo.instructions,
    voice: resolved.persona.voice,
    bubble: resolved.persona.bubble,
    /*
      Null rather than an empty instruction: the renderer must not ask for the
      turn at all, and "say nothing on waking" is a decision made here.

      TWO reasons for that null now, and they are not the same reason. The grant
      is a permission somebody withheld; rest is a state she is in. Only the
      first was consulted, so a session opened while she was resting greeted the
      room out loud — with her eyes shut, because `blink: 1` is held for the
      whole of `asleep`. That is reachable on every hourly reconnect (§53), and
      the fix belongs here rather than in the renderer: whether she may speak
      first is a decision, and decisions are main's.

      `setAsleep` now closes the session outright, so this is nearly unreachable
      — and it stays, because "nearly" is not a guarantee and because the two
      conditions are genuinely independent.
    */
    /*
      A GREETING IS FOR A WAKE, and a reconnect is not one.

      The renderer's `greeted` flag is per SESSION, and the hourly reconnect
      (§53) opens a new one -- so she greeted again, every hour, somebody she
      had been mid-conversation with all along. The renderer cannot tell the
      two apart: from inside a session an open is an open. Main can, because
      main is what sends `__mochi_reconnect__`.

      Decided here for the reason `heard.ts` gives for everything else on this
      boundary: whether she speaks first is a decision, and decisions are
      main's.
    */
    greeting:
      grants.speak_first && !deps.resting().asleep && !replacing
        ? greetingFor(resolved.persona)
        : null,
    face: avatar.face,
    problems: deps.problemCount(),
    bubbleSide: resolved.persona.bubbleSide,
    asleep: deps.resting().asleep,
    tools: mayDo.tools,
    /*
      Read here, on the same pass as everything else, because it is read from
      the same file at the same moment — the argument `bubbleSide` and `asleep`
      already make. An empty list means send no hint and let the model detect;
      see `readTranscriptionLanguages`.
    */
    transcription: {
      model: TRANSCRIPTION_MODEL,
      languages: readTranscriptionLanguages(userData),
    },
  }
}
