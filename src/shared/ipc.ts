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
] as const

export type CompanionChannel = (typeof COMPANION_CHANNELS)[number]

export function isCompanionChannel(value: unknown): value is CompanionChannel {
  return typeof value === 'string' && (COMPANION_CHANNELS as readonly string[]).includes(value)
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
  /** Tell main what the session is doing. */
  report(event: VoiceReport): void
  /** Frames main wants put on the data channel — the ledger's answers. */
  onSend(handle: (frame: unknown) => void): void
}
