import type { FaceSpec } from './avatar-spec'
import type { IdleChoice, Phase } from './companion'
import type { Persona, PersonaLoadProblem } from './persona'
import type { Policy } from './policy'
import type { ShortcutId } from './shortcuts'
import type { Sound } from './sound'
import type { Isolation, UtteranceId, UtteranceOutcome } from './utterance'
import type { CredentialSource, KeyShapeProblem, KeyStoreProblem, Remedy } from './auth'
import type { DelegationSettings, DelegationView } from './delegation'
import { stripControl } from './text'
import type { ThemeId } from './theme'
import type { LocaleTag } from './i18n'

/**
 * The channels, in one place.
 *
 * String literals rather than an enum so both processes bundle the same values
 * with no runtime object crossing the boundary, and a typo is a compile error
 * on whichever side made it.
 */
export const IPC = {
  /** The renderer has decided whether the cursor is over her. */
  setInteractive: 'companion:set-interactive',
  /** A drag began at this offset within the window. */
  dragStart: 'companion:drag-start',
  dragEnd: 'companion:drag-end',
  /** Which face to wear and how big. Resolved and VALIDATED in main; see store/avatars. */
  getAppearance: 'companion:get-appearance',
  /** Pushed when her size changes, so the rig and the window stay one size. */
  appearanceChanged: 'companion:appearance',
  /**
   * Pushed, not polled.
   *
   * The wake reaction has to land within ~100ms of the shortcut for the dial
   * behind it to read as her thinking rather than the app hanging. A renderer
   * asking "what phase are we in?" on its own schedule cannot promise that.
   */
  phaseChanged: 'companion:phase',

  /** Mint an ephemeral key. The bearer never crosses; only the short-lived key's success does. */
  mintKey: 'voice:mint',
  /**
   * Offer in, answer out.
   *
   * The comment here used to say SDP "carries no authority, so it may travel
   * freely", and that is false: an offer carries the ICE ufrag and password,
   * which are short-lived credentials for the media path. What is true is
   * narrower and is the actual reason this channel exists — the SDP carries no
   * OPENAI credential, so the renderer can hold it while the bearer stays in
   * main. The exchange is still privileged and is checked like every other.
   */
  exchangeSdp: 'voice:sdp',
  /** Main asking the renderer to open, close, or speak. */
  voiceCommand: 'voice:command',
  /** The renderer reporting what the session did. */
  voiceEvent: 'voice:event',
  /** The renderer announcing it has subscribed and can receive commands. */
  rendererReady: 'companion:ready',

  /** Everything the settings window reads on open. */
  getSettings: 'settings:get',
  /** A whole persona, written back. Validated in main before it is kept. */
  savePersona: 'settings:save-persona',
  /** How big she is, as a percentage. Resizes her window as a side effect. */
  saveSize: 'settings:save-size',
  openExternal: 'settings:open-external',
  saveShortcuts: 'settings:save-shortcuts',
  saveAuth: 'settings:save-auth',
  checkAuth: 'settings:check-auth',
  saveTheme: 'settings:save-theme',
  /** Microphone handling: the duplex rule, echo cancellation, turn eagerness. */
  saveSound: 'settings:save-sound',
  /** How long she waits with nobody talking before saying goodbye. */
  saveIdle: 'settings:save-idle',
  saveDelegation: 'settings:save-delegation',
  saveSpokenRules: 'settings:save-spoken-rules',
  /**
   * Its own channel rather than part of `saveDelegation`.
   *
   * Everything else in that block is a field in our own preferences file; this
   * one edits `~/.codex/config.toml`, which belongs to another program. Sharing
   * a channel would make one failure mode -- "we could not write Codex's
   * configuration" -- indistinguishable from "we could not save a preference",
   * and only one of those is the user's to act on.
   */
  setWorkspaceTrust: 'settings:set-workspace-trust',
  /** Wear a different persona. Ends any live session. */
  switchPersona: 'settings:switch-persona',
  /** Copy the active persona into a new one, and wear it. */
  addPersona: 'settings:add-persona',
  /** Remove a persona and the notes filed under her. */
  deletePersona: 'settings:delete-persona',
  /** Discard every edit to the built-in, putting her back to the one that ships. */
  restoreBuiltIn: 'settings:restore-built-in',
  /**
   * Whether her conversations are written down, and for how long.
   *
   * Its own channel rather than part of `savePersona`, because retention is
   * no longer part of a persona: it is filed under her id beside her memory,
   * so an author shipping a new version of a package cannot reach it. See
   * `@shared/policy`.
   */
  savePolicy: 'settings:save-policy',
  /** The worn persona's conversations, newest first. Hers only. */
  listSessions: 'settings:list-sessions',
  /** What was said in one of them, named by when it began. */
  readSession: 'settings:read-session',
  /** Search the worn persona's conversations. There is no wider scope. */
  searchTranscripts: 'settings:search-transcripts',
  /** Delete one conversation of hers. */
  forgetSession: 'settings:forget-session',
  /** Write her history to a file the user picks. */
  exportTranscripts: 'settings:export-transcripts',
  /** Read a history file into the worn persona, after confirming. */
  importTranscripts: 'settings:import-transcripts',
  /** Delete the worn persona's notes. Her conversations are NOT touched. */
  forgetMemory: 'settings:forget-memory',
  /** Delete the worn persona's transcripts. Hers only. */
  forgetTranscripts: 'settings:forget-transcripts',
  /** Delete every transcript on this machine, whoever they belong to. */
  forgetEverything: 'settings:forget-everything',
  /** Show the worn persona's package folder in the file manager. */
  revealPackage: 'settings:reveal-package',
  /** Main telling an open settings window that something changed underneath it. */
  settingsChanged: 'settings:changed',
} as const

/**
 * Which open a message belongs to.
 *
 * Every voice message carries one, and both sides drop anything that does not
 * match the attempt they are currently running. Without it the protocol is
 * unsafe in a way nothing in a single exchange reveals: opening a session takes
 * two network calls bounded at 30s each while the lifecycle gives up after 15s,
 * so a retry routinely overlaps the attempt it replaced. The two then share one
 * ephemeral key slot, and each other's `ready` and `failed` reports.
 *
 * Opaque and non-secret. It correlates messages; it authorises nothing.
 */
