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
  /**
   * Put her words on the clipboard.
   *
   * Main, not the renderer: the clipboard is a system surface, and this is the
   * process that owns system surfaces. It also means the text crossing is
   * whatever the renderer already has on screen rather than a new read.
   */
  'clipboard:write',
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
  /** Everything that went wrong, for the window that can show it. */
  'history:problems',
  /**
   * Open the settings window.
   *
   * The way in lives HERE rather than on her bubble, which has exactly three
   * controls and a person asked for exactly those three. Opening a window is
   * also the only thing this channel does — the conversations window gets no
   * ability to read or write a setting by having it.
   */
  'history:settings',
] as const

export type HistoryChannel = (typeof HISTORY_CHANNELS)[number]

/**
 * What the settings window may ask for — a THIRD list, for the same reason
 * there is a second.
 *
 * This is the only window that WRITES, which is exactly why it does not share
 * an allowlist with the two that read. The companion can mint a credential and
 * must never be able to rewrite who she is; the conversations window shows a
 * person's words and must never be able to change the persona those words are
 * filed under.
 *
 * **Nothing here takes a path.** `settings:reveal` names a folder by kind, not
 * by location — a renderer that could hand main an arbitrary path to open would
 * be a file browser with the user's authority, reachable from a page.
 */
export const SETTINGS_CHANNELS = [
  /** Everything the window draws: personas, avatars, capabilities, folders. */
  'settings:read',
  /** Wear this persona. The id is checked against the catalog in main. */
  'settings:wear',
  /** Change fields on a persona. Main decides what may be written and where. */
  'settings:save',
  /** Show me where these files are. A KIND, never a path. */
  'settings:reveal',
] as const

export type SettingsChannel = (typeof SETTINGS_CHANNELS)[number]

export function isSettingsChannel(value: unknown): value is SettingsChannel {
  return typeof value === 'string' && (SETTINGS_CHANNELS as readonly string[]).includes(value)
}

/** The folders a person may be shown. Named, so no path crosses the bridge. */
export const REVEALABLE = ['avatars', 'personas', 'capabilities'] as const
export type Revealable = (typeof REVEALABLE)[number]

/** One persona, as the settings window lists it. */
export interface SettingsPersona {
  readonly id: string
  readonly name: string
  readonly voice: string
  readonly bubble: boolean
  readonly avatarId: string | null
  /** Where she came from, or null for the built-in. Shown, never sent back. */
  readonly source: string | null
}

/**
 * One avatar somebody could wear.
 *
 * `id` is **null for the built-in**, because that is what a persona actually
 * stores: `avatarId: null` means the shipped face. Inventing a name for it here
 * would create a second way to say the same thing, and the resolver would have
 * to learn the fake one.
 */
export interface SettingsAvatar {
  readonly id: string | null
  readonly builtIn: boolean
}

/** One capability, and whether she is actually offered it. */
export interface SettingsCapability {
  readonly name: string
  readonly description: string
  /**
   * `available` is a built-in she can call. `refused` is something found in the
   * user's folder that this build will not run — and does not describe to her
   * either, because a capability she offers and cannot perform is worse than
   * one she has never heard of.
   */
  readonly state: 'available' | 'refused'
  readonly why: string | null
}

/** Everything the settings window draws, answered in one call. */
export interface SettingsView {
  readonly wornId: string
  readonly personas: readonly SettingsPersona[]
  readonly avatars: readonly SettingsAvatar[]
  readonly voices: readonly string[]
  readonly capabilities: readonly SettingsCapability[]
  /** Named for display. Opening one goes through `settings:reveal` by kind. */
  readonly folders: Readonly<Record<Revealable, string>>
}

/** What may be changed about a persona from this window, and nothing else. */
export interface PersonaChange {
  readonly id: string
  readonly name?: string
  readonly voice?: string
  readonly bubble?: boolean
  readonly avatarId?: string | null
}

/** Whether a write landed, and what to say when it did not. */
export type SettingsWrite = { readonly ok: true } | { readonly ok: false; readonly why: string }

export interface MochiSettingsApi {
  read(): Promise<SettingsView>
  wear(id: string): Promise<SettingsWrite>
  save(change: PersonaChange): Promise<SettingsWrite>
  reveal(what: Revealable): void
}

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
  /**
   * What she said — with what is known about how much of it she was HEARD
   * saying.
   *
   * `heard` is null when she finished naturally: everything generated was
   * spoken, so there is nothing to cut. When she was interrupted it carries the
   * renderer's OBSERVATIONS and nothing more — where the cursor had reached,
   * and when the barge-in happened. Main does the cutting, because what is
   * remembered is a decision and decisions are main's.
   *
   * §58 measured the cost of not doing this: **~80–82% of an interrupted turn**
   * filed as though she had spoken it, and §55 counted 38 truncations in an
   * hour of ordinary use.
   */
  | {
      readonly kind: 'said'
      readonly transcript: string
      readonly heard: { readonly at: number; readonly interruptedAt: number } | null
    }
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

import type { FaceSpec } from './avatar-spec'

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
  /**
   * How she looks — the whole `FaceSpec`, resolved in main.
   *
   * Data, not a path. The renderer never reads the avatars folder: the format
   * is deliberately non-executable and bounded, and it is validated once, in
   * main, by `parseFaceSpec`. A renderer that loaded files would be a second
   * reader of user content in the process with the least authority.
   */
  readonly face: FaceSpec
  /**
   * How many things went wrong while assembling all this.
   *
   * A COUNT on the config rather than a channel of its own: the problems worth
   * showing all happen while resolving who she is and what she looks like, so
   * they are all known by the time this is answered. The companion needs only
   * enough to mark the control that opens the window where they are readable.
   */
  readonly problems: number
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
  /** Copy her words. There is no selecting text in a canvas. */
  copy(text: string): void
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
  /**
   * She was cut off partway through this one.
   *
   * Carried because the window is the only place a reader can see it, and
   * without it an interrupted turn is indistinguishable from a short one — the
   * text was silently shortened and nothing says so. An empty text with `cut`
   * is a turn she began and was cut off in before a word survived.
   */
  readonly cut: boolean
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
/** One thing that went wrong, as the window lists it. */
export interface HistoryProblem {
  readonly area: string
  readonly subject: string | null
  readonly detail: string
  readonly at: number
}

export interface MochiHistoryApi {
  /** Everything that went wrong this launch, newest first. */
  problems(): Promise<readonly HistoryProblem[]>
  /** Open the settings window. Opening it is all this can do. */
  settings(): void
  /** Whoever is worn. The window never gets to name a persona. */
  list(): Promise<{
    readonly persona: string
    readonly conversations: readonly HistoryConversation[]
  }>
  turns(token: string): Promise<readonly HistoryTurn[]>
  search(query: string): Promise<readonly HistoryHit[]>
}
