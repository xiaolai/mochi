import { greetingFor } from '@shared/instructions'
import { GRANT_SPECS, offeredGrants, WITHHELD_GRANTS, type Grant } from '@shared/grants'
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
import type { WireTool } from '@shared/capability/registry'
import type { Prompts } from '@shared/grants'
import { whatSheMayDo } from '../what-she-may-do'
import { briefFor, resumeFor } from '../memory/brief'
import type { Persona } from '@shared/persona'

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
   * WRITE: the briefing this session opened with.
   *
   * Reported rather than returned, because the renderer has no use for it and
   * `SessionConfig` crosses IPC. Main needs it: a grant change rebuilds the
   * whole instruction block and the renderer replaces what it holds, so a
   * rebuild without this deletes the wake summary — or tells her to stop
   * carrying on a conversation she is in the middle of.
   */
  readonly briefedWith: (text: string) => void
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
  /**
   * The tools she is offered, already wearing any rewritten descriptions.
   *
   * A THUNK over the registry it used to hold, for the reason every other
   * reader in `index.ts` is one: a tool description is editable, and reading
   * the list once at wiring time would make an edit land on the next relaunch
   * instead of the next wake. `toolsNow` is the single place that list is
   * built; this dep exists so nothing here can reach past it to the shipped
   * text.
   */
  readonly tools: () => readonly WireTool[]
  /**
   * Grants whose capability cannot be performed YET, whatever was stored.
   *
   * Empty in the ordinary case. `recall_codex` is in it while its index is
   * still building — see `offeredGrants`, which explains why this is applied
   * over consent rather than written into it.
   */
  readonly unready: () => ReadonlySet<Grant>
  /**
   * What each catalogued prompt currently says. See `@shared/prompts`.
   *
   * A THUNK, for `tools`' reason: these are editable and read from disk, so
   * capturing them at wiring time would make an edit land on the next relaunch
   * rather than on the next wake.
   */
  readonly prompts: () => Prompts
  /** The archive, or null when it is not open. */
  readonly transcripts: () => Transcripts | null
  readonly problemCount: () => number
  /** Injected so the brief's "most recently…" is a value a test can fix. */
  readonly now: () => number
  readonly note: (what: string, id: string | null, detail: string) => void
  readonly log: (line: string) => void
  readonly warn: (line: string) => void
}

/**
 * What she is told about the conversation this session is joining.
 *
 * ## Two kinds, and sending the wrong one is worse than sending neither
 *
 * `brief.ts` argues it at length: a WAKE gets a dated summary of a conversation
 * that ended, framed as background and explicitly not to be resumed. A
 * RECONNECT gets the opposite instruction, because nothing ended — a connection
 * dropped, §53 measured that it does so on the hour, and from the user's side
 * she simply has to keep up.
 *
 * `replacing` is the one signal that tells them apart, and main is the only
 * process that has it: from inside a session an open is an open.
 *
 * ## Why this had no caller until now
 *
 * `briefFor` and `resumeFor` were written, tested, and reached from nothing —
 * found by widening `store/wiring.test.ts` to `src/main/memory` after the same
 * thing turned out to be true of the summariser. The cost of the absence was
 * not cosmetic: without `resumeFor`, an hour into a conversation the session is
 * replaced and she has no record of any of it, because a new Realtime session
 * starts with an empty context. She kept talking and had forgotten the morning.
 *
 * ## Empty is a real answer
 *
 * No archive, no prior conversation, or a reconnect with nothing said yet — all
 * of them return `''`, and `instructionsFor` omits the section rather than
 * printing a heading over nothing.
 */
function briefing(
  deps: SessionConfigDeps,
  personaId: string,
  /**
   * The conversation that was live BEFORE `wear()` ran, or null.
   *
   * Passed in rather than asked for, and that is the whole of this parameter.
   * `wear()` calls `end()`, which sets `live = null` — so by the time this
   * function runs, `liveToken()` answers null on every path and `resumeFor`
   * had no production caller at all.
   *
   * It shipped that way and the test passed, because the test's stub returned
   * a token unconditionally: a stub that cannot reach the broken state cannot
   * fail on it. The stub now goes null on `wear`, which is what the real one
   * does.
   *
   * The TURNS survive `end()` — it writes `ended_at` and nothing else — so the
   * token is all that has to be carried across.
   */
  liveBefore: string | null,
): string {
  const store = deps.transcripts()
  if (store === null) return ''
  try {
    /*
      A LIVE CONVERSATION decides this, not the `replacing` flag.

      They agree on the two paths anybody thinks about — sleep ends the
      conversation, so a wake has none; an hourly reconnect leaves one open.
      They disagree on a third: `did-finish-load` fires again when the renderer
      RELOADS, and nothing sets `replacing` for that. She would have been told
      not to resume a conversation that was still going on.

      An open conversation is also the more direct question. "Is there
      something to carry on from" is what these two prompts differ about, and
      the flag is a proxy for it.
    */
    if (liveBefore !== null) {
      return resumeFor(store.turns(personaId, liveBefore))
    }
    const past = store.sessions(personaId)
    const last = past[0]
    return briefFor({
      sessions: past.length,
      lastAt: last?.endedAt ?? last?.startedAt ?? null,
      tail: last === undefined ? [] : store.turns(personaId, last.token),
      now: deps.now(),
    })
  } catch (error: unknown) {
    // Never a reason to refuse her a session. A brief that cannot be built is a
    // session that opens without one, which is exactly the state every session
    // was in before this was wired.
    deps.warn(`[brief] could not be built: ${String(error)}`)
    return ''
  }
}