export type AttemptId = number

/**
 * Anything that survives both structured clone and `JSON.stringify` unchanged.
 *
 * Named because two boundaries in a row demand it and neither reports the
 * failure usefully: IPC throws on a function, and `JSON.stringify` silently
 * drops `undefined`, so a value that is merely "an object" can arrive as
 * something else or not at all.
 */
export type JsonValue =
  string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue }

/** What main asks the renderer to do with the session it owns. */
export type VoiceCommand =
  | {
      readonly kind: 'open'
      readonly attempt: AttemptId
      readonly persona: Persona
      /**
       * What she remembers, travelling WITH the persona.
       *
       * Beside it rather than inside it: memory is filed under her id in main
       * and is not part of what a persona is. Sent per open because that is
       * the only moment it is read -- the session's instructions are built
       * once, and a memory that changed afterwards belongs to the next wake.
       */
      readonly memory: string
      /**
       * The spoken-output rules this machine is configured with.
       *
       * Travels with the open, beside `memory`, for the same reason: it is read
       * once when the session's instructions are built. It was stored, shown and
       * editable while production still called `instructionsFor` with two
       * arguments -- so the setting existed everywhere except where it mattered.
       */
      readonly spokenRules: string
      /**
       * How this computer handles the microphone, travelling WITH the open.
       *
       * Beside the persona rather than inside it: two personas cannot disagree
       * about whether this laptop's speaker feeds its own microphone. Sent per
       * open because that is the only moment the capture constraints and the
       * session configuration are decided -- changing either mid-conversation
       * would move the microphone under a turn already in flight.
       */
      readonly sound: Sound
      /**
       * Whether the APP drives every utterance.
       *
       * Sets `turn_detection.create_response = false`, so the server detects
       * turns and transcribes them but never generates a reply by itself. A
       * persona that does exactly one thing and ignores everything else is
       * then a property of the protocol rather than a request in the prompt --
       * asking a model in prose to ignore you works most of the time, and this
       * works every time.
       */
      readonly driven: boolean
    }
  | { readonly kind: 'close'; readonly attempt: AttemptId }
  | {
      readonly kind: 'speak'
      readonly attempt: AttemptId
      /** Follow it by this. See `shared/utterance.ts` for why it needs a name. */
      readonly utterance: UtteranceId
      readonly instructions: string
      /** Three dimensions, not a flag. See `Isolation`. */
      readonly isolation: Isolation
    }
  | { readonly kind: 'silence'; readonly attempt: AttemptId; readonly utterance: UtteranceId }
  | { readonly kind: 'mic'; readonly attempt: AttemptId; readonly open: boolean }
  /**
   * The answer to an `ask_workspace` call, however late.
   *
   * Queued as a `function_call_output` on the original `call_id` and WITHOUT a
   * `response.create` -- both halves measured on a live session. The payload is
   * whatever main decided to say: an answer, a refusal, or a reason it could
   * not run. It is JSON, not prose, so what she reads aloud is generated by her
   * from data rather than relayed verbatim from a file.
   */
  /**
   * The user pressed the delegation key.
   *
   * Queued into the conversation as an item with NO `response.create`, which a
   * live session verified: she does not answer it now, she simply knows it on
   * her next turn -- and her next turn is the request the user is about to
   * speak. Forcing a turn here would also collide with anything she is saying,
   * which §1 D measured as an outright rejection.
   *
   * Without this the press changed nothing she could see. Main recorded an
   * authorisation and never told her one existed, so she had no reason to call
   * the tool, the press expired sixty seconds later, and the key was
   * indistinguishable from one no application had claimed.
   */
  | { readonly kind: 'armWorkspace'; readonly attempt: AttemptId }
  /**
   * A delegation has actually STARTED.
   *
   * Sent only once main has spent the authorisation and handed the question to
   * Codex, so it can never announce a lookup that was refused a millisecond
   * later.
   *
   * It exists because the tool's own description asks her to say she is looking
   * and that is a REQUEST, not a mechanism. On a live session she emitted a
   * turn containing the function call and no audio at all -- no
   * `output_audio_buffer.started` between `response.output_item.added` and
   * `response.done` -- and then said nothing for the fifty-six seconds the run
   * took. The user's only signal that anything was happening was asking why
   * nothing had happened.
   *
   * UNLIKE `armWorkspace`, this one does ask for a turn: there is no user
   * utterance coming to carry it, and an acknowledgement that arrives with the
   * answer is not an acknowledgement.
   */
  | { readonly kind: 'workspaceStarted'; readonly attempt: AttemptId }
  | {
      readonly kind: 'workspaceAnswer'
      readonly attempt: AttemptId
      readonly callId: string
      /**
       * JSON, expressed in the type rather than promised in a comment.
       *
       * It was `unknown`, which admits everything this value cannot be: it
       * crosses IPC (structured clone, which rejects functions) and is then
       * `JSON.stringify`d into the data channel (which drops `undefined`,
       * throws on `BigInt`, and throws on a cycle). Any of those fails on the
       * one path that must always complete -- an `ask_workspace` call that
       * never receives its `function_call_output` sits unanswered in the
       * conversation for the rest of the session.
       *
       * `payloadFor` in main builds every value here, so the constraint costs
       * nothing today; it exists so the next member added to that union cannot
       * quietly be a `Date`.
       */
      readonly payload: JsonValue
    }

/**
 * What the renderer reports back.
 *
 * `voiceStarted` / `voiceStopped` come from the ANALYSER, not the data channel:
 * `response.done` fires ~2.1s before her audio finishes playing, so the wire is
 * the wrong clock for anything that has to wait for her to finish.
 *
 * `openFailed` and `sessionLost` are separate because the state machine does
 * different things with them, and a single `failed` collapsed that distinction:
 * it mapped to `sessionFailed`, which is only handled while waking, so a
 * connection dropping AFTER she was ready was silently discarded and left main
 * awake with the microphone flagged open over a session the renderer had
 * already torn down.
 */
