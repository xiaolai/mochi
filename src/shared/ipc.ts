/**
 * The one place a channel crossing the main↔renderer boundary is written down.
 *
 * Everything arriving from the renderer is untrusted input. It runs web content,
 * and whatever the preload bridge can reach, a compromised page can reach too.
 * So the channels are an allowlist checked at runtime, not a naming convention:
 * `isCompanionChannel` is what the bridge calls before it forwards anything.
 *
 * ## One channel for every capability, not one per capability
 *
 * v1 had 45 message kinds, three of which were a per-tool triple —
 * `workspaceAsked`, `recallAsked`, and one for remembering. Adding a capability
 * meant adding to this contract, which is half of why adding one touched four
 * files. `voice:call` carries the name, so the contract stops growing when the
 * capability set does.
 */
export const COMPANION_CHANNELS = [
  /** Renderer asks main to mint. The bearer never crosses; a short-lived key may. */
  'voice:open',
  /** Renderer hands main an SDP offer; main exchanges it and returns the answer. */
  'voice:sdp',
  /**
   * Renderer asks for everything that goes in `session.update` — who she is,
   * what she sounds like, what she may call.
   *
   * ONE call rather than three, because all of it is main's to know: the
   * persona lives in main's store, the note lives beside it, and the capability
   * registry is main's by design. A renderer that assembled this would need the
   * persona, which is the same mistake as letting it decide which capability
   * runs.
   */
  'voice:config',
  /** She called a capability. Name, call id, raw arguments — main dispatches. */
  'voice:call',
  /** Renderer reports what the session is doing — see `VoiceReport`. */
  'voice:report',
  /** Main → renderer: put this frame on the data channel. */
  'voice:send',
  /** She was asked for her conversations. Main owns the window; this opens it. */
  'history:open',
] as const

export type CompanionChannel = (typeof COMPANION_CHANNELS)[number]

/**
 * What the conversations window may ask for — a SEPARATE list, not an addition.
 *
 * Two documents, two allowlists, and neither can reach the other's channels.
 * A single list would mean the window showing a transcript could also mint a
 * key and exchange an SDP offer, and the companion could read any conversation
 * — for no better reason than that both are renderers.
 *
 * **Nothing here names a persona.** Every one of these reads whoever is worn,
 * decided in main, which is what keeps "show me the history" from becoming
 * "show me anyone's history" the moment a page is compromised.
 */
export const HISTORY_CHANNELS = [
  /** Her conversations, newest first. */
  'history:list',
  /** What was said in one of them, by its opaque token. */
  'history:turns',
  /** Full-text search across hers. */
  'history:search',
] as const

export type HistoryChannel = (typeof HISTORY_CHANNELS)[number]

export function isCompanionChannel(value: unknown): value is CompanionChannel {
  return typeof value === 'string' && (COMPANION_CHANNELS as readonly string[]).includes(value)
}

export function isHistoryChannel(value: unknown): value is HistoryChannel {
  return typeof value === 'string' && (HISTORY_CHANNELS as readonly string[]).includes(value)
}

/**
 * What the renderer tells main about the live session.
 *
 * A typed union on ONE channel rather than a channel each. The expiry is the
 * one that has to travel: `expires_at` arrives on `session.created`, which only
 * the renderer sees, and main is where the reconnect is scheduled (§53).
 */