/**
 * Say what could not be loaded, per package.
 *
 * NAMED, where the problem names something. `retention-unsupported` refuses a
 * whole character, and reporting it as a bare kind against a null subject
 * leaves somebody with a character that vanished and no way to tell which
 * package did it. Every kind that carries an id or a source says so.
 *
 * Its own function because `sessionConfig` is about assembling one session, and
 * this is about the shelf it was assembled from — a loop over problems that
 * reads nothing else in that function and that nothing else there reads.
 */
function reportCatalogue(catalog: PersonaCatalog, deps: SessionConfigDeps): void {
  for (const problem of catalog.problems) {
    const about = 'id' in problem ? problem.id : 'source' in problem ? problem.source : null
    const detail = about === null ? problem.kind : `${problem.kind}: ${about}`
    deps.warn(`[persona] ${detail}`)
    deps.note('persona', about, detail)
  }
}

/**
 * The face she is drawn with, and a line for every file that could not be read.
 *
 * LOUD, and per file. An avatar that silently did not load presents as "the app
 * ignored my file", which the store's own comment calls the least debuggable
 * outcome this feature can have.
 *
 * Its own function for the reason `reportCatalogue` is: resolving a face is not
 * assembling a session, and the reporting around it reads nothing else in that
 * function.
 */
function faceWorn(
  userData: string,
  catalog: PersonaCatalog,
  persona: Persona,
  deps: SessionConfigDeps,
): ReturnType<typeof resolveFaceFor> {
  const avatars = avatarsRoot(userData)
  seedAvatars(avatars)
  const face = resolveFaceFor(
    avatars,
    packageFolder(persona.id, catalog.sources),
    persona.avatarId,
    persona.theme,
    persona.size,
  )
  for (const problem of face.problems) {
    deps.warn(`[avatar] ${problem.file}: ${problem.reason}`)
    deps.note('avatar', problem.file, problem.reason)
  }
  deps.log(`[avatar] ${face.source ?? 'built-in'}`)
  return face
}

export function sessionConfig(deps: SessionConfigDeps): SessionConfig {
  // CONSUMED here, whatever else this read goes on to decide. See
  // `reconnecting`: the flag describes exactly one open.
  /*
    READ FOR ITS SIDE EFFECT, and no longer for its answer.

    `replacingASession` consumes the flag — its own comment says so, and says
    why: "the flag describes exactly one open. Left set, it would also silence
    the greeting of a character somebody wore after a reconnect." So the read
    has to happen on every pass whatever decides the greeting.

    What it no longer decides is the greeting. See there.
  */
  deps.replacingASession()
  const userData = deps.userData()
  const catalog = deps.catalogue(userData)
  reportCatalogue(catalog, deps)
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
  /*
    HELD BEFORE THE SWITCH, because the switch destroys it.

    `wear()` calls `end()` on the way through, which nulls the live token. Any
    reader of it after this line sees null — see `briefing`'s `liveBefore`.
  */
  const liveBefore = deps.conversation().liveToken()
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
  const avatar = faceWorn(userData, catalog, resolved.persona, deps)

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
  const stored = readGrants(userData, resolved.persona.id, legacyGrants(userData))
  if (stored === WITHHELD_GRANTS) {
    deps.warn(`[grants] ${resolved.persona.id}'s permissions could not be read; withholding`)
    deps.note(
      'settings',
      null,
      'her permissions file could not be read, so every permission is withheld until it can be ' +
        '— she cannot greet you, look anything up, or keep a note',
    )
  }
  /*
    PERMITTED is not the same as PERFORMABLE, and the wire needs the second.

    `recall_codex` is granted the moment somebody flips the switch and its index
    takes seconds to build. Offering the tool in that window would let her call
    something that can only answer "I could not look" — so readiness is applied
    over the stored answer here, and is never written back: what somebody chose
    is theirs, and the settings panel goes on showing it.
  */
  const grants = offeredGrants(stored, deps.unready())

  const brief = briefing(deps, resolved.persona.id, liveBefore)
  deps.briefedWith(brief)
  const mayDo = whatSheMayDo({
    persona: resolved.persona,
    note: note,
    grants: grants,
    tools: deps.tools(),
    template: readPrompt(userData),
    brief: brief,
    prompts: deps.prompts(),
  })
  deps.log(
    `[persona] ${resolved.persona.name} (${resolved.persona.id}), voice ${resolved.persona.voice}, note ${note.length} chars, bubble ${resolved.persona.bubble ? 'on' : 'off'}`,
  )
  const off = GRANT_SPECS.filter((spec) => !grants[spec.id]).map((spec) => spec.id)
  deps.log(`[grants] withheld: ${off.length === 0 ? 'none' : off.join(', ')}`)
  return {
    instructions: mayDo.instructions,
    voice: resolved.persona.voice,
    bubble: resolved.persona.bubble,
    // What she may wear. `face.ts` consults it before the waking perk.
    faces: resolved.persona.faces,
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
    /*
      A LIVE CONVERSATION DECIDES THIS TOO, for the reason `briefing` gives.

      It was `!replacing`, and `briefing` a hundred lines up already uses
      `liveBefore !== null` and explains why: the two agree on the paths anybody
      thinks about and disagree on a third. "`did-finish-load` fires again when
      the renderer RELOADS, and nothing sets `replacing` for that."

      On that path the brief was `resumeFor`, which ends "Do not greet them
      again, do not summarise it back to them, and do not mention any
      interruption" — and this sent a greeting in the same breath. She was
      handed two instructions that contradict each other, in one session, and
      whichever she followed one of them was wrong.

      "Is there something to carry on from" is the question both of these are
      about. The flag was a proxy for it, and the proxy was wrong in the one
      case they differ.
    */
    greeting:
      grants.speak_first && !deps.resting().asleep && liveBefore === null
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