export type VoiceReport =
  | { readonly kind: 'ready'; readonly attempt: AttemptId }
  | { readonly kind: 'openFailed'; readonly attempt: AttemptId; readonly reason: string }
  | { readonly kind: 'sessionLost'; readonly attempt: AttemptId; readonly reason: string }
  | { readonly kind: 'voiceStarted'; readonly attempt: AttemptId }
  | { readonly kind: 'voiceStopped'; readonly attempt: AttemptId }
  | { readonly kind: 'userSpoke'; readonly attempt: AttemptId }
  /**
   * Whether her own voice is coming back into the microphone.
   *
   * Sent when the answer CHANGES, not per frame. The renderer measures it --
   * see `audio/loopback.ts` -- because the two envelopes it compares only
   * exist there; main decides what to do about it, as with everything else.
   */
  | { readonly kind: 'loopback'; readonly attempt: AttemptId; readonly present: boolean }
  /**
   * One of her utterances ended, and how.
   *
   * Driven by her audio actually stopping, not by `response.done` -- measured
   * here, that arrives 2 to 8 seconds early -- the gap grows with the
   * utterance -- because the model generates
   * faster than real time. A capability advancing on the protocol event would
   * move on while she was still talking.
   */
  | {
      readonly kind: 'utteranceEnded'
      readonly attempt: AttemptId
      readonly utterance: UtteranceId
      readonly outcome: UtteranceOutcome
    }
  /**
   * A finished turn, as text.
   *
   * The wire already carries these -- `session.update` asks for transcription
   * and both `response.output_audio_transcript.done` and
   * `conversation.item.input_audio_transcription.completed` were being logged
   * and thrown away. Writing them is main's job, not the renderer's: the
   * renderer is the least trusted process here, so what crosses is data and
   * the store stays on the other side.
   */
  | {
      readonly kind: 'said'
      readonly attempt: AttemptId
      readonly who: 'her' | 'you'
      readonly text: string
    }
  /**
   * She called `ask_workspace`.
   *
   * The renderer decides nothing here -- whether this may run depends on the
   * trigger setting and on a keypress, both of which main owns. The Realtime
   * service cannot reach a local Codex, so main is the middleman and the loop
   * stays on this machine.
   *
   * `callId` is echoed back with the answer. It is the model's string, so it is
   * bounded and stripped like every other one that crosses.
   */
  | {
      readonly kind: 'workspaceAsked'
      readonly attempt: AttemptId
      readonly callId: string
      readonly question: string
    }

export type MintReply = { readonly ok: true } | { readonly ok: false; readonly reason: string }
export type SdpReply =
  { readonly ok: true; readonly answer: string } | { readonly ok: false; readonly reason: string }

/**
 * Validate a report arriving over IPC.
 *
 * The renderer is the least trusted process in this app -- it is the one that
 * loads a face out of a user-writable folder -- and main was casting its
 * payload straight to `VoiceReport`. A `null` threw inside the handler, and any
 * object shaped `{kind:'ready'}` could drive the lifecycle from anywhere that
 * could reach the channel. Returns `null` rather than throwing: a bad message
 * is something to drop and log, not something to crash main over.
 */
/** How much of a renderer-supplied reason is worth keeping. */
const MAX_REASON = 300

/**
 * How much of a SPOKEN TURN is worth keeping.
 *
 * Separate from `MAX_REASON`, and the separation is the point. A turn was
 * cleaned with the reason limit, so anything past 300 characters was cut off
 * before it reached the transcript, the capability, or memory -- about two
 * sentences. An error message has no business setting the length of what
 * somebody is allowed to say.
 *
 * Generous rather than tuned: a minute of continuous speech is roughly 900
 * characters, so this is several minutes in one unbroken turn. It exists to
 * stop main holding an unbounded string on the renderer's say-so, not to
 * decide how much anybody may say.
 */
const MAX_TURN = 4000

/**
 * Strip what could forge a log line, then bound it.
 *
 * Control characters go first, newlines included: text carrying `\n` can write
 * a second line into the log that looks like a separate, authentic entry.
 */
function clean(text: string, limit: number): string {
  const flat = stripControl(text).trim()
  if (flat.length <= limit) return flat
  // The ellipsis is INSIDE the limit, and the cut is on a code POINT.
  //
  // Appending it after `slice(0, limit)` made the result one unit longer than
  // the bound it was given -- so the one thing this function promises was
  // false for every value it actually acted on. And slicing by code unit can
  // land between a surrogate pair, producing a lone half that renders as a
  // replacement character; `Array.from` iterates code points, so the cut falls
  // between characters instead.
  return `${Array.from(flat)
    .slice(0, limit - 1)
    .join('')}…`
}

/** A reason that is safe to log. */
function cleanReason(reason: string): string {
  return clean(reason, MAX_REASON)
}

/**
 * How long a `call_id` may be, and what may be in it.
 *
 * Measured shape: `call_jT8hb57lFVeqP0OZ`. The pattern is deliberately wider
 * than that -- it is the service's token to mint, not ours to predict -- but
 * narrow enough that nothing which could forge a log line or a shell argument
 * reaches main. Anything outside it is refused rather than repaired, because a
 * repaired id is an answer delivered to nobody.
 */
const MAX_CALL_ID = 200
const CALL_ID_SHAPE = /^[A-Za-z0-9_.:-]+$/