export type VoiceReport =
  /** `session.created` announced the deadline. Absolute Unix **seconds**. */
  | { readonly kind: 'expiry'; readonly expiresAt: number }
  /**
   * What the user said, as ASR settled it.
   *
   * Structured rather than folded into a log line, because main files it. The
   * text is a person's words: whether it reaches disk is the retention setting's
   * decision, made in main, and the renderer neither knows it nor should.
   */
  | { readonly kind: 'heard'; readonly transcript: string }
  /** What she said. Same treatment, same reason. */
  | { readonly kind: 'said'; readonly transcript: string }
  /**
   * Whether the cursor is inside her silhouette right now.
   *
   * Sent only when it CHANGES, not every frame. Main owns the window, so main
   * is the only thing that can turn click-through on and off — and the renderer
   * is the only thing that knows the shape, because the shape is one `Path2D`
   * the rig both fills and hit-tests.
   */
  | { readonly kind: 'pointer'; readonly onHer: boolean }
  /** A lifecycle change worth a line in the log. */
  | { readonly kind: 'state'; readonly state: string }
  /** Anything else worth saying once. */
  | { readonly kind: 'note'; readonly text: string }

/** What `session.update` is built from. Assembled in main; sent by the renderer. */
export interface SessionConfig {
  /** Who she is: persona, her note about the user, the rules. Never empty. */
  readonly instructions: string
  /** Locked after her first audio output — switching personas needs a reconnect (§21). */
  readonly voice: string
  readonly tools: readonly unknown[]
  /**
   * Whether she shows her words beside her.
   *
   * Per persona and off by default — a bubble is words over somebody's desktop,
   * and a companion that subtitles itself by default has decided for them.
   */
  readonly bubble: boolean
  /**
   * What to say on waking, as an instruction rather than as words.
   *
   * A separate `response.create` rather than part of the system prompt, because
   * she must speak **without having been spoken to** — there is no user turn to
   * respond to, and a system prompt only shapes an answer to something.
   */
  readonly greeting: string
}

/**
 * The shape the preload bridge puts on `window.mochi`.
 *
 * It lives here rather than in `src/preload` because the renderer has to name
 * this type too, and the renderer's TypeScript project does not — and should
 * not — compile the preload. Shared is the only directory both sides build.
 */
export interface MochiApi {
  /** Mint a session. Returns a short-lived key, or a sentence saying why not. */
  open(): Promise<{ ok: true; key: string; model: string } | { ok: false; why: string }>
  /** Exchange the offer. Main holds the key; the renderer never sees it again. */
  sdp(offer: string): Promise<{ ok: true; answer: string } | { ok: false; why: string }>
  /** Everything `session.update` needs. See `voice:config`. */
  config(): Promise<SessionConfig>
  /** Forward a tool call to main. Fire and forget: the answer comes back as a frame. */
  call(name: string, callId: string, args: string): void
  /** Open the conversations window. Main owns every window, so main opens it. */
  history(): void
  /** Tell main what the session is doing. */
  report(event: VoiceReport): void
  /** Frames main wants put on the data channel — the ledger's answers. */
  onSend(handle: (frame: unknown) => void): void
}

/** One conversation, as the window lists it. */
export interface HistoryConversation {
  /** Opaque; holding it authorises nothing. Every read still checks the persona. */
  readonly token: string
  readonly startedAt: number
  readonly endedAt: number | null
  readonly turns: number
}

/** One thing said in one. */
export interface HistoryTurn {
  readonly at: number
  readonly who: 'her' | 'you'
  readonly text: string
}

/** One search result, with the conversation it came from so it can be opened. */
export interface HistoryHit {
  readonly token: string
  readonly at: number
  readonly who: 'her' | 'you'
  readonly text: string
}

/**
 * What the conversations window gets on `window.mochiHistory`.
 *
 * A different global from `window.mochi` rather than more methods on it: the
 * two documents load the same preload file, and a single object would mean the
 * companion page could call `turns()` because the bridge had already built it.
 * The role decides which one is installed, so the other is not merely
 * unreachable — it was never constructed.
 */
export interface MochiHistoryApi {
  /** Whoever is worn. The window never gets to name a persona. */
  list(): Promise<{
    readonly persona: string
    readonly conversations: readonly HistoryConversation[]
  }>
  turns(token: string): Promise<readonly HistoryTurn[]>
  search(query: string): Promise<readonly HistoryHit[]>
}