export function parseVoiceReport(value: unknown): VoiceReport | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  const attempt = record['attempt']
  // A POSITIVE integer. Integer because it indexes attempts and NaN would
  // compare unequal to every attempt including itself -- a report silently
  // dropped forever is worse than one rejected loudly here. Positive because
  // the lifecycle starts its counter at 0 and increments BEFORE each open, so
  // the first live attempt is 1: a report claiming 0 or a negative number
  // cannot belong to any session that ever existed, and letting it through
  // means main matching it against a sentinel rather than rejecting it.
  if (typeof attempt !== 'number' || !Number.isSafeInteger(attempt) || attempt < 1) return null

  switch (record['kind']) {
    case 'ready':
    case 'voiceStarted':
    case 'voiceStopped':
    case 'userSpoke':
      return { kind: record['kind'], attempt }
    case 'utteranceEnded': {
      const utterance = record['utterance']
      const outcome = record['outcome']
      // `>= 1`, matching how they are minted. Zero and negatives are shapes no
      // sender can produce, and admitting them through the boundary means the
      // only check on an impossible id is that nothing downstream happens to
      // mind -- the same reasoning as the attempt id beside it.
      if (typeof utterance !== 'number' || !Number.isSafeInteger(utterance) || utterance < 1) {
        return null
      }
      if (outcome !== 'played' && outcome !== 'cancelled' && outcome !== 'failed') return null
      return { kind: 'utteranceEnded', attempt, utterance, outcome }
    }
    case 'loopback': {
      const present = record['present']
      if (typeof present !== 'boolean') return null
      return { kind: 'loopback', attempt, present }
    }
    case 'said': {
      const who = record['who']
      const text = record['text']
      if ((who !== 'her' && who !== 'you') || typeof text !== 'string') return null
      // BOUNDED and stripped, like every other renderer-supplied string that
      // reaches main. A turn is a sentence somebody said, not a place to put
      // a megabyte -- and control characters in it would forge log lines.
      const spoken = clean(text, MAX_TURN)
      return spoken === '' ? null : { kind: 'said', attempt, who, text: spoken }
    }
    case 'workspaceAsked': {
      const callId = record['callId']
      const question = record['question']
      if (typeof callId !== 'string' || typeof question !== 'string') return null
      // The id is VALIDATED, never rewritten.
      //
      // It is an opaque correlation token: the answer is delivered by sending
      // a `function_call_output` carrying it back, and the service matches it
      // byte for byte. `clean` trims, replaces characters and truncates -- so
      // an id it touched no longer named the call it came from, and the answer
      // was delivered against nothing AFTER the delegation had run and spent
      // the user's quota. Rejecting an implausible id costs one refusal;
      // repairing one costs a run whose answer can never arrive.
      //
      // Bounded and charset-checked rather than trusted: this crosses from the
      // renderer, and the value is later interpolated into log lines.
      if (callId.length === 0 || callId.length > MAX_CALL_ID) return null
      if (!CALL_ID_SHAPE.test(callId)) return null
      // An EMPTY question is kept, deliberately. Main still has to answer the
      // call -- an unanswered `function_call_output` sits in the conversation
      // for the rest of the session -- so it refuses with a reason rather than
      // dropping the report and leaving her waiting on herself.
      return { kind: 'workspaceAsked', attempt, callId, question: clean(question, MAX_TURN) }
    }
    case 'openFailed':
    case 'sessionLost': {
      const reason = record['reason']
      if (typeof reason !== 'string') return null
      // BOUNDED and stripped. This string is written to a log and passed to
      // callbacks, and it arrives from the least trusted process here -- so an
      // unbounded one is a memory cost main pays on the renderer's say-so, and
      // control characters in it can forge log lines that look like they came
      // from somewhere else.
      return { kind: record['kind'], attempt, reason: cleanReason(reason) }
    }
    default:
      return null
  }
}

export interface DragStartPayload {
  readonly offsetX: number
  readonly offsetY: number
}

/**
 * Which window a preload instance is running in.
 *
 * Passed through `additionalArguments` and read from `process.argv`, because
 * there is only ever ONE preload file. Two would be tidier to read and would
 * leave BOTH windows with no bridge at all: rollup lifts the shared modules of
 * two entries into a chunk, and a sandboxed preload may not `require` a
 * relative path. Types, unit tests and the build all stay green, and it is
 * visible only by running the thing.
 */
export const ROLE_FLAG = '--mochi-role='
export const ROLES = ['companion', 'settings'] as const
export type WindowRole = (typeof ROLES)[number]

export function roleFromArgv(argv: readonly string[]): WindowRole | null {
  // EVERY match, not the first. Taking the first meant that two role flags --
  // a stale one left in `additionalArguments` beside a new one, say -- silently
  // picked whichever the argument order happened to put first, and the order
  // of `additionalArguments` is not something a reader of the window code can
  // see. Two roles is a mistake, and guessing which was meant is how the
  // privileged one gets handed out by accident.
  const flags = argv.filter((arg) => arg.startsWith(ROLE_FLAG))
  if (flags.length > 1) {
    console.error(`[preload] ${String(flags.length)} role flags were given; refusing all of them`)
    return null
  }
  const raw = flags[0]?.slice(ROLE_FLAG.length)
  // NULL, not a default. This used to fall back to `companion`, on the argument
  // that a bridge-less companion fails visibly while a bridge-less settings
  // window merely looks empty — true, and the wrong axis to decide it on.
  //
  // `companion` is the PRIVILEGED role: it can move her window, disable
  // click-through, mint an ephemeral API key and open a microphone. Defaulting
  // to it means any window opened without a role — a future one, a mistake, a
  // renderer somebody attaches this preload to — is handed the whole capability
  // set for free. That is a security boundary failing open, and "the failure is
  // easy to notice" is not a property of a boundary, it is a property of a bug.
  //
  // Both windows now name their role explicitly, so null means somebody added a
  // third and forgot. The preload says so loudly and exposes nothing.
  return (ROLES as readonly string[]).includes(raw ?? '') ? (raw as WindowRole) : null
}

/**
 * How she should be drawn: which face, and at what size.
 *
 * Both together, because they are one question. The renderer needs the size to
 * position her and main needs it to size the window, and the two must come
 * from the same place or they drift.
 */
export interface Appearance {
  readonly face: FaceSpec
  /** Percentage of the base scale. Clamped in main. */
  readonly sizePercent: number
}

/**
 * What a live credential check concluded.
 *
 * Structured rather than a sentence: the settings window localises it, and a
 * string assembled in main would be a second place user-facing text is written.
 */
export type AuthVerdict =
  | { readonly ok: true; readonly source: CredentialSource; readonly mode: string | null }
  | { readonly ok: false; readonly source: CredentialSource; readonly why: AuthFailure }

export type AuthFailure =
  /** No key stored, so there is nothing to check. */
  | { readonly kind: 'no-key' }
  /** Codex cannot be used, and this is what to do about it. */
  | { readonly kind: 'codex'; readonly remedy: Remedy }
  /** OpenAI answered and refused the key. 401 or 403 — nothing else. */
  | { readonly kind: 'rejected'; readonly status: number }
  /**
   * OpenAI answered about ITSELF: a rate limit, an outage, a gateway.
   *
   * Separate from `rejected` because the two demand opposite actions. Folding
   * a 429 into "refused" tells somebody to go and replace a key that works.
   */
  | { readonly kind: 'unavailable'; readonly status: number }
  /** Nothing answered: offline, a proxy in the way, a timeout. */
  | { readonly kind: 'unreachable' }

/**
 * Why a save was refused, as a value rather than a sentence.
 *
 * Main used to answer these handlers with English it had written itself --
 * `'not permitted'`, `` `${key} must be text` ``, the store's `why` -- and the
 * window put the string on screen unchanged. That is a second place user-facing
 * text is authored, in one language, outside the table that makes a missing
 * translation a compile error. `AuthFailure` above already got this right; this
 * is the same treatment for the way in.
 *
 * IDENTIFIERS are not translated and are carried verbatim: a field name like
 * `greeting.instruction` and a list of accepted literals are names, not prose.
 * Only the sentence around them is chosen by the window.
 */
export type SaveProblem =
  /** The message did not come from the settings window. */
  | { readonly kind: 'not-permitted' }
  /** Validated, accepted, and then the disk refused it. */
  | { readonly kind: 'save-failed' }
  /** A value main does not recognise — only reachable from a crafted message. */
  | { readonly kind: 'unknown-value'; readonly field: string; readonly allowed: string }
  /** The pasted key does not look like a key. */
  | { readonly kind: 'key-shape'; readonly reason: KeyShapeProblem }
  /** The key looks right and could not be stored. */
  | { readonly kind: 'key-store'; readonly reason: KeyStoreProblem }
  /** One binding did not parse. */
  | { readonly kind: 'shortcut-unusable'; readonly id: ShortcutId }
  /** Two actions on one chord. */
  | { readonly kind: 'shortcut-clash' }
  /** A field of the persona sheet. */
  | { readonly kind: 'field'; readonly field: string; readonly reason: FieldProblem }
  /** A field with a length limit, which the sentence has to quote. */
  | { readonly kind: 'field-length'; readonly field: string; readonly limit: number }
  /**
   * A key that is not part of a persona at all.
   *
   * REPORTED rather than ignored, which is the rule the avatar format follows
   * and the reason applies here word for word: a typo
   * like `styel` dropped in silence shows the author their edit having no
   * effect, with nothing anywhere to say why. `parseFaceSpec` has done this
   * since it was written; the persona parser was quietly lenient.
   */
  | { readonly kind: 'unknown-field'; readonly field: string }
  /**
   * Written by a build newer than this one.
   *
   * Its own kind rather than a length or a value problem, because the remedy
   * is completely different: nothing is wrong with the file, and editing it
   * is the wrong advice. The only fix is a newer mochi.
   */
  | { readonly kind: 'from-the-future'; readonly field: string; readonly found: number }

/**
 * `malformed` is text of the right TYPE that is not a usable value.
 *
 * Separate from `not-text` and `empty` because it is the only one a person can
 * hit with a perfectly reasonable-looking string: an `id` of `My Mochi` is text
 * and is not empty, and it is still refused. Collapsing it into `not-text`
 * would put "must be text" under a field that plainly contains text.
 */
/**
 * What a colour change turned out to be.
 *
 * `personaId` because picking a colour for the BUILT-IN forks her -- her id is
 * reserved, so there is no way to store a change against it. The window has to
 * be told which persona it is now editing, and told by the call it made rather
 * than by a broadcast it might process in either order relative to this reply.
 */
export interface ThemeSaved {
  readonly problems: readonly SaveProblem[]
  /** Who the theme was stored against. Differs from the active id on a fork. */
  readonly personaId: string
}

export type FieldProblem =
  | 'not-text'
  | 'empty'
  | 'not-object'
  /**
   * A LIST was required and something else arrived.
   *
   * Distinct from `not-object`, which was being reused for it: the user-facing
   * sentence for that one says "must be a group of settings", and telling
   * somebody who wrote `expressions: "happy"` that a list must be a group of
   * settings sends them to fix the wrong thing.
   */
  | 'not-list'
  | 'malformed'
  | 'not-a-version'

/**
 * A save problem as one line of ENGLISH, for LOGS ONLY.
 *
 * Never for the window. `describeProblem` in the settings renderer does that,
 * from the message tables, in the user's language. This exists because a
 * diagnostic still has to say something and every log in this app is English —
 * and because a `SaveProblem` dropped into a template literal stringifies to
 * `[object Object]`, which is a log line that survives review and says nothing.
 */
export function logSaveProblem(problem: SaveProblem): string {
  switch (problem.kind) {
    case 'not-permitted':
      return 'not permitted'
    case 'save-failed':
      return 'could not be written'
    case 'unknown-value':
      return `${problem.field} must be one of: ${problem.allowed}`
    case 'field':
      return `${problem.field} is ${problem.reason}`
    case 'field-length':
      return `${problem.field} is longer than ${String(problem.limit)}`
    case 'unknown-field':
      return `${problem.field} is not a field of a persona`
    case 'from-the-future':
      return `${problem.field} is ${String(problem.found)}, which this build does not understand`
    case 'key-shape':
      return `the key looks wrong: ${problem.reason}`
    case 'key-store':
      return `the key could not be stored: ${problem.reason}`
    case 'shortcut-unusable':
      return `${problem.id} is not a usable key combination`
    case 'shortcut-clash':
      return 'two actions cannot share one key combination'
  }
}

/** Everything the settings window needs in one round trip. */
export interface SettingsSnapshot {
  readonly persona: Persona
  /**
   * Every persona the catalog holds, for the switcher and the shelf.
   *
   * Ids and names only. The window lists them and asks main to switch; it has
   * no use for eight whole personas and no business holding characters it is
   * not editing.
   */
  readonly personas: ReadonlyArray<{ readonly id: string; readonly name: string }>
  /**
   * Whether the built-in differs from the persona she ships as.
   *
   * Sent so the window can offer the undo only when there is something to
   * undo. Her original wording lives in the source rather than anywhere the
   * user can read, so this is the only way back to it -- and a button that
   * is always there but usually does nothing teaches people to ignore it.
   */
  readonly builtInEdited: boolean
  /** What this computer does with the microphone. See `shared/sound.ts`. */
  readonly sound: Sound
  /** How long she waits before sleeping. `null` is never. See `companion.ts`. */
  readonly idleMs: IdleChoice
  /**
   * What the room was measured to do, or `null` when nothing has listened.
   *
   * Sent so the window can show the automatic decision rather than only act on
   * it. A judgement the user cannot see is one they cannot tell from a
   * malfunction, and this one decides whether they can interrupt her.
   *
   * `null` covers both "asleep" and "awake but she has not spoken yet". The
   * window says so rather than guessing, because the two are the same to
   * somebody reading the pane: nobody has heard anything.
   */
  readonly loopbackHeard: boolean | null
  /**
   * What is on disk, for the pane that is about exactly that.
   *
   * Counted for the WORN persona (`sessions`, `turns`) and for the machine
   * (`bytes`, `where`). Those are kept apart on purpose: how much of her
   * there is, is hers; where the file lives and how big it is, is this
   * computer's, and burying that in About would be hiding it.
   */
  readonly kept: {
    readonly sessions: number
    readonly turns: number
    readonly bytes: number
    readonly where: string
  }
  /**
   * Whether her conversations are written down, and for how long.
   *
   * On the snapshot rather than inside `persona`, because it is not part of
   * her package -- see `@shared/policy`. The window needs the EFFECTIVE
   * answer, which is what main is enforcing right now, not what some manifest
   * once said.
   */
  readonly policy: Policy
  /**
   * What she remembers, so the pane can show it and offer to clear it.
   *
   * Empty for a character nobody has talked to. Here rather than inside
   * `persona` for the same reason `policy` is: it is produced by USING her,
   * and it has to outlive her package being replaced.
   */
  readonly memory: string
  /**
   * What went wrong loading them, if anything.
   *
   * Carried on the snapshot rather than logged, because a persona that
   * silently did not load presents as "the app ignored my file". Structured
   * rather than a sentence -- see `PersonaLoadProblem`.
   */
  readonly personaProblems: readonly PersonaLoadProblem[]
  /**
   * The face currently being worn.
   *
   * Sent so the settings window can take its accent from HER rather than from
   * the OS, which is what keeps one graphical source: retune her palette and
   * the interface follows. Already validated -- main parsed it before it
   * crossed, exactly as for the companion.
   */
  readonly face: FaceSpec
  readonly locale: LocaleTag
  /**
   * The build, for the About group.
   *
   * Sent rather than imported: the renderer has no `app`, and reading
   * `package.json` from a bundled renderer would ship a second copy of a number
   * that is already authoritative in exactly one place.
   */
  readonly version: string
  /** Name, repository and author for the About group. See `main/about.ts`. */
  readonly about: {
    readonly name: string
    readonly repository: string
    readonly author: string
    readonly homepage: string
  }
  /**
   * How she authenticates, and how that is going.
   *
   * Carries NO key and no token. `hint` is the last four characters of a stored
   * key and nothing else — enough to tell two keys apart, useless to anyone
   * reading a screen recording. The key itself goes from the renderer to main
   * once, at the moment it is pasted, and never travels the other way.
   */
  readonly auth: {
    readonly source: CredentialSource
    /** Whether a key is stored. */
    readonly keySet: boolean
    readonly keyHint: string
    /** False where the OS offers no keychain, in which case none can be stored. */
    readonly canStoreKey: boolean
  }
  /**
   * What this computer does when she is asked to look something up.
   *
   * Resolved in main: the model list comes from a file only main can read, and
   * the readiness is deliberately reduced to a kind and a remedy so no search
   * path or expiry date crosses. See `DelegationView`.
   */
  readonly delegation: DelegationView
  /**
   * The spoken-output rules as stored, and the built-in for comparison.
   *
   * `stored` is `null` while nobody has changed them, which is what lets the
   * box show the built-in text as a placeholder rather than as an edit somebody
   * appears to have made.
   */
  readonly spokenRules: { readonly stored: string | null; readonly builtIn: string }
  /**
   * Each shortcut as a person reads it, with whether it was actually claimed.
   *
   * Formatted in MAIN rather than here: `describeAccelerator` needs the
   * platform to decide between `⇧⌃M` and `Shift+Control+M`, and the renderer
   * has no business knowing which OS it is on.
   *
   * A chord that could not be registered is NOT null. This block used to say it
   * was, two declarations above the field it describes -- the null is on
   * `TrayModel.keys`, where an unclaimed chord has no accelerator to print in a
   * menu. Here every entry exists and `unavailable` says whether it works, because
   * the settings window has to show you the combination you chose even when
   * something else owns it.
   */
  readonly keys: Readonly<
    Record<
      ShortcutId,
      {
        /** Electron's spelling. What the renderer sends back unchanged. */
        readonly accelerator: string
        /** How a person reads it: `⇧⌃M` on macOS, `Control+Shift+M` elsewhere. */
        readonly shown: string
        /**
         * Registration failed, which in practice means another application
         * owns the combination. Shown as unavailable rather than offered: a chord
         * displayed as working when it is not is the one state a user cannot
         * diagnose by pressing it.
         */
        /**
         * The OS refused to register it. Not necessarily "another app has it".
         *
         * `globalShortcut.register` returns false for several reasons and
         * distinguishes none of them: another application holding the chord,
         * a combination the system reserves, or -- on macOS -- accessibility
         * permission not being granted. The field was called `taken` and the
         * message said "Taken by another app", so the two failures a user can
         * actually fix were reported as the one they cannot.
         */
        readonly unavailable: boolean
      }
    >
  >
  /** Her size, as a percentage of the base scale. */
  readonly sizePercent: number
  /** Offered in the picker. Sent rather than imported so main stays the source. */
  readonly locales: ReadonlyArray<{ readonly tag: LocaleTag; readonly nativeName: string }>
}

/** What the SETTINGS window gets. A different surface, not a superset. */
/**
 * One conversation, as the settings window sees it.
 *
 * Named by WHEN it began. The store's rowid deliberately does not cross this
 * boundary: SQLite reissues rowids after a delete, and this window holds
 * identifiers across time by its nature, so a rowid here would eventually
 * name a conversation nobody pointed at. See `Session` in the store.
 */
export interface KeptSession {
  /**
   * What this conversation answers to.
   *
   * Opaque and random, minted per conversation. Neither the rowid nor the
   * moment it began: SQLite hands rowids out again after a delete, and two
   * personas can each have a conversation that began in the same millisecond,
   * so both would let an identifier held across time -- which is what this
   * window does by nature -- come to name something nobody pointed at. A
   * random token cannot collide across personas either, which is why main can
   * scope by the WORN persona and still be sure a stale one matches nothing.
   *
   * It authorises nothing. Every lookup is still scoped in main.
   */
  readonly token: string
  readonly startedAt: number
  /** Null while she is still awake. */
  readonly endedAt: number | null
  readonly turns: number
}

/** One thing that was said. */
export interface KeptTurn {
  readonly at: number
  readonly who: 'her' | 'you'
  readonly text: string
}

/** A search hit, and which conversation to open to see it in context. */
export interface KeptHit extends KeptTurn {
  readonly token: string
  readonly startedAt: number
}

/**
 * What came of reading an archive.
 *
 * Cancelled is its own answer rather than an empty success. The user closing
 * a file dialog is not a failed import, and reporting "0 conversations" for it
 * reads as a file that turned out to be empty.
 */
export type ImportOutcome =
  | {
      readonly kind: 'done'
      readonly sessions: number
      readonly turns: number
      /** Conversations already present, byte for byte. Not duplicated. */
      readonly skipped: number
      /**
       * Conversations that share an instant with one already here but say
       * something different, and were NOT written.
       *
       * Reported rather than folded into `skipped`, because an import that
       * silently drops a conversation while reporting success is the failure
       * this count exists to make impossible to miss.
       */
      readonly conflicts: number
    }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'refused'; readonly problems: readonly SaveProblem[] }

export interface SettingsBridge {
  /**
   * `process.platform`, as a value the window can read without a round trip.
   *
   * The chord recorder needs it: the meta key is Command on macOS and the
   * Super key everywhere else, so the same keypress is two different chords
   * depending on the machine. A constant rather than a snapshot field —
   * a platform does not change while the app is running, and putting it on a
   * per-change message would invite code that treats it as though it might.
   */
  readonly platform: string
  read(): Promise<SettingsSnapshot>
  /** Returns the problems, empty when it was accepted. */
  savePersona(persona: Persona): Promise<readonly SaveProblem[]>
  /** Clamped in main, so this cannot fail — it returns what was actually kept. */
  saveSize(percent: number): Promise<number>
  /**
   * Ask the OS to open one of the app's OWN addresses.
   *
   * Takes a URL and returns whether it was opened, rather than taking an
   * identifier, because the About group has the strings already. Main answers
   * `false` for anything outside its allowlist: `shell.openExternal` launches
   * whatever is registered for a scheme, so the renderer proposing a
   * destination and main choosing whether to honour it is the only arrangement
   * where a compromised renderer cannot pick one.
   */
  openExternal(url: string): Promise<boolean>
  /**
   * Rebind. Returns the problems, empty when it was accepted.
   *
   * Takes the whole set rather than one action, because the conflict that
   * matters is BETWEEN them: two actions on one chord registers fine and
   * silently drops the second handler, so it can only be judged as a set.
   */
  saveShortcuts(shortcuts: Readonly<Record<ShortcutId, string>>): Promise<readonly SaveProblem[]>
  /**
   * Check the selected credential, for real, now.
   *
   * The Codex status was cached at launch, so signing out of Codex left the
   * window confidently reporting a login that no longer existed. This re-probes
   * rather than re-reading, and for a key it asks OpenAI.
   */
  checkAuth(): Promise<AuthVerdict>
  /**
   * Recolour her, now.
   *
   * Its own call rather than part of the persona draft. A theme is chosen by
   * looking at her, so it has to apply while you look — and routing it through
   * the draft would mean pressing Save to see a colour, then saving whatever
   * else happened to be half-typed in the form at the same time.
   */
  saveTheme(theme: ThemeId): Promise<ThemeSaved>
  /**
   * Set how this computer handles the microphone.
   *
   * Applies to the NEXT session rather than the live one: the capture
   * constraints and the turn detection are decided when a session opens, and
   * moving either under a turn already in flight is worse than waiting.
   */
  saveSound(sound: Sound): Promise<readonly SaveProblem[]>
  /**
   * Set how long she waits, with nobody talking, before saying goodbye.
   *
   * Applies to the LIVE session, unlike `saveSound`, and that difference is
   * real rather than an inconsistency: the lifecycle reads its settings on
   * every tick, so there is no capture constraint to move and nothing in flight
   * to cut in half. Somebody lengthening this because she keeps leaving means
   * it to take effect now, not after she has left once more.
   */
  saveIdle(idleMs: IdleChoice): Promise<readonly SaveProblem[]>
  /**
   * Set how this computer runs Codex when she looks something up.
   *
   * The whole block travels, like `saveSound`, so a save cannot half-apply --
   * and main re-reads it through `readDelegation` rather than trusting the
   * window, so a message missing a field leaves that field alone instead of
   * resetting it.
   */
  saveDelegation(delegation: DelegationSettings): Promise<readonly SaveProblem[]>
  /** The rules every persona is given. Empty means the built-in text. */
  saveSpokenRules(rules: string): Promise<readonly SaveProblem[]>
  /**
   * Add or remove the workspace in Codex's own trusted list.
   *
   * Separate from `saveDelegation` because it writes to a file this app does
   * not own. Its failures are Codex's configuration being unwritable, which is
   * a different thing to tell somebody than a preference not saving.
   */
  setWorkspaceTrust(trusted: boolean): Promise<readonly SaveProblem[]>
  /**
   * Wear a different persona.
   *
   * Its own call rather than part of the draft, for the reason `saveTheme` is:
   * this is an ACTION, not an edit. Editing a persona means wearing her --
   * there is one notion of "which persona" in this app, and every defect this
   * feature has had came from two surfaces disagreeing about it.
   */
  switchPersona(id: string): Promise<readonly SaveProblem[]>
  /**
   * Copy whoever is active into a new persona, and wear the copy.
   *
   * Duplicating rather than starting blank: a persona is mostly prose, and an
   * empty style with an empty greeting is a form nobody can tell from a broken
   * one. Returns the problems; the new persona arrives in the next snapshot.
   */
  addPersona(): Promise<readonly SaveProblem[]>
  /** Remove her, and the notes filed under her. Refused for the built-in. */
  deletePersona(id: string): Promise<readonly SaveProblem[]>
  /**
   * Put the built-in back to the persona she ships as.
   *
   * The counterpart to editing her in place. Her original prompt lives in the
   * source rather than anywhere the user can see, so without this, changing
   * her would be the one-way door that forking her used to be.
   *
   * Her memory and transcripts are NOT touched. Those are hers by id, and an
   * undo of the wording is not a request to forget the conversations.
   */
  restoreBuiltIn(): Promise<readonly SaveProblem[]>
  /**
   * Set whether her conversations are written down, and for how long.
   *
   * Applies on the spot rather than through Save, and that is deliberate for a
   * privacy control: the failure mode of a form is forgetting to submit it,
   * and here that means believing storage is off while it is on.
   */
  savePolicy(policy: Policy): Promise<readonly SaveProblem[]>
  /** Her conversations, newest first. There is no scope wider than her. */
  listSessions(): Promise<readonly KeptSession[]>
  /** What was said in one of hers. Empty for one that is not, or is not there. */
  readSession(token: string): Promise<readonly KeptTurn[]>
  /**
   * Search hers.
   *
   * No persona argument and no "everything" scope: a search that reaches past
   * whoever is worn is a privacy hole rather than a feature, and the
   * way to keep that true is for the renderer to have no way to ask.
   */
  searchTranscripts(query: string): Promise<readonly KeptHit[]>
  /** Delete one conversation of hers, named by when it began. */
  forgetSession(token: string): Promise<readonly SaveProblem[]>
  /** Write her history somewhere the user picks. Main owns the file dialog. */
  exportTranscripts(): Promise<readonly SaveProblem[]>
  /**
   * Read a history file into the worn persona.
   *
   * Main opens the dialog, reads the file, and — when the archive came from a
   * DIFFERENT persona — names both sides and asks before writing anything.
   * The confirmation is native and lives in main because a renderer that could
   * skip it would make the guarantee a convention.
   */
  importTranscripts(): Promise<ImportOutcome>
  /** Delete the worn persona's notes. Her conversations are NOT touched. */
  forgetMemory(): Promise<readonly SaveProblem[]>
  /** Delete the worn persona's transcripts. Her memory is NOT touched. */
  forgetTranscripts(): Promise<readonly SaveProblem[]>
  /**
   * Delete every transcript on this machine.
   *
   * The escape hatch, and deliberately not a persona action:
   * it reaches past whoever is worn, so it lives in the machine half where
   * that is what the reader expects.
   */
  forgetEverything(): Promise<readonly SaveProblem[]>
  /**
   * Show the worn persona's package folder.
   *
   * The only authoring surface there is. A persona's prompt and colour are
   * edited in this window; her artifact and its data are files, and until now
   * finding them meant knowing where an Electron app keeps its userData.
   *
   * Takes no argument. Main knows who is worn, and a renderer able to name a
   * folder is a renderer able to open any folder -- the same reason
   * `openExternal` compares against an allowlist rather than inspecting.
   */
  revealPackage(): Promise<readonly SaveProblem[]>
  /**
   * Set the credential source, and optionally store a key.
   *
   * `key` travels one way. Passing `null` leaves any stored key alone; passing
   * a string replaces it; `clearKey` removes it. There is no call that returns
   * a key, because there is no reason for the renderer to hold one.
   *
   * A DISCRIMINATED OPERATION, so the contradiction cannot be expressed.
   *
   * It used to be `{source, key: string | null, clearKey: boolean}`, which
   * admits `{key: 'sk-…', clearKey: true}` -- replace it and delete it, in one
   * message. Main resolved that in the only order that cannot lose anything,
   * and the comment here explained the ordering at length; but an invalid
   * state carefully handled is still an invalid state that every future reader
   * has to be told about. The three real operations are `keep`, `replace` and
   * `clear`, and the type now says so.
   */
  saveAuth(next: AuthChange): Promise<readonly SaveProblem[]>
  onChanged(listener: (snapshot: SettingsSnapshot) => void): () => void
}

/**
 * What a credential save is actually asking for.
 *
 * Three operations, not a bag of optional fields:
 *
 * - `keep`   — change which source is used and leave the stored key alone
 * - `replace`— store this key
 * - `clear`  — remove the stored key
 *
 * The key rides on the one variant that has one, so "replace it and delete it"
 * is not a message anybody can send.
 */
export type AuthChange =
  | { readonly source: CredentialSource; readonly key: 'keep' }
  | { readonly source: CredentialSource; readonly key: 'replace'; readonly value: string }
  | { readonly source: CredentialSource; readonly key: 'clear' }

/** What preload exposes. Declared here so both sides agree on one shape. */
export interface CompanionBridge {
  setInteractive(interactive: boolean): void
  dragStart(payload: DragStartPayload): void
  dragEnd(): void
  /**
   * The face to render.
   *
   * Already validated: main parsed it against the schema before it crossed, so
   * the renderer receives something it can draw or the built-in. There is no
   * third outcome, which is why nothing downstream re-checks it.
   */
  getAppearance(): Promise<Appearance>
  /** Returns an unsubscribe, so a reload cannot leave two listeners on one channel. */
  onAppearance(listener: (appearance: Appearance) => void): () => void
  /** Returns an unsubscribe, so a reload cannot leave two listeners on one channel. */
  onPhase(listener: (phase: Phase) => void): () => void
  /**
   * Ask main to mint for one attempt. The key stays there; this only learns
   * whether it worked.
   *
   * The attempt is required so main can file the key against it. A key minted
   * for a superseded attempt is discarded rather than left in a shared slot for
   * whichever exchange asks next.
   */
  mintKey(attempt: AttemptId): Promise<MintReply>
  exchangeSdp(attempt: AttemptId, offer: string): Promise<SdpReply>
  onVoiceCommand(listener: (command: VoiceCommand) => void): () => void
  reportVoice(report: VoiceReport): void
  /**
   * Tell main the renderer is listening.
   *
   * Subscribing to a push channel is not the same as being ready to receive on
   * it: the renderer awaits its face before registering, so a wake in that
   * window was delivered to nobody and left the lifecycle waiting out its
   * timeout for a session that was never asked for.
   */
  ready(): void
}
